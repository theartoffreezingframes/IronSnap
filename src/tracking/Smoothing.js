/**
 * One-Euro filter — the standard low-latency smoothing filter for interactive
 * tracking (Casiez et al. 2012). It removes jitter when the hand is still while
 * keeping latency near zero during fast motion.
 */
import { OneEuroFilter } from './OneEuroFilter.js';

export class Vec3Filter {
  constructor({ minCutoff = 1.2, beta = 0.02, dCutoff = 1.0 } = {}) {
    this.x = new OneEuroFilter({ minCutoff, beta, dCutoff });
    this.y = new OneEuroFilter({ minCutoff, beta, dCutoff });
    this.z = new OneEuroFilter({ minCutoff, beta, dCutoff });
  }

  filter(point, timestamp) {
    return {
      x: this.x.filter(point.x, timestamp),
      y: this.y.filter(point.y, timestamp),
      z: this.z.filter(point.z ?? 0, timestamp),
    };
  }

  reset() {
    this.x.reset();
    this.y.reset();
    this.z.reset();
  }
}

/** Smooths all 21 landmarks of a single hand. */
export class LandmarkFilter {
  constructor(options) {
    this.points = Array.from({ length: 21 }, () => new Vec3Filter(options));
  }

  filter(landmarks, timestamp) {
    const out = new Array(landmarks.length);
    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i];
      out[i] = this.points[i].filter({ x: p.x, y: p.y, z: p.z ?? 0 }, timestamp);
    }
    return out;
  }

  reset() {
    for (const p of this.points) p.reset();
  }
}

export default Vec3Filter;
