// Finding the browser tabs open in Obsidian: leaves of Obsidian's core Web
// Viewer and of Surfing. Only these two kinds are ever exposed to agents, so
// Obsidian's own page, extension pages and hidden helper webviews stay out.
import { remote } from "electron";
import type * as Electron from "electron";
import type { App, View, WorkspaceLeaf } from "obsidian";
import { surfingTarget, SURFING_VIEW, webViewerEnabled, webViewerTarget } from "../extensions/host/targets";

export type BrowserKind = "webviewer" | "surfing";

export interface Tab {
	/** The webContents id: stable for the life of the webview. */
	id: number;
	kind: BrowserKind;
	leaf: WorkspaceLeaf;
	view: View;
	webview: Electron.WebviewTag;
}

export interface ConsoleEntry {
	level: "verbose" | "info" | "warning" | "error";
	text: string;
	source: string;
	time: number;
}

const WEBVIEWER = "webviewer";
const CONSOLE_LEVELS: ConsoleEntry["level"][] = ["verbose", "info", "warning", "error"];
const CONSOLE_BUFFER = 200;

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** The <webview> of a leaf's view, when it is one of the two browsers and has one. */
function webviewOfView(view: View): { kind: BrowserKind; webview: Electron.WebviewTag } | null {
	const type = view.getViewType();
	if (type === WEBVIEWER) {
		const own = (view as View & { webview?: Electron.WebviewTag }).webview;
		const webview = own ?? view.containerEl.querySelector<Electron.WebviewTag>("webview");
		return webview ? { kind: "webviewer", webview } : null;
	}
	if (type === SURFING_VIEW) {
		const webview = (view as View & { webviewEl?: Electron.WebviewTag }).webviewEl;
		return webview ? { kind: "surfing", webview } : null;
	}
	return null;
}

export function isBrowserLeaf(leaf: WorkspaceLeaf): boolean {
	const type = leaf.view.getViewType();
	return type === WEBVIEWER || type === SURFING_VIEW;
}

export class TabRegistry {
	private consoles = new WeakMap<Electron.WebviewTag, ConsoleEntry[]>();
	private lastLeaf: WeakRef<WorkspaceLeaf> | null = null;

	constructor(private app: App) {}

	/** Remember the browser tab the user is on, for calls that name no tab. */
	noteActiveLeaf(leaf: WorkspaceLeaf | null): void {
		if (leaf && isBrowserLeaf(leaf)) this.lastLeaf = new WeakRef(leaf);
	}

	/** Start collecting a webview's console output (once). */
	private trackConsole(webview: Electron.WebviewTag): ConsoleEntry[] {
		let buffer = this.consoles.get(webview);
		if (buffer) return buffer;
		const entries: ConsoleEntry[] = [];
		buffer = entries;
		this.consoles.set(webview, entries);
		// A new page starts with an empty console.
		webview.addEventListener("did-navigate", () => {
			entries.length = 0;
		});
				webview.addEventListener("console-message", (event) => {
			entries.push({
				level: CONSOLE_LEVELS[event.level] ?? "info",
				text: String(event.message).slice(0, 2000),
				source: event.sourceId ? `${event.sourceId}:${event.line}` : "",
				time: Date.now(),
			});
			if (entries.length > CONSOLE_BUFFER) entries.splice(0, entries.length - CONSOLE_BUFFER);
		});
		return entries;
	}

	consoleOf(tab: Tab): ConsoleEntry[] {
		return this.trackConsole(tab.webview);
	}

	/** All web tabs, in every window. */
	list(): Tab[] {
		const tabs: Tab[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			const tab = this.tabOfLeaf(leaf);
			if (tab) tabs.push(tab);
		});
		return tabs;
	}

	tabOfLeaf(leaf: WorkspaceLeaf): Tab | null {
		if (leaf.isDeferred) return null;
		const found = webviewOfView(leaf.view);
		if (!found) return null;
		let id: number;
		try {
			id = found.webview.getWebContentsId();
		} catch {
			// Not attached or not ready yet.
			return null;
		}
		this.trackConsole(found.webview);
		return { id, kind: found.kind, leaf, view: leaf.view, webview: found.webview };
	}

	get(id: number): Tab | null {
		return this.list().find((tab) => tab.id === id) ?? null;
	}

	/** The tab a call without tabId acts on. */
	resolve(id: number | undefined): Tab {
		const tabs = this.list();
		if (id !== undefined) {
			const tab = tabs.find((candidate) => candidate.id === id);
			if (!tab) throw new Error(`No web tab with tabId ${id}. Call tabs_list.`);
			return tab;
		}
		if (tabs.length === 0) throw new Error("No web tabs are open. Use tabs_create to open one.");
		const last = this.lastLeaf?.deref();
		const lastTab = last ? tabs.find((tab) => tab.leaf === last) : undefined;
		if (lastTab) return lastTab;
		const recent = this.app.workspace.getMostRecentLeaf();
		return (
			tabs.find((tab) => tab.leaf === recent) ??
			tabs.find((tab) => tab.webview.clientWidth > 0) ??
			tabs[0]
		);
	}

	isActive(tab: Tab): boolean {
		return this.app.workspace.getMostRecentLeaf() === tab.leaf || tab.webview.clientWidth > 0;
	}

	/** Main-process WebContents of a tab. */
	webContents(tab: Tab): Electron.WebContents {
		const contents = remote.webContents.fromId(tab.id);
		if (!contents || contents.isDestroyed()) throw new Error("The tab's page is gone. Call tabs_list.");
		return contents;
	}

	/** Show a hidden tab (a background tab has no layout, so no input or capture). */
	async ensureVisible(tab: Tab): Promise<void> {
		if (tab.webview.clientWidth > 0 && tab.webview.clientHeight > 0) return;
		await this.app.workspace.revealLeaf(tab.leaf);
		for (let i = 0; i < 20 && tab.webview.clientWidth === 0; i += 1) await sleep(50);
	}

	async activate(tab: Tab): Promise<void> {
		this.app.workspace.setActiveLeaf(tab.leaf, { focus: true });
		await this.app.workspace.revealLeaf(tab.leaf);
	}

	/** Open a URL in a new tab and wait until the webview exists and the load has started. */
	async open(url: string, active: boolean, sessionIsolation: boolean): Promise<Tab> {
		const target = webViewerEnabled(this.app)
			? webViewerTarget(this.app)
			: surfingTarget(this.app, { sessionIsolation });
		const leaf = await target.open(url, active);
		await leaf.loadIfDeferred();
		let tab: Tab | null = null;
		for (let i = 0; i < 100 && !tab; i += 1) {
			tab = this.tabOfLeaf(leaf);
			if (!tab) await sleep(100);
		}
		if (!tab) throw new Error("The new tab did not start in time.");
		await waitUntilCommitted(tab.webview, this.webContents(tab), 10_000);
		return tab;
	}
}

/** Resolves once the page has committed a load (or after `timeoutMs`). */
function waitUntilCommitted(
	webview: Electron.WebviewTag,
	contents: Electron.WebContents,
	timeoutMs: number,
): Promise<void> {
	return new Promise((resolve) => {
		const finish = () => {
			window.clearTimeout(timer);
			webview.removeEventListener("did-navigate", finish);
			webview.removeEventListener("did-stop-loading", finish);
			resolve();
		};
		const timer = window.setTimeout(finish, timeoutMs);
		webview.addEventListener("did-navigate", finish);
		webview.addEventListener("did-stop-loading", finish);
		if (contents.getURL() && !contents.isLoading()) finish();
	});
}

/**
 * Start watching for a page load; trigger the navigation after calling this,
 * then await the result. Resolves on did-stop-loading, or after `timeoutMs`,
 * or at once when no load began.
 */
export function watchLoad(
	webview: Electron.WebviewTag,
	contents: Electron.WebContents,
	timeoutMs: number,
): Promise<void> {
	return new Promise((resolve) => {
		let started = contents.isLoading();
		const finish = () => {
			window.clearTimeout(hard);
			window.clearTimeout(probe);
			webview.removeEventListener("did-start-loading", onStart);
			webview.removeEventListener("did-stop-loading", finish);
			resolve();
		};
		const onStart = () => {
			started = true;
		};
		const hard = window.setTimeout(finish, timeoutMs);
		const probe = window.setTimeout(() => {
			if (!started && !contents.isLoading()) finish();
		}, 500);
		webview.addEventListener("did-start-loading", onStart);
		webview.addEventListener("did-stop-loading", finish);
	});
}
