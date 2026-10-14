// Browser-style extension popup anchored to its toolbar button. The extension
// page runs in its own <webview> in the SAME session as the Web Viewer; no
// extension UI is injected into web pages.
import { Notice, setIcon, setTooltip } from 'obsidian';
import type ChromeExtensionsBridge from '../bridge';
import type { ExtensionRecord, WebviewTag } from '../types';
import { AnchoredSurface, Anchor } from './anchored';
import { renderExtensionIcon } from '../util';
import { tr } from '../i18n/strings';

// Chrome sizes a popup to its content within these limits.
const MIN = { width: 160, height: 60 };
const MAX = { width: 800, height: 600 };
const INITIAL = { width: 360, height: 420 };
const OPTIONS_SIZE = { width: 680, height: 560 };
const HEADER_HEIGHT = 36;
const SIZE_PREFIX = '[obsidian-bridge:size] ';

// Runs inside the popup page: reports the content's preferred size whenever it
// changes. Only prints to the popup's own console, which the host listens to.
const SIZE_PROBE = `(() => {
  if (window.__obsidianBridgeSizeProbe) return true;
  window.__obsidianBridgeSizeProbe = true;
  let last = '';
  const report = () => {
    const doc = document.documentElement, body = document.body;
    if (!body) return;
    let right = 0, bottom = 0;
    for (const el of body.children) {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const style = getComputedStyle(el);
      if (style.position === 'fixed' || style.display === 'none') continue;
      right = Math.max(right, r.right + (parseFloat(style.marginRight) || 0));
      bottom = Math.max(bottom, r.bottom + (parseFloat(style.marginBottom) || 0));
    }
    const bs = getComputedStyle(body);
    right += parseFloat(bs.marginRight) || 0;
    bottom += (parseFloat(bs.marginBottom) || 0) + (parseFloat(bs.paddingBottom) || 0);
    const size = {
      contentWidth: Math.ceil(right), contentHeight: Math.ceil(bottom),
      scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth,
      scrollHeight: doc.scrollHeight, clientHeight: doc.clientHeight
    };
    const key = JSON.stringify(size);
    if (key !== last) { last = key; console.debug(${JSON.stringify(SIZE_PREFIX)} + key); }
  };
  const ro = new ResizeObserver(report);
  ro.observe(document.documentElement);
  if (document.body) ro.observe(document.body);
  new MutationObserver(() => {
    if (document.body) for (const el of document.body.children) ro.observe(el);
    report();
  }).observe(document.documentElement, { childList: true, subtree: true });
  report();
  return true;
})()`;

export type PageKind = 'popup' | 'options';

/** What the size probe in the popup page reports. */
interface SizeReport { contentWidth: number; contentHeight: number; scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number }

export class ExtensionPopover {
  private surface: AnchoredSurface | null = null;
  private frame: WebviewTag | null = null;
  private errors: Array<{ level: number; message: string; sourceId?: string; line?: number }> = [];
  private targetTabId: number | null = null;
  private size = { ...INITIAL };

  constructor(
    private plugin: ChromeExtensionsBridge,
    readonly rec: ExtensionRecord,
    private relativePath: string,
    private anchor: Anchor,
    readonly kind: PageKind = 'popup',
    private sourceWebview: WebviewTag | null = null
  ) {}

  static resolveUrl(id: string, relPath: string): string {
    if (!/^[a-p]{32}$/.test(id)) throw new Error(tr('error.invalidChromeExtensionId'));
    const rel = String(relPath || '');
    if (!rel || /^[/\\]/.test(rel) || /\\/.test(rel) || /^(?:[a-z]+:|\/\/)/i.test(rel)) throw new Error(tr('error.invalidPopupPath'));
    const url = new URL(rel, `chrome-extension://${id}/`);
    if (url.protocol !== 'chrome-extension:' || url.hostname !== id ||
        rel.split('/').some(x => { try { return decodeURIComponent(x) === '..'; } catch { return true; } })) {
      throw new Error(tr('error.pageNotOwn'));
    }
    return url.href;
  }

  /** REAL webContents ID of the browser tab this popup was opened for. */
  get targetTab(): number | null { return this.isOpen ? this.targetTabId : null; }

  get isOpen(): boolean { return !!this.surface && !this.surface.isClosed; }
  isAnchoredTo(el: HTMLElement): boolean { return !!this.surface?.isAnchoredTo(el); }

  /** The browser tab owning the clicked action, as a REAL webContents ID. */
  private resolveTargetTab(): number | null {
    const guest: WebviewTag | null = this.sourceWebview?.isConnected ? this.sourceWebview : this.plugin.activeWebview();
    try {
      const id = guest?.getWebContentsId?.();
      return Number.isSafeInteger(id) && (id as number) > 0 ? id as number : null;
    } catch { return null; }
  }

  open(): this {
    this.targetTabId = this.kind === 'popup' ? this.resolveTargetTab() : null;
    // The popup URL must stay exactly the extension's own: extensions such as
    // Dark Reader only answer messages whose sender.url equals it. The compat
    // layer asks the host for the target tab instead (popup.targetTab).
    const url = new URL(ExtensionPopover.resolveUrl(this.rec.id, this.relativePath));
    const name = this.plugin.getDisplayName(this.rec);
    const surface = new AnchoredSurface(this.anchor, 'chrome-bridge-popover', tr(this.kind === 'options' ? 'popover.optionsLabel' : 'popover.panelLabel', { name }));
    this.surface = surface;
    surface.onClose = () => { this.frame = null; this.plugin.popoverClosed(this); };

    const header = surface.el.createDiv({ cls: 'chrome-bridge-popover-head' });
    renderExtensionIcon(header.createSpan({ cls: 'chrome-bridge-popover-icon' }), this.plugin.iconFor(this.rec, 16), name);
    header.createSpan({ cls: 'chrome-bridge-popover-title', text: this.kind === 'options' ? tr('popover.optionsTitle', { name }) : name });
    const button = (icon: string, label: string, onClick: () => void) => {
      const el = header.createEl('button', { cls: 'clickable-icon chrome-bridge-popover-button', attr: { type: 'button', 'aria-label': label } });
      setIcon(el, icon);
      setTooltip(el, label);
      el.addEventListener('click', onClick);
      return el;
    };
    if (this.kind === 'popup' && this.plugin.optionsPageOf(this.rec)) {
      button('settings', tr('list.options'), () => { surface.close(); void this.plugin.openOptions(this.rec, this.anchor); });
    }
    if (this.plugin.settings.debug) button('bug', tr('popover.diagnose'), () => void this.diagnose());
    button('x', tr('common.close'), () => surface.close());

    const status = surface.el.createDiv({ cls: 'chrome-bridge-popover-status', text: tr('common.loading') });
    const frame = document.createElement('webview');
    frame.className = 'chrome-bridge-popover-webview';
    frame.setAttribute('partition', this.plugin.partition());
    frame.setAttribute('src', url.href);
    this.frame = frame;
    frame.addEventListener('dom-ready', () => {
      status.hidden = true;
      if (this.kind === 'popup') frame.executeJavaScript(SIZE_PROBE).catch(() => undefined);
    });
    frame.addEventListener('console-message', e => {
      const message = e.message || '';
      if (message.startsWith(SIZE_PREFIX)) {
        try { this.fitContent(JSON.parse(message.slice(SIZE_PREFIX.length)) as SizeReport); } catch { /* best effort */ }
        return;
      }
      const level = e.level;
      if (level >= 2 || /(?:Uncaught|TypeError|ReferenceError|Failed to load|SyntaxError)/i.test(message)) {
        this.errors.push({ level, message: message.slice(0, 1500), sourceId: e.sourceId, line: e.line });
        if (this.errors.length > 30) this.errors.shift();
        if (this.plugin.settings.debug) console.warn('[Chrome Bridge] Popup error:', name, message);
      }
    });
    // window.close() in the extension page closes the popup, as in Chrome.
    frame.addEventListener('close', () => surface.close());
    frame.addEventListener('did-fail-load', event => {
      if (event.errorCode === -3) return;
      status.hidden = false;
      status.setText(tr('page.loadFailed', { code: event.errorCode, description: event.errorDescription || 'unknown' }));
    });
    surface.el.appendChild(frame);
    this.size = this.kind === 'options' ? { ...OPTIONS_SIZE } : { ...INITIAL };
    surface.setSize(this.size.width, this.size.height + HEADER_HEIGHT);
    return this;
  }

  /** Grow to overflowing content, shrink to fixed-size content (Chrome-like). */
  private fitContent(m: SizeReport): void {
    if (!this.surface || this.surface.isClosed) return;
    const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));
    const width = m.scrollWidth > m.clientWidth + 1 ? m.scrollWidth : m.contentWidth > 0 ? m.contentWidth : this.size.width;
    const height = m.scrollHeight > m.clientHeight + 1 ? m.scrollHeight : m.contentHeight > 0 ? m.contentHeight : this.size.height;
    const next = { width: clamp(width, MIN.width, MAX.width), height: clamp(height, MIN.height, MAX.height) };
    if (Math.abs(next.width - this.size.width) < 2 && Math.abs(next.height - this.size.height) < 2) return;
    this.size = next;
    this.surface.setSize(next.width, next.height + HEADER_HEIGHT);
  }

  async diagnose(): Promise<unknown> {
    const result: Record<string, unknown> = {
      extension: this.plugin.getDisplayName(this.rec), id: this.rec.id,
      expectedUrl: ExtensionPopover.resolveUrl(this.rec.id, this.relativePath),
      targetTabId: this.targetTabId, size: this.size, errors: [...this.errors]
    };
    try {
      result.page = await this.frame?.executeJavaScript(`(() => ({
        url: location.href, readyState: document.readyState, title: document.title,
        bodyText: document.body?.innerText?.slice(0, 180),
        runtimeId: chrome?.runtime?.id, browserType: typeof globalThis.browser,
        bridge: globalThis.__obsidianBridgeCompatV06 || null
      }))()`);
    } catch (e) { result.diagnosticError = String(e); }
    console.debug('[Chrome Bridge] Popup diagnostics:', JSON.stringify(result, null, 2));
    new Notice(tr('notice.extensionDiagnosticsLogged'));
    return result;
  }

  close(): void { this.surface?.close(); }
}
