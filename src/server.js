'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const links = require('./links');
const views = require('./views');
const { LinkError } = links;

const STATIC_DIR = path.join(__dirname, '..', 'public');
const STATIC_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const MAX_BODY = 64 * 1024;

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
};

// options:
//   store       - a Store instance
//   prefix      - label shown before link names, default "see/"
//   userHeader  - header set by an auth proxy that names the signed-in user
//                 (e.g. "x-forwarded-email"). When set, links are owned and only
//                 their owner (or an admin) can change them.
//   admins      - users who can change any link
//   logger      - function(line) for request logs (default: none)
function createHandler({ store, prefix, userHeader = '', admins = [], logger = () => {} }) {
  userHeader = userHeader.toLowerCase();

  function context(req) {
    const host = req.headers.host || 'localhost';
    const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (req.socket.encrypted ? 'https' : 'http');
    const user = userHeader ? String(req.headers[userHeader] || '').trim() : '';
    return {
      origin: `${proto}://${host}`,
      prefix: prefix || 'see/',
      user,
    };
  }

  function canEdit(link, user) {
    if (!userHeader) return true; // no auth configured: open editing
    return !link.owner || link.owner === user || admins.includes(user);
  }

  function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
    res.end(res.req.method === 'HEAD' ? undefined : body);
  }

  function json(res, status, data) {
    send(res, status, JSON.stringify(data, null, 2) + '\n', 'application/json; charset=utf-8');
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new LinkError(413, 'Request body too large.'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        if (!size) return resolve({});
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
          resolve(data);
        } catch {
          reject(new LinkError(400, 'Body must be a JSON object.'));
        }
      });
      req.on('error', reject);
    });
  }

  // Blocks cross-site writes (CSRF). Browsers can't send JSON cross-origin
  // without a CORS preflight, and Origin / Sec-Fetch-Site reveal the caller.
  function checkWrite(req, ctx) {
    if (req.method !== 'DELETE' && !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      throw new LinkError(415, 'Send JSON with Content-Type: application/json.');
    }
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') throw new LinkError(403, 'Cross-site requests are not allowed.');
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      let host;
      try {
        host = new URL(origin).host;
      } catch {}
      if (host !== req.headers.host) throw new LinkError(403, 'Cross-site requests are not allowed.');
    } else if (origin === 'null') {
      throw new LinkError(403, 'Cross-site requests are not allowed.');
    }
    if (userHeader && !ctx.user) throw new LinkError(401, 'Sign in to change links.');
  }

  function editable(name, ctx) {
    const link = store.get(name);
    if (!link) throw new LinkError(404, `"${name}" does not exist.`);
    if (!canEdit(link, ctx.user)) throw new LinkError(403, `Only ${link.owner} can change this link.`);
    return link;
  }

  async function api(req, res, ctx, parts) {
    const [, resource, rawName, ...extra] = parts; // ['api', 'links', name?]
    if (resource !== 'links' || extra.length) throw new LinkError(404, 'Not found.');
    const name = rawName === undefined ? undefined : decodeURIComponent(rawName);
    const m = req.method;

    if (name === undefined) {
      if (m === 'GET' || m === 'HEAD') {
        const params = new URL(req.url, 'http://x').searchParams;
        const limit = Math.min(Math.max(parseInt(params.get('limit'), 10) || 1000, 1), 5000);
        return json(res, 200, { links: store.list({ q: params.get('q') || '', sort: params.get('sort') || 'name', limit }) });
      }
      if (m === 'POST') {
        checkWrite(req, ctx);
        const body = await readJson(req);
        const owner = userHeader ? ctx.user : String(body.owner ?? '');
        return json(res, 201, { link: store.create({ ...body, owner }, ctx.user) });
      }
      throw new LinkError(405, 'Method not allowed.');
    }

    if (m === 'GET' || m === 'HEAD') {
      const link = store.get(name);
      if (!link) throw new LinkError(404, `"${name}" does not exist.`);
      return json(res, 200, { link, history: store.history(link.id), canEdit: canEdit(link, ctx.user) });
    }
    if (m === 'PUT' || m === 'PATCH') {
      checkWrite(req, ctx);
      const body = await readJson(req);
      editable(name, ctx);
      return json(res, 200, { link: store.update(name, body, ctx.user) });
    }
    if (m === 'DELETE') {
      checkWrite(req, ctx);
      editable(name, ctx);
      store.delete(name, ctx.user);
      return json(res, 200, { deleted: true });
    }
    throw new LinkError(405, 'Method not allowed.');
  }

  function serveStatic(res, file) {
    const ext = path.extname(file);
    if (!/^[a-z0-9-]+\.[a-z]+$/i.test(file) || !STATIC_TYPES[ext]) throw new LinkError(404, 'Not found.');
    let body;
    try {
      body = fs.readFileSync(path.join(STATIC_DIR, file));
    } catch {
      throw new LinkError(404, 'Not found.');
    }
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': STATIC_TYPES[ext], 'Cache-Control': 'public, max-age=300' });
    res.end(res.req.method === 'HEAD' ? undefined : body);
  }

  async function system(req, res, ctx, parts) {
    const isRead = req.method === 'GET' || req.method === 'HEAD';
    switch (parts[0]) {
      case 'api':
        return api(req, res, ctx, parts);
      case 'static':
        if (!isRead || parts.length !== 2) break;
        return serveStatic(res, parts[1]);
      case 'help':
        if (!isRead) break;
        return send(res, 200, views.help(ctx));
      case 'export':
        if (!isRead) break;
        return send(res, 200, JSON.stringify(store.list({ sort: 'name', limit: 1e9 }), null, 2) + '\n', 'application/json; charset=utf-8', {
          'Content-Disposition': 'attachment; filename="links.json"',
        });
      case 'opensearch.xml':
        if (!isRead) break;
        return send(res, 200, views.opensearch(ctx), 'application/opensearchdescription+xml; charset=utf-8');
      case 'healthz':
        return send(res, 200, 'ok\n', 'text/plain; charset=utf-8');
    }
    throw new LinkError(404, 'Not found.');
  }

  function home(req, res, ctx, url) {
    const q = url.searchParams.get('q') || '';
    const sort = ['popular', 'recent', 'name'].includes(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'popular';
    const rows = store.list({ q, sort });
    send(res, 200, views.home({ ...ctx, rows, total: store.count(), q, sort }));
  }

  // see/name[/rest][?query]  -> redirect
  // see/name+                -> details page
  // unknown name            -> 404 page offering to create it
  function shortlink(req, res, ctx, url) {
    const [first, ...restParts] = url.pathname.slice(1).split('/');
    let name;
    try {
      name = decodeURIComponent(first);
    } catch {
      throw new LinkError(400, 'Malformed URL.');
    }
    const rest = restParts.join('/');

    if (name.endsWith('+') && !rest) {
      const link = store.get(name.slice(0, -1));
      if (!link) return shortlinkMissing(res, ctx, name.slice(0, -1));
      return send(res, 200, views.detail({ ...ctx, link, history: store.history(link.id), canEdit: canEdit(link, ctx.user) }));
    }

    const link = store.get(name);
    if (!link) return shortlinkMissing(res, ctx, name);
    const target = links.expand(link.url, rest, url.search);
    if (req.method === 'GET') store.recordVisit(link.id);
    logger(`${ctx.user || '-'} ${req.method} ${req.url} -> ${target}`);
    res.writeHead(302, { Location: target, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
    res.end();
  }

  function shortlinkMissing(res, ctx, name) {
    let validName = true;
    try {
      links.validateName(name);
    } catch {
      validName = false;
    }
    send(res, 404, views.notFound({ ...ctx, name, validName, suggestions: store.suggest(name) }));
  }

  return async function handle(req, res) {
    const ctx = context(req);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/.')) {
        return await system(req, res, ctx, url.pathname.slice(2).split('/'));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new LinkError(405, 'Method not allowed.');
      if (url.pathname === '/' || url.pathname === '') return home(req, res, ctx, url);
      if (url.pathname === '/favicon.ico') return serveStatic(res, 'favicon.svg');
      return shortlink(req, res, ctx, url);
    } catch (err) {
      const status = err instanceof LinkError ? err.status : 500;
      const message = err instanceof LinkError ? err.message : 'Something went wrong.';
      if (status === 500) console.error(err);
      if (res.headersSent) return res.end();
      if (req.url.startsWith('/.api/')) return json(res, status, { error: message });
      send(res, status, views.errorPage({ ...ctx, status, message }));
    }
  };
}

function createServer(options) {
  return http.createServer(createHandler(options));
}

module.exports = { createServer, createHandler };
