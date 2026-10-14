// Turns one Obsidian Web Viewer <webview> into chrome.tabs.onUpdated events
// (Electron never fires tabs events for these guests). Chrome's order for a
// load: {status: 'loading', url} → {title} / {favIconUrl} → {status: 'complete'}.
import type { TabEvent, TabFields } from '../shared/protocol';
import type { WebviewTag } from '../types';
import { onWebview, WebviewEventMap, WebviewEventName } from './webview-events';

export type TabSink = (event: TabEvent, tab: TabFields, extra?: { changeInfo?: Record<string, unknown>; removeInfo?: { windowId: number; isWindowClosing: boolean } }) => void;

export class TabObserver {
  private detach: Array<() => void> = [];
  private status: 'loading' | 'complete' = 'complete';
  private title = '';
  /** Captured while alive: a destroyed guest has no webContents ID. */
  tabId: number | null = null;

  constructor(private webview: WebviewTag, private sink: TabSink, private wanted: () => boolean, private isActive: () => boolean) {
    this.captureId();
    const on = <K extends WebviewEventName>(name: K, fn: (e: WebviewEventMap[K]) => void) => {
      this.detach.push(onWebview(webview, name, e => {
        this.captureId();
        if (this.tabId === null || !this.wanted()) return;
        try { fn(e); } catch (err) { console.warn('[Chrome Bridge] tabs events:', err); }
      }));
    };
    // Only committed navigations change status: a blocked or failed one (e.g.
    // history.back() to a data: URL) must not look like the page loading again.
    on('did-navigate', e => {
      this.status = 'loading';
      this.update({ status: 'loading', url: e.url });
    });
    on('did-navigate-in-page', e => { if (e.isMainFrame) this.update({ url: e.url }); });
    on('page-title-updated', e => {
      const title = e.title ?? '';
      if (title === this.title) return;
      this.title = title;
      this.update({ title });
    });
    on('page-favicon-updated', e => {
      const icon = Array.isArray(e.favicons) ? e.favicons[0] : undefined;
      if (typeof icon === 'string') this.update({ favIconUrl: icon });
    });
    on('did-stop-loading', () => {
      if (this.status === 'complete') return;
      this.status = 'complete';
      this.update({ status: 'complete' });
    });
  }

  private captureId(): void {
    if (this.tabId !== null) return;
    try {
      const id = this.webview.getWebContentsId();
      if (Number.isSafeInteger(id) && id > 0) this.tabId = id;
    } catch { /* best effort */ }
  }

  /** The live fields the host knows about this tab. */
  fields(): TabFields | null {
    this.captureId();
    if (this.tabId === null) return null;
    let url: string | undefined;
    try { url = this.webview.getURL() || undefined; } catch { /* best effort */ }
    return { id: this.tabId, url, title: this.title || undefined, status: this.status, active: this.isActive() };
  }

  private update(changeInfo: Record<string, unknown>): void {
    const tab = this.fields();
    if (tab) this.sink('onUpdated', tab, { changeInfo });
  }

  dispose(): void {
    for (const off of this.detach.splice(0)) off();
  }
}
