/**
 * HandTracker
 * -----------
 * Owns the camera stream and the MediaPipe Hand Landmarker.
 *
 * • Loads the model from `public/models/hand_landmarker.task` with real byte
 *   progress, and falls back to the MediaPipe CDN if the local copy is absent.
 * • Tries the GPU delegate first, silently degrades to CPU.
 * • Streams 21 smoothed, mirrored landmarks per hand for up to two hands.
 * • Draws the 21-point skeleton overlay with handedness + confidence labels.
 */
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { LandmarkFilter } from './Smoothing.js';
import { TRACKING } from '../config.js';
import { clamp } from './geometry.js';

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_CDN =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export class TrackerError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'TrackerError';
    this.code = code;
    this.cause = cause;
  }
}

/** Turn a raw getUserMedia/DOMException into a human explanation. */
export function explainCameraError(err) {
  const name = err?.name || '';
  if (!window.isSecureContext) {
    return new TrackerError(
      'INSECURE_CONTEXT',
      'Camera access needs a secure context. Open the app on http://localhost or over HTTPS.',
      err,
    );
  }
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new TrackerError(
        'PERMISSION_DENIED',
        'Camera permission was blocked. Click the camera icon in the address bar, allow access, then press RETRY.',
        err,
      );
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new TrackerError('NO_CAMERA', 'No camera was found on this device. Use keyboard mode below.', err);
    case 'NotReadableError':
    case 'TrackStartError':
      return new TrackerError(
        'CAMERA_BUSY',
        'The camera is already in use by another app (Zoom, Teams, OBS…). Close it and press RETRY.',
        err,
      );
    case 'OverconstrainedError':
      return new TrackerError('UNSUPPORTED', 'This camera cannot provide a usable video mode.', err);
    case 'NotSupportedError':
      return new TrackerError(
        'UNSUPPORTED_BROWSER',
        'This browser does not expose a camera API. Use a recent Chrome, Edge, Firefox or Safari over http://localhost or HTTPS.',
        err,
      );
    case 'AbortError':
      return new TrackerError('ABORTED', 'Camera start was interrupted. Try again.', err);
    default:
      return new TrackerError('CAMERA_FAILED', `Camera could not start${name ? ` (${name})` : ''}.`, err);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HandTracker {
  constructor({ video, overlay, onProgress = () => {}, onStatus = () => {} } = {}) {
    this.video = video;
    this.overlay = overlay;
    this.ctx = overlay?.getContext('2d') ?? null;
    this.onProgress = onProgress;
    this.onStatus = onStatus;

    this.stream = null;
    this.landmarker = null;
    this.filters = new Map();
    this.lastVideoTime = -1;
    this.running = false;
    this.delegate = null;
    this.modelSource = null;
    this.wasmSource = null;
    this.lastResult = { hands: [], at: 0 };
    this.modelBuffer = null;
    this.identities = [];

    this.metrics = {
      inferenceMs: 0,
      detectFps: 0,
      cameraFps: 0,
      detectedFrames: 0,
      totalFrames: 0,
    };
    this._fpsWindow = { frames: 0, start: 0 };
    this._detectWindow = { frames: 0, start: 0 };
    this._cameraWindow = { frames: 0, start: 0, lastTime: -1 };

    this._onTrackEnded = () => {
      if (this.running) {
        this.onStatus({ type: 'camera-lost' });
        this.stop();
      }
    };
  }

  get isReady() {
    return Boolean(this.landmarker && this.stream && this.running);
  }

  /** GET a file with byte progress; returns an ArrayBuffer. */
  async _fetchWithProgress(url, label) {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length') || 0);
    if (!res.body || !total) {
      const buf = await res.arrayBuffer();
      this.onProgress({ label, loaded: buf.byteLength, total: buf.byteLength, ratio: 1 });
      return buf;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      this.onProgress({ label, loaded, total, ratio: loaded / total });
    }
    const out = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out.buffer;
  }

  /** Download the model in the background so the first start is instant. */
  async prefetchModel() {
    if (this.modelBuffer) return;
    const base = import.meta.env.BASE_URL || '/';
    try {
      this.modelBuffer = await this._fetchWithProgress(`${base}models/hand_landmarker.task`, 'hand_landmarker.task');
    } catch {
      /* the CDN fallback will handle it at start time */
    }
  }

  async loadModel() {
    const base = import.meta.env.BASE_URL || '/';
    const local = `${base}models/hand_landmarker.task`;
    this.onProgress({ label: 'LOADING HAND MODEL', ratio: 0, loaded: 0, total: 0 });
    try {
      if (!this.modelBuffer) {
        this.modelBuffer = await this._fetchWithProgress(local, 'hand_landmarker.task');
      }
      this.modelSource = 'local';
      return { modelAssetBuffer: new Uint8Array(this.modelBuffer) };
    } catch (err) {
      console.warn('[tracker] local model unavailable, using CDN:', err.message);
      this.modelSource = 'cdn';
      this.onProgress({ label: 'LOADING HAND MODEL (CDN)', ratio: 0.05, loaded: 0, total: 0 });
      return { modelAssetPath: MODEL_CDN };
    }
  }

  async loadLandmarker() {
    const base = import.meta.env.BASE_URL || '/';
    this.onProgress({ label: 'STARTING VISION RUNTIME', ratio: 0.55, loaded: 0, total: 0 });
    let vision = null;
    for (const candidate of [`${base}wasm`, WASM_CDN]) {
      if (!candidate) continue;
      try {
        vision = await FilesetResolver.forVisionTasks(candidate);
        this.wasmSource = candidate;
        break;
      } catch (err) {
        console.warn(`[tracker] wasm at ${candidate} failed:`, err?.message || err);
      }
    }
    if (!vision) {
      throw new TrackerError(
        'WASM_FAILED',
        'The MediaPipe runtime could not be loaded. Run "npm run assets" (or npm install) and reload.',
      );
    }

    const model = await this.loadModel();
    this.onProgress({ label: 'WARMING UP DETECTOR', ratio: 0.8, loaded: 0, total: 0 });

    const attempts = [
      { delegate: 'GPU', label: 'GPU' },
      { delegate: 'CPU', label: 'CPU' },
    ];
    let lastError = null;
    for (const attempt of attempts) {
      try {
        this.landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { ...model, delegate: attempt.delegate },
          runningMode: 'VIDEO',
          numHands: TRACKING.numHands,
          minHandDetectionConfidence: TRACKING.minHandDetectionConfidence,
          minHandPresenceConfidence: TRACKING.minHandPresenceConfidence,
          minTrackingConfidence: TRACKING.minTrackingConfidence,
        });
        this.delegate = attempt.delegate;
        this.onProgress({ label: 'DETECTOR ONLINE', ratio: 1, loaded: 0, total: 0 });
        return;
      } catch (err) {
        lastError = err;
        console.warn(`[tracker] ${attempt.delegate} delegate failed:`, err?.message || err);
      }
    }
    throw new TrackerError(
      'MODEL_FAILED',
      'Hand tracking could not initialise. Keyboard controls still work.',
      lastError,
    );
  }

  async _requestStream() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw explainCameraError(new DOMException('unsupported', 'NotSupportedError'));
    }
    try {
      return await navigator.mediaDevices.getUserMedia({ video: TRACKING.video, audio: false });
    } catch (err) {
      // Retry once with plain constraints — some cameras reject ideal sizes.
      if (err?.name === 'OverconstrainedError' || err?.name === 'TypeError') {
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      throw explainCameraError(err);
    }
  }

  async start() {
    if (this.running) return;
    this.onProgress({ label: 'REQUESTING CAMERA', ratio: 0.08, loaded: 0, total: 0 });
    try {
      this.stream = await this._requestStream();
    } catch (err) {
      throw err instanceof TrackerError ? err : explainCameraError(err);
    }
    for (const track of this.stream.getVideoTracks()) {
      track.addEventListener('ended', this._onTrackEnded);
      track.addEventListener('mute', this._onTrackEnded);
    }

    const settings = this.stream.getVideoTracks()[0]?.getSettings?.() ?? {};
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    try {
      await this.video.play();
    } catch (err) {
      throw new TrackerError('PLAY_FAILED', 'The camera preview could not start playing.', err);
    }
    if (!this.video.videoWidth) {
      await Promise.race([
        new Promise((resolve) => this.video.addEventListener('loadedmetadata', resolve, { once: true })),
        sleep(1500),
      ]);
    }
    this.overlay.width = this.video.videoWidth || 640;
    this.overlay.height = this.video.videoHeight || 480;

    this.onProgress({ label: 'CALIBRATING OPTICS', ratio: 0.2, loaded: 0, total: 0 });
    if (!this.landmarker) await this.loadLandmarker();

    this.filters.clear();
    this.identities = [];
    this.lastVideoTime = -1;
    this.running = true;
    this.metrics.cameraFps = Math.round(settings.frameRate || 30);
    this._fpsWindow = { frames: 0, start: performance.now() };
    this._detectWindow = { frames: 0, start: performance.now() };
    return { settings, delegate: this.delegate, modelSource: this.modelSource };
  }

  stop() {
    this.running = false;
    this.lastVideoTime = -1;
    this.filters.clear();
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.removeEventListener('ended', this._onTrackEnded);
        track.removeEventListener('mute', this._onTrackEnded);
        track.stop();
      }
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
    this.clearOverlay();
    this.lastResult = { hands: [], at: 0 };
  }

  dispose() {
    this.stop();
    this.landmarker?.close?.();
    this.landmarker = null;
  }

  clearOverlay() {
    if (this.ctx) this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  /**
   * Run detection for the current video frame.
   * @returns {{hands: Array, fresh: boolean}}
   */
  detect(now = performance.now()) {
    if (!this.running || !this.landmarker || !this.video || this.video.readyState < 2) {
      return { hands: [], fresh: false };
    }
    if (this.video.currentTime === this.lastVideoTime) {
      return { hands: this.lastResult.hands, fresh: false };
    }
    this.lastVideoTime = this.video.currentTime;

    const t0 = performance.now();
    let result;
    try {
      result = this.landmarker.detectForVideo(this.video, now);
    } catch (err) {
      console.warn('[tracker] detection failed:', err);
      return { hands: this.lastResult.hands, fresh: false };
    }
    this.metrics.inferenceMs = performance.now() - t0;

    const rawHands = result?.landmarks ?? [];
    const categories = result?.handednesses ?? result?.handedness ?? [];
    const timestamp = now / 1000;
    const hands = [];

    // Assign a stable identity to each detection. MediaPipe can report the same
    // handedness twice (e.g. two right hands in frame, or a low-confidence
    // label), so the ID must not be the raw label alone — otherwise both hands
    // would share a smoothing filter and a gesture state.
    const taken = new Set();
    const nextIdentities = [];
    for (let i = 0; i < rawHands.length; i++) {
      const raw = rawHands[i];
      const category = categories[i]?.[0] ?? categories[i] ?? null;
      const label = category?.categoryName || category?.displayName || `HAND ${i + 1}`;
      const score = clamp(category?.score ?? 0.75, 0, 1);

      // Mirror X so movement to the user's right increases x on screen.
      const mirrored = raw.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z ?? 0 }));
      const palm = mirrored[9] ?? mirrored[0] ?? { x: 0.5, y: 0.5 };

      let best = null;
      let bestDistance = 0.4;
      for (const identity of this.identities) {
        if (taken.has(identity.id) || identity.label !== label) continue;
        const distance = Math.hypot(identity.x - palm.x, identity.y - palm.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = identity;
        }
      }

      let id = best?.id;
      if (!id) {
        id = taken.has(label) ? `${label}-${i + 1}` : label;
        while (taken.has(id)) id = `${id}'`;
      }
      taken.add(id);

      let filter = this.filters.get(id);
      if (!filter) {
        filter = new LandmarkFilter(TRACKING.filter);
        this.filters.set(id, filter);
      }
      const smoothed = filter.filter(mirrored, timestamp);
      hands.push({ id, landmarks: smoothed, raw: mirrored, handedness: label, score });
      nextIdentities.push({ id, label, x: palm.x, y: palm.y });
    }
    this.identities = nextIdentities;
    // Drop filters for identities that are gone.
    for (const key of [...this.filters.keys()]) {
      if (!nextIdentities.some((identity) => identity.id === key)) this.filters.delete(key);
    }

    const windows = this.metrics;
    this._detectWindow.frames++;
    if (now - this._detectWindow.start >= 1000) {
      windows.detectFps = Math.round((this._detectWindow.frames * 1000) / (now - this._detectWindow.start));
      this._detectWindow = { frames: 0, start: now };
    }
    this._fpsWindow.frames++;
    windows.totalFrames++;
    if (hands.length) windows.detectedFrames++;
    if (now - this._fpsWindow.start >= 1000) {
      windows.detectionRate = windows.detectedFrames / Math.max(windows.totalFrames, 1);
      this._fpsWindow = { frames: 0, start: now };
    }

    this.lastResult = { hands, at: now };
    this.drawOverlay(hands);
    return { hands, fresh: true };
  }

  drawOverlay(hands) {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.overlay.width;
    const h = this.overlay.height;
    ctx.clearRect(0, 0, w, h);
    if (!hands.length) return;

    for (const hand of hands) {
      const lm = hand.landmarks;
      const px = (p) => p.x * w;
      const py = (p) => p.y * h;
      const isLeft = hand.handedness === 'Left';

      // Bone glow
      ctx.lineCap = 'round';
      ctx.shadowColor = isLeft ? 'rgba(56,189,248,0.9)' : 'rgba(168,85,247,0.9)';
      ctx.shadowBlur = 12;
      ctx.strokeStyle = 'rgba(34,211,238,0.30)';
      ctx.lineWidth = 7;
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.moveTo(px(lm[a]), py(lm[a]));
        ctx.lineTo(px(lm[b]), py(lm[b]));
      }
      ctx.stroke();

      // Bones
      ctx.strokeStyle = isLeft ? 'rgba(125,240,255,0.95)' : 'rgba(216,180,254,0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.moveTo(px(lm[a]), py(lm[a]));
        ctx.lineTo(px(lm[b]), py(lm[b]));
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Joints
      for (let i = 0; i < lm.length; i++) {
        const tip = [4, 8, 12, 16, 20].includes(i);
        ctx.beginPath();
        ctx.arc(px(lm[i]), py(lm[i]), tip ? 4.4 : 2.8, 0, Math.PI * 2);
        ctx.fillStyle = tip ? '#ffffff' : 'rgba(190,250,255,0.9)';
        ctx.fill();
        if (i === 9) {
          ctx.beginPath();
          ctx.arc(px(lm[9]), py(lm[9]), 9, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(34,211,238,0.55)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Pinch indicator
      const palm = Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y) || 1e-3;
      const pinch = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y) / palm;
      if (pinch < 0.42) {
        const cx = (px(lm[4]) + px(lm[8])) / 2;
        const cy = (py(lm[4]) + py(lm[8])) / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 14 + (1 - pinch / 0.42) * 10, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Label
      const label = `${hand.handedness.toUpperCase()} ${Math.round(hand.score * 100)}%`;
      const lx = clamp(px(lm[0]) - 30, 6, w - 96);
      const ly = clamp(py(lm[0]) + 26, 18, h - 8);
      ctx.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = 'rgba(4,12,20,0.72)';
      const width = ctx.measureText(label).width + 14;
      ctx.fillRect(lx - 4, ly - 14, width, 20);
      ctx.fillStyle = isLeft ? '#7df0ff' : '#e9d5ff';
      ctx.fillText(label, lx + 3, ly);
    }
  }
}

export default HandTracker;
