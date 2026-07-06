/**
 * Browser smoke test + screenshots.
 * Serves dist/ via `vite preview`, boots the app in Chromium, powers on the
 * audio engine, programs steps, plays, and verifies the playhead advances.
 * Screenshots land in scripts/shots/.
 *
 * Usage: node scripts/browser-check.mjs
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 4173;
const BASE = `http://localhost:${PORT}`;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await wait(200);
  }
  throw new Error('preview server did not start');
}

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
});

const shotsDir = new URL('./shots/', import.meta.url).pathname;
mkdirSync(shotsDir, { recursive: true });

let failed = false;

try {
  await waitForServer(BASE);
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });

  const errors = [];

  async function bootPage(viewport, label) {
    const page = await browser.newPage({ viewport });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const loc = msg.location();
        errors.push(`[${label}] console: ${msg.text()} @ ${loc.url ?? '?'}`);
      }
    });
    page.on('response', (res) => {
      if (res.status() >= 400) errors.push(`[${label}] http ${res.status()}: ${res.url()}`);
    });
    page.on('pageerror', (err) => errors.push(`[${label}] pageerror: ${err.message}`));
    await page.goto(BASE);
    await page.click('.start-btn');
    await page.waitForSelector('.start-overlay', { state: 'detached', timeout: 15000 });
    return page;
  }

  // --- desktop landscape: full interaction test
  const page = await bootPage({ width: 1440, height: 900 }, 'desktop');

  // program four-on-the-floor on D1 (selected by default)
  const keys = page.locator('.stepkey');
  for (const i of [0, 4, 8, 12]) await keys.nth(i).click();
  // verify step LEDs lit
  for (const i of [0, 4, 8, 12]) {
    const led = keys.nth(i).locator('.pbtn-led');
    const cls = await led.getAttribute('class');
    if (!cls.includes('led-on')) throw new Error(`step ${i} LED not lit after toggle`);
  }

  // select D4 (hat) and add offbeats
  await page.locator('.pbtn-part', { hasText: 'D4' }).click();
  for (const i of [2, 6, 10, 14]) await keys.nth(i).click();

  // play and watch the playhead move
  await page.locator('.pbtn-play').click();
  await wait(300);
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const idx = await page.evaluate(() => {
      const el = document.querySelector('.stepkey-playhead');
      if (!el) return -1;
      return [...document.querySelectorAll('.stepkey')].indexOf(el);
    });
    if (idx >= 0) seen.add(idx);
    await wait(90);
  }
  if (seen.size < 4) throw new Error(`playhead barely moved; positions seen: ${[...seen].join(',')}`);
  console.log('playhead positions seen:', [...seen].sort((a, b) => a - b).join(', '));

  // knob drag: turn cutoff down on D1
  await page.locator('.pbtn-part', { hasText: 'D1' }).click();
  const cutoff = page.locator('.sec-filter .knob-dial').nth(1);
  const box = await cutoff.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 5 });
  await page.mouse.up();
  console.log('knob drag ok');

  // keyboard mode: play a note live on S1
  await page.locator('.pbtn-part', { hasText: 'S1' }).click();
  await page.locator('.pbtn-sm', { hasText: 'KEYBOARD' }).click();
  await keys.nth(7).click();
  await page.locator('.pbtn-sm', { hasText: 'STEP' }).first().click();
  console.log('keyboard mode ok');

  // step editor: toggle a step on S1, long-press it, edit note
  await keys.nth(0).click();
  const key0 = await keys.nth(0).boundingBox();
  await page.mouse.move(key0.x + key0.width / 2, key0.y + key0.height / 2);
  await page.mouse.down();
  await wait(700);
  await page.mouse.up();
  await page.waitForSelector('.step-editor', { timeout: 3000 });
  await page.click('.step-editor [data-a="note+"]');
  const noteVal = await page.textContent('.step-editor [data-v="note"]');
  await page.click('.step-editor [data-a="close"]');
  console.log('step editor ok, note now', noteVal);

  // song mode: append two events and check the info line
  await page.locator('.sec-song .pbtn-sm', { hasText: '+ PTN' }).click();
  await page.locator('.sec-song .pbtn-sm', { hasText: '+ PTN' }).click();
  const songInfo = await page.textContent('.song-info');
  if (!songInfo.includes('2 events')) throw new Error(`song info wrong: ${songInfo}`);
  console.log('song mode ok:', songInfo);

  await page.locator('.pbtn-big', { hasText: '■' }).click();
  await page.screenshot({ path: `${shotsDir}desktop-landscape.png` });
  await page.close();

  // --- phone portrait + landscape screenshots
  const portrait = await bootPage({ width: 390, height: 844 }, 'portrait');
  await wait(400);
  await portrait.screenshot({ path: `${shotsDir}phone-portrait.png` });
  await portrait.close();

  const landscape = await bootPage({ width: 844, height: 390 }, 'landscape');
  await wait(400);
  await landscape.screenshot({ path: `${shotsDir}phone-landscape.png` });
  await landscape.close();

  const tablet = await bootPage({ width: 1024, height: 768 }, 'tablet');
  await wait(400);
  await tablet.screenshot({ path: `${shotsDir}tablet-landscape.png` });
  await tablet.close();

  await browser.close();

  const fatal = errors.filter((e) => !e.includes('favicon'));
  if (fatal.length) {
    console.error('console/page errors:\n' + fatal.join('\n'));
    failed = true;
  } else {
    console.log('browser check PASSED — screenshots in scripts/shots/');
  }
} catch (err) {
  console.error('browser check FAILED:', err);
  failed = true;
} finally {
  preview.kill();
}

process.exit(failed ? 1 : 0);
