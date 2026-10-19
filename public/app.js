'use strict';

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // Toast messages
  const toastEl = $('#toast');
  let toastTimer;
  function toast(message, kind = 'error') {
    toastEl.textContent = message;
    toastEl.className = `toast ${kind}`;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 4000);
  }

  // Relative timestamps ("3 days ago")
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
  for (const el of $$('time[data-ts]')) {
    const ms = Number(el.dataset.ts);
    const diff = (ms - Date.now()) / 1000;
    const [unit, secs] = UNITS.find(([, s]) => Math.abs(diff) >= s) || ['second', 1];
    el.textContent = rtf.format(Math.round(diff / secs), unit);
    el.title = new Date(ms).toLocaleString();
  }

  async function call(method, url, data) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }

  // Create / edit forms
  for (const form of $$('form[data-link-form]')) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = $('button[type=submit]', form);
      const original = form.dataset.original;
      const data = Object.fromEntries(new FormData(form));
      button.disabled = true;
      try {
        const { link } = original
          ? await call('PUT', `/.api/links/${encodeURIComponent(original)}`, data)
          : await call('POST', '/.api/links', data);
        location.href = `/${encodeURIComponent(link.name)}+?saved`;
      } catch (err) {
        toast(err.message);
        button.disabled = false;
      }
    });
  }

  // Delete
  for (const btn of $$('[data-delete]')) {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete this link? This can't be undone.`)) return;
      try {
        await call('DELETE', `/.api/links/${encodeURIComponent(btn.dataset.delete)}`);
        location.href = '/?deleted';
      } catch (err) {
        toast(err.message);
      }
    });
  }

  // Copy to clipboard
  for (const btn of $$('[data-copy]')) {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        toast('Copied to clipboard', 'ok');
      } catch {
        toast('Could not copy — your browser blocked it.');
      }
    });
  }

  // Instant search on the home page
  const search = $('#search');
  if (search) {
    const rows = $$('table.links tbody tr');
    const none = $('#no-matches');
    const filter = () => {
      const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
      let shown = 0;
      for (const row of rows) {
        const hit = terms.every((t) => row.dataset.search.includes(t) || row.dataset.search.includes(t.replace(/[-_]/g, '')));
        row.hidden = !hit;
        if (hit) shown++;
      }
      if (none) none.hidden = shown > 0 || rows.length === 0;
    };
    search.addEventListener('input', filter);
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        e.preventDefault();
        search.focus();
        search.select();
      }
      if (e.key === 'Escape' && document.activeElement === search) {
        search.value = '';
        filter();
        search.blur();
      }
    });
  }

  const params = new URLSearchParams(location.search);
  if (params.has('saved')) toast('Saved', 'ok');
  if (params.has('deleted')) toast('Link deleted', 'ok');
  if (params.has('saved') || params.has('deleted')) history.replaceState(null, '', location.pathname);
})();
