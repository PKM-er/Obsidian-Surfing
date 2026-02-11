// @ts-ignore
import { remote } from "electron";
import SurfingPlugin from "../surfingIndex";

export interface WebviewCallbacks {
	onNavigate(url: string): void;
	onTitleUpdate(title: string): void;
	onFaviconUpdate(favicons: string[]): void;
	onFocus(): void;
	onDomReady(webContents: any): void;
	onDestroyed(): void;
	onKeyboardEvent(emulatedEvent: KeyboardEvent, webContents: any): void;
	onDragStartInject(webContents: any): void;
	onMenuClose(): void;
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
	webviewEl!: HTMLWebViewElement & { getWebContentsId(): number };
	private containerEl!: HTMLElement;
	private config: WebviewManagerConfig;
	private loaded = false;

	constructor(config: WebviewManagerConfig) {
		this.config = config;
	}

	create(): void {
		this.containerEl = this.config.contentEl.createDiv({
			cls: "wb-webview-container",
		});

		const doc = this.config.contentEl.doc;
		this.webviewEl = doc.createElement("webview") as any;
		this.webviewEl.setAttribute("allowpopups", "");
		this.webviewEl.setAttribute(
			"webpreferences",
			"nodeIntegration=false, contextIsolation=true, sandbox=true",
		);
		// @ts-ignore
		if (this.config.sessionIsolation) {
			this.webviewEl.partition =
				"surfing-vault-" + this.config.appId + "-" + this.config.leafId;
		} else {
			this.webviewEl.partition =
				"persist:surfing-vault-" + this.config.appId;
		}
		this.webviewEl.addClass("wb-frame");
		this.containerEl.appendChild(this.webviewEl);

		this.registerEventListeners(doc);
	}

	getContainerEl(): HTMLElement {
		return this.containerEl;
	}

	getWebContents(): any {
		if (!this.webviewEl) return null;
		// @ts-ignore
		return remote.webContents.fromId(this.webviewEl.getWebContentsId());
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
			setTimeout(done, timeout);
		});
	}

	refresh(): void {
		const webContents = this.getWebContents();
		if (webContents) webContents.reload();
	}

	clearHistory(leafHistory: any): void {
		const webContents = this.getWebContents();
		if (!webContents) return;

		webContents.clearHistory();
		webContents.executeJavaScript(
			"history.pushState({}, '', location.href)",
		);

		leafHistory.backHistory.splice(0);
		leafHistory.forwardHistory.splice(0);
	}

	private registerEventListeners(doc: Document): void {
		const cb = this.config.callbacks;

		this.webviewEl.addEventListener("dom-ready", async () => {
			const webContents = this.getWebContents();
			if (!webContents) return;

			cb.onDomReady(webContents);

			// For getting keyboard event from webview
			webContents.on("before-input-event", (event: any, input: any) => {
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
			(event: any) => {
				cb.onFaviconUpdate(event.favicons);
			},
		);

		this.webviewEl.addEventListener("page-title-updated", (event: any) => {
			cb.onTitleUpdate(event.title);
		});

		this.webviewEl.addEventListener("will-navigate", (event: any) => {
			cb.onNavigate(event.url);
		});

		this.webviewEl.addEventListener(
			"did-navigate-in-page",
			(event: any) => {
				cb.onNavigate(event.url);
				cb.onMenuClose();
			},
		);

		this.webviewEl.addEventListener("new-window", (event: any) => {
			event.preventDefault();
		});

		this.webviewEl.addEventListener("did-attach-webview", () => {
			console.log("Webview attached");
		});

		this.webviewEl.addEventListener("destroyed", () => {
			if (doc !== this.config.contentEl.doc) {
				console.log("Webview destroyed");
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
