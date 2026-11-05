/**
 * Gesture reference drawer with backdrop + focus handling.
 */
export class Reference {
  constructor({ onOpenChange = () => {} } = {}) {
    this.root = document.getElementById('reference');
    this.onOpenChange = onOpenChange;
    this.visible = false;
    this._lastFocus = null;

    for (const node of this.root.querySelectorAll('[data-close-reference]')) {
      node.addEventListener('click', () => this.close());
    }
  }

  open() {
    if (this.visible) return;
    this._lastFocus = document.activeElement;
    this.root.hidden = false;
    this.visible = true;
    const focusable = this.root.querySelector('button, [href]');
    focusable?.focus({ preventScroll: true });
    this.onOpenChange(true);
  }

  close() {
    if (!this.visible) return;
    this.root.hidden = true;
    this.visible = false;
    this._lastFocus?.focus?.({ preventScroll: true });
    this.onOpenChange(false);
  }

  toggle() {
    if (this.visible) this.close();
    else this.open();
  }
}

export default Reference;
