import * as THREE from 'three';
import { Backdrop } from './Backdrop.js';
import { ParticleField } from './ParticleField.js';
import { LinkLines } from './LinkLines.js';
import { Hologram } from './Hologram.js';
import { OrbitalRings } from './OrbitalRings.js';
import { Effects } from './Effects.js';
import { MODES } from '../config.js';
import { clamp } from '../tracking/geometry.js';

/**
 * Visualizer — the single seam between "what the hands are doing" and
 * "what the scene shows". It owns every 3D subsystem and maps continuous
 * gesture channels onto shader uniforms, keeping all smoothing in one place.
 */
export class Visualizer {
  constructor(sceneManager, { quality = 'high' } = {}) {
    this.sm = sceneManager;
    this.scene = sceneManager.scene;
    this.camera = sceneManager.camera;
    this.quality = quality;
    this.pixelRatio = this.sm.renderer.getPixelRatio();

    const counts =
      quality === 'high'
        ? { particles: 22000, links: 1400, stars: 3000 }
        : quality === 'medium'
          ? { particles: 13000, links: 900, stars: 2000 }
          : { particles: 7000, links: 500, stars: 1200 };

    this.backdrop = new Backdrop(this.scene, { stars: counts.stars, pixelRatio: this.pixelRatio });
    this.particles = new ParticleField(this.scene, { count: counts.particles, pixelRatio: this.pixelRatio });
    this.links = new LinkLines(this.scene, { count: counts.links, pixelRatio: this.pixelRatio });
    this.hologram = new Hologram(this.scene, { pixelRatio: this.pixelRatio });
    this.rings = new OrbitalRings(this.scene, { pixelRatio: this.pixelRatio, detail: quality === 'low' ? 'low' : 'high' });
    this.effects = new Effects(this.scene, { pixelRatio: this.pixelRatio, quality });
    this.effects.setMode(MODES[0]);

    this.modeIndex = 0;
    this.mode = MODES[0];
    this.backdrop.setMode(this.modePalette(this.mode));
    this.particles.setMode(this.mode);
    this.links.setMode(this.mode);
    this.hologram.setMode(this.mode);
    this.rings.setMode(this.mode);

    this.targets = { expand: 0, compress: 0, grab: 0, energy: this.mode.energy, spanScale: 1 };
    this.smooth = { expand: 0, compress: 0, grab: 0, spanScale: 1, reachX: 0, reachY: 0 };
    this.manual = { expand: 0, compress: 0, grab: 0, x: 0, y: 0, spin: 0 };
    this.hands = [];
    this.hologramPosition = new THREE.Vector3();
    this.overdriveUntil = 0;
    this.overdrive = 0;
    this.steer = new THREE.Vector3();
    this._handA = new THREE.Vector3();
    this._handB = new THREE.Vector3();
    this._vec = new THREE.Vector3();
    this._steerOffset = new THREE.Vector3();
    this._arcA = new THREE.Vector3();
    this._arcB = new THREE.Vector3();
    this.modeHex = { a: 0x22d3ee, b: 0xa855f7, c: 0x22d3ee };
    this.manualArcActive = false;
    this._time = 0;
    this.particlesSettled = false;
  }

  modePalette(mode) {
    return {
      colors: {
        top: new THREE.Color(mode.colorB).multiplyScalar(0.16).getStyle(),
        bottom: new THREE.Color(0x01030a).getStyle(),
        accent: new THREE.Color(mode.colorA).multiplyScalar(0.22).getStyle(),
        star: new THREE.Color(mode.colorC).lerp(new THREE.Color(0xffffff), 0.55).getStyle(),
      },
      colorA: mode.colorA,
      colorB: mode.colorB,
      colorC: mode.colorC,
    };
  }

  get modeName() {
    return this.mode.name;
  }

  setMode(index) {
    const wrapped = ((index % MODES.length) + MODES.length) % MODES.length;
    this.modeIndex = wrapped;
    this.mode = MODES[wrapped];
    this.backdrop.setMode(this.modePalette(this.mode));
    this.particles.setMode(this.mode);
    this.links.setMode(this.mode);
    this.hologram.setMode(this.mode);
    this.rings.setMode(this.mode);
    this.effects.setMode(this.mode);
    this.targets.energy = this.mode.energy;
    this.modeHex = {
      a: new THREE.Color(this.mode.colorA).getHex(),
      b: new THREE.Color(this.mode.colorB).getHex(),
      c: new THREE.Color(this.mode.colorC).getHex(),
    };
    // A mode switch ripples through the whole field.
    this.particles.pulse(0.8);
    this.rings.impulse(0.5);
    this.effects.shockwave(this.hologram.root.position, {
      color: this.modeHex.a,
      size: 9,
      duration: 1.2,
    });
    return this.mode;
  }

  nextMode() {
    return this.setMode(this.modeIndex + 1);
  }

  prevMode() {
    return this.setMode(this.modeIndex - 1);
  }

  /**
   * Feed a GestureEngine state into the scene.
   * @param {object} state from GestureEngine.update()
   */
  applyState(state) {
    this.hands = state.hands;
    const c = state.continuous;
    this.targets.expand = Math.max(c.expand, 0);
    this.targets.compress = Math.max(c.compress, 0);
    this.targets.grab = Math.max(c.grab, 0);
    this.targets.spanScale = clamp(c.spanScale || 1, 0.45, 2.4);
    this.smooth.reachX = c.reach?.x ?? 0;
    this.smooth.reachY = c.reach?.y ?? 0;
    this.grabPoint = c.grabPoint;
    this.mode_ = state.mode;
  }

  /** Keyboard-driven manual channels (used when the camera is off). */
  setManual(partial) {
    Object.assign(this.manual, partial);
  }

  nudgeManual({ dx = 0, dy = 0, expand = 0, compress = 0 }) {
    this.manual.x = clamp(this.manual.x + dx, -1, 1);
    this.manual.y = clamp(this.manual.y + dy, -1, 1);
    this.manual.expand = clamp(this.manual.expand + expand, 0, 1);
    this.manual.compress = clamp(this.manual.compress + compress, 0, 1);
  }

  reset() {
    this.targets = { expand: 0, compress: 0, grab: 0, energy: this.mode.energy, spanScale: 1 };
    this.smooth = { expand: 0, compress: 0, grab: 0, spanScale: 1, reachX: 0, reachY: 0 };
    this.manual = { expand: 0, compress: 0, grab: 0, x: 0, y: 0, spin: 0 };
    this.hands = [];
    this.overdrive = 0;
    this.overdriveUntil = 0;
    this.hologram.root.position.set(0, 0, 0);
    this.hologram.setGrab(false, null, 0);
    this.hologram.setScale(1);
    this.effects.reset();
    this.particles.explosion = 0;
    this.particles.wave.active = false;
    this.particles.wave.strength = 0;
    this.rings.impulse(0);
    for (const arc of this.effects.lightnings) arc.setActive(false);
    this.sm.setExposure(1.05);
  }

  /** Trigger overdrive ("victory" visual mode) for a few seconds. */
  activateOverdrive(duration = 8) {
    this.overdriveUntil = this._time + duration;
    this.particles.pulse(1.1);
    this.particles.explode(0.35);
    this.rings.impulse(0.9);
    this.hologram.triggerConfirm();
    this.effects.shockwave(this.hologram.root.position, {
      color: this.modeHex.b,
      size: 12,
      duration: 1.6,
    });
  }

  get overdriveActive() {
    return this._time < this.overdriveUntil;
  }

  /** Handle a discrete gesture event coming from the tracker. */
  trigger(event) {
    const mode = this.mode;
    const center = this.hologram.root.position;
    switch (event.type) {
      case 'PINCH_START':
        this.effects.shockwave(center, { color: this.modeHex.a, size: 4.5, duration: 0.8 });
        this.particles.pulse(0.35);
        break;
      case 'PINCH_END':
        this.particles.explode(0.9);
        this.particles.pulse(1);
        this.rings.impulse(0.7);
        this.effects.explode(center, { strength: 1.1, color: this.modeHex.a });
        break;
      case 'THUMB_UP':
        this.hologram.triggerConfirm();
        this.effects.confirm(center, this.modeHex.a);
        this.particles.pulse(0.6);
        break;
      case 'PEACE':
        this.effects.shockwave(center, { color: this.modeHex.c, size: 6, duration: 0.9 });
        this.particles.pulse(0.45);
        break;
      case 'VICTORY':
        this.activateOverdrive(8);
        break;
      case 'SPREAD':
        this.particles.pulse(1.2);
        this.rings.impulse(0.8);
        this.effects.shockwave(center, { color: 0x22d3ee, size: 14, duration: 1.4 });
        break;
      case 'CLOSE':
        this.particles.pulse(-0.8);
        this.rings.impulse(0.4);
        this.effects.shockwave(center, { color: 0xa855f7, size: 5, duration: 1 });
        break;
      case 'MODE':
        this.setMode(event.index ?? this.modeIndex);
        break;
      default:
        break;
    }
  }

  update(dt, time) {
    this._time = time;
    // Exponential damping: frame-rate independent and always converges, even
    // when the browser is running at 5 fps on weak hardware.
    const ease = (current, target, rate) => current + (target - current) * (1 - Math.exp(-rate * dt));

    const manualActive = this.manual.expand > 0.001 || this.manual.compress > 0.001 || this.manual.grab > 0.001;
    const expand = clamp(Math.max(this.targets.expand, this.manual.expand), 0, 1);
    const compress = clamp(Math.max(this.targets.compress, this.manual.compress), 0, 1);
    const grab = clamp(Math.max(this.targets.grab, this.manual.grab), 0, 1);

    this.smooth.expand = ease(this.smooth.expand, expand, 3.4);
    this.smooth.compress = ease(this.smooth.compress, compress, 3.4);
    this.smooth.grab = ease(this.smooth.grab, grab, 9);
    this.smooth.spanScale = ease(this.smooth.spanScale, this.targets.spanScale, 2.6);

    const overdriveStrength = this.overdriveActive ? 1 : 0;
    this.overdrive = ease(this.overdrive, overdriveStrength, 2.5);

    const energy = this.mode.energy * (1 + this.overdrive * 0.45);
    const fieldScale = this.smooth.spanScale * (1 + this.smooth.expand * 0.42) * (1 - this.smooth.compress * 0.5);

    // Steering: hand (or arrow keys) shifts the whole field.
    const targetX = (this.hands.length ? this.smooth.reachX : this.manual.x) * 3.4;
    const targetY = (this.hands.length ? -this.smooth.reachY : -this.manual.y) * 2.1;
    this.steer.x = ease(this.steer.x, targetX, 2.6);
    this.steer.y = ease(this.steer.y, targetY, 2.6);

    // --- hologram: position / grab -----------------------------------
    let grabWorld = null;
    if (this.smooth.grab > 0.08 && this.grabPoint) {
      grabWorld = this.sm.worldFromScreen(
        clamp(this.grabPoint.x, -0.2, 1.2),
        clamp(this.grabPoint.y, -0.2, 1.2),
        0,
        this._vec,
      );
      grabWorld.x += this.manual.x * 2;
      grabWorld.y -= this.manual.y * 1.5;
    }
    if (grabWorld) this.hologram.setGrab(true, grabWorld, this.smooth.grab);
    else if (manualActive) {
      this.hologram.setGrab(true, this._vec.set(this.manual.x * 5, -this.manual.y * 3.2, 0), 0.6);
    } else this.hologram.setGrab(false, null, 0);
    this.hologram.setScale(1 + this.smooth.expand * 0.22 - this.smooth.compress * 0.25 + this.overdrive * 0.12);

    // --- particles ----------------------------------------------------
    this.particles.setTargets({
      scale: fieldScale,
      expand: this.smooth.expand,
      compress: this.smooth.compress,
      grab: this.smooth.grab,
      energy,
    });
    const handWorld = this._vec.set(this.steer.x, this.steer.y, 0);
    this.particles.setPointer(handWorld, this.hands.length ? 0.85 : this.manual.grab * 0.6);
    this._steerOffset.set(this.steer.x * 0.22, this.steer.y * 0.15, 0);
    this.particles.points.position.lerp(this._steerOffset, Math.min(1, dt * 2));

    this.particles.update(dt, time);
    this.links.update(dt, time, { scale: fieldScale, expand: this.smooth.expand, energy });
    this.backdrop.update(dt, time, { energy, expand: this.smooth.expand });
    this.hologram.update(dt, time, this.camera);
    this.rings.update(dt, time, {
      scale: fieldScale * (1 - this.smooth.compress * 0.12),
      expand: this.smooth.expand,
      energy,
      mode: this.mode.id,
    });

    // --- per-hand reticles, beams and lightning -----------------------
    this.updateHands(dt, time);

    this.effects.update(dt, time);

    // Overdrive pushes exposure + bloom.
    this.sm.setExposure(1.02 + this.overdrive * 0.1);
    if (this.sm.postFX) this.sm.postFX.setStrength((this.quality === 'high' ? 0.55 : 0.45) + this.overdrive * 0.2);
  }

  updateHands(dt, time) {
    const hands = this.hands;
    for (let i = 0; i < 2; i++) {
      const hand = hands[i];
      if (!hand || !hand.landmarks) {
        this.effects.reticle(i, null, 0x22d3ee, false);
        this.effects.hideBeam(i);
        this.effects.lightning(i, null, null, null, false);
        continue;
      }
      const lm = hand.landmarks;
      const palmWorld = this.sm.worldFromScreen(
        clamp(lm[9].x, -0.4, 1.4),
        clamp(lm[9].y, -0.4, 1.4),
        1.2,
        this._handA,
      );
      const color = hand.pinching ? 0xffffff : this.modeHex.a;
      this.effects.reticle(i, palmWorld, color, true);
      this.effects.beam(i, this.hologram.root.position, palmWorld, this.modeHex.a, 0.6);

      const isArc = hand.gesture === 'PEACE' || hand.rawGesture === 'PEACE';
      if (isArc) {
        this.sm.worldFromScreen(clamp(lm[8].x, -0.4, 1.4), clamp(lm[8].y, -0.4, 1.4), 1.0, this._arcA);
        this.sm.worldFromScreen(clamp(lm[12].x, -0.4, 1.4), clamp(lm[12].y, -0.4, 1.4), 1.0, this._arcB);
        this.effects.lightning(i, this._arcA, this._arcB, this.modeHex.c, true);
      } else {
        this.effects.lightning(i, null, null, null, false);
      }
    }

    // Keyboard fallback: an energy arc anchored to the hologram.
    if (this.manualArcActive) {
      const center = this.hologram.root.position;
      this._arcA.set(center.x - 2.6 + this.manual.x * 2, center.y + 1.5 - this.manual.y, 0.8);
      this._arcB.set(center.x + 2.6 + this.manual.x * 2, center.y + 1.75 - this.manual.y, 0.8);
      this.effects.lightning(1, this._arcA, this._arcB, this.modeHex.c, true);
      this.effects.reticle(1, this._arcA, this.modeHex.c, true);
    } else if (hands.length === 0) {
      this.effects.lightning(1, null, null, null, false);
      this.effects.reticle(1, null, 0x22d3ee, false);
      this.effects.hideBeam(1);
    }

    if (hands.length === 0 && this.manual.grab > 0.05) {
      const p = this.sm.worldFromScreen(0.5 + this.manual.x * 0.35, 0.5 + this.manual.y * 0.35, 1.2, this._handA);
      this.effects.reticle(0, p, this.modeHex.a, true);
      this.effects.beam(0, this.hologram.root.position, p, this.modeHex.a, 0.5);
    } else if (hands.length === 0) {
      this.effects.reticle(0, null, 0x22d3ee, false);
      this.effects.hideBeam(0);
    }
  }

  render() {
    this.sm.render();
  }

  setPixelRatio(ratio) {
    this.pixelRatio = ratio;
    this.particles.setPixelRatio(ratio);
    this.effects.setPixelRatio(ratio);
    this.rings.setPixelRatio(ratio);
    this.backdrop.setPixelRatio(ratio);
  }

  dispose() {
    this.backdrop.dispose();
    this.particles.dispose();
    this.links.dispose();
    this.hologram.dispose();
    this.rings.dispose();
    this.effects.dispose();
  }
}

export default Visualizer;
