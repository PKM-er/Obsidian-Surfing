import { remote } from "electron";
import type * as Electron from "electron";
import SurfingPlugin from "../surfingIndex";

export interface WebviewCallbacks {
	/** The page committed a navigation (inPage: same document, e.g. pushState). */
	onNavigate(url: string, inPage: boolean): void;
	/** A main-frame load failed before committing. */
	onNavigationFailed(): void;
	onTitleUpdate(title: string): void;
	onFaviconUpdate(favicons: string[]): void;
	onFocus(): void;
	onDomReady(webContents: Electron.WebContents): void;
	onDestroyed(): void;
	onKeyboardEvent(emulatedEvent: KeyboardEvent, webContents: Electron.WebContents): void;
	onDragStartInject(webContents: Electron.WebContents): void;
	onMenuClose(): void;
}

/** Obsidian internal: the back/forward stacks of a workspace leaf. */
export interface LeafHistory {
	backHistory: unknown[];
	forwardHistory: unknown[];
}

export interface WebviewManagerConfig {
	plugin: SurfingPlugin;
	appId: string;
	leafId: string;
	contentEl: HTMLElement;
	sessionIsolation: boolean;
	callbacks: WebviewCallbacks;
	getCurrentUrl: () => string;
	recreateWebview: () => void;
}

export class WebviewManager {
	webviewEl!: Electron.WebviewTag;
	private containerEl!: HTMLElement;
	private config: WebviewManagerConfig;
	private loaded = false;
	/** webContents IDs whose main-process events are already hooked (dom-ready repeats per page). */
	private hooked = new Set<number>();

	constructor(config: WebviewManagerConfig) {
		this.config = config;
	}

	create(): void {
		this.containerEl = this.config.contentEl.createDiv({
			cls: "wb-webview-container",
		});

		const doc = this.config.contentEl.doc;
		this.webviewEl = doc.createElement("webview");
		this.webviewEl.setAttribute("allowpopups", "");
		this.webviewEl.setAttribute(
			"webpreferences",
			"nodeIntegration=false, contextIsolation=true, sandbox=true",
		);
		if (this.config.sessionIsolation) {
			this.webviewEl.partition =
				"surfing-vault-" + this.config.appId + "-" + this.config.leafId;
		} else {
			this.webviewEl.partition =
				"persist:surfing-vault-" + this.config.appId;
		}
		this.webviewEl.addClass("wb-frame");

		this.registerEventListeners(doc);
	}

	getContainerEl(): HTMLElement {
		return this.containerEl;
	}

	getWebContents(): Electron.WebContents | null {
		if (!this.webviewEl) return null;
		return remote.webContents.fromId(this.webviewEl.getWebContentsId()) ?? null;
	}

	waitForPageLoad(timeout = 10000): Promise<void> {
		return new Promise((resolve) => {
			if (!this.webviewEl) {
				resolve();
				return;
			}
			let settled = false;
			const done = () => {
				if (settled) return;
				settled = true;
				this.webviewEl?.removeEventListener("did-finish-load", onLoad);
				resolve();
			};
			const onLoad = () => done();
			this.webviewEl.addEventListener("did-finish-load", onLoad);
			window.setTimeout(done, timeout);
		});
	}

	refresh(): void {
		const webContents = this.getWebContents();
		if (webContents) webContents.reload();
	}

	clearHistory(leafHistory: LeafHistory): void {
		const webContents = this.getWebContents();
		if (!webContents) return;

		// navigationHistory arrived in Electron 32; older Obsidian installers
		// only have the deprecated webContents.clearHistory().
		const history = (webContents as Partial<Pick<Electron.WebContents, "navigationHistory">>).navigationHistory;
		if (history) history.clear();
		else webContents.clearHistory();
		void webContents.executeJavaScript(
			"history.pushState({}, '', location.href)",
		);

		leafHistory.backHistory.splice(0);
		leafHistory.forwardHistory.splice(0);
	}

	private registerEventListeners(doc: Document): void {
		const cb = this.config.callbacks;

		this.webviewEl.addEventListener("dom-ready", () => {
			const webContents = this.getWebContents();
			if (!webContents) return;

			cb.onDomReady(webContents);

			// dom-ready fires for every page, but the webContents (and its
			// listeners) lives as long as the <webview>: hook it once, or each
			// key is delivered once per page loaded so far.
			if (this.hooked.has(webContents.id)) {
				try {
					cb.onDragStartInject(webContents);
				} catch (err) {
					console.error("Failed to add event: ", err);
				}
				return;
			}
			this.hooked.add(webContents.id);

			// For getting keyboard event from webview
			webContents.on("before-input-event", (_event: Electron.Event, input: Electron.Input) => {
				if (input.type !== "keyDown") return;

				const emulatedKeyboardEvent = new KeyboardEvent("keydown", {
					code: input.code,
					key: input.key,
					shiftKey: input.shift,
					altKey: input.alt,
					ctrlKey: input.control,
					metaKey: input.meta,
					repeat: input.isAutoRepeat,
				});

				cb.onKeyboardEvent(emulatedKeyboardEvent, webContents);
			});

			try {
				cb.onDragStartInject(webContents);
			} catch (err) {
				console.error("Failed to add event: ", err);
			}
		});

		this.webviewEl.addEventListener("focus", () => {
			cb.onFocus();
		});

		this.webviewEl.addEventListener(
			"page-favicon-updated",
			(event) => {
				cb.onFaviconUpdate(event.favicons);
			},
		);

		this.webviewEl.addEventListener("page-title-updated", (event) => {
			cb.onTitleUpdate(event.title);
		});

		// Committed navigations only: will-navigate fires before a
		// navigation that may still be cancelled, and never for redirects,
		// loadURL or history traversal.
		this.webviewEl.addEventListener("did-navigate", (event) => {
			cb.onNavigate(event.url, false);
			cb.onMenuClose();
		});

		this.webviewEl.addEventListener(
			"did-navigate-in-page",
			(event) => {
				if (!event.isMainFrame) return;
				cb.onNavigate(event.url, true);
				cb.onMenuClose();
			},
		);

		this.webviewEl.addEventListener("did-fail-load", (event) => {
			if (event.isMainFrame) cb.onNavigationFailed();
		});

		this.webviewEl.addEventListener("destroyed", () => {
			if (doc !== this.config.contentEl.doc) {
				console.debug("Webview destroyed");
				this.webviewEl.detach();
				cb.onDestroyed();
			}
		});

		doc.contains(this.config.contentEl)
			? this.containerEl.appendChild(this.webviewEl)
			: this.config.contentEl.onNodeInserted(() => {
					if (this.loaded) return;
					else this.loaded = true;
					this.config.contentEl.doc === doc
						? this.containerEl.appendChild(this.webviewEl)
						: this.config.callbacks.onDestroyed();
				});
	}
}
