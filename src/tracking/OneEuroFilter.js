/**
 * 1€ filter (Casiez, Roussel & Vogel, CHI 2012).
 * Adaptive low-pass: heavy smoothing at low speed, light smoothing at high speed.
 */
const alpha = (cutoff, dt) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuroFilter {
  constructor({ minCutoff = 1, beta = 0, dCutoff = 1 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  filter(value, timestamp) {
    // timestamp in seconds
    if (this.tPrev === null) {
      this.tPrev = timestamp;
      this.xPrev = value;
      return value;
    }
    let dt = timestamp - this.tPrev;
    if (dt <= 0) dt = 1 / 120;
    dt = Math.min(dt, 0.25);

    const dx = (value - this.xPrev) / dt;
    const edx = this.dxPrev + alpha(this.dCutoff, dt) * (dx - this.dxPrev);
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const result = this.xPrev + alpha(cutoff, dt) * (value - this.xPrev);

    this.xPrev = result;
    this.dxPrev = edx;
    this.tPrev = timestamp;
    return result;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}

export default OneEuroFilter;
