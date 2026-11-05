import './styles/index.css';
import { SceneManager } from './scene/SceneManager.js';
import { Visualizer } from './scene/Visualizer.js';
import { HandTracker, TrackerError } from './tracking/HandTracker.js';
import { GestureEngine } from './tracking/GestureEngine.js';
import { Hud } from './ui/Hud.js';
import { Tutorial } from './ui/Tutorial.js';
import { Reference } from './ui/Reference.js';
import { KeyboardController } from './input/KeyboardController.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { GESTURES, MODES, STORAGE_KEYS } from './config.js';
import { clamp } from './tracking/geometry.js';

const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const isMobile = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent);
const lowPower = isMobile || (navigator.hardwareConcurrency ?? 8) <= 4;

class App {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.video = document.getElementById('webcam');
    this.overlay = document.getElementById('handOverlay');

    const requestedQuality = new URLSearchParams(location.search).get('quality');
    this.quality = ['low', 'medium', 'high'].includes(requestedQuality)
      ? requestedQuality
      : lowPower
        ? 'medium'
        : 'high';
    this.sceneManager = new SceneManager(this.canvas, { quality: this.quality });
    this.visualizer = new Visualizer(this.sceneManager, { quality: this.quality });
    this.gestureEngine = new GestureEngine();

    this.audio = new AudioEngine({ muted: this.readSoundPreference() });
    this.cameraActive = false;
    this.cameraStarting = false;
    this.manualEngaged = false;
    this.manualArc = false;
    this.grabHeld = false;
    this.modeIndex = 0;

    this.hud = new Hud({
      onStartCamera: () => this.startCamera(),
      onStopCamera: () => this.stopCamera({ userInitiated: true }),
      onToggleSound: () => this.toggleSound(),
      onOpenReference: () => this.reference.toggle(),
      onModeSelect: (index) => this.setMode(index, { source: 'ui' }),
      onReset: () => this.reset({ source: 'ui' }),
      onTutorial: () => this.tutorial.open({ force: true }),
      getModeIndex: () => this.modeIndex,
    });

    this.tracker = new HandTracker({
      video: this.video,
      overlay: this.overlay,
      onProgress: ({ label, ratio }) => {
        if (!this.cameraStarting) return;
        this.hud.showCameraLoading(label, ratio);
      },
      onStatus: ({ type }) => {
        if (type === 'camera-lost') {
          this.hud.toast('Camera disconnected. Keyboard controls remain active.', { tone: 'warn' });
          this.stopCamera({ silent: true });
        }
      },
    });

    this.reference = new Reference({
      onOpenChange: (open) => {
        this.keyboard.setEnabled(true);
        if (open) this.audio.click();
      },
    });

    this.tutorial = new Tutorial({
      onComplete: ({ open }) => {
        if (!open) this.audio.click();
      },
    });

    this.keyboard = new KeyboardController({
      onAction: (key, event, meta) => this.handleKeyboard(key, event, meta),
      onAnyKey: () => this.audio.enable(),
      onRelease: (key) => this.handleKeyRelease(key),
    });

    this.hud.setStartButton('idle');
    this.hud.setParticleCount(this.visualizer.particles.count);
    this.hud.setQuality(this.quality.toUpperCase());
    this.hud.setMode(MODES[0]);
    this.hud.setSound(this.audio.muted);
    this.hud.setSystem('standby', 'SYSTEM STANDBY');
    this.hud.setGesture('STANDBY', 'INITIALISE THE OPTICAL SENSOR');
    this.hud.setTracking('OFFLINE', 'idle');
    this.hud.setCameraState({
      chip: 'NO SIGNAL',
      chipState: 'warn',
      footer: 'LOCAL PROCESSING',
      live: false,
    });
    this.hud.setInference(0, null);

    this.lastFrame = performance.now();
    this.time = 0;
    this.fpsAvg = 60;
    this.fpsWindow = { frames: 0, elapsed: 0 };
    this.lowFpsSeconds = 0;
    this.hudTimer = 0;
    this.downgraded = false;

    this.bindWindowEvents();
  }

  /* ── preferences ──────────────────────────────────────────────── */
  readSoundPreference() {
    try {
      return localStorage.getItem(STORAGE_KEYS.sound) === 'muted';
    } catch {
      return false;
    }
  }

  persistSoundPreference(muted) {
    try {
      localStorage.setItem(STORAGE_KEYS.sound, muted ? 'muted' : 'on');
    } catch {
      /* ignore */
    }
  }

  /* ── boot ─────────────────────────────────────────────────────── */
  async boot() {
    this.hud.boot('BUILDING HOLOGRAPHIC FIELD', 0.35);
    await this.nextFrame();
    this.hud.boot('CALIBRATING ORBITAL RINGS', 0.7);
    await this.nextFrame();
    this.hud.boot('SYSTEM READY', 1);

    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);

    setTimeout(() => {
      this.hud.hideBoot();
      const opened = this.tutorial.open({ delay: 350 });
      if (!opened) {
        this.hud.toast('Press INITIALIZE CAMERA — or use the arrow keys to drive the field.', {
          duration: 5200,
        });
      }
    }, prefersReducedMotion ? 200 : 900);

    // Warm the model in the background so the first camera start is instant.
    setTimeout(() => {
      this.tracker.prefetchModel().catch(() => {});
    }, 2600);
  }

  nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  /* ── camera ───────────────────────────────────────────────────── */
  async startCamera() {
    if (this.cameraStarting || this.cameraActive) return;
    this.cameraStarting = true;
    this.hud.setStartButton('busy');
    this.hud.setCameraError(null);
    this.hud.setSystem('busy', 'INITIALISING SENSOR');
    this.hud.setTracking('STARTING', 'busy');
    this.hud.showCameraLoading('REQUESTING CAMERA ACCESS', 0.04);
    await this.audio.enable();
    this.audio.startAmbient();

    try {
      const info = await this.tracker.start();
      this.cameraActive = true;
      this.hud.hideCameraLoading();
      this.hud.setStartButton('active');
      this.hud.setCameraState({
        chip: 'LOCKED',
        chipState: 'live',
        footer: 'LOCAL PROCESSING',
        live: true,
      });
      this.hud.setSystem('live', 'SYSTEM ONLINE');
      this.hud.setTracking('SEARCHING', 'warn');
      this.hud.setInference(this.tracker.metrics.inferenceMs, this.tracker.delegate);
      this.hud.logEvent('OPTICAL SENSOR ONLINE', 'good');
      const source = info?.modelSource === 'local' ? 'local model' : 'CDN model';
      this.hud.toast(`Sensor online (${this.tracker.delegate} delegate, ${source}). Show a hand.`, {
        tone: 'good',
        duration: 4200,
      });
      this.audio.click();
    } catch (err) {
      const message =
        err instanceof TrackerError
          ? err.message
          : `Camera could not start: ${err?.message ?? 'unknown error'}.`;
      this.hud.hideCameraLoading();
      this.hud.setStartButton('retry');
      this.hud.setCameraError(message);
      this.hud.setCameraState({
        chip: 'OFFLINE',
        chipState: 'error',
        footer: 'KEYBOARD MODE',
        live: false,
      });
      this.hud.setSystem('error', 'SENSOR OFFLINE');
      this.hud.setTracking('KEYBOARD', 'warn');
      this.hud.setGesture('MANUAL MODE', 'ARROWS + Q/E DRIVE THE FIELD');
      this.hud.toast(message, { tone: 'error', duration: 7000 });
      this.hud.logEvent(`CAMERA ERROR: ${message}`, 'warn');
      console.warn('[app] camera start failed:', err);
      this.tracker.stop();
    } finally {
      this.cameraStarting = false;
    }
  }

  stopCamera({ userInitiated = false, silent = false } = {}) {
    if (!this.cameraActive) return;
    this.tracker.stop();
    this.cameraActive = false;
    this.gestureEngine.reset();
    this.visualizer.hands = [];
    this.visualizer.manual.grab = 0;
    this.hud.hideCameraLoading();
    this.hud.setStartButton('idle');
    this.hud.setCameraError(null);
    this.hud.setCameraState({
      chip: 'NO SIGNAL',
      chipState: 'warn',
      footer: 'LOCAL PROCESSING',
      live: false,
    });
    this.hud.setTracking('OFFLINE', 'idle');
    this.hud.setGesture('STANDBY', 'INITIALISE THE OPTICAL SENSOR');
    this.hud.setHands(0, '');
    this.hud.setConfidence(0);
    this.hud.setInference(0, null);
    this.hud.setSystem('standby', 'SYSTEM STANDBY');
    if (userInitiated && !silent) {
      this.hud.toast('Optical sensor stopped. Keyboard controls are still live.', { tone: 'info' });
      this.hud.logEvent('OPTICAL SENSOR OFFLINE');
      this.audio.click();
    }
  }

  /* ── render loop ──────────────────────────────────────────────── */
  loop(now) {
    requestAnimationFrame(this.loop);
    const rawDt = (now - this.lastFrame) / 1000;
    // Clamp only to protect against tab-switch jumps; a slow machine keeps a
    // large dt so animations still converge instead of crawling.
    const dt = clamp(rawDt, 0.0005, 0.2);
    this.lastFrame = now;
    this.time += dt;

    if (document.hidden) return;

    // True rolling frame-rate over a 500 ms window (no EMA lag, no lies).
    this.fpsWindow.frames++;
    this.fpsWindow.elapsed += rawDt;
    if (this.fpsWindow.elapsed >= 0.5) {
      this.fpsAvg = this.fpsWindow.frames / this.fpsWindow.elapsed;
      this.fpsWindow.frames = 0;
      this.fpsWindow.elapsed = 0;
    }
    this.trackPerformance(dt);

    const { hands } = this.tracker.detect(now);
    const state = this.gestureEngine.update(hands, now);
    for (const event of state.events) this.handleGestureEvent(event);

    this.visualizer.applyState(state);
    this.applyManualChannels(dt);
    this.visualizer.update(dt, this.time);
    this.visualizer.render();

    this.hudTimer += dt;
    if (this.hudTimer > 0.1) {
      this.updateHud(state);
      this.hudTimer = 0;
    }
  }

  trackPerformance(dt) {
    if (this.downgraded) return;
    if (this.fpsAvg < 34) this.lowFpsSeconds += dt;
    else this.lowFpsSeconds = Math.max(0, this.lowFpsSeconds - dt * 0.6);

    if (this.lowFpsSeconds > 4) {
      this.downgraded = true;
      const nextQuality = this.quality === 'high' ? 'medium' : 'low';
      this.quality = nextQuality;
      this.sceneManager.setQuality(nextQuality);
      this.visualizer.setPixelRatio(this.sceneManager.renderer.getPixelRatio());
      this.hud.setQuality(nextQuality.toUpperCase());
      this.hud.toast('Performance auto-tuned: reduced render resolution.', { tone: 'info' });
    }
  }

  applyManualChannels(dt) {
    // Manual values decay so a tap produces a visible impulse rather than a stuck state.
    const decay = Math.pow(0.5, dt);
    this.visualizer.manual.expand *= decay;
    this.visualizer.manual.compress *= decay;
    if (!this.grabHeld) this.visualizer.manual.grab *= Math.pow(0.02, dt);
    this.visualizer.manualArcActive = this.manualArc;
  }

  /* ── gesture events ───────────────────────────────────────────── */
  handleGestureEvent(event) {
    this.visualizer.trigger(event);
    const gesture = GESTURES[event.type];
    switch (event.type) {
      case 'PINCH_START':
        this.audio.pinchIn();
        this.hud.logEvent('PINCH → HOLOGRAM GRABBED', 'good');
        this.hud.live('Hologram grabbed');
        break;
      case 'PINCH_END':
        this.audio.pinchOut();
        this.hud.logEvent('PINCH RELEASED → SHOCKWAVE');
        this.hud.live('Hologram released');
        break;
      case 'THUMB_UP':
        this.audio.confirm();
        this.hud.logEvent('THUMB UP → SIGNAL CONFIRMED', 'good');
        this.hud.toast('Signal confirmed.', { tone: 'good', duration: 2200 });
        this.hud.live('Signal confirmed');
        break;
      case 'PEACE':
        this.audio.crackle();
        this.audio.tone({ freq: 1400, slideTo: 300, dur: 0.22, type: 'sawtooth', gain: 0.05 });
        this.hud.logEvent('TWO FINGER → ENERGY ARC', 'warn');
        this.hud.live('Energy arc engaged');
        break;
      case 'VICTORY':
        this.audio.overdrive();
        this.hud.logEvent('VICTORY → OVERDRIVE ENGAGED', 'good');
        this.hud.toast('OVERDRIVE engaged — the field is running hot for 8 seconds.', {
          tone: 'good',
          duration: 3600,
        });
        this.hud.live('Overdrive engaged');
        break;
      case 'SPREAD':
        this.audio.expand();
        this.hud.logEvent('HANDS APART → UNIVERSE EXPANDED', 'good');
        break;
      case 'CLOSE':
        this.audio.collapse();
        this.hud.logEvent('HANDS TOGETHER → UNIVERSE COLLAPSED');
        break;
      case 'SWIPE_LEFT':
        this.setMode(this.modeIndex - 1, { source: 'gesture' });
        break;
      case 'SWIPE_RIGHT':
        this.setMode(this.modeIndex + 1, { source: 'gesture' });
        break;
      default:
        if (gesture) this.hud.logEvent(`${gesture.label} → ${gesture.action}`);
        break;
    }
  }

  /* ── modes / reset / sound ────────────────────────────────────── */
  setMode(index, { source = 'ui', silent = false } = {}) {
    const wrapped = ((index % MODES.length) + MODES.length) % MODES.length;
    this.modeIndex = wrapped;
    const mode = this.visualizer.setMode(wrapped);
    this.hud.setMode({ name: mode.name });
    if (!silent) {
      this.audio.modeShift();
      this.hud.logEvent(`VISUAL MODE → ${mode.name} (${mode.subtitle})`);
      if (source === 'gesture') this.hud.toast(`Mode: ${mode.name}`, { tone: 'info', duration: 1800 });
    }
  }

  reset({ source = 'ui' } = {}) {
    this.visualizer.reset();
    this.gestureEngine.reset();
    this.grabHeld = false;
    this.manualArc = false;
    this.visualizer.manualArcActive = false;
    this.modeIndex = 0;
    this.visualizer.setMode(0);
    this.hud.setMode({ name: MODES[0].name });
    this.hud.setGesture(this.cameraActive ? 'TRACKING' : 'STANDBY', this.cameraActive ? 'SHOW YOUR HAND' : 'INITIALISE THE OPTICAL SENSOR');
    this.hud.setConfidence(0);
    this.hud.setOverdrive(false, 0);
    this.hud.logEvent('EXPERIENCE RESET', 'good');
    this.audio.click();
    if (source === 'ui') this.hud.toast('Field parameters restored to baseline.', { tone: 'good' });
    this.hud.live('Experience reset');
  }

  async toggleSound() {
    await this.audio.enable();
    const muted = !this.audio.muted;
    this.audio.setMuted(muted);
    this.hud.setSound(muted);
    this.persistSoundPreference(muted);
    if (!muted) {
      this.audio.startAmbient();
      this.audio.click();
    } else {
      this.audio.stopAmbient();
    }
    this.hud.logEvent(muted ? 'SOUND MUTED' : 'SOUND ENABLED');
  }

  /* ── keyboard ─────────────────────────────────────────────────── */
  handleKeyRelease(key) {
    if (key === 'space') {
      this.grabHeld = false;
      this.visualizer.manual.grab = 0;
    }
  }

  handleKeyboard(key, event, { repeated } = {}) {
    if (['left', 'right', 'up', 'down', 'q', 'e', 'space'].includes(key)) this.manualEngaged = true;
    // Tutorial has priority over everything except Esc / arrows.
    if (this.tutorial.visible) {
      if (key === 'escape') this.tutorial.close({ completed: true });
      else if (key === 'right' || key === 'space' || key === 'enter') this.tutorial.next();
      else if (key === 'left') this.tutorial.prev();
      return true;
    }
    if (this.reference.visible) {
      if (key === 'escape' || key === 'h') this.reference.close();
      return true;
    }

    switch (key) {
      case 'left':
        this.visualizer.nudgeManual({ dx: -0.075 });
        return true;
      case 'right':
        this.visualizer.nudgeManual({ dx: 0.075 });
        return true;
      case 'up':
        this.visualizer.nudgeManual({ dy: -0.06 });
        return true;
      case 'down':
        this.visualizer.nudgeManual({ dy: 0.06 });
        return true;
      case 'q':
        this.visualizer.nudgeManual({ expand: 0.06, compress: -0.08 });
        return true;
      case 'e':
        this.visualizer.nudgeManual({ compress: 0.06, expand: -0.08 });
        return true;
      case 'space':
        this.grabHeld = true;
        this.visualizer.manual.grab = 1;
        if (!repeated) this.audio.pinchIn();
        return true;
      case 'v':
        if (event?.repeat) return true;
        this.manualArc = !this.manualArc;
        this.visualizer.manualArcActive = this.manualArc;
        if (this.manualArc) {
          this.audio.crackle();
          this.hud.logEvent('ENERGY ARC MANUAL MODE ON', 'warn');
          this.hud.toast('Energy arc engaged (press V to release).', { tone: 'info' });
        } else {
          this.hud.logEvent('ENERGY ARC MANUAL MODE OFF');
        }
        return true;
      case 'x':
        this.visualizer.activateOverdrive(8);
        this.audio.overdrive();
        this.hud.logEvent('OVERDRIVE ENGAGED (KEY)', 'good');
        this.hud.toast('OVERDRIVE engaged for 8 seconds.', { tone: 'good' });
        return true;
      case 'y':
        this.visualizer.trigger({ type: 'THUMB_UP' });
        this.audio.confirm();
        this.hud.logEvent('CONFIRM (KEY)', 'good');
        this.hud.toast('Signal confirmed.', { tone: 'good', duration: 1800 });
        return true;
      case '1':
      case '2':
      case '3':
      case '4':
        this.setMode(Number(key) - 1);
        return true;
      case '[':
        this.setMode(this.modeIndex - 1);
        return true;
      case ']':
        this.setMode(this.modeIndex + 1);
        return true;
      case 'c':
        if (this.cameraActive) this.stopCamera({ userInitiated: true });
        else this.startCamera();
        return true;
      case 'm':
        this.toggleSound();
        return true;
      case 'r':
        this.reset({ source: 'keyboard' });
        return true;
      case 'h':
        this.reference.toggle();
        return true;
      case 't':
        this.tutorial.open({ force: true });
        return true;
      case 'escape':
        this.reference.close();
        return true;
      default:
        return false;
    }
  }

  /* ── HUD refresh ──────────────────────────────────────────────── */
  updateHud(state) {
    const hands = state.hands;
    const handCount = hands.length;

    if (this.cameraActive) {
      if (handCount > 0) this.hud.setTracking(`${handCount} HAND${handCount > 1 ? 'S' : ''} TRACKED`, 'live');
      else this.hud.setTracking('SEARCHING', 'warn');
    }

    const primary = state.primary;
    if (primary.name && primary.name !== 'NONE') {
      const meta = GESTURES[primary.name] ?? { label: primary.name, action: '' };
      this.hud.setGesture(meta.label, meta.action, true);
    } else if (!this.cameraActive) {
      this.hud.setGesture(
        this.manualEngaged ? 'MANUAL MODE' : 'STANDBY',
        this.manualEngaged ? 'ARROW KEYS + Q/E DRIVE THE FIELD' : 'INITIALISE THE OPTICAL SENSOR',
      );
    } else {
      this.hud.setGesture('TRACKING', 'SHOW ONE OR TWO HANDS');
    }

    const confidence = handCount
      ? hands.reduce((sum, hand) => sum + hand.confidence, 0) / handCount
      : 0;
    this.hud.setConfidence(confidence);

    const labels = hands
      .map((hand) => `${hand.handedness === 'Left' ? 'L' : hand.handedness === 'Right' ? 'R' : '?'}`)
      .join(' + ');
    this.hud.setHands(handCount, labels);
    this.hud.setFps(this.fpsAvg);
    this.hud.setInference(this.tracker.metrics.inferenceMs, this.tracker.delegate);

    const fieldScale = this.visualizer.particles.uniforms.uScale.value;
    this.hud.setFieldScale(fieldScale);
    this.hud.setHandSpan(state.continuous.span);

    const overdrive = this.visualizer.overdriveActive;
    const remaining = Math.max(0, this.visualizer.overdriveUntil - this.visualizer._time);
    this.hud.setOverdrive(overdrive, remaining);

    if (this.manualArc && Math.random() > 0.7) this.audio.crackle();
  }

  /* ── window events ────────────────────────────────────────────── */
  bindWindowEvents() {
    window.addEventListener('beforeunload', () => {
      this.tracker.dispose();
      this.sceneManager.dispose();
    });
    document.addEventListener('visibilitychange', () => {
      this.lastFrame = performance.now();
    });
    let relayoutTimer = 0;
    window.addEventListener('resize', () => {
      this.visualizer.setPixelRatio(this.sceneManager.renderer.getPixelRatio());
      clearTimeout(relayoutTimer);
      relayoutTimer = setTimeout(() => this.hud.relayout(), 180);
    });
  }
}

const app = new App();
app.boot().catch((err) => {
  console.error('[app] boot failed', err);
  const boot = document.getElementById('bootStatus');
  if (boot) boot.textContent = `STARTUP ERROR: ${err?.message ?? err}`;
});

// Expose for debugging in the browser console (not used by the UI).
window.__wondersnap = app;
