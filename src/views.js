'use strict';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const enc = encodeURIComponent;

function time(ms, fallback = 'Never') {
  if (!ms) return esc(fallback);
  const iso = new Date(ms).toISOString();
  return `<time data-ts="${ms}" datetime="${iso}">${iso.slice(0, 10)}</time>`;
}

function layout({ title, prefix, user, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/.static/style.css">
<link rel="icon" href="/.static/favicon.svg" type="image/svg+xml">
<link rel="search" type="application/opensearchdescription+xml" title="${esc(prefix)}" href="/.opensearch.xml">
<script src="/.static/app.js" defer></script>
</head>
<body>
<header class="topbar">
  <div class="wrap topbar-inner">
    <a class="brand" href="/"><span class="brand-mark">${esc(prefix)}</span><span class="brand-name">short links</span></a>
    <nav class="topnav">
      <a href="/">All links</a>
      <a href="/.help">How it works</a>
      ${user ? `<span class="user" title="Signed in">${esc(user)}</span>` : ''}
    </nav>
  </div>
</header>
<main class="wrap">
${body}
</main>
<footer class="wrap footer">
  <span>see — short links, go/ style.</span>
  <a href="/.export">Export JSON</a>
</footer>
<div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
</body>
</html>`;
}

function linkForm({ prefix, link, name = '', focus = 'name' }) {
  const v = link || { name, url: '', description: '', owner: '' };
  return `<form class="link-form" data-link-form${link ? ` data-original="${esc(link.name)}"` : ''}>
  <label class="field">
    <span class="label">Short name</span>
    <span class="input-group">
      <span class="prefix">${esc(prefix)}</span>
      <input name="name" required maxlength="100" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]*"
        value="${esc(v.name)}" placeholder="team-docs" autocomplete="off" autocapitalize="off" spellcheck="false"${focus === 'name' ? ' autofocus' : ''}>
    </span>
  </label>
  <label class="field grow">
    <span class="label">Destination URL</span>
    <input name="url" required inputmode="url" value="${esc(v.url)}" placeholder="https://docs.example.com/team"
      autocomplete="off" autocapitalize="off" spellcheck="false"${focus === 'url' ? ' autofocus' : ''}>
  </label>
  <label class="field full">
    <span class="label">Description <em>optional</em></span>
    <input name="description" maxlength="500" value="${esc(v.description)}" placeholder="What is this link for?">
  </label>
  ${link ? `<label class="field full">
    <span class="label">Owner <em>who can change this link</em></span>
    <input name="owner" maxlength="200" value="${esc(v.owner)}" placeholder="Anyone can edit" autocomplete="off">
  </label>` : ''}
  <div class="actions full">
    <p class="hint">Extra path is appended: <code>${esc(prefix)}name/more</code> → <code>…/more</code>. Use <code>%s</code> to choose where it goes.</p>
    <button class="btn primary" type="submit">${link ? 'Save changes' : 'Create link'}</button>
  </div>
</form>`;
}

function linkTable(prefix, rows) {
  return `<div class="table-wrap"><table class="links">
  <thead><tr><th>Short link</th><th>Destination</th><th class="num">Visits</th><th class="hide-sm">Updated</th></tr></thead>
  <tbody>
  ${rows
    .map(
      (l) => `<tr data-search="${esc(`${l.name} ${l.key} ${l.url} ${l.description}`.toLowerCase())}">
    <td><a class="short" href="/${enc(l.name)}+">${esc(prefix)}<strong>${esc(l.name)}</strong></a>${
        l.description ? `<div class="desc">${esc(l.description)}</div>` : ''
      }</td>
    <td class="dest"><a href="/${enc(l.name)}" title="${esc(l.url)}">${esc(l.url.replace(/^https?:\/\//, ''))}</a></td>
    <td class="num">${l.visits.toLocaleString('en-US')}</td>
    <td class="hide-sm muted">${time(l.updated_at)}</td>
  </tr>`
    )
    .join('\n')}
  </tbody>
</table></div>`;
}

function home({ prefix, user, rows, total, q, sort }) {
  const tabs = [
    ['popular', 'Popular'],
    ['recent', 'Recent'],
    ['name', 'A–Z'],
  ]
    .map(([s, label]) => {
      const href = `/?sort=${s}${q ? `&q=${enc(q)}` : ''}`;
      return `<a href="${href}"${s === sort ? ' class="active" aria-current="page"' : ''}>${label}</a>`;
    })
    .join('');
  const list = rows.length
    ? linkTable(prefix, rows)
    : `<div class="empty">${q ? `No links match “${esc(q)}”.` : 'No links yet. Create the first one above.'}</div>`;
  return layout({
    title: `${prefix} short links`,
    prefix,
    user,
    body: `<section class="card hero">
  <h1>Create a short link</h1>
  <p class="muted">Memorable names for long URLs. Type <code>${esc(prefix)}name</code> in any browser to jump there.</p>
  ${linkForm({ prefix, focus: q ? '' : 'name' })}
</section>
<section class="card">
  <div class="list-head">
    <form class="search" method="get" action="/" role="search">
      <input type="search" name="q" id="search" value="${esc(q)}" placeholder="Search ${total.toLocaleString('en-US')} links…" aria-label="Search links" autocomplete="off">
      <input type="hidden" name="sort" value="${esc(sort)}">
      <kbd class="hide-sm">/</kbd>
    </form>
    <nav class="tabs" aria-label="Sort">${tabs}</nav>
  </div>
  ${list}
  <div class="empty" id="no-matches" hidden>No links match your search.</div>
</section>`,
  });
}

function detail({ prefix, user, origin, link, history, canEdit }) {
  const short = `${prefix}${link.name}`;
  const historyItems = history
    .map(
      (h) => `<li><span class="badge ${esc(h.action)}">${esc(h.action)}</span>
      <span class="hist-url">${esc(h.name)} → ${esc(h.url)}</span>
      <span class="muted">${h.actor ? `by ${esc(h.actor)} · ` : ''}${time(h.at)}</span></li>`
    )
    .join('');
  return layout({
    title: short,
    prefix,
    user,
    body: `<section class="card">
  <div class="detail-head">
    <div class="detail-title">
      <div class="eyebrow">Short link</div>
      <h1 class="shortname">${esc(short)}</h1>
      <a class="dest-big" href="${esc(link.url)}" rel="noreferrer">${esc(link.url)}</a>
      ${link.description ? `<p>${esc(link.description)}</p>` : ''}
    </div>
    <div class="head-actions">
      <button class="btn" type="button" data-copy="${esc(`${origin}/${link.name}`)}">Copy link</button>
      <a class="btn primary" href="/${enc(link.name)}">Open</a>
    </div>
  </div>
  <dl class="stats">
    <div><dt>Visits</dt><dd>${link.visits.toLocaleString('en-US')}</dd></div>
    <div><dt>Last used</dt><dd>${time(link.last_visited_at)}</dd></div>
    <div><dt>Owner</dt><dd>${link.owner ? esc(link.owner) : '<span class="muted">Anyone</span>'}</dd></div>
    <div><dt>Created</dt><dd>${time(link.created_at)}</dd></div>
  </dl>
</section>
<section class="card">
  <h2>Edit</h2>
  ${canEdit ? linkForm({ prefix, link, focus: '' }) : `<p class="muted">Only ${esc(link.owner)} can change this link.</p>`}
</section>
${history.length ? `<section class="card"><h2>History</h2><ol class="history">${historyItems}</ol></section>` : ''}
${canEdit ? `<section class="card danger-zone">
  <h2>Delete</h2>
  <p class="muted">Anyone visiting <code>${esc(short)}</code> will be offered the chance to recreate it.</p>
  <button class="btn danger" type="button" data-delete="${esc(link.name)}">Delete ${esc(short)}</button>
</section>` : ''}`,
  });
}

function notFound({ prefix, user, name, suggestions, validName }) {
  const sugg = suggestions.length
    ? `<section class="card"><h2>Did you mean…</h2><ul class="suggest">${suggestions
        .map(
          (l) => `<li><a class="short" href="/${enc(l.name)}">${esc(prefix)}<strong>${esc(l.name)}</strong></a>
          <span class="muted">${esc(l.url)}</span></li>`
        )
        .join('')}</ul></section>`
    : '';
  return layout({
    title: `${prefix}${name} — not found`,
    prefix,
    user,
    body: `<section class="card hero">
  <div class="eyebrow">Not found</div>
  <h1><span class="shortname">${esc(prefix + name)}</span> doesn't exist yet</h1>
  <p class="muted">${validName ? 'Claim it now — paste where it should go.' : 'That isn’t a valid link name, but you can create a similar one.'}</p>
  ${linkForm({ prefix, name: validName ? name : '', focus: validName ? 'url' : 'name' })}
</section>
${sugg}`,
  });
}

function help({ prefix, user, origin }) {
  const p = esc(prefix);
  return layout({
    title: `How ${prefix} links work`,
    prefix,
    user,
    body: `<section class="card prose">
  <h1>How it works</h1>
  <p>Point <code>${p}</code> at this server (a DNS search domain or hosts entry), then type <code>${p}name</code> in any browser.</p>
  <h2>Names</h2>
  <p>Names ignore case, hyphens and underscores: <code>${p}Team-Docs</code>, <code>${p}teamdocs</code> and <code>${p}team_docs</code> are the same link.</p>
  <h2>Extra path</h2>
  <p>Anything after the name is added to the destination. If <code>${p}gh</code> points to <code>https://github.com</code>, then <code>${p}gh/nodejs/node</code> opens <code>https://github.com/nodejs/node</code>. Query strings are passed through too.</p>
  <h2>Templates</h2>
  <p>Put <code>%s</code> in a destination to choose where the extra path goes. With <code>https://bugs.example.com/show?id=%s</code>, <code>${p}bug/1234</code> opens bug 1234.</p>
  <h2>Shortcuts</h2>
  <ul>
    <li>Visit an unknown link to create it on the spot.</li>
    <li>Add <code>+</code> to see a link's details and history: <code>${p}name+</code>.</li>
    <li>Press <kbd>/</kbd> on the home page to search.</li>
    <li>Add this site as a browser search engine (<code>${esc(origin)}/%s</code>) to use links from the address bar.</li>
  </ul>
  <h2>API</h2>
  <p>JSON at <code>/.api/links</code> (GET, POST) and <code>/.api/links/&lt;name&gt;</code> (GET, PUT, DELETE). Export everything from <a href="/.export">/.export</a>.</p>
</section>`,
  });
}

function errorPage({ prefix, user, status, message }) {
  return layout({
    title: `${status} — ${prefix}`,
    prefix,
    user,
    body: `<section class="card hero"><div class="eyebrow">Error ${status}</div><h1>${esc(message)}</h1><p><a href="/">Back to all links</a></p></section>`,
  });
}

function opensearch({ prefix, origin }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>${esc(prefix)}</ShortName>
  <Description>${esc(prefix)} short links</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Url type="text/html" method="get" template="${esc(origin)}/{searchTerms}"/>
</OpenSearchDescription>`;
}

module.exports = { esc, home, detail, notFound, help, errorPage, opensearch };
