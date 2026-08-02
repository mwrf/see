"""The settings page and history dashboard.

Plain HTML and a little vanilla JS, served as string constants.  No build step,
no framework, no npm -- this has to be editable over SSH on a Pi at midnight,
and usable one-handed on a phone.
"""

from __future__ import annotations

_STYLE = """
:root {
  color-scheme: dark light;
  --bg: #101216; --card: #191d24; --line: #262c36;
  --fg: #e8ecf2; --muted: #9aa5b4; --accent: #4da3ff; --ok: #3ddc84; --bad: #ff5c5c;
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0 0 4rem; background: var(--bg); color: var(--fg);
  font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
header {
  position: sticky; top: 0; z-index: 5; background: var(--bg);
  border-bottom: 1px solid var(--line); padding: .9rem 1rem;
  display: flex; align-items: baseline; gap: .75rem;
}
header h1 { font-size: 1.15rem; margin: 0; letter-spacing: .02em; }
header a { color: var(--muted); text-decoration: none; font-size: .85rem; }
header a:hover { color: var(--accent); }
main { max-width: 46rem; margin: 0 auto; padding: 1rem; }
fieldset {
  border: 1px solid var(--line); border-radius: 12px; background: var(--card);
  margin: 0 0 1rem; padding: .8rem 1rem 1rem;
}
legend { padding: 0 .4rem; color: var(--muted); font-size: .78rem; text-transform: uppercase;
  letter-spacing: .08em; }
label { display: block; margin: .7rem 0 .2rem; font-size: .9rem; color: var(--muted); }
input, select {
  width: 100%; padding: .6rem .7rem; font-size: 1rem; color: var(--fg);
  background: #0d1015; border: 1px solid var(--line); border-radius: 8px;
}
input[type=checkbox] { width: auto; margin-right: .5rem; }
.row { display: flex; gap: .75rem; }
.row > * { flex: 1; }
.check { display: flex; align-items: center; margin: .5rem 0; color: var(--fg); font-size: .95rem; }
button {
  width: 100%; padding: .85rem; font-size: 1rem; font-weight: 600; border: 0; border-radius: 10px;
  background: var(--accent); color: #06101c; cursor: pointer;
}
button.secondary { background: #2a313c; color: var(--fg); }
.bar { position: fixed; left: 0; right: 0; bottom: 0; padding: .75rem 1rem calc(.75rem + env(safe-area-inset-bottom));
  background: rgba(16,18,22,.94); border-top: 1px solid var(--line);
  display: flex; gap: .75rem; max-width: 46rem; margin: 0 auto; }
#status { min-height: 1.2rem; font-size: .85rem; color: var(--muted); padding: 0 .2rem 1rem; }
#status.ok { color: var(--ok); } #status.bad { color: var(--bad); }
.pill { display: inline-block; padding: .1rem .5rem; border-radius: 999px; font-size: .72rem;
  background: #232a34; color: var(--muted); }
table { width: 100%; border-collapse: collapse; font-size: .85rem; }
th, td { text-align: left; padding: .45rem .4rem; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 500; font-size: .72rem; text-transform: uppercase; }
.swatch { display: inline-block; width: .7rem; height: .7rem; border-radius: 2px; margin-right: .4rem;
  vertical-align: -1px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr)); gap: .6rem; }
.stat { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: .7rem; }
.stat b { display: block; font-size: 1.4rem; font-weight: 600; }
.stat span { color: var(--muted); font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; }
footer { color: var(--muted); font-size: .75rem; text-align: center; padding: 1.5rem 1rem 0; }
@media (max-width: 30rem) { .row { flex-direction: column; gap: 0; } }
"""

SETTINGS_HTML = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SkyPanel settings</title>
<style>{_STYLE}</style>
</head>
<body>
<header>
  <h1>SkyPanel</h1>
  <a href="/dashboard">dashboard</a>
  <a href="/healthz">health</a>
  <span id="src" class="pill">…</span>
</header>
<main>
  <div id="status"></div>
  <form id="f">
    <fieldset>
      <legend>Location</legend>
      <div class="row">
        <div><label for="home_lat">Latitude</label><input id="home_lat" name="home_lat" type="number" step="0.0001" required></div>
        <div><label for="home_lon">Longitude</label><input id="home_lon" name="home_lon" type="number" step="0.0001" required></div>
      </div>
      <label for="site_name">Site name</label><input id="site_name" name="site_name">
      <label for="scan_radius_mi">Scan radius (1–200 mi)</label>
      <input id="scan_radius_mi" name="scan_radius_mi" type="number" min="1" max="200" step="1">
    </fieldset>

    <fieldset>
      <legend>Units</legend>
      <div class="row">
        <div><label for="altitude_unit">Altitude</label>
          <select id="altitude_unit" name="altitude_unit"><option value="ft">feet</option><option value="m">metres</option></select></div>
        <div><label for="speed_unit">Speed</label>
          <select id="speed_unit" name="speed_unit"><option value="kt">knots</option><option value="mph">mph</option><option value="kmh">km/h</option></select></div>
        <div><label for="distance_unit">Distance</label>
          <select id="distance_unit" name="distance_unit"><option value="mi">miles</option><option value="km">km</option></select></div>
      </div>
    </fieldset>

    <fieldset>
      <legend>What to show</legend>
      <label for="route_display">Route as</label>
      <select id="route_display" name="route_display"><option value="codes">airport codes</option><option value="cities">city names</option></select>
      <div class="check"><input type="checkbox" id="show_airline_line" name="show_airline_line"><label for="show_airline_line" style="margin:0">Airline name</label></div>
      <div class="check"><input type="checkbox" id="show_flight_line" name="show_flight_line"><label for="show_flight_line" style="margin:0">Flight, route and type</label></div>
      <div class="check"><input type="checkbox" id="show_detail_line" name="show_detail_line"><label for="show_detail_line" style="margin:0">Altitude, speed and distance</label></div>
      <div class="check"><input type="checkbox" id="show_vert_rate" name="show_vert_rate"><label for="show_vert_rate" style="margin:0">Climb / descent rate</label></div>
    </fieldset>

    <fieldset>
      <legend>Filters</legend>
      <div id="cats"></div>
      <div class="row">
        <div><label for="min_altitude_ft">Min altitude (ft)</label><input id="min_altitude_ft" name="min_altitude_ft" type="number" step="100"></div>
        <div><label for="max_altitude_ft">Max altitude (ft)</label><input id="max_altitude_ft" name="max_altitude_ft" type="number" step="100"></div>
      </div>
    </fieldset>

    <fieldset>
      <legend>Panel</legend>
      <div class="row">
        <div><label for="brightness">Brightness</label><input id="brightness" name="brightness" type="range" min="0" max="100"></div>
        <div><label for="night_brightness">Night brightness</label><input id="night_brightness" name="night_brightness" type="range" min="0" max="100"></div>
      </div>
      <div class="row">
        <div><label for="night_start">Night starts</label><input id="night_start" name="night_start" placeholder="23:00"></div>
        <div><label for="night_end">Night ends</label><input id="night_end" name="night_end" placeholder="07:00"></div>
      </div>
      <label for="poll_interval_s">Poll interval (s)</label>
      <input id="poll_interval_s" name="poll_interval_s" type="number" min="1" max="300">
    </fieldset>

    <fieldset>
      <legend>Track a flight</legend>
      <label for="ident">Flight ident (BA249, RYR1812, EI-DYR)</label>
      <div class="row">
        <input id="ident" placeholder="BA249">
        <button type="button" id="track" style="flex:0 0 8rem">Track</button>
      </div>
      <button type="button" class="secondary" id="untrack" style="margin-top:.6rem">Back to nearest</button>
    </fieldset>
  </form>
  <footer id="attrib"></footer>
</main>
<div class="bar">
  <button type="button" class="secondary" id="reload">Reload</button>
  <button type="button" id="save">Save</button>
</div>
<script>
const CATS = ["airline", "military", "helicopter", "ga", "unknown"];
const $ = (id) => document.getElementById(id);
let current = {{}};

function say(msg, kind) {{
  const el = $("status");
  el.textContent = msg;
  el.className = kind || "";
  if (kind === "ok") setTimeout(() => {{ el.textContent = ""; el.className = ""; }}, 2500);
}}

function renderCats(selected) {{
  $("cats").innerHTML = CATS.map((c) =>
    `<div class="check"><input type="checkbox" id="cat_${{c}}" value="${{c}}"` +
    `${{selected.includes(c) ? " checked" : ""}}><label for="cat_${{c}}" style="margin:0">${{c}}</label></div>`
  ).join("");
}}

function fill(s) {{
  for (const [k, v] of Object.entries(s)) {{
    if (k === "categories") {{ renderCats(v); continue; }}
    const el = $(k);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = Boolean(v); else el.value = v;
  }}
}}

function collect() {{
  const out = {{}};
  for (const k of Object.keys(current)) {{
    if (k === "categories") continue;
    const el = $(k);
    if (!el) continue;
    out[k] = el.type === "checkbox" ? el.checked : el.value;
  }}
  out.categories = CATS.filter((c) => $("cat_" + c) && $("cat_" + c).checked);
  return out;
}}

async function load() {{
  const r = await fetch("/api/settings");
  const data = await r.json();
  current = data.settings;
  fill(current);
  $("src").textContent = data.meta.active_source + " · " + data.meta.airlines_known + " airlines";
  $("attrib").textContent = data.meta.attribution || "";
}}

async function save() {{
  const r = await fetch("/api/settings", {{
    method: "POST",
    headers: {{ "Content-Type": "application/json" }},
    body: JSON.stringify(collect()),
  }});
  const data = await r.json();
  if (!r.ok) return say(data.detail || "save failed", "bad");
  current = data.settings;
  fill(current);
  say("Saved — the panel picks this up on its next poll.", "ok");
}}

async function track() {{
  const ident = $("ident").value.trim();
  if (!ident) return say("Enter a flight ident first", "bad");
  const r = await fetch("/api/track", {{
    method: "POST", headers: {{ "Content-Type": "application/json" }},
    body: JSON.stringify({{ ident }}),
  }});
  say(r.ok ? "Tracking " + ident : "Could not start tracking", r.ok ? "ok" : "bad");
}}

$("save").onclick = save;
$("reload").onclick = () => load().then(() => say("Reloaded", "ok"));
$("track").onclick = track;
$("untrack").onclick = async () => {{
  await fetch("/api/track/cancel", {{ method: "POST" }});
  say("Back to nearest-aircraft mode", "ok");
}};
$("f").addEventListener("submit", (e) => {{ e.preventDefault(); save(); }});
load().catch((e) => say(String(e), "bad"));
</script>
</body>
</html>
"""


DASHBOARD_HTML = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SkyPanel history</title>
<style>{_STYLE}</style>
</head>
<body>
<header>
  <h1>SkyPanel history</h1>
  <a href="/">settings</a>
  <select id="hours" style="width:auto;padding:.25rem .4rem;font-size:.8rem">
    <option value="1">1 h</option><option value="6">6 h</option>
    <option value="24" selected>24 h</option><option value="168">7 d</option>
  </select>
</header>
<main>
  <div class="stats" id="stats"></div>
  <fieldset style="margin-top:1rem">
    <legend>Seen</legend>
    <table><thead><tr>
      <th>Flight</th><th>Airline</th><th>Type</th><th>Route</th><th>Closest</th><th>Last seen</th>
    </tr></thead><tbody id="rows"></tbody></table>
  </fieldset>
  <footer id="attrib"></footer>
</main>
<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g,
  (c) => ({{ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }})[c]);
const ago = (t) => {{
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 90) return Math.round(s) + "s";
  if (s < 5400) return Math.round(s / 60) + "m";
  return Math.round(s / 3600) + "h";
}};

async function load() {{
  const hours = $("hours").value;
  const r = await fetch("/api/history?hours=" + hours);
  const data = await r.json();
  const s = data.summary;
  $("stats").innerHTML = [
    ["aircraft", s.aircraft], ["sightings", s.sightings],
    ["closest", s.closest_mi == null ? "—" : s.closest_mi + " mi"],
    ["highest", s.highest_ft == null ? "—" : Math.round(s.highest_ft).toLocaleString() + " ft"],
  ].map(([k, v]) => `<div class="stat"><b>${{esc(v)}}</b><span>${{k}}</span></div>`).join("");

  $("rows").innerHTML = data.sightings.map((row) => `<tr>
    <td>${{esc(row.callsign || row.registration || row.hex)}}</td>
    <td><span class="swatch" style="background:${{esc(row.airline_colour || "#666")}}"></span>${{esc(row.airline_name || "—")}}</td>
    <td>${{esc(row.type_code || "—")}}</td>
    <td>${{esc(row.origin || "?")}} → ${{esc(row.destination || "?")}}</td>
    <td>${{row.closest_mi == null ? "—" : row.closest_mi.toFixed(1) + " mi"}}</td>
    <td>${{ago(row.last_seen)}} ago</td></tr>`).join("")
    || '<tr><td colspan="6" style="color:var(--muted)">Nothing yet.</td></tr>';
}}

fetch("/api/settings").then((r) => r.json())
  .then((d) => {{ $("attrib").textContent = d.meta.attribution || ""; }})
  .catch(() => {{}});
$("hours").onchange = load;
load();
setInterval(load, 30000);
</script>
</body>
</html>
"""
