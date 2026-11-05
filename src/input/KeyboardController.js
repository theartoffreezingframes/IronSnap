/**
 * Keyboard backup controls — the whole interface is operable without a camera.
 *
 * Continuous keys (steering, expand/compress, grab) fire immediately and then
 * repeat every 70 ms while held, so the field glides instead of jumping.
 */
const REPEAT_MS = 70;
const CONTINUOUS = new Set(['left', 'right', 'up', 'down', 'q', 'e', 'space']);

export class KeyboardController {
  constructor({ onAction = () => {}, onAnyKey = () => {}, onRelease = () => {} } = {}) {
    this.onAction = onAction;
    this.onAnyKey = onAnyKey;
    this.onRelease = onRelease;
    this.held = new Map();
    this.enabled = true;
    this._loop = null;
    this._keydown = this._keydown.bind(this);
    this._keyup = this._keyup.bind(this);
    this._blur = this._blur.bind(this);
    window.addEventListener('keydown', this._keydown);
    window.addEventListener('keyup', this._keyup);
    window.addEventListener('blur', this._blur);
  }

  static normalise(event) {
    switch (event.key) {
      case ' ':
      case 'Spacebar':
        return 'space';
      case 'ArrowLeft':
        return 'left';
      case 'ArrowRight':
        return 'right';
      case 'ArrowUp':
        return 'up';
      case 'ArrowDown':
        return 'down';
      case 'Escape':
        return 'escape';
      default:
        return event.key.toLowerCase();
    }
  }

  _isTyping(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return false;
    return (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    );
  }

  _keydown(event) {
    if (!this.enabled || this._isTyping(event) || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = KeyboardController.normalise(event);
    this.onAnyKey(key, event);
    if (CONTINUOUS.has(key)) event.preventDefault();
    if (event.repeat) return;

    const handled = this.onAction(key, event, { repeated: false });
    if (handled === false) return;

    if (CONTINUOUS.has(key)) {
      this.held.set(key, performance.now() + 220);
      this._startLoop();
    }
  }

  _keyup(event) {
    const key = KeyboardController.normalise(event);
    this.held.delete(key);
    this.onRelease(key);
  }

  _blur() {
    this.held.clear();
  }

  _startLoop() {
    if (this._loop) return;
    const tick = () => {
      const now = performance.now();
      for (const [key, next] of this.held) {
        if (now >= next) {
          this.held.set(key, now + REPEAT_MS);
          this.onAction(key, null, { repeated: true });
        }
      }
      this._loop = this.held.size ? requestAnimationFrame(tick) : null;
    };
    this._loop = requestAnimationFrame(tick);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.held.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this._keydown);
    window.removeEventListener('keyup', this._keyup);
    window.removeEventListener('blur', this._blur);
    if (this._loop) cancelAnimationFrame(this._loop);
  }
}

export default KeyboardController;
