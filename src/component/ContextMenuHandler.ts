import { HoverParent, HoverPopover, Menu, MenuItem, WorkspaceLeaf } from "obsidian";
import { callMoment } from "../utils/moment";
import Defuddle from "defuddle";
import { AIPageBridge } from "./AIPageBridge";
import { clipboard } from "electron";
import type * as Electron from "electron";
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
	webviewEl: Electron.WebviewTag;
	navigateFn: (url: string) => void;
	copyHighLightFn: () => void;
}

/** The context-menu params with the page-relative and guest coordinates this handler adds. */
interface MenuParams extends Partial<Electron.ContextMenuParams> {
	pageURL: string;
	x: number;
	y: number;
	guestX: number;
	guestY: number;
}

/** Back/forward navigation on a leaf's history, which Obsidian does not type. */
interface NavigableHistory {
	back(): void;
	forward(): void;
}

type NavigableLeaf = WorkspaceLeaf & { history: NavigableHistory };

/** A <webview> tag that exposes its guest window. */
type WebviewWithWindow = Electron.WebviewTag & { contentWindow: Window };

export class ContextMenuHandler {
	private ctx: ContextMenuContext;
	menu: Menu | null = null;
	hoverPopover: HoverPopover | null = null;
	private webContents: Electron.WebContents | null = null;
	private webviewEl: Electron.WebviewTag | null = null;
	private menuTargets = new WeakSet<HTMLElement>();


	constructor(ctx: ContextMenuContext) {
		this.ctx = ctx;
	}

	async register(webContents: Electron.WebContents, webviewEl: Electron.WebviewTag): Promise<void> {
		this.webContents = webContents;
		this.webviewEl = webviewEl;
		// Electron reports right-clicks the page did not handle itself, with
		// what was under the pointer (link, image, text field, selection).
		// The <webview> outlives navigations, so listen once per element.
		if (!this.menuTargets.has(webviewEl)) {
			this.menuTargets.add(webviewEl);
			webviewEl.addEventListener("context-menu", (event) => {
				const p: Partial<Electron.ContextMenuParams> = event.params ?? {};
				const rect = webviewEl.getBoundingClientRect();
				this.hoverPopover?.hide();
				if (!this.webContents) return;
				const guestX = p.x ?? NaN;
				const guestY = p.y ?? NaN;
				this.createMenu(this.webContents, {
					...p,
					pageURL: p.pageURL || this.ctx.getUrl(),
					guestX,
					guestY,
					x: guestX + rect.x,
					y: guestY + rect.y,
				});
			});
		}

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
		ch.port1.onmessage = (e: MessageEvent<unknown>) => {
			const data = e.data;
			if (typeof data === "string" && data.startsWith("link ")) {
				if (this.hoverPopover) this.hoverPopover.hide();
				const x = data.split(" ")[1];
				const y = data.split(" ")[2];
				const url = data.split(" ")[3];
				if (!url) return;
				if (!url.startsWith("http")) return;
				this.hoverPopover = new HoverPopover(
					this.ctx.contentEl as HTMLElement & HoverParent,
					null,
					100,
				);

				const realRect = webviewEl.getClientRects();
				const rect: {
					x: number;
					y: number;
				} = {
					x: parseInt(x ?? "", 10) + realRect[0].x,
					y: parseInt(y ?? "", 10) + realRect[0].y,
				};

				window.setTimeout(() => {
					this.hoverPopover?.position({
						x: rect.x,
						y: rect.y,
						doc: this.ctx.contentEl.doc,
					});
				}, 100);

				this.hoverPopover.hoverEl.toggleClass(
					"surfing-hover-popover",
					true,
				);

				const parentEl = this.hoverPopover.hoverEl.createDiv({
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

			if (data !== "darkreader-failed") {
				this.menu?.close();
				this.hoverPopover?.hide();
			} else {
				void webContents
						.executeJavaScript(
							`
										window.getComputedStyle( document.body ,null).getPropertyValue('background-color');
							`,
						true,
					)
					.then((result: unknown) => {
						if (typeof result !== "string") return;
						const colorArr = result
							.slice(result.indexOf("(") + 1, result.indexOf(")"))
							.split(", ")
							.map(Number);

						const brightness = Math.sqrt(
							(colorArr[0] ?? NaN) ** 2 * 0.241 +
								(colorArr[1] ?? NaN) ** 2 * 0.691 +
								(colorArr[2] ?? NaN) ** 2 * 0.068,
						);

						// If the background color is dark, set the theme to dark.
						if (brightness > 120) {
							void webContents.insertCSS(`
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

		(webviewEl as WebviewWithWindow).contentWindow.postMessage(`test`, "*", [
			ch.port2,
		]);
	}

	close(): void {
		this.menu?.close();
		this.hoverPopover?.hide();
	}

	private createMenu = (webContents: Electron.WebContents, params: MenuParams) => {
		if (this.menu) {
			this.menu?.close();
		}

		const plugin = this.ctx.plugin;
		this.menu = new Menu();

		const navigateBack = () => {
			(this.ctx.leaf as NavigableLeaf | undefined)?.history.back();
		};

		const navigateForward = () => {
			(this.ctx.leaf as NavigableLeaf | undefined)?.history.forward();
		};

		const onTarget = this.addTargetItems(webContents, params);

		if (!params.selectionText && !onTarget) {
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

						const html: unknown =
								await webContents.executeJavaScript(
									`document.documentElement.outerHTML`,
									true,
								);
							if (typeof html !== "string") return;
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
						void webContents.capturePage().then((image) => {
							clipboard.writeImage(image);
						});
					} catch (err) {
						console.error("Failed to copy: ", err);
					}
				});
			});

		const selected = params.selectionText;
		if (selected) {
			this.menu.addSeparator();
			this.menu.addItem((item: MenuItem) => {
				item.setTitle(t("Search Text"));
				item.setIcon("search");
				item.onClick(() => {
					try {
						SurfingView.spawnWebBrowserView(plugin, true, {
							url: selected,
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
						void navigator.clipboard.writeText(selected);
					} catch (err) {
						console.error("Failed to copy: ", err);
					}
				});
			});
			this.menu.addItem((item: MenuItem) => {
				item.setTitle("Save selection as markdown")
					.setIcon("download")
					.onClick(async () => {
						const content = selected;
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
						let tempText = encodeURIComponent(selected);
						const chineseRegex =
							/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/gi;
						const englishSentence =
							selected.split("\n");

						if (
							(selected.match(chineseRegex)?.length ?? 0) >
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
										selected.substring(0, 8),
									) +
									"," +
									encodeURIComponent(
										selected.substring(
											selected.length - 8,
											selected.length,
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
							params.pageURL.replace(/#:~:text=(.*)/g, "") +
							"#:~:text=" +
							tempText;
						const selectionText = selected.replace(
							/\n/g,
							" ",
						);
						let link = "";
						if (highlightFormat.contains("{TIME")) {
							const timeString = highlightFormat.match(
								/\{TIME:[^{}[\]]*\}/g,
							)?.[0];
							if (timeString) {
								const momentTime = callMoment().format(
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
								if (typeof result !== "string") return;
								clipboard.writeText(
									"[" +
										(result.split("?t=")[1] ?? "")
											.replace(/&p=[1-9]{1,}/g, "") +
										"](" +
										result +
										")",
								); // Will be the JSON object from the fetch call
							});
						console.debug("Page URL copied to clipboard");
					} catch (err) {
						console.error("Failed to copy: ", err);
					}
				});
			});
		}

		plugin.chromeExtensions?.addPageMenuItems(
			this.menu,
			params,
			this.webviewEl,
		);

		this.menu.showAtPosition({
			x: params.x,
			y: params.y,
		});
	};

	/** Link, image and text-field items, from Electron's context-menu params. */
	private addTargetItems(webContents: Electron.WebContents, params: MenuParams): boolean {
		const menu = this.menu;
		if (!menu) return false;
		let added = false;
		const linkURL = params.linkURL;
		if (linkURL && /^(https?|file):/i.test(linkURL)) {
			menu.addItem((item: MenuItem) =>
				item
					.setTitle(t("Open Link In New Tab"))
					.setIcon("external-link")
					.onClick(() =>
						SurfingView.spawnWebBrowserView(this.ctx.plugin, true, {
							url: linkURL,
						}),
					),
			)
				.addItem((item: MenuItem) =>
					item
						.setTitle(t("Open Link In External Browser"))
						.setIcon("globe")
						.onClick(() =>
							window.open(linkURL, "_blank", "external"),
						),
				)
				.addItem((item: MenuItem) =>
					item
						.setTitle(t("Copy Link Address"))
						.setIcon("link")
						.onClick(() => clipboard.writeText(linkURL)),
				);
			added = true;
		}
		const srcURL = params.srcURL;
		if (params.mediaType === "image" && srcURL) {
			menu.addItem((item: MenuItem) =>
				item
					.setTitle(t("Copy Image"))
					.setIcon("image")
					.onClick(() =>
						webContents.copyImageAt(params.guestX, params.guestY),
					),
			).addItem((item: MenuItem) =>
				item
					.setTitle(t("Copy Image Address"))
					.setIcon("link")
					.onClick(() => clipboard.writeText(srcURL)),
			);
			added = true;
		}
		if (params.isEditable) {
			const flags: Partial<Electron.EditFlags> = params.editFlags ?? {};
			const edit = (title: string, icon: string, enabled: boolean, run: () => void) =>
				menu.addItem((item: MenuItem) =>
					item.setTitle(title).setIcon(icon).setDisabled(!enabled).onClick(run),
				);
			edit(t("Cut"), "scissors", flags.canCut !== false, () => webContents.cut());
			edit(t("Copy"), "copy", flags.canCopy !== false, () => webContents.copy());
			edit(t("Paste"), "clipboard-paste", flags.canPaste !== false, () => webContents.paste());
			edit(t("Select All"), "text-select", flags.canSelectAll !== false, () => webContents.selectAll());
			added = true;
		}
		if (added) menu.addSeparator();
		return added;
	}
}
