#!/usr/bin/env node
/**
 * Copies MediaPipe's wasm runtime out of node_modules into public/wasm so the
 * app can boot completely offline (no jsdelivr / Google CDN round-trips).
 *
 * Runs automatically via `postinstall`, `dev` and `build`. Safe to re-run.
 */
import { existsSync, mkdirSync, copyFileSync, statSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const dest = join(root, 'public/wasm');
const model = join(root, 'public/models/hand_landmarker.task');

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

function copyWasm() {
  if (!existsSync(src)) {
    console.warn('[assets] @mediapipe/tasks-vision is not installed yet — run "npm install" first.');
    return;
  }
  mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const file of readdirSync(src)) {
    if (!/\.(js|wasm)$/.test(file)) continue;
    const from = join(src, file);
    const to = join(dest, file);
    const upToDate = existsSync(to) && statSync(to).size === statSync(from).size;
    if (!upToDate) {
      copyFileSync(from, to);
      copied++;
    }
  }
  console.log(`[assets] wasm runtime ready in public/wasm (${copied} file(s) copied).`);
}

async function ensureModel() {
  if (existsSync(model) && statSync(model).size > 1_000_000) {
    console.log('[assets] hand_landmarker.task present.');
    return;
  }
  console.warn('[assets] model file missing — trying to download it from the MediaPipe CDN...');
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(model), { recursive: true });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(model, buf);
    console.log(`[assets] downloaded model (${(buf.length / 1e6).toFixed(1)} MB).`);
  } catch (err) {
    console.warn(`[assets] could not download the model (${err.message}).`);
    console.warn('[assets] The app will fall back to the MediaPipe CDN at runtime;');
    console.warn('[assets] for offline use place hand_landmarker.task in public/models/.');
  }
}

copyWasm();
await ensureModel();
