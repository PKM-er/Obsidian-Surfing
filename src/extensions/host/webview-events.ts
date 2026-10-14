// Electron <webview> DOM events by name, with the event types Electron's own
// typings declare, so handlers registered under a computed name stay typed.
import type { WebviewTag } from '../types';
import type * as Electron from 'electron';

/**
 * Electron's <webview> also passes the frame's process/routing IDs with these
 * events (its event-to-property table); its typings leave them out.
 */
export interface FrameIds { frameProcessId?: number; frameRoutingId?: number }

export interface WebviewEventMap {
  'close': Event;
  'console-message': Electron.ConsoleMessageEvent;
  'destroyed': Event;
  'did-fail-load': Electron.DidFailLoadEvent & FrameIds;
  'did-frame-finish-load': Electron.DidFrameFinishLoadEvent & FrameIds;
  'did-frame-navigate': Electron.DidFrameNavigateEvent;
  'did-navigate': Electron.DidNavigateEvent;
  'did-navigate-in-page': Electron.DidNavigateInPageEvent & FrameIds;
  'did-start-navigation': Electron.DidStartNavigationEvent;
  'did-stop-loading': Event;
  'dom-ready': Event;
  'page-favicon-updated': Electron.PageFaviconUpdatedEvent;
  'page-title-updated': Electron.PageTitleUpdatedEvent;
  'render-process-gone': Electron.RenderProcessGoneEvent;
  /** Emitted by the <webview> element; Electron's typings do not declare it. */
  'context-menu': Event & { params: Electron.ContextMenuParams };
}

export type WebviewEventName = keyof WebviewEventMap;

/** Adds a typed listener; returns the function that removes it. */
export function onWebview<K extends WebviewEventName>(target: WebviewTag | HTMLElement, name: K,
  listener: (event: WebviewEventMap[K]) => void, capture = false): () => void {
  const fn = listener as EventListener;
  target.addEventListener(name, fn, capture);
  return () => target.removeEventListener(name, fn, capture);
}
