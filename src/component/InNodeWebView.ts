import { InPageHeaderBar } from "./InPageHeaderBar";
import { clipboard, remote } from "electron";
import type * as Electron from "electron";
import { SurfingView } from "../surfingView";
import { t } from "../translations/helper";
import { ExtraButtonComponent } from "obsidian";
import { callMoment } from "../utils/moment";
import { getUrl } from "../utils/url";
import SurfingPlugin from "../surfingIndex";

interface CanvasNodeData {
	url?: string;
	alwaysKeepLoaded?: boolean;
	[key: string]: unknown;
}

interface CanvasLike {
	isDragging?: boolean;
	createLinkNode(
		url: string,
		position: { x: number; y: number },
		size: { height: number; width: number },
	): unknown;
	deselectAll(): void;
	addNode(node: unknown): void;
	select(node: unknown): void;
	zoomToSelection(): void;
	requestSave(): void;
}

interface WebViewNode {
	contentEl: HTMLElement;
	url: string;
	x: number;
	y: number;
	width: number;
	height: number;
	canvas?: CanvasLike;
	editor?: unknown;
	widget?: unknown;
	getData(): CanvasNodeData;
	setData(data: CanvasNodeData): void;
	render(): void;
}

export class InNodeWebView {
	private contentEl: HTMLElement;
	private webviewEl!: Electron.WebviewTag;
	private canvas: CanvasLike | undefined;
	private node: WebViewNode;
	private searchBarEl!: InPageHeaderBar;

	private currentUrl!: string;
	private plugin: SurfingPlugin;

	private type: "canvas" | "inline";

	private editor: unknown;
	private widget: unknown;

	constructor(
		node: WebViewNode,
		plugin: SurfingPlugin,
		type: "canvas" | "inline",
		canvas?: CanvasLike,
	) {
		this.contentEl = node.contentEl;
		this.node = node;
		this.canvas = canvas;

		this.plugin = plugin;
		this.type = type;

		if (this.type === "inline") {
			this.editor = this.node?.editor;
			this.widget = this.node?.widget;
		}
	}

	onload() {
		this.contentEl.empty();

		this.type === "canvas" && this.appendSearchBar();
		this.type === "inline" && this.appendShowOriginalCode();
		this.appendWebView();

		this.contentEl.toggleClass("wb-view-content", true);
		this.type === "inline" &&
			this.contentEl.toggleClass("wb-browser-inline", true);
	}

	appendShowOriginalCode() {
		const btnEl = this.contentEl.createDiv();
		btnEl.addClass("wb-show-original-code");
		new ExtraButtonComponent(btnEl)
			.setIcon("code-2")
			.setTooltip(t("Show original url"));
		// 	.onClick(() => {
		// 	// Dispatch selection event to the codemirror editor based on widget start and end position.
		// 	const {start, end} = this.widget;
		// 	this.editor.dispatch({
		// 		selection: EditorSelection.create([
		// 			EditorSelection.range(start, end - 1),
		// 			// EditorSelection.range(6, 7),
		// 			EditorSelection.cursor(start)
		// 		], 0)
		// 	});
		// });
	}

	appendSearchBar() {
		this.searchBarEl = new InPageHeaderBar(
			this.plugin.app,
			this.node,
			this.node.url,
		);
		this.searchBarEl.onload();
		this.currentUrl = this.node.url;
		this.searchBarEl.setSearchBarUrl(this.node.url);

		this.searchBarEl.addOnSearchBarEnterListener((url: string) => {
			const finalURL = getUrl(url, this.plugin);
			if (finalURL) this.currentUrl = finalURL;
			else this.currentUrl = url;

			this.webviewEl.setAttribute("src", this.currentUrl);
			this.searchBarEl.setSearchBarUrl(this.currentUrl);

			const oldData = this.node.getData();
			if (oldData.url === this.currentUrl) return;
			oldData.url = this.currentUrl;
			this.node.setData(oldData);
			this.node.canvas?.requestSave();

			this.node.render();
		});
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
		else this.webviewEl.setAttribute("src", this.node.url);
		// this.node.placeholderEl.innerText = this.node.url;

		this.webviewEl.addEventListener("dom-ready", () => {
			const webContents = remote.webContents.fromId(
				this.webviewEl.getWebContentsId(),
			);
			if (!webContents) return;

			// Open new browser tab if the web view requests it.
			webContents.setWindowOpenHandler((event) => {
				if (event.disposition !== "foreground-tab") {
					SurfingView.spawnWebBrowserView(this.plugin, true, {
						url: event.url,
					});
					return {
						action: "allow",
					};
				}

				if (this.canvas) {
					const linkNode = this.canvas.createLinkNode(
						event.url,
						{
							x: this.node.x + this.node.width + 20,
							y: this.node.y,
						},
						{
							height: this.node.height,
							width: this.node.width,
						},
					);
					this.canvas.deselectAll();
					this.canvas.addNode(linkNode);

					this.canvas.select(linkNode);
					this.canvas.zoomToSelection();
					this.canvas.requestSave();

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
				void webContents.executeJavaScript(
					`
						window.addEventListener('dragstart', (e) => {
							if(e.ctrlKey || e.metaKey) {
								e.dataTransfer.clearData();
								const selectionText = document.getSelection().toString();
								const linkToHighlight = e.srcElement.baseURI.replace(/#:~:text=(.*)/g, "") + "#:~:text=" + encodeURIComponent(selectionText);
								let link = "";
								if ("${highlightFormat}".includes("{TIME")) {
									link = "${getCurrentTime()}";
									// // eslint-disable-next-line no-useless-escape
									// const timeString = "${highlightFormat}".match(/{TIME:[^{}[]]*}/g)?.[0];
									// if (timeString) {
									// 	// eslint-disable-next-line no-useless-escape
									// 	const momentTime = moment().format(timeString.replace(/{TIME:([^}]*)}/g, "$1"));
									// 	link = "${highlightFormat}".replace(timeString, momentTime);
									// }
								}
								link = (link != "" ? link : "${highlightFormat}").replace(/{URL}/g, linkToHighlight).replace(/{CONTENT}/g, selectionText.replace(/\\n/g, " "));

								e.dataTransfer.setData('text/plain', link);
								console.log(e);
							}
						});
						`,
					true,
				);
			} catch (err) {
				console.error("Failed to add event: ", err);
			}

			webContents.on(
				"context-menu",
				(event: Electron.Event, params: Electron.ContextMenuParams) => {
					event.preventDefault();

					const { Menu, MenuItem } = remote;
					const menu = new Menu();
					// Basic Menu For Webview
					// TODO: Support adding different commands to the menu.
					// Possible to use Obsidian Default API?
					menu.append(
						new MenuItem({
							label: t("Open Current URL In External Browser"),
							click: () => {
								window.open(params.pageURL, "_blank");
							},
						}),
					);

					menu.append(
						new MenuItem({
							label: "Open Current URL In Surfing",
							click: () => {
								window.open(params.pageURL);
							},
						}),
					);

					if (params.selectionText) {
						const pluginSettings = this.plugin.settings;

						menu.append(new MenuItem({ type: "separator" }));
						menu.append(
							new MenuItem({
								label: t("Search Text"),
								click: () => {
									try {
										SurfingView.spawnWebBrowserView(
											this.plugin,
											true,
											{ url: params.selectionText },
										);
										console.debug(
											"Page URL copied to clipboard",
										);
									} catch (err) {
										console.error("Failed to copy: ", err);
									}
								},
							}),
						);
						menu.append(new MenuItem({ type: "separator" }));
						menu.append(
							new MenuItem({
								label: t("Copy Plain Text"),
								click: () => {
									try {
										webContents.copy();
										console.debug(
											"Page URL copied to clipboard",
										);
									} catch (err) {
										console.error("Failed to copy: ", err);
									}
								},
							}),
						);
						const highlightFormat = pluginSettings.highlightFormat;
						menu.append(
							new MenuItem({
								label: t("Copy Link to Highlight"),
								click: () => {
									try {
										const linkToHighlight =
											params.pageURL.replace(
												/#:~:text=(.*)/g,
												"",
											) +
											"#:~:text=" +
											encodeURIComponent(
												params.selectionText,
											);
										const selectionText =
											params.selectionText;
										let link = "";
										if (highlightFormat.includes("{TIME")) {
											const timeString =
												highlightFormat.match(
													/\{TIME:[^{}[\]]*\}/g,
												)?.[0];
											if (timeString) {
												const momentTime =
													callMoment().format(
														timeString.replace(
															/{TIME:([^}]*)}/g,
															"$1",
														),
													);
												link = highlightFormat.replace(
													timeString,
													momentTime,
												);
											}
										}
										link = (
											link != "" ? link : highlightFormat
										)
											.replace(
												/\{URL\}/g,
												linkToHighlight,
											)
											.replace(
												/\{CONTENT\}/g,
												selectionText,
											);
										clipboard.writeText(link);
										console.debug(
											"Link URL copied to clipboard",
										);
									} catch (err) {
										console.error("Failed to copy: ", err);
									}
								},
							}),
						);

						menu.popup();
					}

					if (params.pageURL?.includes("bilibili.com/")) {
						menu.append(
							new MenuItem({
								label: t("Copy Video Timestamp"),
								click: () => {
									try {
										void webContents
											.executeJavaScript(
												`
											var time = document.querySelectorAll('.bpx-player-ctrl-time-current')[0].innerHTML;
											var timeYMSArr=time.split(':');
											var joinTimeStr='00h00m00s';
											if(timeYMSArr.length===3){
												 joinTimeStr=timeYMSArr[0]+'h'+timeYMSArr[1]+'m'+timeYMSArr[2]+'s';
											}else if(timeYMSArr.length===2){
												 joinTimeStr=timeYMSArr[0]+'m'+timeYMSArr[1]+'s';
											}
											var timeStr= "";
											var pageStrMatch = window.location.href.match(/(p=[1-9]{1,})/g);
											var pageStr = "";
											if(typeof pageStrMatch === "object" && pageStrMatch?.length > 0){
											    pageStr = '&' + pageStrMatch[0];
											}else if(typeof pageStrMatch === "string") {
											    pageStr = '&' + pageStrMatch;
											}
											timeStr = window.location.href.split('?')[0]+'?t=' + joinTimeStr + pageStr;
										`,
												true,
											)
											.then((result: unknown) => {
												if (typeof result !== "string")
													return;
												clipboard.writeText(
													"[" +
														result
															.split("?t=")[1]
															.replace(
																/&p=[1-9]{1,}/g,
																"",
															) +
														"](" +
														result +
														")",
												); // Will be the JSON object from the fetch call
											});
										console.debug(
											"Page URL copied to clipboard",
										);
									} catch (err) {
										console.error("Failed to copy: ", err);
									}
								},
							}),
						);
					}

					window.setTimeout(() => {
						menu.popup();
						// Dirty workaround for showing the menu, when currentUrl is not the same as the url of the webview
						if (
							this.node.url !== params.pageURL &&
							!params.selectionText
						) {
							menu.popup();
						}
					}, 0);
				},
			);
		});

		this.webviewEl.addEventListener("will-navigate", (event) => {
			if (this.type === "canvas") {
				const oldData = this.node.getData();
				oldData.url = event.url;
				this.node.setData(oldData);
				this.node.canvas?.requestSave();
			} else {
				this.node.url = event.url;
			}
		});

		this.webviewEl.addEventListener("did-navigate-in-page", (event) => {
			if (this.type === "canvas") {
				const oldData = this.node.getData();

				if (
					event.url.includes("contacts.google.com/widget") ||
					(this.node.canvas?.isDragging && oldData.url === event.url)
				) {
					const webContents = remote.webContents.fromId(
						this.webviewEl.getWebContentsId(),
					);
					webContents?.stop();
					return;
				}
				if (oldData.url === event.url) return;
				oldData.url = event.url;
				oldData.alwaysKeepLoaded = true;
				this.node.setData(oldData);
				this.node.canvas?.requestSave();
			} else {
				this.node.url = event.url;
			}
		});

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
