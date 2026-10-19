'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { key, validateName, validateUrl, expand } = require('../src/links');

test('names match ignoring case, hyphens and underscores', () => {
  assert.equal(key('Team-Docs'), key('team_docs'));
  assert.equal(key('TEAMDOCS'), 'teamdocs');
});

test('rejects bad names', () => {
  for (const bad of ['', '-x', '.hidden', 'a b', 'a/b', 'x+', '<script>', 'a'.repeat(101)]) {
    assert.throws(() => validateName(bad), /Names must/, bad);
  }
  assert.equal(validateName(' ok.v2 '), 'ok.v2');
});

test('validates destination URLs', () => {
  assert.equal(validateUrl('example.com/a'), 'https://example.com/a');
  assert.equal(validateUrl('http://x.com/?q=%s'), 'http://x.com/?q=%s');
  assert.equal(validateUrl('https://%s.example.com'), 'https://%s.example.com');
  for (const bad of ['', 'javascript:alert(1)', 'ftp://x.com', 'data:text/html,hi', 'http://']) {
    assert.throws(() => validateUrl(bad), undefined, bad);
  }
});

test('expands extra path, templates and query strings', () => {
  assert.equal(expand('https://github.com'), 'https://github.com');
  assert.equal(expand('https://github.com', 'nodejs/node'), 'https://github.com/nodejs/node');
  assert.equal(expand('https://x.com/docs/', 'a'), 'https://x.com/docs/a');
  assert.equal(expand('https://x.com/docs#top', 'a'), 'https://x.com/docs/a#top');
  assert.equal(expand('https://bugs.x.com/show?id=%s', '123'), 'https://bugs.x.com/show?id=123');
  assert.equal(expand('https://x.com/s?q=%s', ''), 'https://x.com/s?q=');
  assert.equal(expand('https://x.com/a?b=1', '', '?c=2'), 'https://x.com/a?b=1&c=2');
  assert.equal(expand('https://x.com/a', 'p', '?c=2'), 'https://x.com/a/p?c=2');
});
