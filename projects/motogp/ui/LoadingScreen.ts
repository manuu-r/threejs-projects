/** Minimal loading overlay owned by the MotoGP game mount. */
export class LoadingScreen {
  private readonly el: HTMLElement;
  private readonly textEl: HTMLElement;

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'motogp-loading';
    this.textEl = document.createElement('div');
    this.textEl.className = 'motogp-loading__text';
    this.el.appendChild(this.textEl);
    host.appendChild(this.el);
    this.el.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:#0a0d12;color:#9fb2c8;font-size:18px;z-index:10;transition:opacity .4s;';
  }

  setText(text: string): void {
    this.textEl.textContent = text;
  }

  hide(): void {
    this.el.style.opacity = '0';
    this.el.style.pointerEvents = 'none';
    window.setTimeout(() => this.el.remove(), 450);
  }
}
