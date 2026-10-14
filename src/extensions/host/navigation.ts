// Turns Obsidian Web Viewer <webview> navigation events into
// chrome.webNavigation event details. Frame IDs follow Chromium's extension
// convention: 0 for the main frame, the FrameTreeNode ID for sub-frames
// (so they work with scripting.executeScript / tabs.sendMessage frameIds).
import type { FrameDetails, WebNavigationEvent } from '../shared/protocol';
import type { Remote, WebviewTag } from '../types';
import { FrameIds, onWebview, WebviewEventMap, WebviewEventName } from './webview-events';
import type * as Electron from 'electron';

export type NavigationSink = (event: WebNavigationEvent, details: Record<string, unknown>) => void;

interface FrameRef { frameId: number; parentFrameId: number }

/** Resolves sub-frame identities through Electron's main-process WebFrameMain. */
export interface FrameResolver {
  resolve(processId: number, routingId: number): FrameRef | null;
}

export function remoteFrameResolver(remote: Remote | null): FrameResolver {
  return {
    resolve(processId, routingId) {
      try {
        const frame = remote?.webFrameMain.fromId(processId, routingId);
        if (!frame) return null;
        const parent = frame.parent;
        if (!parent) return { frameId: 0, parentFrameId: -1 };
        const parentIsTop = !parent.parent;
        return { frameId: frame.frameTreeNodeId, parentFrameId: parentIsTop ? 0 : parent.frameTreeNodeId };
      } catch { return null; }
    }
  };
}

/** All frames of a guest, for webNavigation.getAllFrames. */
export function framesOfWebContents(contents: Electron.WebContents): FrameDetails[] {
  const main = contents.mainFrame;
  const mainId = main.frameTreeNodeId;
  return main.framesInSubtree.map((frame): FrameDetails => {
    const id = frame.frameTreeNodeId;
    const parent = frame.parent;
    return {
      frameId: id === mainId ? 0 : id,
      parentFrameId: !parent ? -1 : parent.frameTreeNodeId === mainId ? 0 : parent.frameTreeNodeId,
      processId: frame.processId,
      url: frame.url,
      errorOccurred: false,
      frameType: id === mainId ? 'outermost_frame' : 'sub_frame',
      documentLifecycle: 'active'
    };
  });
}

type FrameEvent = { isMainFrame: boolean } & FrameIds;

const sameDocument = (a: string, b: string) => a.replace(/#.*$/, '') === b.replace(/#.*$/, '');

/**
 * Observes one Web Viewer webview. `wanted()` gates all work (including
 * remote frame lookups) so pages cost nothing when no extension listens.
 */
export class NavigationObserver {
  private committed = new Map<string, { url: string; frameId: number; parentFrameId: number; processId: number }>();
  /** Sub-frame identities by process:routing ID; each lookup is a sync remote call. */
  private frames = new Map<string, FrameRef | null>();
  private mainProcessId = -1;
  private lastMainUrl = '';
  private detach: Array<() => void> = [];

  constructor(private webview: WebviewTag, private resolver: FrameResolver, private sink: NavigationSink, private wanted: () => boolean) {
    const on = <K extends WebviewEventName>(name: K, fn: (event: WebviewEventMap[K]) => void) => {
      this.detach.push(onWebview(webview, name, event => {
        if (!this.wanted()) return;
        try { fn(event); } catch (e) { console.warn('[Chrome Bridge] webNavigation:', e); }
      }));
    };
    on('did-start-navigation', e => {
      if (e.isInPlace) return; // fragment/history changes are reported separately
      const frame = this.frame(e);
      if (!frame) return;
      this.emit('onBeforeNavigate', frame, { url: e.url, processId: -1 });
    });
    on('did-frame-navigate', e => {
      const frame = this.frame(e);
      if (!frame) return;
      const processId = Number(e.frameProcessId) || -1;
      let transitionType = frame.frameId === 0 ? 'link' : 'auto_subframe';
      if (frame.frameId === 0) {
        if (e.url === this.lastMainUrl) transitionType = 'reload';
        this.lastMainUrl = e.url;
        this.mainProcessId = processId;
        this.committed.clear();
        this.frames.clear();
      }
      this.committed.set(this.key(e), { url: e.url, processId, ...frame });
      this.emit('onCommitted', frame, { url: e.url, processId, transitionType, transitionQualifiers: [] });
    });
    on('did-navigate-in-page', e => {
      const frame = this.frame(e);
      if (!frame) return;
      const key = this.key(e);
      const previous = this.committed.get(key);
      const kind: WebNavigationEvent = previous && sameDocument(previous.url, e.url) ? 'onReferenceFragmentUpdated' : 'onHistoryStateUpdated';
      const processId = previous?.processId ?? (Number(e.frameProcessId) || -1);
      this.committed.set(key, { url: e.url, processId, ...frame });
      if (frame.frameId === 0) this.lastMainUrl = e.url;
      this.emit(kind, frame, { url: e.url, processId, transitionType: 'link', transitionQualifiers: [] });
    });
    on('dom-ready', () => {
      this.emit('onDOMContentLoaded', { frameId: 0, parentFrameId: -1 }, { url: this.url(), processId: this.mainProcessId });
    });
    on('did-frame-finish-load', e => {
      const frame = e.isMainFrame ? { frameId: 0, parentFrameId: -1 } : this.frame(e);
      if (!frame) return;
      const known = this.committed.get(this.key(e));
      const url = frame.frameId === 0 ? this.url() : known?.url;
      if (!url) return;
      this.emit('onCompleted', frame, { url, processId: frame.frameId === 0 ? this.mainProcessId : known?.processId ?? -1 });
    });
    on('did-fail-load', e => {
      const frame = e.isMainFrame ? { frameId: 0, parentFrameId: -1 } : this.frame(e);
      if (!frame) return;
      const name = e.errorDescription || 'ERR_FAILED';
      this.emit('onErrorOccurred', frame, {
        url: e.validatedURL || '', processId: Number(e.frameProcessId) || -1,
        error: name.startsWith('net::') ? name : 'net::' + name
      });
    });
  }

  private key(e: FrameEvent): string { return e.isMainFrame ? 'main' : `${e.frameProcessId}:${e.frameRoutingId}`; }

  private frame(e: FrameEvent): FrameRef | null {
    if (e.isMainFrame) return { frameId: 0, parentFrameId: -1 };
    const pid = Number(e.frameProcessId), rid = Number(e.frameRoutingId);
    if (!Number.isInteger(pid) || !Number.isInteger(rid)) return null;
    const key = `${pid}:${rid}`;
    if (!this.frames.has(key)) this.frames.set(key, this.resolver.resolve(pid, rid));
    return this.frames.get(key) ?? null;
  }

  private url(): string {
    try { return this.webview.getURL(); } catch { return this.lastMainUrl; }
  }

  private emit(event: WebNavigationEvent, frame: FrameRef, extra: Record<string, unknown>): void {
    let tabId: number;
    try { tabId = this.webview.getWebContentsId(); } catch { return; }
    if (!Number.isSafeInteger(tabId)) return;
    this.sink(event, {
      tabId, timeStamp: Date.now(), ...frame, ...extra,
      frameType: frame.frameId === 0 ? 'outermost_frame' : 'sub_frame',
      documentLifecycle: 'active'
    });
  }

  dispose(): void {
    for (const off of this.detach.splice(0)) off();
  }
}
