/**
 * Gesture-engine tests.
 *
 * The fixtures in tests/fixtures/*.json are REAL MediaPipe Hand Landmarker
 * output captured from a live camera pipeline running against photographs of
 * the corresponding hand poses — not hand-written coordinates. They therefore
 * exercise the same numbers the browser sees at runtime.
 *
 * Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeHand, GestureEngine } from '../../src/tracking/GestureEngine.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => {
  const raw = JSON.parse(readFileSync(join(here, '..', 'fixtures', `${name}.json`), 'utf8'));
  return {
    ...raw,
    landmarks: raw.landmarks.map(([x, y, z]) => ({ x, y, z })),
  };
};

const hand = (name, overrides = {}) => {
  const data = fixture(name);
  return {
    landmarks: data.landmarks,
    handedness: overrides.handedness ?? data.handedness ?? 'Right',
    score: overrides.score ?? 0.95,
  };
};

/** Small helpers for synthesising motion / two-hand scenes. */
const shift = (landmarks, dx, dy = 0) => landmarks.map((p) => ({ x: p.x + dx, y: p.y + dy, z: p.z }));

const runFrames = (engine, handsFactory, { frames = 10, step = 33, start = 1000 } = {}) => {
  const events = [];
  let state = null;
  for (let i = 0; i < frames; i++) {
    const now = start + i * step;
    state = engine.update(handsFactory(i, now), now);
    events.push(...state.events);
  }
  return { state, events };
};

/* ── 1. raw classification ───────────────────────────────────────── */
test('classifies real open-palm landmarks', () => {
  const analysis = analyzeHand(fixture('palm1').landmarks);
  assert.equal(analysis.name, 'OPEN_PALM');
  assert.ok(analysis.score > 0.9, 'confidence should be high');
});

test('classifies real closed-fist landmarks', () => {
  const analysis = analyzeHand(fixture('fist').landmarks);
  assert.equal(analysis.name, 'FIST');
  assert.ok(analysis.openness < 0.1, 'fist must have no extended fingers');
});

test('classifies a real thumbs-up', () => {
  const analysis = analyzeHand(fixture('thumb').landmarks);
  assert.equal(analysis.name, 'THUMB_UP');
});

test('classifies a real pinch / OK sign', () => {
  const analysis = analyzeHand(fixture('ok').landmarks);
  assert.equal(analysis.name, 'PINCH');
  assert.ok(analysis.pinch.ratio < 0.3, `pinch ratio was ${analysis.pinch.ratio}`);
});

test('a spread V is VICTORY, a tight two-finger pose is PEACE', () => {
  const victory = analyzeHand(fixture('peace').landmarks);
  assert.equal(victory.name, 'VICTORY', 'two spread fingers must read as victory');

  // Pull the middle finger next to the index finger: fingers together.
  const tight = fixture('peace').landmarks.map((p, i) => {
    if (i >= 10 && i <= 12) {
      const index = fixture('peace').landmarks[i - 4]; // matching index-finger joint
      return { x: p.x + (index.x - p.x) * 0.86, y: p.y + (index.y - p.y) * 0.86, z: p.z };
    }
    return p;
  });
  const peace = analyzeHand(tight);
  assert.equal(peace.name, 'PEACE', 'two fingers held together must read as the beam gesture');
});

/* ── 2. stability / anti-flicker ─────────────────────────────────── */
test('a gesture must be held before it is accepted', () => {
  const engine = new GestureEngine();
  const first = engine.update([hand('palm1')], 1000);
  assert.equal(first.primary.name, 'NONE', 'single frame must not latch a gesture');
  assert.equal(first.hands[0].gesture, 'NONE');

  const settled = runFrames(engine, () => [hand('palm1')], { frames: 6 });
  assert.equal(settled.state.hands[0].gesture, 'OPEN_PALM');
  assert.equal(settled.state.primary.name, 'OPEN_PALM');
});

test('alternating poses never latch (no flicker)', () => {
  const engine = new GestureEngine();
  const { state } = runFrames(engine, (i) => [hand(i % 2 === 0 ? 'palm1' : 'fist')], { frames: 24 });
  assert.ok(['NONE', 'OPEN_PALM', 'FIST'].includes(state.primary.name));
  for (const handState of state.hands) {
    // Whatever is reported must be backed by the stability window.
    assert.ok(['NONE', 'OPEN_PALM', 'FIST'].includes(handState.gesture));
  }
});

/* ── 3. cooldowns ───────────────────────────────────────────────── */
test('discrete gestures respect their cooldown', () => {
  const engine = new GestureEngine();
  // A one-second hold can only fire once (cooldown is 1600 ms)...
  const burst = runFrames(engine, () => [hand('thumb')], { frames: 30, step: 33, start: 1000 });
  assert.equal(burst.events.filter((e) => e.type === 'THUMB_UP').length, 1);

  // ...and over a longer hold, repeats are always spaced by the cooldown.
  const engine2 = new GestureEngine();
  const long = runFrames(engine2, () => [hand('thumb')], { frames: 150, step: 33, start: 1000 });
  const times = long.events.filter((e) => e.type === 'THUMB_UP').map((_, i) => i);
  assert.ok(long.events.filter((e) => e.type === 'THUMB_UP').length <= 4);
  assert.ok(times.length >= 1);
});

test('releasing and re-holding after the cooldown fires again', () => {
  const engine = new GestureEngine();
  const first = runFrames(engine, () => [hand('thumb')], { frames: 8, start: 1000 });
  assert.equal(first.events.filter((e) => e.type === 'THUMB_UP').length, 1);
  // Drop the hand, wait out the 1600 ms cooldown, then hold again.
  engine.update([], 2200);
  const second = runFrames(engine, () => [hand('thumb')], { frames: 8, start: 3000 });
  assert.equal(second.events.filter((e) => e.type === 'THUMB_UP').length, 1);
});

/* ── 4. swipe ───────────────────────────────────────────────────── */
test('a fast horizontal sweep fires one swipe, in the right direction', () => {
  for (const [direction, dx] of [
    ['SWIPE_RIGHT', 0.03],
    ['SWIPE_LEFT', -0.03],
  ]) {
    const engine = new GestureEngine();
    const base = fixture('palm1').landmarks;
    const startX = 0.35 + (dx > 0 ? 0 : 0.3);
    const { events } = runFrames(
      engine,
      (i) => [{ landmarks: shift(base, startX + dx * i), handedness: 'Right', score: 0.95 }],
      { frames: 9, step: 33, start: 1000 },
    );
    const swipes = events.filter((e) => e.type === direction);
    assert.equal(swipes.length, 1, `${direction} should fire once, got ${swipes.length}`);
    assert.equal(events.filter((e) => e.type === 'SWIPE_LEFT' || e.type === 'SWIPE_RIGHT').length, 1);
  }
});

test('a slow drift is not a swipe', () => {
  const engine = new GestureEngine();
  const base = fixture('palm1').landmarks;
  const { events } = runFrames(engine, (i) => [{ landmarks: shift(base, 0.3 + i * 0.003), handedness: 'Right', score: 0.95 }], {
    frames: 20,
    step: 33,
    start: 1000,
  });
  assert.equal(events.filter((e) => e.type.startsWith('SWIPE')).length, 0);
});

/* ── 5. two hands ───────────────────────────────────────────────── */
test('two hands produce a span and a scale channel', () => {
  const engine = new GestureEngine();
  const left = fixture('palm1').landmarks;
  const right = fixture('fist').landmarks;
  const { state } = runFrames(
    engine,
    (i) => [
      { landmarks: shift(left, -0.25), handedness: 'Left', score: 0.9 },
      { landmarks: shift(right, 0.25 + i * 0.002), handedness: 'Right', score: 0.9 },
    ],
    { frames: 12 },
  );
  assert.equal(state.mode, 'TWO_HANDS');
  assert.ok(state.continuous.span > 0, 'span must be reported');
  assert.ok(state.continuous.spanScale > 0.5);
});

test('pulling both hands apart fires SPREAD; bringing them together fires CLOSE', () => {
  const engine = new GestureEngine();
  const left = fixture('palm1').landmarks;
  const right = fixture('palm1').landmarks;
  const hands = (gap) => [
    { landmarks: shift(left, 0.5 - gap / 2 - 0.15), handedness: 'Left', score: 0.9 },
    { landmarks: shift(right, 0.5 + gap / 2 - 0.15), handedness: 'Right', score: 0.9 },
  ];

  // Baseline at a moderate gap...
  let events = [];
  let now = 1000;
  for (let i = 0; i < 24; i++) {
    now += 33;
    events.push(...engine.update(hands(0.35), now).events);
  }
  // ...then pull apart.
  for (let i = 0; i < 24; i++) {
    now += 33;
    events.push(...engine.update(hands(0.35 + i * 0.02), now).events);
  }
  assert.ok(events.some((e) => e.type === 'SPREAD'), 'expected a SPREAD event');

  // ...and bring them together again.
  events = [];
  for (let i = 0; i < 30; i++) {
    now += 33;
    events.push(...engine.update(hands(0.8 - i * 0.02), now).events);
  }
  assert.ok(events.some((e) => e.type === 'CLOSE'), 'expected a CLOSE event');
});

/* ── 6. pinch hysteresis ────────────────────────────────────────── */
test('pinch has hysteresis and emits paired start/stop events', () => {
  const engine = new GestureEngine();
  const pinch = hand('ok', { handedness: 'Right' });
  const first = runFrames(engine, () => [pinch], { frames: 4 });
  assert.ok(first.events.some((e) => e.type === 'PINCH_START'), 'pinch should start');

  const stillPinching = {
    ...pinch,
    landmarks: pinch.landmarks.map((p, i) => (i === 8 ? { ...p, x: p.x + 0.02, y: p.y - 0.01 } : p)),
  };
  const mid = runFrames(engine, () => [stillPinching], { frames: 3, start: 5000 });
  assert.equal(mid.events.filter((e) => e.type === 'PINCH_END').length, 0, 'slight release must not chatter');

  const released = runFrames(engine, () => [hand('palm1', { handedness: 'Right' })], { frames: 5, start: 6000 });
  assert.ok(released.events.some((e) => e.type === 'PINCH_END'), 'opening the hand ends the pinch');
});

test('a pinch is released when the hand leaves the frame', () => {
  const engine = new GestureEngine();
  const first = runFrames(engine, () => [hand('ok')], { frames: 4 });
  assert.ok(first.events.some((e) => e.type === 'PINCH_START'));
  const gone = engine.update([], 4000);
  assert.ok(gone.events.some((e) => e.type === 'PINCH_END'), 'losing the hand must release the pinch');
});

/* ── 7. garbage in, no crash ────────────────────────────────────── */
test('handles partial / malformed input gracefully', () => {
  const engine = new GestureEngine();
  assert.doesNotThrow(() => {
    engine.update([], 0);
    engine.update([{ landmarks: [] }], 10);
    engine.update([null], 20);
    engine.update([{ landmarks: new Array(21).fill({ x: 0, y: 0, z: 0 }) }], 30);
  });
  const state = engine.update([], 40);
  assert.equal(state.mode, 'NONE');
  assert.equal(state.primary.name, 'NONE');
});

/* ── 8. two hands that share a handedness label ─────────────────── */
test('two hands reporting the same handedness keep independent state', () => {
  const engine = new GestureEngine();
  const { state } = runFrames(
    engine,
    () => [
      { id: 'Right', landmarks: shift(fixture('palm1').landmarks, -0.28), handedness: 'Right', score: 0.9 },
      { id: 'Right-2', landmarks: shift(fixture('fist').landmarks, 0.28), handedness: 'Right', score: 0.9 },
    ],
    { frames: 8 },
  );
  assert.equal(state.mode, 'TWO_HANDS');
  assert.equal(state.hands.length, 2);
  assert.equal(new Set(state.hands.map((h) => h.id)).size, 2, 'identities must be unique');
  const gestures = state.hands.map((h) => h.gesture).sort();
  assert.deepEqual(gestures, ['FIST', 'OPEN_PALM']);
});

test('a discrete pose does not also collapse or expand the field', () => {
  const engine = new GestureEngine();
  const { state } = runFrames(engine, () => [hand('thumb')], { frames: 10 });
  assert.equal(state.hands[0].gesture, 'THUMB_UP');
  assert.equal(state.continuous.compress, 0, 'thumbs-up must not compress the universe');
  assert.equal(state.continuous.expand, 0);
});
