import { GESTURES, KEYBOARD_HELP, MODES } from '../config.js';

/**
 * Hud — all DOM writing lives here.
 * Values are cached so the render loop can call these every frame without
 * thrashing the DOM (only changed values touch the document).
 */
const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.cache = new Map();
    this.el = {
      boot: $('boot'),
      bootBar: $('bootBar'),
      bootStatus: $('bootStatus'),
      systemStatus: $('systemStatus'),
      systemState: $('systemState'),
      startButton: $('startButton'),
      stopButton: $('stopButton'),
      soundButton: $('soundButton'),
      helpButton: $('helpButton'),
      trackingChip: $('trackingChip'),
      gestureState: $('gestureState'),
      gestureAction: $('gestureAction'),
      confidenceState: $('confidenceState'),
      confidenceBar: $('confidenceBar'),
      handsState: $('handsState'),
      handedState: $('handedState'),
      inferenceState: $('inferenceState'),
      fpsState: $('fpsState'),
      fieldMode: $('fieldMode'),
      fieldScale: $('fieldScale'),
      handSpan: $('handSpan'),
      overdriveState: $('overdriveState'),
      particleCount: $('particleCount'),
      qualityChip: $('qualityChip'),
      eventLog: $('eventLog'),
      cameraChip: $('cameraChip'),
      cameraState: $('cameraState'),
      delegateState: $('delegateState'),
      cameraStage: $('cameraStage'),
      cameraPlaceholder: $('cameraPlaceholder'),
      cameraLoading: $('cameraLoading'),
      cameraLoadingText: $('cameraLoadingText'),
      cameraProgressBar: $('cameraProgressBar'),
      cameraError: $('cameraError'),
      modeSelector: $('modeSelector'),
      tutorialButton: $('tutorialButton'),
      resetButton: $('resetButton'),
      openReference: $('openReference'),
      manualCard: $('manualCard'),
      toastStack: $('toastStack'),
      liveRegion: $('liveRegion'),
      gestureGrid: $('gestureGrid'),
      keyboardGrid: $('keyboardGrid'),
    };

    this.buildModeButtons();
    this.buildReference();
    this.bind();
  }

  /* ── construction ─────────────────────────────────────────────── */
  buildModeButtons() {
    this.el.modeSelector.innerHTML = '';
    MODES.forEach((mode, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mode-button';
      button.dataset.modeIndex = String(index);
      button.setAttribute('aria-pressed', index === 0 ? 'true' : 'false');
      button.title = `${mode.name} — ${mode.subtitle}`;
      button.innerHTML = `<i>0${index + 1}</i>${mode.name}`;
      button.addEventListener('click', () => this.handlers.onModeSelect?.(index));
      this.el.modeSelector.appendChild(button);
    });
  }

  buildReference() {
    // Keyboard hints come from the single source of truth in config.js so the
    // gesture map can never drift away from the actual bindings.
    const entries = [
      ['OPEN_PALM', 'Hold all five fingers open'],
      ['FIST', 'Close your hand tightly'],
      ['PINCH', 'Touch thumb + index together'],
      ['PEACE', 'Two fingers together'],
      ['VICTORY', 'Two fingers spread in a V'],
      ['THUMB_UP', 'Thumb up, fingers folded'],
      ['SWIPE_LEFT', 'Swipe your open hand left'],
      ['SWIPE_RIGHT', 'Swipe your open hand right'],
      ['TWO_HANDS', 'Raise both hands'],
      ['SPREAD', 'Pull both hands apart'],
      ['CLOSE', 'Bring both hands together'],
    ];

    this.el.gestureGrid.innerHTML = entries
      .map(
        ([key, desc], index) => `
        <div class="gesture-item">
          <span class="gesture-item__glyph" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
          <span class="gesture-item__name">${GESTURES[key]?.label ?? key}
            <span class="gesture-item__desc">${desc} → ${GESTURES[key]?.action ?? ''}</span>
          </span>
          <span class="gesture-item__key">${GESTURES[key]?.key || ''}</span>
        </div>`,
      )
      .join('');

    this.el.keyboardGrid.innerHTML = KEYBOARD_HELP.map(
      (item) => `<div class="key-row"><span>${item.keys}</span><span>${item.action}</span></div>`,
    ).join('');
  }

  bind() {
    this.el.startButton.addEventListener('click', () => this.handlers.onStartCamera?.());
    this.el.stopButton.addEventListener('click', () => this.handlers.onStopCamera?.());
    this.el.soundButton.addEventListener('click', () => this.handlers.onToggleSound?.());
    this.el.helpButton.addEventListener('click', () => this.handlers.onOpenReference?.());
    this.el.openReference.addEventListener('click', () => this.handlers.onOpenReference?.());
    this.el.manualCard.addEventListener('click', () => this.handlers.onOpenReference?.());
    this.el.resetButton.addEventListener('click', () => this.handlers.onReset?.());
    this.el.tutorialButton.addEventListener('click', () => this.handlers.onTutorial?.());
  }

  /* ── small helpers ────────────────────────────────────────────── */
  setText(key, value) {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    const node = this.el[key];
    if (node) node.textContent = value;
  }

  setAttr(key, attr, value) {
    const node = this.el[key];
    if (!node) return;
    const cacheKey = `${key}.${attr}`;
    if (this.cache.get(cacheKey) === value) return;
    this.cache.set(cacheKey, value);
    node.setAttribute(attr, value);
  }

  /* ── status setters ───────────────────────────────────────────── */
  setSystem(state, text) {
    this.setAttr('systemStatus', 'data-state', state);
    this.setText('systemState', text);
  }

  setTracking(text, state = 'busy') {
    this.setText('trackingChip', text);
    this.setAttr('trackingChip', 'data-state', state);
  }

  setGesture(name, action, active = false) {
    this.setText('gestureState', name);
    this.setText('gestureAction', action);
    this.setAttr('gestureState', 'data-state', active ? 'active' : 'idle');
  }

  setConfidence(value) {
    const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
    this.setText('confidenceState', `${percent}%`);
    if (this.cache.get('confidenceWidth') !== percent) {
      this.cache.set('confidenceWidth', percent);
      this.el.confidenceBar.style.width = `${percent}%`;
    }
  }

  setHands(count, labels = '') {
    this.setText('handsState', String(count));
    this.setText('handedState', labels || '—');
  }

  setInference(ms, delegate) {
    this.setText('inferenceState', ms > 0 ? `${Math.round(ms)} MS` : '—');
    this.setText('delegateState', delegate ? `DELEGATE ${delegate}` : 'DELEGATE —');
  }

  setFps(fps) {
    if (!Number.isFinite(fps) || fps <= 0) {
      this.setText('fpsState', '—');
      return;
    }
    // Sub-10 fps values keep one decimal so a heavy scene reads honestly
    // instead of rounding down to zero and looking like "no data".
    const label = fps < 9.95 ? `${fps.toFixed(1)} FPS` : `${Math.round(fps)} FPS`;
    this.setText('fpsState', label);
  }

  setMode(mode) {
    this.setText('fieldMode', mode.name);
    for (const button of this.el.modeSelector.querySelectorAll('.mode-button')) {
      const index = Number(button.dataset.modeIndex);
      button.setAttribute('aria-pressed', index === this.handlers.getModeIndex?.() ? 'true' : 'false');
    }
  }

  setParticleCount(count) {
    this.setText('particleCount', count.toLocaleString('en-US'));
  }

  setFieldScale(value) {
    this.setText('fieldScale', `${value.toFixed(2)}×`);
  }

  setHandSpan(value) {
    this.setText('handSpan', value ? `${value.toFixed(2)}` : '—');
  }

  setOverdrive(active, remaining = 0) {
    this.setText('overdriveState', active ? `ACTIVE ${Math.ceil(remaining)}S` : 'OFF');
    this.setAttr('overdriveState', 'data-accent', active ? 'true' : 'false');
  }

  setQuality(label) {
    this.setText('qualityChip', label);
  }

  /* ── camera ───────────────────────────────────────────────────── */
  setCameraState({ chip, chipState, footer, live }) {
    this.setText('cameraChip', chip);
    this.setAttr('cameraChip', 'data-state', chipState || 'busy');
    this.setText('cameraState', footer);
    this.setAttr('cameraStage', 'data-live', live ? 'true' : 'false');
    if (live) this.el.cameraPlaceholder.style.opacity = '0';
    else this.el.cameraPlaceholder.style.opacity = '1';
  }

  showCameraLoading(label, ratio = 0) {
    this.el.cameraLoading.hidden = false;
    this.el.cameraPlaceholder.style.opacity = '0';
    this.setText('cameraLoadingText', label);
    this.el.cameraProgressBar.style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
  }

  hideCameraLoading() {
    this.el.cameraLoading.hidden = true;
  }

  setCameraError(message) {
    if (!message) {
      this.el.cameraError.hidden = true;
      this.el.cameraError.textContent = '';
      return;
    }
    this.el.cameraError.hidden = false;
    this.el.cameraError.textContent = message;
  }

  setStartButton(state) {
    const button = this.el.startButton;
    const label = button.querySelector('.btn-label');
    const compact = window.innerWidth <= 720;
    const labels = {
      busy: compact ? 'STARTING…' : 'INITIALISING…',
      active: compact ? 'CAMERA ON' : 'CAMERA ACTIVE',
      retry: compact ? 'RETRY' : 'RETRY CAMERA',
      idle: compact ? 'START CAMERA' : 'INITIALIZE CAMERA',
    };
    button.disabled = state === 'busy' || state === 'active';
    button.dataset.busy = state === 'busy' ? 'true' : 'false';
    button.dataset.state = state;
    label.textContent = labels[state] ?? labels.idle;
    this.el.stopButton.hidden = state !== 'active';
    this.el.stopButton.textContent = compact ? 'STOP' : 'STOP CAMERA';
    this.startState = state;
  }

  /** Re-render text that depends on the viewport width. */
  relayout() {
    if (this.startState) this.setStartButton(this.startState);
  }

  setSound(muted) {
    this.el.soundButton.setAttribute('aria-pressed', muted ? 'false' : 'true');
    this.el.soundButton.title = muted ? 'Sound off (M)' : 'Sound on (M)';
  }

  /* ── boot ─────────────────────────────────────────────────────── */
  boot(status, ratio) {
    if (status) this.setText('bootStatus', status);
    if (typeof ratio === 'number') this.el.bootBar.style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
  }

  hideBoot() {
    this.el.boot.dataset.hidden = 'true';
  }

  /* ── events + toasts ──────────────────────────────────────────── */
  logEvent(text, tone = 'info') {
    const empty = this.el.eventLog.querySelector('.event-log__empty');
    if (empty) empty.remove();
    const row = document.createElement('div');
    row.className = 'event-row';
    row.dataset.tone = tone;
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    row.innerHTML = `<time>${time}</time><span>${text}</span>`;
    this.el.eventLog.prepend(row);
    while (this.el.eventLog.children.length > 5) this.el.eventLog.lastElementChild.remove();
  }

  toast(text, { tone = 'info', duration = 3200 } = {}) {
    const node = document.createElement('div');
    node.className = 'toast';
    node.dataset.tone = tone;
    node.textContent = text;
    this.el.toastStack.appendChild(node);
    const remove = () => {
      node.dataset.leaving = 'true';
      setTimeout(() => node.remove(), 320);
    };
    const timer = setTimeout(remove, duration);
    node.addEventListener('click', () => {
      clearTimeout(timer);
      remove();
    });
    while (this.el.toastStack.children.length > 3) this.el.toastStack.firstElementChild.remove();
    return node;
  }

  live(text) {
    this.el.liveRegion.textContent = text;
  }
}

export default Hud;
