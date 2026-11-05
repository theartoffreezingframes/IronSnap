/**
 * GestureEngine
 * -------------
 * Turns 21-landmark hands into stable, debounced gesture state.
 *
 * Design notes
 *  • Every measurement that matters is normalised by the palm size
 *    (wrist → middle MCP), so it works at any distance from the camera.
 *  • Finger extension combines joint angles (rotation invariant) with a
 *    reach ratio (depth tolerant) — one alone is not reliable.
 *  • Nothing fires until it has been held for STABILITY_FRAMES frames, and
 *    every discrete gesture has its own cooldown, so a hand hovering between
 *    poses cannot machine-gun effects.
 *  • Continuous channels (openness, compression, grab strength, span) are
 *    emitted every frame so the 3D scene can react smoothly rather than
 *    snapping between poses.
 *
 * The module is pure/headless on purpose: it is unit tested with synthetic
 * landmark fixtures (see tests/unit/gesture-engine.test.mjs).
 */
import {
  GESTURE_COOLDOWNS,
  MIN_CONFIDENCE,
  STABILITY_FRAMES,
  SWIPE,
  FIELD,
} from '../config.js';
import { angleAt, clamp, dist3, ema, palmSize, smoothstep } from './geometry.js';

const FINGERS = {
  index: { mcp: 5, pip: 6, dip: 7, tip: 8 },
  middle: { mcp: 9, pip: 10, dip: 11, tip: 12 },
  ring: { mcp: 13, pip: 14, dip: 15, tip: 16 },
  pinky: { mcp: 17, pip: 18, dip: 19, tip: 20 },
};

/** Extension score 0..1 for one non-thumb finger. */
function fingerExtension(lm, finger) {
  const wrist = lm[0];
  const { mcp, pip, dip, tip } = finger;
  const a1 = angleAt(lm[mcp], lm[pip], lm[dip]);
  const a2 = angleAt(lm[pip], lm[dip], lm[tip]);
  const straight = clamp((0.5 * (a1 + a2) - 118) / 52, 0, 1);
  const reach = dist3(lm[tip], wrist) / Math.max(dist3(lm[mcp], wrist), 1e-5);
  const reachScore = clamp((reach - 1.07) / 0.34, 0, 1);
  return clamp(straight * 0.55 + reachScore * 0.45, 0, 1);
}

/** Extension / abduction score 0..1 for the thumb. */
function thumbExtension(lm, palm) {
  const a1 = angleAt(lm[1], lm[2], lm[3]);
  const a2 = angleAt(lm[2], lm[3], lm[4]);
  const straight = clamp((0.5 * (a1 + a2) - 132) / 42, 0, 1);
  const reach = dist3(lm[4], lm[2]) / palm;
  const reachScore = clamp((reach - 0.62) / 0.5, 0, 1);
  // Thumb tip held far from the little-finger knuckle ⇒ splayed out of the fist.
  const splay = clamp((dist3(lm[4], lm[17]) / palm - 0.78) / 0.55, 0, 1);
  return clamp(straight * 0.35 + reachScore * 0.3 + splay * 0.35, 0, 1);
}

/**
 * Raw per-hand analysis. Exported for unit tests.
 * @param {Array<{x:number,y:number,z?:number}>} lm 21 landmarks (already mirrored)
 * @param {{pinchWasActive?:boolean}} [opts]
 */
export function analyzeHand(lm, opts = {}) {
  const palm = palmSize(lm);
  const ext = {
    index: fingerExtension(lm, FINGERS.index),
    middle: fingerExtension(lm, FINGERS.middle),
    ring: fingerExtension(lm, FINGERS.ring),
    pinky: fingerExtension(lm, FINGERS.pinky),
  };
  const thumb = thumbExtension(lm, palm);

  const fourMean = (ext.index + ext.middle + ext.ring + ext.pinky) / 4;
  const fourMax = Math.max(ext.index, ext.middle, ext.ring, ext.pinky);

  // Pinch uses tip proximity and has hysteresis so it does not chatter.
  const pinchRatio = dist3(lm[4], lm[8]) / palm;
  const pinchEnter = 0.3;
  const pinchExit = 0.42;
  const pinchActive = opts.pinchWasActive ? pinchRatio < pinchExit : pinchRatio < pinchEnter;
  const pinchStrength = clamp(1 - pinchRatio / pinchExit, 0, 1);

  // Victory vs "two fingers together": the angle between index & middle tips.
  const vSpread = dist3(lm[8], lm[12]) / palm;

  // Thumb-up: every other finger folded, thumb clearly out of the palm.
  const thumbUp =
    fourMax < 0.42 && thumb > 0.6 && dist3(lm[4], lm[8]) / palm > 0.55 ? clamp(thumb, 0, 1) : 0;

  const twoFingers =
    ext.index > 0.62 && ext.middle > 0.62 && ext.ring < 0.45 && ext.pinky < 0.45;

  let name = 'NONE';
  let score = 0;

  if (pinchActive && ext.middle > 0.22) {
    name = 'PINCH';
    score = clamp(0.55 + pinchStrength * 0.45, 0, 1);
  } else if (thumbUp > 0) {
    name = 'THUMB_UP';
    score = thumbUp;
  } else if (twoFingers) {
    // Spread = victory (V). Together = focused two-finger beam.
    // Threshold calibrated against real MediaPipe output: a clear V measures
    // ≈0.46 palm units between fingertips, fingers held together measure <0.2.
    name = vSpread > 0.34 ? 'VICTORY' : 'PEACE';
    score = clamp(0.55 + Math.min(ext.index, ext.middle) * 0.45, 0, 1);
  } else if (fourMean > 0.68 && thumb > 0.35) {
    name = 'OPEN_PALM';
    score = clamp(0.5 + fourMean * 0.5, 0, 1);
  } else if (fourMax < 0.4 && thumb < 0.62) {
    name = 'FIST';
    score = clamp(0.55 + (1 - fourMean) * 0.45, 0, 1);
  }

  return {
    name,
    score,
    palm,
    ext,
    thumb,
    openness: fourMean,
    pinch: { active: pinchActive, ratio: pinchRatio, strength: pinchStrength },
    spread: vSpread,
    pointer: { x: lm[9].x, y: lm[9].y, z: lm[9].z ?? 0 },
    pinchPoint: { x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 },
  };
}

/** Tracks how long a candidate gesture has been held. */
class StabilityTracker {
  constructor(frames = STABILITY_FRAMES, minConfidence = MIN_CONFIDENCE) {
    this.frames = frames;
    this.minConfidence = minConfidence;
    this.reset();
  }

  reset() {
    this.candidate = null;
    this.count = 0;
    this.samples = [];
    this.accepted = null;
    this.acceptedScore = 0;
    this.misses = 0;
  }

  push(name, score) {
    if (name !== this.candidate) {
      this.candidate = name;
      this.count = 1;
      this.samples = [score];
    } else {
      this.count++;
      this.samples.push(score);
      if (this.samples.length > 8) this.samples.shift();
    }
    const mean = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    const stable = this.count >= this.frames && mean >= this.minConfidence;

    if (stable && name !== 'NONE') {
      this.accepted = name;
      this.acceptedScore = mean;
      this.misses = 0;
    } else if (this.accepted) {
      // Require two consecutive misses before dropping, kills single-frame dropouts.
      if (name !== this.accepted) this.misses++;
      if (this.misses >= 2) {
        this.accepted = null;
        this.acceptedScore = 0;
        this.misses = 0;
      }
    }
    return { accepted: this.accepted, acceptedScore: this.acceptedScore, stable };
  }
}

export class GestureEngine {
  constructor(options = {}) {
    this.cooldowns = { ...GESTURE_COOLDOWNS, ...(options.cooldowns || {}) };
    this.stabilityFrames = options.stabilityFrames ?? STABILITY_FRAMES;
    this.minConfidence = options.minConfidence ?? MIN_CONFIDENCE;
    this.reset();
  }

  reset() {
    this.trackers = new Map(); // handedness → StabilityTracker
    this.history = new Map(); // handedness → swipe history
    this.lastFired = new Map(); // gesture → timestamp
    this.pinchActive = new Map();
    this.pinchEmitted = new Map();
    this.swipeLock = new Map();
    this.spanBaseline = ema(0, 0.035);
    this.spanRef = 0;
    this.spreadArmed = true;
    this.closeArmed = true;
    this.lastSpan = null;
    this.primary = { name: 'NONE', score: 0, hand: null, since: 0 };
    this.time = 0;
  }

  canFire(gesture, now) {
    const cooldown = this.cooldowns[gesture] ?? 0;
    const last = this.lastFired.get(gesture) ?? -Infinity;
    return now - last >= cooldown;
  }

  markFired(gesture, now) {
    this.lastFired.set(gesture, now);
  }

  trackerFor(handedness) {
    let tracker = this.trackers.get(handedness);
    if (!tracker) {
      tracker = new StabilityTracker(this.stabilityFrames, this.minConfidence);
      this.trackers.set(handedness, tracker);
    }
    return tracker;
  }

  swipeHistoryFor(handedness) {
    let history = this.history.get(handedness);
    if (!history) {
      history = [];
      this.history.set(handedness, history);
    }
    return history;
  }

  /**
   * @param {Array<{landmarks:Array,handedness:string,score:number}>} hands
   * @param {number} now timestamp in ms
   */
  update(hands = [], now = 0) {
    const events = [];
    this.time = now;
    const seen = new Set();
    const handStates = [];

    for (const hand of hands) {
      if (!hand?.landmarks || hand.landmarks.length < 21) continue;
      const id = hand.id || hand.handedness || `H${seen.size}`;
      seen.add(id);

      const wasPinching = this.pinchActive.get(id) ?? false;
      const analysis = analyzeHand(hand.landmarks, { pinchWasActive: wasPinching });
      const tracker = this.trackerFor(id);
      const stable = tracker.push(analysis.name, analysis.score);
      const accepted = stable.accepted;

      // ---- pinch edges ------------------------------------------------
      // The continuous grab strength reacts immediately (see continuous.grab),
      // but the discrete PINCH_START only fires once the pose is stable, so a
      // fist passing through a pinch-like frame cannot snap the hologram.
      const pinching = analysis.pinch.active;
      const emitted = this.pinchEmitted.get(id) ?? false;
      if (pinching && stable.accepted === 'PINCH' && !emitted && this.canFire('PINCH', now)) {
        this.markFired('PINCH', now);
        this.pinchEmitted.set(id, true);
        events.push({ type: 'PINCH_START', strength: analysis.pinch.strength, handedness: id });
      } else if ((!pinching && (wasPinching || emitted)) || (emitted && stable.accepted !== 'PINCH')) {
        this.pinchEmitted.set(id, false);
        events.push({ type: 'PINCH_END', strength: 0, handedness: id });
      }
      this.pinchActive.set(id, pinching);

      // ---- swipe -------------------------------------------------------
      const history = this.swipeHistoryFor(id);
      history.push({ x: analysis.pointer.x, y: analysis.pointer.y, t: now });
      while (history.length && now - history[0].t > SWIPE.window) history.shift();

      let swipe = null;
      const lockedUntil = this.swipeLock.get(id) ?? 0;
      if (!pinching && now > lockedUntil && history.length > 3 && hands.length === 1) {
        const first = history[0];
        const last = history[history.length - 1];
        const dt = Math.max((last.t - first.t) / 1000, 1 / 120);
        const dx = last.x - first.x;
        const speed = Math.abs(dx) / dt;
        if (Math.abs(dx) >= SWIPE.distance && speed >= SWIPE.speed) {
          swipe = dx > 0 ? 'SWIPE_RIGHT' : 'SWIPE_LEFT';
          this.swipeLock.set(id, now + 320);
          history.length = 0;
        }
      }

      // ---- discrete triggers ------------------------------------------
      if (accepted && ['VICTORY', 'PEACE', 'THUMB_UP'].includes(accepted)) {
        if (this.canFire(accepted, now)) {
          this.markFired(accepted, now);
          events.push({
            type: accepted,
            strength: stable.acceptedScore,
            handedness: id,
            point: analysis.pointer,
            spread: analysis.spread,
          });
        }
      }
      if (swipe && this.canFire(swipe, now)) {
        this.markFired(swipe, now);
        events.push({ type: swipe, handedness: id, strength: 1 });
      }

      handStates.push({
        id,
        handedness: hand.handedness,
        landmarks: hand.landmarks,
        score: hand.score ?? 0,
        gesture: accepted || 'NONE',
        rawGesture: analysis.name,
        gestureScore: stable.acceptedScore,
        confidence: clamp((hand.score ?? 0.7) * (stable.acceptedScore || analysis.score), 0, 1),
        analysis,
        pinching,
      });
    }

    // Drop trackers for hands that vanished (keeps memory + state clean) and
    // release any pinch that was still held, otherwise the hologram would stay
    // glued to a hand that left the frame.
    for (const id of [...this.trackers.keys()]) if (!seen.has(id)) this.trackers.delete(id);
    for (const id of [...this.history.keys()]) if (!seen.has(id)) this.history.delete(id);
    for (const [id, pinching] of [...this.pinchActive.entries()]) {
      if (!seen.has(id)) {
        const wasEmitted = this.pinchEmitted.get(id) ?? false;
        if (pinching || wasEmitted) events.push({ type: 'PINCH_END', strength: 0, handedness: id, lost: true });
        this.pinchActive.delete(id);
        this.pinchEmitted.delete(id);
      }
    }

    // ---- aggregate -----------------------------------------------------
    const state = {
      time: now,
      hands: handStates,
      mode: handStates.length > 1 ? 'TWO_HANDS' : handStates.length === 1 ? 'ONE_HAND' : 'NONE',
      primary: { ...this.primary },
      continuous: {
        expand: 0,
        compress: 0,
        grab: 0,
        grabPoint: { x: 0.5, y: 0.5 },
        reach: { x: 0, y: 0 },
        span: 0,
        spanScale: 1,
        openness: 0,
      },
      events,
    };

    if (!handStates.length) {
      this.primary = { name: 'NONE', score: 0, hand: null, since: now };
      this.spanBaseline.reset();
      this.spreadArmed = true;
      this.closeArmed = true;
      state.primary = { ...this.primary };
      return state;
    }

    // Continuous channels from the dominant hand.
    const primaryHand = handStates.reduce((a, b) => (b.gestureScore > a.gestureScore ? b : a));
    const primaryAnalysis = primaryHand.analysis;
    const openness = primaryAnalysis.openness;
    state.continuous.openness = openness;

    // Only the two "field shaping" poses drive the continuous expand/compress
    // channels. Without this, a thumbs-up or an OK-sign (both have closed
    // fingers) would unnecessarily collapse the particle universe.
    const shaping = ['OPEN_PALM', 'FIST', 'NONE'].includes(primaryHand.gesture);
    state.continuous.expand = shaping ? smoothstep(0.6, 0.95, openness) : 0;
    state.continuous.compress = shaping ? smoothstep(0.42, 0.08, openness) : 0;
    state.continuous.reach = {
      x: clamp((primaryAnalysis.pointer.x - 0.5) * 2, -1, 1),
      y: clamp((primaryAnalysis.pointer.y - 0.5) * 2, -1, 1),
    };

    for (const handState of handStates) {
      if (handState.pinching) {
        state.continuous.grab = Math.max(state.continuous.grab, handState.analysis.pinch.strength);
        state.continuous.grabPoint = handState.analysis.pinchPoint;
      }
    }

    // Two-hand span → universe scale + spread/close events.
    if (handStates.length > 1) {
      const a = handStates[0].analysis;
      const b = handStates[1].analysis;
      const d = Math.hypot(
        a.pointer.x - b.pointer.x,
        a.pointer.y - b.pointer.y,
        (a.pointer.z ?? 0) - (b.pointer.z ?? 0),
      );
      const avgPalm = (a.palm + b.palm) / 2 || 1e-4;
      const span = d / avgPalm;
      state.continuous.span = span;
      state.continuous.spanScale = clamp(span / 2.6, 0.5, 2.3);

      const baseline = this.spanBaseline.push(span) || span;
      if (span > baseline * 1.3 && this.spreadArmed && this.canFire('SPREAD', now)) {
        this.spreadArmed = false;
        this.closeArmed = true;
        this.markFired('SPREAD', now);
        events.push({ type: 'SPREAD', strength: clamp(span / Math.max(baseline, 1e-3) - 1, 0, 1) });
      } else if (span < baseline * 0.78 && this.closeArmed && this.canFire('CLOSE', now)) {
        this.closeArmed = false;
        this.spreadArmed = true;
        this.markFired('CLOSE', now);
        events.push({ type: 'CLOSE', strength: clamp(1 - span / Math.max(baseline, 1e-3), 0, 1) });
      }
      if (span < baseline * 1.1) this.spreadArmed = true;
      if (span > baseline * 0.95) this.closeArmed = true;
      state.continuous.expand = Math.max(state.continuous.expand, clamp((state.continuous.spanScale - 1) * 0.8 + 0.5, 0, 1));
    } else {
      this.spanBaseline.reset();
    }

    // Primary gesture for the HUD. Only accepted (stable) gestures are shown,
    // so the readout always reflects what the interface actually acted on.
    const discrete = primaryHand.gesture !== 'NONE' ? primaryHand.gesture : null;
    const name = discrete || (handStates.length > 1 ? 'TWO_HANDS' : 'NONE');
    if (name !== this.primary.name) {
      this.primary = { name, score: primaryHand.gestureScore || primaryAnalysis.score, hand: primaryHand.id, since: now };
    } else {
      this.primary.score = Math.max(this.primary.score * 0.9, primaryHand.gestureScore || primaryAnalysis.score);
    }
    state.primary = { ...this.primary };
    state.continuous.reachRaw = state.continuous.reach;
    return state;
  }
}

export { FIELD };
export default GestureEngine;
