#!/usr/bin/env node
'use strict';

/*
 *  see — a short link server: type see/name to go anywhere.
 *
 *  Usage: node see.js [port]
 *
 *  Environment:
 *    PORT             port to listen on (default 80; the first argument wins)
 *    SEE_DB           SQLite database file (default ./see.db)
 *    SEE_PREFIX       label shown before names (default "see/")
 *    SEE_USER_HEADER  header from your auth proxy naming the user, e.g. x-forwarded-email.
 *                     Enables link ownership. Leave unset to let anyone edit.
 *    SEE_ADMINS       comma-separated users who can edit any link
 */

// node:sqlite is stable in practice but still prints an experimental warning.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  if (String(warning).includes('SQLite')) return;
  return emitWarning.call(process, warning, ...args);
};

const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./src/db');
const { createServer } = require('./src/server');

const port = Number(process.argv[2] || process.env.PORT || 80);
const dbFile = process.env.SEE_DB || path.join(__dirname, 'see.db');
const store = new Store(dbFile);

// First run: bring over links from the old mappings.json file.
const legacy = path.join(__dirname, 'mappings.json');
if (store.count() === 0 && fs.existsSync(legacy)) {
  const created = store.importMappings(JSON.parse(fs.readFileSync(legacy, 'utf8')));
  console.log(`Imported ${created} links from mappings.json`);
}

const server = createServer({
  store,
  prefix: process.env.SEE_PREFIX,
  userHeader: process.env.SEE_USER_HEADER || '',
  admins: (process.env.SEE_ADMINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  logger: console.log,
});

server.listen(port, () => console.log(`see is running on http://localhost:${port} (database: ${dbFile})`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    store.close();
    process.exit(0);
  });
}
