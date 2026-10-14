import { clipboard, remote } from "electron";
import type * as Electron from "electron";
import { SurfingView } from "../surfingView";
import { t } from "../translations/helper";
import { FileSystemAdapter, App } from "obsidian";
import { callMoment } from "../utils/moment";
import SurfingPlugin from "../surfingIndex";

interface EmbededNode {
	containerEl: HTMLElement;
	url?: string;
}

interface EmbededFile {
	path: string;
}

export class EmbededWebView {
	private contentEl: HTMLElement;
	private webviewEl!: Electron.WebviewTag;
	private node: EmbededNode;
	private file: EmbededFile;
	private menu: Electron.Menu | undefined;
	private app: App;
	private plugin: SurfingPlugin;
	private currentUrl!: string;

	constructor(
		node: EmbededNode,
		file: EmbededFile,
		app: App,
		plugin: SurfingPlugin,
	) {
		this.contentEl = node.containerEl;
		this.node = node;
		this.file = file;
		this.app = app;
		this.plugin = plugin;
	}

	load() {
		// this.contentEl.empty();

		this.appendWebView();
		this.contentEl.addClass("wb-view-content-embeded");
	}

	unload() {
		this.contentEl.removeClass("wb-view-content-embeded");
		// this.contentEl.empty();
	}

	loadFile(file: EmbededFile) {
		// this.file = file;
		this.load();
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

		const adapter = this.app.vault.adapter as FileSystemAdapter;
		this.currentUrl =
			"file:///" +
			(adapter.getBasePath() + "/" + this.file.path)
				.toString()
				.replace(/\s/g, "%20");

		if (this.currentUrl)
			this.webviewEl.setAttribute("src", this.currentUrl);
		else this.webviewEl.setAttribute("src", this.file.path);
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

				// if (this.canvas) {
				// 	const linkNode = this.canvas.createLinkNode(event.url, {
				// 		x: this.node.x + this.node.width + 20,
				// 		y: this.node.y
				// 	}, {
				// 		height: this.node.height,
				// 		width: this.node.width
				// 	});
				// 	this.canvas.deselectAll();
				// 	this.canvas.addNode(linkNode);
				//
				// 	this.canvas.select(linkNode);
				// 	this.canvas.zoomToSelection();
				// 	this.canvas.requestSave();
				//
				// 	return {
				// 		action: "allow",
				// 	}
				// }

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
					this.menu = menu;
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
											{
												url: params.selectionText,
											},
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
			this.currentUrl = event.url;
			// this.webviewEl.setAttribute("src", event.url);
		});

		this.webviewEl.addEventListener("did-navigate-in-page", (event) => {
			this.currentUrl = event.url;
			this.webviewEl.setAttribute("src", event.url);
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
