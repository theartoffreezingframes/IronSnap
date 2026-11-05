/**
 * AudioEngine — every sound is synthesised with the Web Audio API.
 * No audio files, no extra dependencies, no autoplay violations (the context
 * is only created from a real user gesture).
 */
export class AudioEngine {
  constructor({ muted = false } = {}) {
    this.ctx = null;
    this.master = null;
    this.ambient = null;
    this.muted = muted;
    this.ready = false;
    this.lastCrackle = 0;
  }

  /** Must be called from a user gesture (click / keydown). */
  async enable() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);

    // Shared noise buffer for whooshes / crackles.
    const length = Math.floor(this.ctx.sampleRate * 1.2);
    this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    this.ready = true;
    return this.ctx;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, now, 0.05);
    }
  }

  tone({ freq = 520, dur = 0.18, type = 'sine', gain = 0.12, slideTo = null, delay = 0 }) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  noise({ dur = 0.4, gain = 0.12, from = 300, to = 3200, q = 1.2, delay = 0 }) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, to), t0 + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.18);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(env).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  pinchIn() {
    this.tone({ freq: 620, slideTo: 940, dur: 0.12, type: 'triangle', gain: 0.06 });
  }

  pinchOut() {
    this.tone({ freq: 880, slideTo: 220, dur: 0.3, type: 'sawtooth', gain: 0.05 });
    this.noise({ dur: 0.5, gain: 0.11, from: 2400, to: 260 });
  }

  confirm() {
    [523.25, 659.25, 987.77].forEach((freq, i) =>
      this.tone({ freq, dur: 0.24, type: 'sine', gain: 0.075, delay: i * 0.075 }),
    );
  }

  modeShift() {
    this.noise({ dur: 0.45, gain: 0.1, from: 420, to: 4600, q: 2 });
    this.tone({ freq: 330, slideTo: 660, dur: 0.28, type: 'sine', gain: 0.05 });
  }

  overdrive() {
    this.noise({ dur: 0.9, gain: 0.14, from: 200, to: 5200, q: 0.9 });
    [220, 330, 440, 660].forEach((freq, i) =>
      this.tone({ freq, dur: 0.5, type: 'sawtooth', gain: 0.03, delay: i * 0.06 }),
    );
  }

  crackle(now = performance.now()) {
    if (now - this.lastCrackle < 320) return;
    this.lastCrackle = now;
    this.noise({ dur: 0.1, gain: 0.05, from: 3200, to: 900, q: 3 });
  }

  expand() {
    this.noise({ dur: 0.8, gain: 0.1, from: 180, to: 2400, q: 0.7 });
    this.tone({ freq: 130.8, slideTo: 261.6, dur: 0.6, type: 'sine', gain: 0.05 });
  }

  collapse() {
    this.noise({ dur: 0.6, gain: 0.1, from: 2600, to: 140, q: 0.8 });
    this.tone({ freq: 261.6, slideTo: 98, dur: 0.5, type: 'sine', gain: 0.05 });
  }

  click() {
    this.tone({ freq: 900, dur: 0.05, type: 'square', gain: 0.03 });
  }

  /** Low ambient drone; started once the context exists. */
  startAmbient() {
    if (!this.ready || this.ambient) return;
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.gain.value = 0.0001;
    bus.gain.setTargetAtTime(0.045, ctx.currentTime, 1.4);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.8;
    const freqs = [55, 82.5, 110.25];
    const oscs = freqs.map((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 2 ? 'triangle' : 'sine';
      osc.frequency.value = f;
      osc.detune.value = (i - 1) * 6;
      osc.connect(filter);
      osc.start();
      return osc;
    });
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.06;
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    filter.connect(bus).connect(this.master);
    this.ambient = { bus, oscs, lfo, filter };
  }

  stopAmbient() {
    if (!this.ambient) return;
    const ctx = this.ctx;
    const { bus, oscs, lfo } = this.ambient;
    bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
    setTimeout(() => {
      oscs.forEach((o) => {
        try {
          o.stop();
        } catch {
          /* already stopped */
        }
      });
      try {
        lfo.stop();
      } catch {
        /* already stopped */
      }
    }, 900);
    this.ambient = null;
  }

  dispose() {
    this.stopAmbient();
    this.ctx?.close?.();
    this.ctx = null;
    this.ready = false;
  }
}

export default AudioEngine;
