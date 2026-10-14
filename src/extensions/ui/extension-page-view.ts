// A workspace tab showing one of a managed extension's own pages
// (chrome-extension://<id>/...), e.g. an options page with open_in_tab, a
// dashboard opened by tabs.create, or a link the extension opened.
import { ItemView, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import type ChromeExtensionsBridge from '../bridge';
import type { WebviewTag } from '../types';
import { tr } from '../i18n/strings';

export const EXTENSION_PAGE_VIEW = 'chrome-bridge-extension-page';

interface PageState { url?: string }

export class ExtensionPageView extends ItemView {
  private url = '';
  private title = '';
  webview: WebviewTag | null = null;
  private status: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: ChromeExtensionsBridge) { super(leaf); }

  getViewType(): string { return EXTENSION_PAGE_VIEW; }
  getIcon(): string { return 'puzzle'; }
  getDisplayText(): string {
    if (this.title) return this.title;
    const rec = this.plugin.recordForUrl(this.url);
    return rec ? this.plugin.getDisplayName(rec) : tr('page.title');
  }

  getState(): Record<string, unknown> { return { url: this.url }; }

  async setState(state: PageState, result: ViewStateResult): Promise<void> {
    if (typeof state?.url === 'string' && state.url !== this.url) {
      this.url = state.url;
      this.showPage();
    }
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('chrome-bridge-extension-page');
    this.addAction('rotate-cw', tr('page.reload'), () => this.webview?.reload());
    if (this.url) this.showPage();
  }

  /**
   * Show the page again if it no longer matches where extensions run: a tab
   * restored at startup opens before its extension is loaded, and a page
   * from the previous session stops working when extensions move to the
   * other browser's session.
   */
  refreshIfStale(): void {
    if (!this.url) return;
    let partition: string | null = null;
    try { partition = this.plugin.partition(); } catch { /* extensions not running */ }
    const current = this.webview?.getAttribute('partition') ?? null;
    if (current !== null && current === partition) return;
    if (current === null && !this.plugin.recordForUrl(this.url)) return;
    this.showPage();
  }

  private showPage(): void {
    this.contentEl.empty();
    this.webview = null;
    this.title = '';
    // Only pages of extensions this plugin manages and has loaded.
    const rec = this.plugin.recordForUrl(this.url);
    if (!rec) {
      this.contentEl.createDiv({ cls: 'chrome-bridge-page-status', text: this.url ? tr('page.notAvailable') : '' });
      return;
    }
    this.status = this.contentEl.createDiv({ cls: 'chrome-bridge-page-status', text: tr('common.loading') });
    const webview = document.createElement('webview');
    webview.className = 'chrome-bridge-page-webview';
    webview.setAttribute('partition', this.plugin.partition());
    webview.setAttribute('src', this.url);
    webview.addEventListener('dom-ready', () => { if (this.status) this.status.hidden = true; });
    webview.addEventListener('page-title-updated', e => {
      this.title = e.title || '';
      (this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.();
    });
    webview.addEventListener('did-fail-load', e => {
      if (e.errorCode === -3 || !this.status) return;
      this.status.hidden = false;
      this.status.setText(tr('page.loadFailed', { code: e.errorCode, description: e.errorDescription || 'unknown' }));
    });
    // window.close() from the extension page closes this tab.
    webview.addEventListener('close', () => this.leaf.detach());
    this.contentEl.appendChild(webview);
    this.webview = webview;
  }

  async onClose(): Promise<void> {
    this.webview?.remove();
    this.webview = null;
  }
}
