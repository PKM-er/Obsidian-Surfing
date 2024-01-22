// @ts-ignore
import { remote } from "electron";
import { SurfingView } from "../surfingView";
import { moment } from "obsidian";

export class PopoverWebView {
	private contentEl: HTMLElement;
	private webviewEl: HTMLElement;
	private node: HTMLElement;

	private currentUrl: string;

	constructor(node: HTMLElement, targetUrl: string) {
		this.contentEl = node.createEl("div", {cls: "wb-view-content"});
		this.node = node;
		this.currentUrl = targetUrl;
	}

	onload() {
		this.contentEl.empty();

		this.appendWebView();
	}

	appendWebView() {
		const doc = this.contentEl.doc;
		this.webviewEl = doc.createElement('webview');
		this.webviewEl.setAttribute("allowpopups", "");
		this.webviewEl.addClass("wb-frame");

		if (this.currentUrl) this.webviewEl.setAttribute("src", this.currentUrl);
		// this.node.placeholderEl.innerText = this.node.url;

		this.webviewEl.addEventListener("dom-ready", (event: any) => {
			// @ts-ignore
			const webContents = remote.webContents.fromId(this.webviewEl.getWebContentsId());

			// Open new browser tab if the web view requests it.
			webContents.setWindowOpenHandler((event: any) => {
				if (event.disposition !== "foreground-tab") {
					SurfingView.spawnWebBrowserView(true, {url: event.url});
					return {
						action: "allow",
					};
				}
			});

			try {
				const pluginSettings = app.plugins.getPlugin("surfing").settings;
				const highlightFormat = pluginSettings.highlightFormat;
				const getCurrentTime = () => {
					let link = "";
					// eslint-disable-next-line no-useless-escape
					const timeString = highlightFormat.match(/\{TIME\:[^\{\}\[\]]*\}/g)?.[0];
					if (timeString) {
						// eslint-disable-next-line no-useless-escape
						const momentTime = moment().format(timeString.replace(/{TIME:([^\}]*)}/g, "$1"));
						link = highlightFormat.replace(timeString, momentTime);
						return link;
					}
					return link;
				};
				webContents.executeJavaScript(`
					window.addEventListener('dragstart', (e) => {
						if(e.ctrlKey || e.metaKey) {
							e.dataTransfer.clearData();
							const selectionText = document.getSelection().toString();
							const linkToHighlight = e.srcElement.baseURI.replace(/\#\:\~\:text\=(.*)/g, "") + "#:~:text=" + encodeURIComponent(selectionText);
							let link = "";
							if ("${highlightFormat}".includes("{TIME")) {
								link = "${getCurrentTime()}";
							}
							link = (link != "" ? link : "${highlightFormat}").replace(/\{URL\}/g, linkToHighlight).replace(/\{CONTENT\}/g, selectionText.replace(/\\n/g, " "));
						
							e.dataTransfer.setData('text/plain', link);
							console.log(e);
						}
					});
					`, true).then((result: any) => {
				});
			} catch (err) {
				console.error('Failed to add event: ', err);
			}
		});


		this.webviewEl.addEventListener("did-navigate-in-page", (event: any) => {
			if (event.url.contains("contacts.google.com/widget")) {
				// @ts-ignore
				const webContents = remote.webContents.fromId(this.webviewEl.getWebContentsId());
				webContents.stop();
				return;
			}
			this.currentUrl = event.url;
		});

		this.webviewEl.addEventListener('destroyed', () => {
			if (doc !== this.contentEl.doc) {
				this.webviewEl.detach();
				this.appendWebView();
			}
		});

		doc.contains(this.contentEl) ? this.contentEl.appendChild(this.webviewEl) : this.contentEl.onNodeInserted(() => {
			this.contentEl.doc === doc ? this.contentEl.appendChild(this.webviewEl) : this.appendWebView();
		});


	}
}
