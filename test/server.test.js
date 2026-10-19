'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/db');
const { createServer } = require('../src/server');

async function start(options = {}) {
  const store = new Store(':memory:');
  const server = createServer({ store, prefix: 'go/', ...options });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = (path, init = {}) => fetch(base + path, { redirect: 'manual', ...init });
  const api = (method, path, body, headers = {}) =>
    req(path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
  return { store, base, req, api, close: () => new Promise((r) => server.close(r)) };
}

test('create, redirect, count visits', async (t) => {
  const s = await start();
  t.after(s.close);
  const res = await s.api('POST', '/.api/links', { name: 'GH', url: 'https://github.com', description: 'Code' });
  assert.equal(res.status, 201);

  let r = await s.req('/gh/nodejs/node?tab=readme');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'https://github.com/nodejs/node?tab=readme');

  r = await s.req('/G-h');
  assert.equal(r.headers.get('location'), 'https://github.com');

  const { link } = await (await s.req('/.api/links/gh')).json();
  assert.equal(link.visits, 2);
});

test('unknown link shows a create page with suggestions', async (t) => {
  const s = await start();
  t.after(s.close);
  s.store.create({ name: 'wiki', url: 'https://wiki.example.com' });
  const r = await s.req('/wikki');
  assert.equal(r.status, 404);
  const html = await r.text();
  assert.match(html, /doesn't exist yet/);
  assert.match(html, /value="wikki"/);
  assert.match(html, /Did you mean/);
  assert.match(html, /wiki\.example\.com/);
});

test('escapes HTML everywhere', async (t) => {
  const s = await start();
  t.after(s.close);
  s.store.create({ name: 'x', url: 'https://x.com/"><script>', description: '<img src=x onerror=alert(1)>' });
  const home = await (await s.req('/')).text();
  assert.doesNotMatch(home, /<script>|<img src=x/);
  const missing = await (await s.req('/%3Cscript%3Ealert(1)%3C%2Fscript%3E')).text();
  assert.doesNotMatch(missing, /<script>alert/);
});

test('detail page, update, rename and delete with history', async (t) => {
  const s = await start();
  t.after(s.close);
  s.store.create({ name: 'docs', url: 'https://a.com' });
  assert.equal((await s.req('/docs+')).status, 200);

  let r = await s.api('PUT', '/.api/links/docs', { name: 'handbook', url: 'b.com' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).link.url, 'https://b.com');
  assert.equal((await s.req('/docs')).status, 404);
  assert.equal((await s.req('/handbook')).headers.get('location'), 'https://b.com');

  const { history } = await (await s.req('/.api/links/handbook')).json();
  assert.deepEqual(history.map((h) => h.action), ['rename', 'create']);

  r = await s.api('DELETE', '/.api/links/handbook');
  assert.equal(r.status, 200);
  assert.equal((await s.req('/handbook')).status, 404);
});

test('rejects duplicates and invalid input', async (t) => {
  const s = await start();
  t.after(s.close);
  await s.api('POST', '/.api/links', { name: 'a-b', url: 'https://x.com' });
  let r = await s.api('POST', '/.api/links', { name: 'AB', url: 'https://y.com' });
  assert.equal(r.status, 409);
  r = await s.api('POST', '/.api/links', { name: 'js', url: 'javascript:alert(1)' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /http/);
});

test('blocks cross-site writes', async (t) => {
  const s = await start();
  t.after(s.close);
  let r = await s.req('/.api/links', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"name":"a","url":"x.com"}' });
  assert.equal(r.status, 415);
  r = await s.api('POST', '/.api/links', { name: 'a', url: 'x.com' }, { Origin: 'https://evil.com' });
  assert.equal(r.status, 403);
  r = await s.api('POST', '/.api/links', { name: 'a', url: 'x.com' }, { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(r.status, 403);
  assert.equal(s.store.count(), 0);
});

test('ownership when an auth proxy header is configured', async (t) => {
  const s = await start({ userHeader: 'X-User', admins: ['root'] });
  t.after(s.close);
  assert.equal((await s.api('POST', '/.api/links', { name: 'a', url: 'x.com' })).status, 401);
  assert.equal((await s.api('POST', '/.api/links', { name: 'a', url: 'x.com' }, { 'X-User': 'ann' })).status, 201);
  assert.equal((await s.api('PUT', '/.api/links/a', { url: 'y.com' }, { 'X-User': 'bob' })).status, 403);
  assert.equal((await s.api('PUT', '/.api/links/a', { url: 'y.com' }, { 'X-User': 'ann' })).status, 200);
  assert.equal((await s.api('DELETE', '/.api/links/a', undefined, { 'X-User': 'root' })).status, 200);
});

test('imports legacy mappings.json', () => {
  const store = new Store(':memory:');
  const n = store.importMappings({ '/google': 'http://www.google.com', '/bad name': 'http://x.com' });
  assert.equal(n, 1);
  assert.equal(store.get('google').url, 'http://www.google.com');
});

test('system pages', async (t) => {
  const s = await start();
  t.after(s.close);
  for (const p of ['/', '/.help', '/.export', '/.opensearch.xml', '/.static/style.css', '/.static/app.js', '/.healthz']) {
    assert.equal((await s.req(p)).status, 200, p);
  }
  assert.equal((await s.req('/.static/../src/db.js')).status, 404);
  assert.equal((await s.req('/.nope')).status, 404);
});
