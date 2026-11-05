/** Small, dependency-free geometry helpers shared by tracking + gestures. */

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};
export const mapRange = (v, inMin, inMax, outMin, outMax) =>
  outMin + ((clamp(v, inMin, inMax) - inMin) / (inMax - inMin || 1e-6)) * (outMax - outMin);

export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));

/** Interior angle (degrees) at `b` for the chain a-b-c. */
export function angleAt(a, b, c) {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v1z = (a.z ?? 0) - (b.z ?? 0);
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const v2z = (c.z ?? 0) - (b.z ?? 0);
  const n1 = Math.hypot(v1x, v1y, v1z) || 1e-6;
  const n2 = Math.hypot(v2x, v2y, v2z) || 1e-6;
  const cos = clamp((v1x * v2x + v1y * v2y + v1z * v2z) / (n1 * n2), -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Reference scale for a hand: wrist → middle-finger MCP. Translation invariant. */
export const palmSize = (lm) => Math.max(dist3(lm[0], lm[9]), 1e-4);

export const midpoint = (a, b) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
});

/** Exponential moving average helper object. */
export function ema(initial, alpha) {
  let value = initial;
  let primed = false;
  return {
    get value() {
      return value;
    },
    push(next) {
      if (!primed) {
        value = next;
        primed = true;
      } else {
        value = value + (next - value) * alpha;
      }
      return value;
    },
    reset() {
      primed = false;
    },
  };
}
