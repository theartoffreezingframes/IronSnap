import { STORAGE_KEYS, TUTORIAL_STEPS } from '../config.js';

/**
 * First-run briefing. Progress is remembered in localStorage, and the
 * overlay is fully keyboard accessible (Esc closes, arrows page through).
 */
export class Tutorial {
  constructor({ steps = TUTORIAL_STEPS, onComplete = () => {} } = {}) {
    this.steps = steps;
    this.onComplete = onComplete;
    this.index = 0;
    this.el = {
      root: document.getElementById('tutorial'),
      step: document.getElementById('tutorialStep'),
      title: document.getElementById('tutorialTitle'),
      body: document.getElementById('tutorialBody'),
      hint: document.getElementById('tutorialHint'),
      dots: document.getElementById('tutorialDots'),
      prev: document.getElementById('tutorialPrev'),
      next: document.getElementById('tutorialNext'),
      skip: document.getElementById('tutorialSkip'),
    };
    this.el.prev.addEventListener('click', () => this.prev());
    this.el.next.addEventListener('click', () => this.next());
    this.el.skip.addEventListener('click', () => this.close());
    this.el.dots.innerHTML = steps.map(() => '<span></span>').join('');
    this.visible = false;
  }

  get seen() {
    try {
      return localStorage.getItem(STORAGE_KEYS.tutorial) === 'seen';
    } catch {
      return false;
    }
  }

  markSeen() {
    try {
      localStorage.setItem(STORAGE_KEYS.tutorial, 'seen');
    } catch {
      /* private mode — not fatal */
    }
  }

  open({ force = false, delay = 0 } = {}) {
    if (!force && this.seen) return false;
    this.index = 0;
    this.render();
    const show = () => {
      this.el.root.hidden = false;
      this.visible = true;
      this.el.next.focus({ preventScroll: true });
      this.onComplete({ open: true });
    };
    if (delay) setTimeout(show, delay);
    else show();
    return true;
  }

  close({ completed = false } = {}) {
    this.el.root.hidden = true;
    this.visible = false;
    if (completed) this.markSeen();
    this.onComplete({ open: false, completed });
  }

  next() {
    if (this.index >= this.steps.length - 1) {
      this.close({ completed: true });
      return;
    }
    this.index = Math.min(this.index + 1, this.steps.length - 1);
    this.render();
  }

  prev() {
    this.index = Math.max(0, this.index - 1);
    this.render();
  }

  render() {
    const step = this.steps[this.index];
    this.el.step.textContent = `/ 0${this.index + 1}`;
    this.el.title.textContent = step.title;
    this.el.body.textContent = step.body;
    this.el.hint.textContent = step.hint;
    this.el.prev.disabled = this.index === 0;
    this.el.next.textContent = this.index === this.steps.length - 1 ? 'BEGIN' : 'NEXT';
    [...this.el.dots.children].forEach((dot, i) => {
      dot.dataset.active = String(i <= this.index);
    });
    // Safety: mark as "seen" if the user reaches the end, even if they close early.
    if (this.index === this.steps.length - 1) this.markSeen();
  }
}

export default Tutorial;
