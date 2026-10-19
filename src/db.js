'use strict';

const { DatabaseSync } = require('node:sqlite');
const links = require('./links');
const { LinkError } = links;

// Each entry runs once, in order; PRAGMA user_version tracks progress.
const MIGRATIONS = [
  `CREATE TABLE links (
     id              INTEGER PRIMARY KEY,
     key             TEXT    NOT NULL UNIQUE,
     name            TEXT    NOT NULL,
     url             TEXT    NOT NULL,
     description     TEXT    NOT NULL DEFAULT '',
     owner           TEXT    NOT NULL DEFAULT '',
     visits          INTEGER NOT NULL DEFAULT 0,
     created_at      INTEGER NOT NULL,
     updated_at      INTEGER NOT NULL,
     last_visited_at INTEGER
   );
   CREATE TABLE link_history (
     id      INTEGER PRIMARY KEY,
     link_id INTEGER NOT NULL,
     action  TEXT    NOT NULL,
     name    TEXT    NOT NULL,
     url     TEXT    NOT NULL,
     actor   TEXT    NOT NULL DEFAULT '',
     at      INTEGER NOT NULL
   );
   CREATE INDEX link_history_by_link ON link_history(link_id, at);`,
];

const SORTS = {
  popular: 'visits DESC, key ASC',
  recent: 'updated_at DESC, key ASC',
  name: 'key ASC',
};

const plain = (row) => (row ? { ...row } : null);

function cleanText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

class Store {
  constructor(file = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  migrate() {
    const { user_version: version } = this.db.prepare('PRAGMA user_version').get();
    for (let i = version; i < MIGRATIONS.length; i++) {
      this.tx(() => {
        this.db.exec(MIGRATIONS[i]);
        this.db.exec(`PRAGMA user_version = ${i + 1}`);
      });
    }
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close() {
    this.db.close();
  }

  count() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM links').get().n;
  }

  get(name) {
    return plain(this.db.prepare('SELECT * FROM links WHERE key = ?').get(links.key(name)));
  }

  getById(id) {
    return plain(this.db.prepare('SELECT * FROM links WHERE id = ?').get(id));
  }

  list({ q = '', sort = 'popular', limit = 1000 } = {}) {
    const order = SORTS[sort] || SORTS.popular;
    q = String(q).trim();
    if (!q) {
      return this.db.prepare(`SELECT * FROM links ORDER BY ${order} LIMIT ?`).all(limit).map(plain);
    }
    const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    const keyLike = '%' + links.key(q).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    return this.db
      .prepare(
        `SELECT * FROM links
         WHERE key LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
         ORDER BY ${order} LIMIT ?`
      )
      .all(keyLike, like, like, limit)
      .map(plain);
  }

  // Close matches for a name that doesn't exist, for "did you mean" hints.
  suggest(name, max = 5) {
    const k = links.key(name);
    if (!k) return [];
    return this.db
      .prepare('SELECT * FROM links')
      .all()
      .map((row) => {
        const d = links.levenshtein(k, row.key);
        const contains = row.key.includes(k) || k.includes(row.key);
        return { row, score: contains ? Math.min(d, 1) : d };
      })
      .filter(({ score }) => score <= Math.max(1, Math.floor(k.length / 3)))
      .sort((a, b) => a.score - b.score || b.row.visits - a.row.visits)
      .slice(0, max)
      .map(({ row }) => plain(row));
  }

  history(id) {
    return this.db
      .prepare('SELECT action, name, url, actor, at FROM link_history WHERE link_id = ? ORDER BY at DESC, id DESC LIMIT 50')
      .all(id)
      .map(plain);
  }

  log(id, action, name, url, actor, at) {
    this.db
      .prepare('INSERT INTO link_history (link_id, action, name, url, actor, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, action, name, url, actor || '', at);
  }

  create(input, actor = '') {
    const name = links.validateName(input.name);
    const url = links.validateUrl(input.url);
    const description = cleanText(input.description, 500);
    const owner = cleanText(input.owner ?? actor, 200);
    return this.tx(() => {
      const existing = this.get(name);
      if (existing) throw new LinkError(409, `"${existing.name}" already exists.`);
      const now = Date.now();
      const { lastInsertRowid } = this.db
        .prepare(
          `INSERT INTO links (key, name, url, description, owner, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(links.key(name), name, url, description, owner, now, now);
      const id = Number(lastInsertRowid);
      this.log(id, 'create', name, url, actor, now);
      return this.getById(id);
    });
  }

  // Applies only the fields present in `input`. Supports renaming.
  update(currentName, input, actor = '') {
    return this.tx(() => {
      const link = this.get(currentName);
      if (!link) throw new LinkError(404, `"${currentName}" does not exist.`);
      const next = { ...link };
      if (input.name !== undefined) next.name = links.validateName(input.name);
      if (input.url !== undefined) next.url = links.validateUrl(input.url);
      if (input.description !== undefined) next.description = cleanText(input.description, 500);
      if (input.owner !== undefined) next.owner = cleanText(input.owner, 200);
      next.key = links.key(next.name);
      if (next.key !== link.key && this.get(next.name)) {
        throw new LinkError(409, `"${next.name}" already exists.`);
      }
      const now = Date.now();
      this.db
        .prepare('UPDATE links SET key = ?, name = ?, url = ?, description = ?, owner = ?, updated_at = ? WHERE id = ?')
        .run(next.key, next.name, next.url, next.description, next.owner, now, link.id);
      this.log(link.id, next.key !== link.key ? 'rename' : 'update', next.name, next.url, actor, now);
      return this.getById(link.id);
    });
  }

  delete(name, actor = '') {
    return this.tx(() => {
      const link = this.get(name);
      if (!link) throw new LinkError(404, `"${name}" does not exist.`);
      this.db.prepare('DELETE FROM links WHERE id = ?').run(link.id);
      this.log(link.id, 'delete', link.name, link.url, actor, Date.now());
      return link;
    });
  }

  recordVisit(id) {
    this.db.prepare('UPDATE links SET visits = visits + 1, last_visited_at = ? WHERE id = ?').run(Date.now(), id);
  }

  // Imports the legacy mappings.json format: { "/name": "https://..." }.
  // Returns the number of links created; invalid or duplicate entries are skipped.
  importMappings(mappings, actor = 'import') {
    let created = 0;
    for (const [path, url] of Object.entries(mappings)) {
      try {
        this.create({ name: path.replace(/^\/+/, ''), url, owner: '' }, actor);
        created++;
      } catch (err) {
        if (!(err instanceof LinkError)) throw err;
      }
    }
    return created;
  }
}

module.exports = { Store };
