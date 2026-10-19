'use strict';

// Rules for short link names and destinations, modeled on Google's go/ links:
//  - names are matched case-insensitively and ignore '-' and '_'
//    (go/Team-Docs, go/teamdocs and go/team_docs are the same link)
//  - extra path after the name is appended to the destination
//    (go/docs/setup -> https://docs.example.com/setup)
//  - a destination containing %s gets the extra path substituted instead
//    (go/bug/123 with https://bugs.example.com/show?id=%s)
//  - the request's query string is passed through to the destination

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MAX_URL = 4096;

class LinkError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function key(name) {
  return String(name).toLowerCase().replace(/[-_]/g, '');
}

function validateName(name) {
  name = String(name ?? '').trim();
  if (!NAME_RE.test(name) || !key(name)) {
    throw new LinkError(400, 'Names must start with a letter or digit and use only letters, digits, ".", "-" or "_" (max 100).');
  }
  return name;
}

function isWebUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateUrl(url) {
  url = String(url ?? '').trim();
  if (!url) throw new LinkError(400, 'A destination URL is required.');
  if (url.length > MAX_URL) throw new LinkError(400, 'Destination URL is too long.');
  // Allow "example.com/foo" as shorthand for https://example.com/foo
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
  if (!isWebUrl(url.split('%s').join('x'))) {
    throw new LinkError(400, 'Destination must be a valid http:// or https:// URL.');
  }
  return url;
}

// Builds the final redirect target for a link.
// rest: raw (still percent-encoded) path after the name, without leading '/'
// search: raw query string including '?', or ''
function expand(target, rest = '', search = '') {
  let out;
  if (target.includes('%s')) {
    out = target.split('%s').join(rest);
  } else if (rest) {
    const u = new URL(target);
    u.pathname = u.pathname.replace(/\/$/, '') + '/' + rest;
    out = u.toString();
  } else {
    out = target;
  }
  if (search && search !== '?') {
    const u = new URL(out);
    u.search = u.search ? u.search + '&' + search.slice(1) : search;
    out = u.toString();
  }
  if (!isWebUrl(out)) throw new LinkError(400, 'That link expands to an invalid URL.');
  return out;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

module.exports = { LinkError, key, validateName, validateUrl, expand, levenshtein, isWebUrl };
