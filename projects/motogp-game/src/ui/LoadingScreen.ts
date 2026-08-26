/** Minimal DOM loading overlay (see #loading-overlay in index.html). */
export class LoadingScreen {
  private el: HTMLElement;
  private textEl: HTMLElement | null;

  constructor() {
    this.el = document.getElementById('loading-overlay')!;
    this.textEl = document.getElementById('loading-text');
    this.el.style.cssText =
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:#0a0d12;color:#9fb2c8;font-size:18px;z-index:10;transition:opacity .4s;';
  }

  setText(text: string): void {
    if (this.textEl) this.textEl.textContent = text;
  }

  hide(): void {
    this.el.style.opacity = '0';
    this.el.style.pointerEvents = 'none';
    window.setTimeout(() => this.el.remove(), 450);
  }
}
