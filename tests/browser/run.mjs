#!/usr/bin/env node
/**
 * Headless browser smoke test for WONDER/SNAP.
 *
 * It drives the real UI in a real (headless) Chromium: keyboard controls,
 * mode switching, panels, reset, console errors and responsive layout.
 * Webcam gestures are NOT simulated here — they are verified manually with a
 * real camera (see README → "Testing every gesture"). The optional --camera
 * flag below only checks that the sensor boots and the model loads.
 *
 * Usage
 *   npm run test:browser                    # boots vite on port 4319 itself
 *   BASE_URL=http://localhost:5173 npm run test:browser   # use a running server
 *   CHROME_PATH=/usr/bin/chromium npm run test:browser
 *   FAKE_CAMERA=/path/to/clip.y4m npm run test:browser -- --camera
 *
 * Requires Google Chrome / Chromium (puppeteer-core does not download one).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';
import puppeteer from 'puppeteer-core';

const PORT = Number(process.env.TEST_PORT || 4319);
const EXTERNAL_URL = process.env.BASE_URL;
const WITH_CAMERA = process.argv.includes('--camera');
const HEADFUL = process.env.HEADFUL === '1';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

const results = [];
const log = (...args) => console.log(...args);

function check(name, fn) {
  results.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findChrome() {
  for (const path of CHROME_CANDIDATES) {
    if (existsSync(path)) return path;
  }
  console.error(
    '\n[test:browser] No Chrome/Chromium binary found.\n' +
      'Set CHROME_PATH to your browser executable, e.g.\n' +
      '  CHROME_PATH=/usr/bin/chromium npm run test:browser\n',
  );
  process.exit(2);
}

async function waitForServer(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Server at ${url} did not become ready in ${timeoutMs} ms`);
}

/* ------------------------------------------------------------------ checks */

check('boots without a boot screen', async ({ page }) => {
  const state = await page.evaluate(() => ({
    bootHidden: document.getElementById('boot').dataset.hidden === 'true',
    canvas: !!document.querySelector('canvas'),
    title: document.title,
  }));
  assert(state.bootHidden, 'boot overlay never disappeared');
  assert(state.canvas, 'WebGL canvas missing');
  assert(/WONDER/i.test(state.title), `unexpected title: ${state.title}`);
});

check('renders four visual modes and switches between them', async ({ page }) => {
  const initial = await page.evaluate(() => ({
    count: document.querySelectorAll('.mode-button').length,
    mode: window.__wondersnap.visualizer.mode.name,
    pressed: [...document.querySelectorAll('.mode-button')].map((b) => b.getAttribute('aria-pressed')),
  }));
  assert(initial.count === 4, `expected 4 mode buttons, found ${initial.count}`);
  assert(initial.pressed[0] === 'true', 'first mode should start selected');

  await page.click('.mode-button[data-mode-index="2"]');
  await page.waitForFunction(() => window.__wondersnap.visualizer.mode.name === 'ION', { timeout: 5000 });
  const pressed = await page.evaluate(() =>
    [...document.querySelectorAll('.mode-button')].map((b) => b.getAttribute('aria-pressed')),
  );
  assert(pressed[2] === 'true' && pressed[0] === 'false', 'mode button state did not follow the scene');

  await page.keyboard.press('[');
  await page.waitForFunction(() => window.__wondersnap.visualizer.mode.name !== 'ION', { timeout: 5000 });
});

check('Q expands and E compresses the field', async ({ page }) => {
  const reset = async () => page.evaluate(() => {
    window.__wondersnap.visualizer.reset();
    return true;
  });
  await reset();

  await page.keyboard.down('q');
  await new Promise((r) => setTimeout(r, 1400));
  await page.keyboard.up('q');
  const expanded = await page.evaluate(() => window.__wondersnap.visualizer.manual.expand);
  assert(expanded > 0.02, `Q did not expand the field (manual.expand=${expanded.toFixed(3)})`);

  await page.keyboard.down('e');
  await new Promise((r) => setTimeout(r, 1600));
  await page.keyboard.up('e');
  const compressed = await page.evaluate(() => window.__wondersnap.visualizer.manual.expand);
  assert(compressed < expanded, `E did not reduce the field (${compressed.toFixed(3)} vs ${expanded.toFixed(3)})`);
});

check('SPACE grabs the hologram and releases it', async ({ page }) => {
  await page.keyboard.down('Space');
  await new Promise((r) => setTimeout(r, 1200));
  const grabbed = await page.evaluate(() => window.__wondersnap.visualizer.smooth.grab);
  assert(grabbed > 0.1, `hologram did not grab (smooth.grab=${grabbed.toFixed(3)})`);

  await page.keyboard.up('Space');
  await new Promise((r) => setTimeout(r, 1200));
  const released = await page.evaluate(() => window.__wondersnap.visualizer.smooth.grab);
  assert(released < grabbed, 'hologram stayed grabbed after releasing SPACE');
});

check('V arms the energy arc and X starts overdrive', async ({ page }) => {
  await page.keyboard.press('v');
  await page.waitForFunction(() => window.__wondersnap.visualizer.manualArcActive === true, { timeout: 5000 });
  await page.keyboard.press('v');
  await page.waitForFunction(() => window.__wondersnap.visualizer.manualArcActive === false, { timeout: 5000 });

  await page.keyboard.press('x');
  // The HUD is refreshed on a 100 ms interval, so give it a beat before reading.
  await new Promise((r) => setTimeout(r, 600));
  const overdrive = await page.evaluate(() => ({
    active: window.__wondersnap.visualizer.overdriveActive,
    hud: document.getElementById('overdriveState').textContent,
  }));
  assert(overdrive.active, 'X did not engage overdrive');
  assert(/ACTIVE/i.test(overdrive.hud), `overdrive HUD read "${overdrive.hud}"`);
});

check('gesture map opens and closes', async ({ page }) => {
  await page.keyboard.press('h');
  await page.waitForFunction(() => !document.getElementById('reference').hidden, { timeout: 5000 });
  const entries = await page.evaluate(() => document.querySelectorAll('.gesture-item').length);
  assert(entries >= 10, `gesture map only listed ${entries} gestures`);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('reference').hidden, { timeout: 5000 });
});

check('sound toggle and reset work', async ({ page }) => {
  const before = await page.evaluate(() => document.getElementById('soundButton').getAttribute('aria-pressed'));
  await page.keyboard.press('m');
  await page.waitForFunction(
    (prev) => document.getElementById('soundButton').getAttribute('aria-pressed') !== prev,
    { timeout: 5000 },
    before,
  );

  await page.click('.mode-button[data-mode-index="1"]');
  await page.waitForFunction(() => window.__wondersnap.visualizer.mode.name === 'QUASAR', { timeout: 5000 });
  await page.click('#resetButton');
  await page.waitForFunction(() => window.__wondersnap.visualizer.mode.name === 'NEBULA', { timeout: 5000 });
});

check('tutorial replays and dismisses', async ({ page }) => {
  await page.keyboard.press('t');
  await page.waitForFunction(() => !document.getElementById('tutorial').hidden, { timeout: 5000 });
  await page.click('#tutorialSkip');
  await page.waitForFunction(() => document.getElementById('tutorial').hidden, { timeout: 5000 });
});

check('no horizontal overflow at desktop and phone widths', async ({ page }) => {
  for (const [width, height] of [[1280, 800], [768, 1024], [390, 844]]) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await new Promise((r) => setTimeout(r, 450));
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    assert(
      overflow.scrollWidth <= overflow.innerWidth + 1,
      `${width}px viewport overflows horizontally (${overflow.scrollWidth} > ${overflow.innerWidth})`,
    );
  }
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
});

check('optional: camera boots and the hand model loads', async ({ page }) => {
  if (!WITH_CAMERA) {
    log('   (skipped — pass --camera with FAKE_CAMERA=<clip.y4m> or a real webcam)');
    return;
  }
  await page.click('#startButton');
  await page.waitForFunction(() => window.__wondersnap.cameraActive === true, { timeout: 120000 });
  const tracker = await page.evaluate(() => ({
    delegate: window.__wondersnap.tracker.delegate,
    model: window.__wondersnap.tracker.modelSource,
    wasm: window.__wondersnap.tracker.wasmSource,
    hands: window.__wondersnap.tracker.lastResult.hands.length,
  }));
  assert(tracker.model, 'landmark model did not load');
  log(`   delegate=${tracker.delegate} model=${tracker.model} wasm=${tracker.wasm} hands=${tracker.hands}`);
  await page.click('#stopButton');
  await page.waitForFunction(() => window.__wondersnap.cameraActive === false, { timeout: 15000 });
});

/* -------------------------------------------------------------------- main */

const chromePath = findChrome();
const baseUrl = EXTERNAL_URL || `http://localhost:${PORT}`;
let server = null;

if (!EXTERNAL_URL) {
  log(`[test:browser] starting vite on port ${PORT} …`);
  server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  server.stdout.on('data', (d) => process.env.VERBOSE && process.stdout.write(d));
  server.stderr.on('data', (d) => process.env.VERBOSE && process.stderr.write(d));
}

const cleanup = () => {
  if (server && !server.killed) server.kill('SIGTERM');
};
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

let browser;
let failures = 0;

try {
  await waitForServer(baseUrl);
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: HEADFUL ? false : 'shell',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--no-first-run',
      ...(WITH_CAMERA ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] : []),
      ...(process.env.FAKE_CAMERA ? [`--use-file-for-fake-video-capture=${process.env.FAKE_CAMERA}`] : []),
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // External font/CDN requests are blocked in some sandboxes; they are not app errors.
    if (/fonts\.googleapis|fonts\.gstatic|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_INTERNET/.test(text)) return;
    consoleErrors.push(text);
  });

  await page.goto(`${baseUrl}/?quality=low`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('boot').dataset.hidden === 'true', { timeout: 45000 });
  await page.evaluate(() => {
    if (!document.getElementById('tutorial').hidden) document.getElementById('tutorialSkip').click();
  });
  await new Promise((r) => setTimeout(r, 400));

  log('');
  for (const { name, fn } of results) {
    const started = Date.now();
    try {
      await fn({ page, browser });
      log(`  ✓ ${name}  (${Date.now() - started} ms)`);
    } catch (error) {
      failures += 1;
      log(`  ✗ ${name}\n      ${error.message}`);
    }
  }

  const overflowErrors = consoleErrors.filter((e) => !/favicon/.test(e));
  if (overflowErrors.length) {
    failures += 1;
    log(`  ✗ console stayed clean\n      ${overflowErrors.join('\n      ')}`);
  } else {
    log('  ✓ console stayed clean');
  }

  const shots = process.env.SCREENSHOT_DIR;
  if (shots) {
    await page.screenshot({ path: `${shots}/test-browser.png` });
    log(`\n[test:browser] screenshot written to ${shots}/test-browser.png`);
  }
} catch (error) {
  failures += 1;
  console.error(`\n[test:browser] fatal: ${error.stack || error.message}`);
} finally {
  await browser?.close();
  cleanup();
}

log(failures === 0 ? '\nAll browser checks passed.\n' : `\n${failures} browser check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
