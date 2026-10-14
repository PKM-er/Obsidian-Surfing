// The browser tabs extensions run in. Surfing hosts extensions in Obsidian's
// core Web Viewer while that core plugin is enabled, and in its own browser
// view otherwise. Both are leaves whose view owns one <webview>; they differ
// in view type, session partition and how a URL is opened.
import type { App, View, WorkspaceLeaf } from 'obsidian';
import type { WebviewTag } from '../types';

export type TargetKind = 'webviewer' | 'surfing';

export interface BrowserTarget {
  kind: TargetKind;
  /** Name of the browser in messages ("Web Viewer", "Surfing"). */
  label: string;
  viewType: string;
  /** Session partition the tabs (and so the extensions) live in. */
  partition: string;
  /** Matches this browser's tab <webview>s anywhere in the workspace. */
  webviewSelector: string;
  webviewOf(view: View): WebviewTag | null;
  /** Open a URL in a new tab of this browser. */
  open(url: string, active: boolean): Promise<WorkspaceLeaf>;
  /**
   * Web Viewer builds its page menu natively from an Electron template, so
   * extension items are merged into that; Surfing builds an Obsidian Menu
   * and asks the bridge for items itself.
   */
  nativePageMenu: boolean;
}

/** Obsidian's undocumented App members (optional: they may change between versions). */
type AppWithInternals = App & {
  appId?: string;
  internalPlugins?: {
    getPluginById?(id: string): { enabled?: boolean } | null;
    plugins?: Record<string, { enabled?: boolean } | undefined>;
  };
};

const WEBVIEWER = 'webviewer';
export const SURFING_VIEW = 'surfing-view';

/** Is Obsidian's core Web Viewer plugin enabled? */
export function webViewerEnabled(app: App): boolean {
  const internal = (app as AppWithInternals).internalPlugins;
  const plugin = internal?.getPluginById?.(WEBVIEWER) ?? internal?.plugins?.[WEBVIEWER];
  return !!plugin?.enabled;
}

async function openLeaf(app: App, type: string, state: Record<string, unknown>, active: boolean): Promise<WorkspaceLeaf> {
  const leaf = app.workspace.getLeaf('tab');
  await leaf.setViewState({ type, state, active });
  if (active) void app.workspace.revealLeaf(leaf);
  return leaf;
}

export function webViewerTarget(app: App): BrowserTarget {
  const selector = '.webviewer-content webview[partition^="persist:"]';
  // Obsidian names the Web Viewer session after the vault; prefer what an
  // open tab actually uses in case that ever changes.
  const live = document.querySelector(selector)?.getAttribute('partition');
  return {
    kind: 'webviewer',
    label: 'Web Viewer',
    viewType: WEBVIEWER,
    partition: live || `persist:vault-${(app as AppWithInternals).appId ?? ''}`,
    webviewSelector: selector,
    webviewOf: view => (view as View & { webview?: WebviewTag }).webview ?? view.containerEl.querySelector<WebviewTag>(selector),
    open: (url, active) => openLeaf(app, WEBVIEWER, { url, navigate: true }, active),
    nativePageMenu: true
  };
}

export function surfingTarget(app: App, options: { sessionIsolation: boolean }): BrowserTarget {
  const selector = `.workspace-leaf-content[data-type="${SURFING_VIEW}"] webview.wb-frame`;
  return {
    kind: 'surfing',
    label: 'Surfing',
    viewType: SURFING_VIEW,
    // With session isolation every Surfing tab has its own in-memory
    // session, which extensions cannot be loaded into.
    partition: options.sessionIsolation ? '' : `persist:surfing-vault-${(app as AppWithInternals).appId ?? ''}`,
    webviewSelector: selector,
    webviewOf: view => (view as View & { webviewEl?: WebviewTag }).webviewEl ?? view.containerEl.querySelector<WebviewTag>('webview.wb-frame'),
    open: (url, active) => openLeaf(app, SURFING_VIEW, { url }, active),
    nativePageMenu: false
  };
}
