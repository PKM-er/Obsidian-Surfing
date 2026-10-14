// A floating surface anchored to a header button, like a browser's extension
// popup: closes on outside click, Escape, or when its anchor disappears.

export type Anchor = HTMLElement | DOMRect | null;

export class AnchoredSurface {
  readonly el: HTMLElement;
  private closed = false;
  private cleanup: Array<() => void> = [];
  private size = { width: 380, height: 490 };
  onClose: (() => void) | null = null;

  constructor(private anchor: Anchor, cls: string, label: string) {
    this.el = document.body.createDiv({ cls: ['chrome-bridge-surface', cls], attr: { role: 'dialog', 'aria-label': label } });
    const onPointer = (e: PointerEvent) => {
      if (this.el.contains(e.target as Node)) return;
      // Clicking the anchor toggles; let its own handler decide.
      if (this.anchor instanceof HTMLElement && this.anchor.contains(e.target as Node)) return;
      this.close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } };
    const onResize = () => this.position();
    const onScroll = (e: Event) => {
      if (this.el.contains(e.target as Node)) return;
      if (this.anchor instanceof HTMLElement) this.position();
      else this.close();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('scroll', onScroll, true);
    this.cleanup.push(
      () => document.removeEventListener('pointerdown', onPointer, true),
      () => document.removeEventListener('keydown', onKey, true),
      () => window.removeEventListener('resize', onResize),
      () => document.removeEventListener('scroll', onScroll, true)
    );
  }

  get isClosed(): boolean { return this.closed; }
  isAnchoredTo(el: HTMLElement): boolean { return this.anchor === el; }

  setSize(width: number, height: number): void {
    this.size = { width, height };
    this.position();
  }

  position(): void {
    if (this.closed) return;
    if (this.anchor instanceof HTMLElement && !this.anchor.isConnected) { this.close(); return; }
    const w = Math.min(this.size.width, Math.max(220, window.innerWidth - 24));
    const h = Math.min(this.size.height, Math.max(160, window.innerHeight - 24));
    const r = this.anchor instanceof HTMLElement ? this.anchor.getBoundingClientRect()
      : this.anchor ?? { left: window.innerWidth - 30, right: window.innerWidth - 18, top: 55, bottom: 78 } as DOMRect;
    const left = Math.min(Math.max(12, r.right - w), window.innerWidth - w - 12);
    const top = r.bottom + 6 + h <= window.innerHeight - 12 ? r.bottom + 6 : Math.max(12, r.top - h - 6);
    Object.assign(this.el.style, { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px` });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const off of this.cleanup.splice(0)) off();
    this.el.remove();
    this.onClose?.();
  }
}
