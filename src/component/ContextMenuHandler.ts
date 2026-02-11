import { HoverPopover, Menu, MenuItem, moment, WorkspaceLeaf } from "obsidian";
import Defuddle from "defuddle";
import { AIPageBridge } from "./AIPageBridge";
import { clipboard } from "electron";
import SurfingPlugin from "../surfingIndex";
import { SurfingView } from "../surfingView";
import { t } from "../translations/helper";
import { PopoverWebView } from "./PopoverWebView";

export interface ContextMenuContext {
	plugin: SurfingPlugin;
	getUrl: () => string;
	getTitle: () => string;
	leaf: WorkspaceLeaf;
	contentEl: HTMLElement;
	webviewEl: HTMLElement;
	navigateFn: (url: string) => void;
	copyHighLightFn: () => void;
}

export class ContextMenuHandler {
	private ctx: ContextMenuContext;
	menu: Menu | null = null;
	hoverPopover: HoverPopover | null = null;

	private doc: Document;

	constructor(ctx: ContextMenuContext) {
		this.ctx = ctx;
	}

	async register(webContents: any, webviewEl: any): Promise<void> {
		webContents.executeJavaScript(`
			window.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				window.myPostPort?.postMessage('contextmenu ' + e.clientX + ' ' + e.clientY);
			 })
		 `);

		await webContents.executeJavaScript(`
			window.addEventListener("message", (e) => {
				window.myPostPort = e.ports[0];
			})
			document.addEventListener('click', (e) => {
				window.myPostPort?.postMessage('click');
			});
			document.addEventListener('scroll', (e) => {
				window.myPostPort?.postMessage('scroll');
			});0

		`);

		const ch = new MessageChannel();
		ch.port1.onmessage = (e: any) => {
			if (e.data === "contextmenu" || e.data?.startsWith("contextmenu")) {
				this.menu?.close();
				const { x, y } =
					e.data.split(" ").length > 1
						? {
								x: e.data.split(" ")[1],
								y: e.data.split(" ")[2],
							}
						: { x: e.x, y: e.y };
				const realRect = webviewEl.getClientRects();
				const rect: {
					x: number;
					y: number;
				} = {
					x: parseInt(x, 10) + realRect[0].x,
					y: parseInt(y, 10) + realRect[0].y,
				};

				const pageUrl = this.ctx.getUrl();
				let selectionText = "";
				try {
					webContents
						.executeJavaScript(
							`window.getSelection().toString()`,
							true,
						)
						.then((result: any) => {
							selectionText = result;

							console.log(rect, pageUrl, selectionText);

							this.createMenu(webContents, {
								...rect,
								pageURL: pageUrl,
								selectionText: selectionText,
							});
						});
				} catch (err) {
					console.error("Failed to copy: ", err);
				}
				return;
			}

			if (e.data && e.data.startsWith("link ")) {
				console.log(e.data);
				if (this.hoverPopover) this.hoverPopover.hide();
				const x = e.data.split(" ")[1];
				const y = e.data.split(" ")[2];
				const url = e.data.split(" ")[3];
				console.log(url);
				if (!url) return;
				if (!url.startsWith("http")) return;
				this.hoverPopover = new HoverPopover(
					<any>this.ctx.contentEl,
					null,
					100,
				);

				const realRect = webviewEl.getClientRects();
				const rect: {
					x: number;
					y: number;
				} = {
					x: parseInt(x, 10) + realRect[0].x,
					y: parseInt(y, 10) + realRect[0].y,
				};

				setTimeout(() => {
					this.hoverPopover?.position({
						x: rect.x,
						y: rect.y,
						doc: this.doc,
					});
				}, 100);

				this.hoverPopover.hoverEl.toggleClass(
					"surfing-hover-popover",
					true,
				);

				const parentEl = this.hoverPopover.hoverEl.createEl("div", {
					cls: "surfing-hover-popover-container",
				});
				const webView = new PopoverWebView(
					parentEl,
					url,
					this.ctx.plugin,
				);
				webView.onload();
				return;
			}

			if (e.data !== "darkreader-failed") {
				this.menu?.close();
				this.hoverPopover?.hide();
			} else if (e.data === "darkreader-failed") {
				webContents
					.executeJavaScript(
						`
										window.getComputedStyle( document.body ,null).getPropertyValue('background-color');
							`,
						true,
					)
					.then((result: any) => {
						const colorArr = result
							.slice(result.indexOf("(") + 1, result.indexOf(")"))
							.split(", ");

						const brightness = Math.sqrt(
							colorArr[0] ** 2 * 0.241 +
								colorArr[1] ** 2 * 0.691 +
								colorArr[2] ** 2 * 0.068,
						);

						// If the background color is dark, set the theme to dark.
						if (brightness > 120) {
							webContents.insertCSS(`
							html {
								filter: invert(90%) hue-rotate(180deg);
							}

							img, svg, div[class*="language-"] {
								filter: invert(110%) hue-rotate(180deg);
								opacity: .8;
							}

							video, canvas {
								filter: invert(110%) hue-rotate(180deg);
								opacity: 1;
							}
					`);
						}
					});
			}
		};

		await (webviewEl as any).contentWindow.postMessage(`test`, "*", [
			ch.port2,
		]);
	}

	close(): void {
		this.menu?.close();
		this.hoverPopover?.hide();
	}

	private createMenu = (webContents: any, params: any) => {
		if (this.menu) {
			this.menu?.close();
		}

		const plugin = this.ctx.plugin;
		this.menu = new Menu() as Menu;

		const navigateBack = () => {
			// @ts-ignore
			this.ctx.leaf?.history.back();
		};

		const navigateForward = () => {
			// @ts-ignore
			this.ctx.leaf?.history.forward();
		};

		if (!params.selectionText) {
			this.menu
				.addItem((item: MenuItem) => {
					item.setTitle(t("Refresh Current Page"));
					item.setIcon("refresh-ccw");
					item.onClick(() => {
						this.ctx.leaf?.rebuildView();
					});
				})
				.addItem((item: MenuItem) => {
					item.setTitle(t("Back"));
					item.setIcon("arrow-left");
					item.onClick(() => {
						navigateBack();
					});
				})
				.addItem((item: MenuItem) => {
					item.setTitle(t("Forward"));
					item.setIcon("arrow-right");
					item.onClick(() => {
						navigateForward();
					});
				})
				.addSeparator();
		}

		this.menu
			.addItem((item: MenuItem) => {
				item.setTitle(t("Open Current URL In External Browser"));
				item.setIcon("link");
				item.onClick(() => {
					window.open(params.pageURL, "_blank");
				});
			})
			.addItem((item: MenuItem) => {
				item.setTitle(t("Save Current Page As Markdown"));
				item.setIcon("download");
				item.onClick(async () => {
					try {
						await AIPageBridge.waitForDOMStability(webContents);

						const html: string =
							await webContents.executeJavaScript(
								`document.documentElement.outerHTML`,
								true,
							);
						const currentTitle: string = webContents
							.getTitle()
							.replace(/[/\\?%*:|"<>]/g, "-");

						const parser = new DOMParser();
						const doc = parser.parseFromString(html, "text/html");

						// Set base URL so relative links/images resolve correctly
						const baseEl = doc.createElement("base");
						baseEl.href = params.pageURL.replace(/\?(.*)/g, "");
						doc.head.prepend(baseEl);

						const result = new Defuddle(doc, {
							url: params.pageURL,
							markdown: true,
						}).parse();

						const frontmatter = [
							"---",
							`title: "${currentTitle}"`,
							result.author ? `author: "${result.author}"` : null,
							result.published
								? `published: "${result.published}"`
								: null,
							`url: "${params.pageURL}"`,
							`date: "${new Date().toISOString().slice(0, 10)}"`,
							"---",
							"",
						]
							.filter(Boolean)
							.join("\n");

						const content = frontmatter + (result.content || "");

						const file = await plugin.app.vault.create(
							(plugin.settings.markdownPath
								? plugin.settings.markdownPath + "/"
								: "/") +
								currentTitle +
								".md",
							content,
						);
						await plugin.app.workspace.openLinkText(
							file.path,
							"",
							true,
						);
					} catch (err) {
						console.error("Failed to save as markdown: ", err);
					}
				});
			})
			.addItem((item: MenuItem) => {
				item.setTitle(t("Copy Current Viewport As Image"));
				item.setIcon("image");
				item.onClick(async () => {
					try {
						// Copy Image to Clipboard
						webContents.capturePage().then(async (image: any) => {
							clipboard.writeImage(image);
						});
					} catch (err) {
						console.error("Failed to copy: ", err);
					}
				});
			});

		if (params.selectionText) {
			this.menu.addSeparator();
			this.menu.addItem((item: MenuItem) => {
				item.setTitle(t("Search Text"));
				item.setIcon("search");
				item.onClick(() => {
					try {
						SurfingView.spawnWebBrowserView(plugin, true, {
							url: params.selectionText,
						});
					} catch (err) {
						console.error("Failed to copy: ", err);
					}
				});
			});
			this.menu.addSeparator();
			this.menu.addItem((item: MenuItem) => {
				item.setTitle(t("Copy Plain Text"));
				item.setIcon("copy");
				item.onClick(() => {
					try {
						navigator.clipboard.writeText(params.selectionText);
					} catch (err) {
						console.error("Failed to copy: ", err);
					}
				});
			});
			this.menu.addItem((item: MenuItem) => {
				item.setTitle("Save selection as markdown")
					.setIcon("download")
					.onClick(async () => {
						const content = params.selectionText;
						// @ts-ignore
						const currentTitle = webContents
							.getTitle()
							.replace(/[/\\?%*:|"<>]/g, "-");
						const file = await plugin.app.vault.create(
							(plugin.settings.markdownPath
								? plugin.settings.markdownPath + "/"
								: "/") +
								currentTitle +
								".md",
							content,
						);
						await plugin.app.workspace.openLinkText(
							file.path,
							"",
							true,
						);
					});
			});
			const highlightFormat = plugin.settings.highlightFormat;
			this.menu.addItem((item: MenuItem) => {
				item.setTitle(t("Copy Link to Highlight"));
				item.setIcon("link");
				item.onClick(() => {
					try {
						// eslint-disable-next-line no-useless-escape
						let tempText = encodeURIComponent(params.selectionText);
						const chineseRegex =
							/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/gi;
						const englishSentence =
							params.selectionText.split("\n");

						if (
							params.selectionText.match(chineseRegex)?.length >
							50
						) {
							if (englishSentence.length > 1) {
								const fistSentenceWords = englishSentence[0];
								const lastSentenceWords =
									englishSentence[englishSentence.length - 1];

								tempText =
									encodeURIComponent(
										fistSentenceWords.slice(0, 3),
									) +
									"," +
									encodeURIComponent(
										lastSentenceWords.slice(
											lastSentenceWords.length - 4,
											lastSentenceWords.length,
										),
									);
							} else {
								tempText =
									encodeURIComponent(
										params.selectionText.substring(0, 8),
									) +
									"," +
									encodeURIComponent(
										params.selectionText.substring(
											params.selectionText.length - 8,
											params.selectionText.length,
										),
									);
							}
						} else if (englishSentence.length > 1) {
							const fistSentenceWords =
								englishSentence[0].split(" ");
							const lastSentenceWords =
								englishSentence[
									englishSentence.length - 1
								].split(" ");

							tempText =
								encodeURIComponent(
									fistSentenceWords.slice(0, 3).join(" "),
								) +
								"," +
								encodeURIComponent(
									lastSentenceWords
										.slice(
											lastSentenceWords.length - 1,
											lastSentenceWords.length,
										)
										.join(" "),
								);
							// tempText = encodeURIComponent(englishWords.slice(0, 2).join(' ')) + "," + encodeURIComponent(englishWords.slice(englishWords.length - 1, englishWords.length).join(' '));
						}

						const linkToHighlight =
							params.pageURL.replace(/\#\:\~\:text\=(.*)/g, "") +
							"#:~:text=" +
							tempText;
						const selectionText = params.selectionText.replace(
							/\n/g,
							" ",
						);
						let link = "";
						if (highlightFormat.contains("{TIME")) {
							// eslint-disable-next-line no-useless-escape
							const timeString = highlightFormat.match(
								/\{TIME\:[^\{\}\[\]]*\}/g,
							)?.[0];
							if (timeString) {
								// eslint-disable-next-line no-useless-escape
								const momentTime = moment().format(
									timeString.replace(
										/{TIME:([^\}]*)}/g,
										"$1",
									),
								);
								link = highlightFormat.replace(
									timeString,
									momentTime,
								);
							}
						}
						link = (link != "" ? link : highlightFormat)
							.replace(/\{URL\}/g, linkToHighlight)
							.replace(/\{CONTENT\}/g, selectionText);
						clipboard.writeText(link);
					} catch (err) {
						console.error("Failed to copy: ", err);
					}
				});
			});
		}

		if (params.pageURL?.contains("bilibili.com/")) {
			this.menu.addSeparator();
			this.menu.addItem((item: MenuItem) => {
				item.setTitle(t("Copy Video Timestamp"));
				item.setIcon("link");
				item.onClick(() => {
					try {
						webContents
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
							.then((result: any) => {
								clipboard.writeText(
									"[" +
										result
											.split("?t=")[1]
											.replace(/&p=[1-9]{1,}/g, "") +
										"](" +
										result +
										")",
								); // Will be the JSON object from the fetch call
							});
						console.log("Page URL copied to clipboard");
					} catch (err) {
						console.error("Failed to copy: ", err);
					}
				});
			});
		}

		this.menu.showAtPosition({
			x: params.x,
			y: params.y,
		});
	};
}
