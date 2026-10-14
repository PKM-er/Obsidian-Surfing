import { remote } from "electron";
import type * as Electron from "electron";
import { SurfingView } from "../surfingView";
import { callMoment } from "../utils/moment";
import SurfingPlugin from "../surfingIndex";

export class PopoverWebView {
	private contentEl: HTMLElement;
	private webviewEl!: Electron.WebviewTag;
	private node: HTMLElement;

	private currentUrl: string;
	private plugin: SurfingPlugin;

	constructor(node: HTMLElement, targetUrl: string, plugin: SurfingPlugin) {
		this.contentEl = node.createDiv({ cls: "wb-view-content" });
		this.node = node;
		this.currentUrl = targetUrl;
		this.plugin = plugin;
	}

	onload() {
		this.contentEl.empty();

		this.appendWebView();
	}

	appendWebView() {
		const doc = this.contentEl.doc;
		this.webviewEl = doc.createElement("webview");
		this.webviewEl.setAttribute("allowpopups", "");
		this.webviewEl.setAttribute(
			"webpreferences",
			"nodeIntegration=false, contextIsolation=true, sandbox=true",
		);
		this.webviewEl.addClass("wb-frame");
		

		if (this.currentUrl)
			this.webviewEl.setAttribute("src", this.currentUrl);
		// this.node.placeholderEl.innerText = this.node.url;

		this.webviewEl.addEventListener("dom-ready", () => {
			const webContents = remote.webContents.fromId(
				this.webviewEl.getWebContentsId(),
			);
			if (!webContents) return;

			// Open new browser tab if the web view requests it.
			webContents.setWindowOpenHandler((details): Electron.WindowOpenHandlerResponse => {
				if (details.disposition !== "foreground-tab") {
					SurfingView.spawnWebBrowserView(this.plugin, true, {
						url: details.url,
					});
					return {
						action: "allow",
					};
				}
				return { action: "deny" };
			});

			try {
				const pluginSettings = this.plugin.settings;
				const highlightFormat = pluginSettings.highlightFormat;
				const getCurrentTime = () => {
					let link = "";
					const timeString = highlightFormat.match(
						/\{TIME:[^{}[\]]*\}/g,
					)?.[0];
					if (timeString) {
						const momentTime = callMoment().format(
							timeString.replace(/{TIME:([^}]*)}/g, "$1"),
						);
						link = highlightFormat.replace(timeString, momentTime);
						return link;
					}
					return link;
				};
				void webContents
					.executeJavaScript(
						`
					window.addEventListener('dragstart', (e) => {
						if(e.ctrlKey || e.metaKey) {
							e.dataTransfer.clearData();
							const selectionText = document.getSelection().toString();
							const linkToHighlight = e.srcElement.baseURI.replace(/#:~:text=(.*)/g, "") + "#:~:text=" + encodeURIComponent(selectionText);
							let link = "";
							if ("${highlightFormat}".includes("{TIME")) {
								link = "${getCurrentTime()}";
							}
							link = (link != "" ? link : "${highlightFormat}").replace(/{URL}/g, linkToHighlight).replace(/{CONTENT}/g, selectionText.replace(/\\n/g, " "));

							e.dataTransfer.setData('text/plain', link);
							console.log(e);
						}
					});
					`,
						true,
					)
					.then(() => undefined);
			} catch (err) {
				console.error("Failed to add event: ", err);
			}
		});

		this.webviewEl.addEventListener(
			"did-navigate-in-page",
			(event) => {
				if (event.url.contains("contacts.google.com/widget")) {
					const webContents = remote.webContents.fromId(
						this.webviewEl.getWebContentsId(),
					);
					webContents?.stop();
					return;
				}
				this.currentUrl = event.url;
			},
		);

		this.webviewEl.addEventListener("destroyed", () => {
			if (doc !== this.contentEl.doc) {
				this.webviewEl.detach();
				this.appendWebView();
			}
		});

		doc.contains(this.contentEl)
			? this.contentEl.appendChild(this.webviewEl)
			: this.contentEl.onNodeInserted(() => {
					this.contentEl.doc === doc
						? this.contentEl.appendChild(this.webviewEl)
						: this.appendWebView();
				});
	}
}
