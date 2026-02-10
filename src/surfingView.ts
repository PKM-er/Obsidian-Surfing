import {
	Editor,
	HoverPopover,
	htmlToMarkdown,
	ItemView,
	MarkdownView,
	Menu,
	MenuItem,
	moment,
	Notice,
	Platform,
	ViewStateResult,
	WorkspaceLeaf,
} from "obsidian";
import { HeaderBar } from "./component/HeaderBar";
// @ts-ignore
import { clipboard, remote } from "electron";
import SurfingPlugin from "./surfingIndex";
import { t } from "./translations/helper";
import searchBox from "./component/SearchBox";
import { SEARCH_ENGINES } from "./surfingPluginSetting";
import { OmniSearchContainer } from "./component/OmniSearchContainer";
import { BookMarkBar } from "./component/BookMarkBar/BookMarkBar";
import { createBookmarkFile, isUrlBookmarked } from "./utils/bookmarkStore";
import { PopoverWebView } from "./component/PopoverWebView";
import type {
	AssistantAction,
	AssistantPageContext,
	AssistantHost,
} from "./component/AIAssistantSidebar";
import type { AIAssistantView } from "./component/AIAssistantView";

const WEB_BROWSER_AI_VIEW_ID = "surfing-ai-assistant";

export const WEB_BROWSER_VIEW_ID = "surfing-view";
export class SurfingView extends ItemView implements AssistantHost {
	plugin: SurfingPlugin;
	private searchBox: searchBox;
	currentUrl: string;
	currentTitle = "Surfing";

	headerBar: HeaderBar;
	favicon: HTMLImageElement;
	webviewEl: HTMLWebViewElement & { getWebContentsId(): number };
	private menu: Menu;

	private hoverPopover: HoverPopover;
	private searchContainer: OmniSearchContainer;

	bookmarkBar: BookMarkBar;
	private webViewContainerEl: HTMLElement;

	private loaded = false;

	private doc: Document;

	private omnisearchEnabled: boolean;

	constructor(leaf: WorkspaceLeaf, plugin: SurfingPlugin) {
		super(leaf);
		this.plugin = plugin;

		// TODO: Add a search box in next version.
		this.omnisearchEnabled = false;
		// this.omnisearchEnabled = app.plugins.enabledPlugins.has("omnisearch");
	}

	static spawnWebBrowserView(
		plugin: SurfingPlugin,
		newLeaf: boolean,
		state: WebBrowserViewState,
	) {
		const pluginSettings = plugin.settings;
		const isOpenInSameTab = pluginSettings.openInSameTab;
		const highlightInSameTab = pluginSettings.highlightInSameTab;
		const app = plugin.app;
		if (!isOpenInSameTab || state.url.startsWith("file://")) {
			if (state.url.contains("bilibili")) {
				for (
					let i = 0;
					i <
					app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID).length;
					i++
				) {
					const leaves =
						app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID);
					const leaf = leaves[i];
					if (!leaf) continue;

					const viewState = leaf.getViewState();
					const browserState = viewState.state as WebBrowserViewState;
					if (!browserState?.url) continue;

					if (
						browserState.url.split("?t=")[0] ===
						state.url.split("?t=")[0]
					) {
						const view = leaf.view as SurfingView;
						view.navigate(state.url, false, true);
						leaf.rebuildView();
						app.workspace.setActiveLeaf(leaf);
						return;
					}
				}
			} else if (state.url.contains("#:~:text=") && highlightInSameTab) {
				for (
					let i = 0;
					i <
					app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID).length;
					i++
				) {
					const leaves =
						app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID);
					const leaf = leaves[i];
					if (!leaf) continue;

					const viewState = leaf.getViewState();
					if (!viewState?.state?.url) continue;

					if (
						(viewState.state as WebBrowserViewState).url.split(
							"#:~:text=",
						)[0] === state.url.split("#:~:text=")[0]
					) {
						// @ts-ignore
						leaf.view.navigate(state.url, false, true);
						leaf.rebuildView();
						app.workspace.setActiveLeaf(leaf);
						return;
					}
				}
			}

			app.workspace.getLeaf(newLeaf).setViewState({
				type: WEB_BROWSER_VIEW_ID,
				active: state.active ?? true,
				state,
			});

			return;
		}

		const leafId = app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID).length
			? localStorage.getItem("web-browser-leaf-id")
			: app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID)[0]?.id;
		if (!leafId) {
			// Check if current leaf is empty view or markdown view.
			let activeViewLeaf: WorkspaceLeaf | undefined;
			activeViewLeaf =
				app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
			const currentViewType = app.workspace
				.getActiveViewOfType(ItemView)
				?.getViewType();
			if (!activeViewLeaf)
				activeViewLeaf =
					currentViewType === "empty" ||
					currentViewType === "surfing-bookmark-manager"
						? app.workspace.getActiveViewOfType(ItemView)?.leaf
						: undefined;
			if (!activeViewLeaf) return;

			const leaf =
				currentViewType === "empty"
					? activeViewLeaf
					: (app.workspace.createLeafBySplit(
							activeViewLeaf,
						) as WorkspaceLeaf);
			localStorage.setItem("web-browser-leaf-id", leaf.id);

			leaf.setViewState({
				type: WEB_BROWSER_VIEW_ID,
				active: true,
				state,
			});

			if (!(leaf.view.getViewType() === "empty")) {
				leaf.rebuildView();
			}

			leaf.setPinned(true);
			leaf.tabHeaderInnerTitleEl.parentElement?.parentElement?.addClass(
				"same-tab",
			);
			return;
		} else {
			if (state.active != undefined && state.active == false) {
				app.workspace.getLeaf(newLeaf).setViewState({
					type: WEB_BROWSER_VIEW_ID,
					active: true,
					state,
				});

				return;
			}

			if (!app.workspace.getLeafById(leafId)) {
				const newLeafID =
					app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID)[0]?.id;
				if (newLeafID) {
					localStorage.setItem("web-browser-leaf-id", newLeafID);

					const view = app.workspace.getLeafById(newLeafID)?.view;
					if (view) {
						(view as unknown as SurfingView).navigate(
							state.url,
							true,
						);
					}
					app.workspace.getLeafById(newLeafID)?.rebuildView();

					return;
				}
			}

			if (
				app.workspace.getLeafById(leafId)?.view.getViewType() ===
				WEB_BROWSER_VIEW_ID
			) {
				(
					app.workspace.getLeafById(leafId)?.view as SurfingView
				).navigate(state.url, true);
				app.workspace.getLeafById(leafId)?.rebuildView();
				return;
			}
		}
	}

	getDisplayText(): string {
		return this.currentTitle;
	}

	getViewType(): string {
		return WEB_BROWSER_VIEW_ID;
	}

	openInpecter() {
		const webContents = remote.webContents.fromId(
			this.webviewEl.getWebContentsId(),
		);
		webContents.openDevTools();
	}

	createWebview = () => {
		this.contentEl.empty();

		if (this.plugin.settings.bookmarkManager.openBookMark) {
			this.bookmarkBar = new BookMarkBar(
				this.leaf.view as SurfingView,
				this.plugin,
			);
			this.bookmarkBar.onload();
		}

		this.webViewContainerEl = this.contentEl.createDiv({
			cls: "wb-webview-container",
		});

		const doc = this.contentEl.doc;
		this.webviewEl = doc.createElement("webview");
		this.webviewEl.setAttribute("allowpopups", "");
		// @ts-ignore
		if (this.plugin.settings.sessionIsolation) {
			this.webviewEl.partition =
				"surfing-vault-" + this.app.appId + "-" + this.leaf.id;
		} else {
			this.webviewEl.partition =
				"persist:surfing-vault-" + this.app.appId;
		}
		this.webviewEl.addClass("wb-frame");
		this.webViewContainerEl.appendChild(this.webviewEl);

		if (this.currentUrl) this.navigate(this.currentUrl);

		this.headerBar.addOnSearchBarEnterListener((url: string) => {
			this.navigate(url);
		});

		this.webviewEl.addEventListener("dom-ready", async (event: any) => {
			// @ts-ignore
			const webContents = remote.webContents.fromId(
				this.webviewEl.getWebContentsId(),
			);

			// Open new browser tab if the web view requests it.
			webContents.setWindowOpenHandler((event: any) => {
				SurfingView.spawnWebBrowserView(this.plugin, true, {
					url: event.url,
					active: event.disposition !== "background-tab",
				});
				return {
					action: "allow",
				};
			});

			await this.registerContextMenuInWebcontents(webContents);
			await this.registerJavascriptInWebcontents(webContents);

			// For getting keyboard event from webview
			webContents.on("before-input-event", (event: any, input: any) => {
				if (input.type !== "keyDown") {
					return;
				}

				// Create a fake KeyboardEvent from the data provided
				const emulatedKeyboardEvent = new KeyboardEvent("keydown", {
					code: input.code,
					key: input.key,
					shiftKey: input.shift,
					altKey: input.alt,
					ctrlKey: input.control,
					metaKey: input.meta,
					repeat: input.isAutoRepeat,
				});

				// TODO: Allow set hotkey in webview;
				if (
					this.plugin.settings.focusSearchBarViaKeyboard &&
					emulatedKeyboardEvent.key === "/"
				) {
					console.log("focus search bar via keyboard");
					if (
						!this.plugin.settings.ignoreList.find((item: string) =>
							this.currentUrl.contains(item.toLowerCase()),
						)
					) {
						webContents
							.executeJavaScript(
								`
											document.activeElement instanceof HTMLInputElement
										`,
								true,
							)
							.then((result: any) => {
								if (!result) this.headerBar.focus();
							});
						return;
					}
				}

				// TODO Detect pressed hotkeys if exists in default hotkeys list
				// If so, prevent default and execute the hotkey
				// If not, send the event to the webview
				activeDocument.body.dispatchEvent(emulatedKeyboardEvent);

				if (
					emulatedKeyboardEvent.ctrlKey &&
					emulatedKeyboardEvent.key === "f"
				) {
					this.searchBox = new searchBox(
						this.leaf,
						webContents,
						this.plugin,
					);
				}
			});

			// TODO: Do we need to show a link that cursor hovering?
			// webContents.on("update-target-url", (event: Event, url: string) => {
			// 	console.log("update-target-url", url);
			// })

			try {
				const highlightFormat = this.plugin.settings.highlightFormat;
				const getCurrentTime = () => {
					let link = "";
					// eslint-disable-next-line no-useless-escape
					const timeString = highlightFormat.match(
						/\{TIME\:[^\{\}\[\]]*\}/g,
					)?.[0];
					if (timeString) {
						// eslint-disable-next-line no-useless-escape
						const momentTime = moment().format(
							timeString.replace(/{TIME:([^\}]*)}/g, "$1"),
						);
						link = highlightFormat.replace(timeString, momentTime);
						return link;
					}
					return link;
				};
				webContents
					.executeJavaScript(
						`
					window.addEventListener('dragstart', (e) => {
						if(e.ctrlKey || e.metaKey) {
							e.dataTransfer.clearData();
							const selectionText = document.getSelection().toString();

							let tempText = encodeURIComponent(selectionText);
							const chineseRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/gi;
							const englishSentence = selectionText.split('\\n');

							if (selectionText.match(chineseRegex)?.length > 50) {
								if (englishSentence.length > 1) {
									const fistSentenceWords = englishSentence[0];
									const lastSentenceWords = englishSentence[englishSentence.length - 1];

									tempText = encodeURIComponent(fistSentenceWords.slice(0, 4)) + "," + encodeURIComponent(lastSentenceWords.slice(lastSentenceWords.length - 4, lastSentenceWords.length));
								} else {
									tempText = encodeURIComponent(selectionText.substring(0, 8)) + "," + encodeURIComponent(selectionText.substring(selectionText.length - 8, selectionText.length));
								}
							} else if (englishSentence.length > 1) {

								const fistSentenceWords = englishSentence[0].split(' ');
								const lastSentenceWords = englishSentence[englishSentence.length - 1].split(' ');

								tempText = encodeURIComponent(fistSentenceWords.slice(0, 3).join(' ')) + "," + encodeURIComponent(lastSentenceWords.slice(lastSentenceWords.length - 1, lastSentenceWords.length).join(' '));
							}

							const linkToHighlight = e.srcElement.baseURI.replace(/\#\:\~\:text\=(.*)/g, "") + "#:~:text=" + tempText;
							let link = "";
							if ("${highlightFormat}".includes("{TIME")) {
								link = "${getCurrentTime()}";
							}
							link = (link != "" ? link : "${highlightFormat}").replace(/\{URL\}/g, linkToHighlight).replace(/\{CONTENT\}/g, selectionText.replace(/\\n/g, " "));

							e.dataTransfer.setData('text/plain', link);
						}
					});
					`,
						true,
					)
					.then((result: any) => {});
			} catch (err) {
				console.error("Failed to add event: ", err);
			}
		});

		// When focus set current leaf active;
		this.webviewEl.addEventListener("focus", (event: any) => {
			this.app.workspace.setActiveLeaf(this.leaf);
		});

		this.webviewEl.addEventListener(
			"page-favicon-updated",
			(event: any) => {
				if (event.favicons[0] !== undefined)
					this.favicon.src = event.favicons[0];
				this.leaf.tabHeaderInnerIconEl.empty();
				this.leaf.tabHeaderInnerIconEl.appendChild(this.favicon);
			},
		);

		this.webviewEl.addEventListener("page-title-updated", (event: any) => {
			if (this.omnisearchEnabled) this.updateSearchBox();
			this.leaf.tabHeaderInnerTitleEl.innerText = event.title;
			this.currentTitle = event.title;

			this.app.workspace.trigger(
				"surfing:page-change",
				event.title,
				this,
			);
		});

		this.webviewEl.addEventListener("will-navigate", (event: any) => {
			this.navigate(event.url, true, false);
		});

		this.webviewEl.addEventListener(
			"did-navigate-in-page",
			(event: any) => {
				this.navigate(event.url, true, false);
				this.menu?.close();
			},
		);

		this.webviewEl.addEventListener("new-window", (event: any) => {
			event.preventDefault();
		});

		this.webviewEl.addEventListener("did-attach-webview", (event: any) => {
			console.log("Webview attached");
		});

		this.webviewEl.addEventListener("destroyed", () => {
			if (doc !== this.contentEl.doc) {
				console.log("Webview destroyed");
				this.webviewEl.detach();
				this.createWebview();
			}
		});

		// TODO: Support dark reader soon.
		// this.frame.addEventListener("did-finish-load", (event: any) => {
		// 	// @ts-ignore
		// 	const webContents = remote.webContents.fromId(this.frame.getWebContentsId());
		//
		// 	webContents.executeJavaScript(`
		// 				window.addEventListener('DOMContentLoaded', ()=>{
		// 					DarkReader.setFetchMethod(window.fetch);
		// 					DarkReader.enable({brightness: 100, contrast: 90, sepia: 10});
		// 					console.log("hlewo");
		// 				});
		// 			`, true).then((result: any) => {
		// 	});
		// })

		doc.contains(this.contentEl)
			? this.webViewContainerEl.appendChild(this.webviewEl)
			: this.contentEl.onNodeInserted(() => {
					if (this.loaded) return;
					else this.loaded = true;
					this.contentEl.doc === doc
						? this.webViewContainerEl.appendChild(this.webviewEl)
						: this.createWebview();
				});
	};

	async onOpen() {
		// Allow views to replace this views.
		this.navigation = true;

		// Create search bar in the header bar.
		this.headerBar = new HeaderBar(
			this.titleContainerEl,
			this.plugin,
			this,
			true,
		);
		this.headerBar.onLoad();

		// Create favicon image element.
		this.favicon = document.createElement("img") as HTMLImageElement;
		this.favicon.width = 16;
		this.favicon.height = 16;

		this.contentEl.addClass("wb-view-content");

		// Create main web view frame that displays the website.

		if (this.omnisearchEnabled)
			this.searchContainer = new OmniSearchContainer(
				this.leaf,
				this.plugin,
			);
		if (this.omnisearchEnabled) this.searchContainer.onload();

		this.createWebview();
		this.initHeaderButtons();
	}

	onload() {
		super.onload();
		if (this.menu) this.menu.close();
	}

	async onClose() {
		this.menu?.close();
		this.hoverPopover?.hide();
	}

	initHeaderButtons() {
		if (Platform.isDesktop && this.plugin.settings.aiAssistant.enabled) {
			this.addAction(
				"bot",
				t("Toggle Surfing AI Assistant Sidebar"),
				() => {
					const leaves = this.app.workspace.getLeavesOfType(
						WEB_BROWSER_AI_VIEW_ID,
					);
					if (leaves.length > 0) {
						this.app.workspace.revealLeaf(leaves[0]);
						(leaves[0].view as AIAssistantView).focusInput();
					} else {
						const rightLeaf =
							this.app.workspace.getRightLeaf(false);
						rightLeaf?.setViewState({
							type: WEB_BROWSER_AI_VIEW_ID,
						});
						if (rightLeaf) {
							this.app.workspace.revealLeaf(rightLeaf);
						}
					}
				},
			);
		}
		this.addAction("settings", t("settings"), () => {
			//@ts-expect-error, private method
			app.setting.open();
			//@ts-expect-error, private method
			app.setting.openTabById("surfing");
		});
		this.addAction("star", t("star"), async () => {
			if (isUrlBookmarked(this.plugin, this.currentUrl)) {
				new Notice("Bookmark already exists.");
				return;
			}

			let description = "";
			try {
				// @ts-ignore
				const webContents = remote.webContents.fromId(
					this.webviewEl.getWebContentsId(),
				);
				const result = await webContents.executeJavaScript(
					`document.querySelector('meta[name="description"]')?.content`,
				);
				if (result) description = result;
			} catch (err) {
				console.error(err);
			}

			const category =
				this.plugin.settings.bookmarkManager.defaultCategory || "ROOT";

			await createBookmarkFile(this.plugin, {
				url: this.currentUrl,
				name: this.currentTitle,
				description,
				tags: [],
				category: [category],
			});
			new Notice("Bookmark saved.");
		});
		if (this.plugin.settings.bookmarkManager.sendToReadWise)
			this.addAction("book", t("Send to ReadWise"), async () => {
				const sendToReadWise = (title: string, url: string) => {
					open(
						"https://readwise.io/save?title=" +
							encodeURIComponent(title) +
							"&url=" +
							encodeURIComponent(url),
					);
				};

				try {
					await sendToReadWise(this.currentTitle, this.currentUrl);
					new Notice("Save success!");
				} catch (err) {
					new Notice("Save failed!");
				}
			});
	}

	async setState(state: WebBrowserViewState, result: ViewStateResult) {
		this.navigate(state.url, false);
	}

	updateSearchBox() {
		const searchEngines = [
			...SEARCH_ENGINES,
			...this.plugin.settings.customSearchEngine,
		];
		// @ts-ignore
		const regex = /^(?:https?:\/\/)?(?:[^@/\n]+@)?(?:www\.)?([^:/?\n]+)/g;
		const currentUrl = this.currentUrl?.match(regex)?.[0];
		if (!currentUrl) return;
		const currentSearchEngine = searchEngines.find((engine) =>
			engine.url.startsWith(currentUrl),
		);
		if (!currentSearchEngine) return;
		// @ts-ignore
		const webContents = remote.webContents.fromId(
			this.webviewEl.getWebContentsId(),
		);

		try {
			webContents
				.executeJavaScript(
					`
											document.querySelector('input')?.value
										`,
					true,
				)
				.then((result: any) => {
					this.searchContainer.update(result?.toLowerCase());
				});
		} catch (err) {
			console.error("Failed to copy: ", err);
		}
	}

	createMenu = (webContents: any, params: any) => {
		if (this.menu) {
			this.menu?.close();
		}

		const self = this;
		this.menu = new Menu() as Menu;

		const navigateBack = () => {
			// @ts-ignore
			this.leaf?.history.back();
		};

		const navigateForward = () => {
			// @ts-ignore
			this.leaf?.history.forward();
		};

		if (!params.selectionText) {
			this.menu
				.addItem((item: MenuItem) => {
					item.setTitle(t("Refresh Current Page"));
					item.setIcon("refresh-ccw");
					item.onClick(() => {
						this.leaf?.rebuildView();
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
						webContents
							.executeJavaScript(
								`
											document.body.outerHTML
										`,
								true,
							)
							.then(async (result: any) => {
								const url = params.pageURL.replace(
									/\?(.*)/g,
									"",
								);
								const parseContent = result.replaceAll(
									/src="(?!(https|http))([^"]*)"/g,
									'src="' + url + '$2"',
								);
								const content = htmlToMarkdown(parseContent);
								// @ts-ignore
								const currentTitle = webContents
									.getTitle()
									.replace(/[/\\?%*:|"<>]/g, "-");
								const file = await self.app.vault.create(
									(self.plugin.settings.markdownPath
										? self.plugin.settings.markdownPath +
											"/"
										: "/") +
										currentTitle +
										".md",
									content,
								);
								await self.app.workspace.openLinkText(
									file.path,
									"",
									true,
								);
							});
						console.log("Page Title copied to clipboard");
					} catch (err) {
						console.error("Failed to copy: ", err);
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
						SurfingView.spawnWebBrowserView(self.plugin, true, {
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
						const file = await self.app.vault.create(
							(self.plugin.settings.markdownPath
								? self.plugin.settings.markdownPath + "/"
								: "/") +
								currentTitle +
								".md",
							content,
						);
						await self.app.workspace.openLinkText(
							file.path,
							"",
							true,
						);
					});
			});
			const highlightFormat = this.plugin.settings.highlightFormat;
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

	async registerContextMenuInWebcontents(webContents: any) {
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
				const realRect = this.webviewEl.getClientRects();
				const rect: {
					x: number;
					y: number;
				} = {
					x: parseInt(x, 10) + realRect[0].x,
					y: parseInt(y, 10) + realRect[0].y,
				};

				const pageUrl = this.currentUrl;
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
					<any>this.contentEl,
					null,
					100,
				);

				const realRect = this.webviewEl.getClientRects();
				const rect: {
					x: number;
					y: number;
				} = {
					x: parseInt(x, 10) + realRect[0].x,
					y: parseInt(y, 10) + realRect[0].y,
				};

				setTimeout(() => {
					this.hoverPopover.position({
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
				const webView = new PopoverWebView(parentEl, url, this.plugin);
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

		await (this.webviewEl as any).contentWindow.postMessage(`test`, "*", [
			ch.port2,
		]);
	}

	async registerJavascriptInWebcontents(webContents: any) {
		try {
			if (this.plugin.settings.darkMode) {
				try {
					await webContents.executeJavaScript(`
						const element = document.createElement('script');

						fetch('https://cdn.jsdelivr.net/npm/darkreader/darkreader.min.js')
							.then((response) => {
								element.src = response.url;
								document.body.appendChild(element);
							})
							.catch((error) => {
								console.error('Error loading the script:', error);
							});

						element.onload = () => {
							try {
								DarkReader?.setFetchMethod(window.fetch);
								DarkReader?.enable({
									brightness: 100,
									contrast: 90,
									sepia: 10
								});
								console.log(DarkReader);
							} catch (err) {

								window.myPostPort?.postMessage('darkreader-failed');
								console.error('Failed to load dark reader: ', err);

							}
						};0
					`);
				} catch (e) {
					console.error(e);
				}
			}
		} catch (err) {
			console.error("Failed to get background color: ", err);
		}

		// https://cdn.jsdelivr.net/npm/darkreader/darkreader.min.js
		webContents.executeJavaScript(`
				window.addEventListener('mouseover', (e) => {
					if(!e.target) return;
					if(!e.ctrlKey && !e.metaKey) return;
					// Tag name is a tag
					if(e.target.tagName.toLowerCase() === 'a'){
						window.myPostPort?.postMessage('link ' + e.clientX + ' ' + e.clientY + ' ' + e.target.href);
					}
				});
			`);
	}

	private getWebContents() {
		if (!this.webviewEl) return null;
		// @ts-ignore
		return remote.webContents.fromId(this.webviewEl.getWebContentsId());
	}

	async getAIAssistantPageContext(
		includePageText: boolean,
		maxPageTextLength: number,
	): Promise<AssistantPageContext> {
		const fallback: AssistantPageContext = {
			url: this.currentUrl || "",
			title: this.currentTitle || "",
			selectionText: "",
			pageText: "",
			headings: [],
			links: [],
		};
		const webContents = this.getWebContents();
		if (!webContents) return fallback;

		// No hard 12000 cap — let callers (MCP vs sidebar) control the limit
		const safeMaxLen = Math.max(400, maxPageTextLength);
		try {
			// Wait for dynamic content (React/Vue/SPA) to stabilize before extraction
			await this.waitForDOMStability(webContents);

			const context = await webContents.executeJavaScript(
				`
					(() => {
						const normalizeText = (text) => (text || "").toString().trim();
						const selectedText = normalizeText(window.getSelection()?.toString());

						// Headings with level info
						const allHeadings = Array.from(document.querySelectorAll("h1, h2, h3, h4"))
							.map((h) => {
								const level = "#".repeat(parseInt(h.tagName[1]));
								return level + " " + normalizeText(h.textContent);
							})
							.filter((s) => s.length > 2)
							.slice(0, 50);

						// Links with text and href
						const links = Array.from(document.querySelectorAll("a[href]"))
							.map((a) => {
								const text = normalizeText(a.textContent);
								const href = a.href;
								if (!href) return null;
								return text ? "[" + text.slice(0, 60) + "](" + href + ")" : href;
							})
							.filter(Boolean)
							.filter((v, i, arr) => arr.indexOf(v) === i)
							.slice(0, 50);

						let pageText = "";
						if (${includePageText}) {
							const maxLen = ${safeMaxLen};

							// Primary: structured DOM-to-text serialization
							let out = "";
							function walk(node) {
								if (out.length >= maxLen) return;
								if (node.nodeType === 3) {
									const t = node.textContent.replace(/[\\t ]+/g, " ");
									if (t.trim()) out += t;
									return;
								}
								if (node.nodeType !== 1) return;
								const el = node;
								const tag = el.tagName;
								const style = window.getComputedStyle(el);
								if (style.display === "none" || style.visibility === "hidden") return;
								if (/^(SCRIPT|STYLE|NOSCRIPT|SVG|IFRAME)$/.test(tag)) return;

								const prefix = {
									H1: "\\n# ", H2: "\\n## ", H3: "\\n### ", H4: "\\n#### ",
									P: "\\n", DIV: "\\n", BLOCKQUOTE: "\\n> ",
									BR: "\\n", HR: "\\n---\\n",
								}[tag] || "";
								if (prefix) out += prefix;

								if (tag === "A" && el.href) {
									const text = normalizeText(el.textContent).slice(0, 80);
									if (text) { out += "[" + text + "](" + el.href + ")"; return; }
								}
								if (tag === "IMG") {
									const alt = el.alt || el.title || "";
									if (alt) out += "[img: " + alt.slice(0, 40) + "]";
									return;
								}
								if (tag === "LI") {
									const parent = el.parentElement;
									if (parent && parent.tagName === "OL") {
										const idx = Array.from(parent.children).indexOf(el) + 1;
										out += "\\n" + idx + ". ";
									} else {
										out += "\\n- ";
									}
								}
								if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
									const label = el.placeholder || el.getAttribute("aria-label") || el.name || "";
									out += "[" + tag.toLowerCase() + (label ? ": " + label.slice(0, 30) : "") + "]";
									return;
								}
								if (tag === "BUTTON") {
									out += "[btn: " + normalizeText(el.textContent).slice(0, 30) + "]";
									return;
								}
								for (const child of el.childNodes) walk(child);
								if (/^(P|DIV|LI|TR|BLOCKQUOTE|SECTION|ARTICLE|HEADER|FOOTER)$/.test(tag)) {
									if (!out.endsWith("\\n")) out += "\\n";
								}
							}
							walk(document.body);
							pageText = out.replace(/\\n{3,}/g, "\\n\\n").trim().slice(0, maxLen);

							// Fallback: if DOM walker got very little text, use innerText
							// This handles React/Vue/SPA apps where content is in virtual DOM
							if (pageText.length < 200) {
								const innerText = (document.body.innerText || "")
									.replace(/\\n{3,}/g, "\\n\\n")
									.trim()
									.slice(0, maxLen);
								if (innerText.length > pageText.length) {
									pageText = innerText;
								}
							}
						}

						return {
							url: location.href || "",
							title: document.title || "",
							selectionText: selectedText.slice(0, 1500),
							pageText,
							headings: allHeadings,
							links,
						};
					})()
					`,
				true,
			);

			return {
				url: context?.url || fallback.url,
				title: context?.title || fallback.title,
				selectionText: context?.selectionText || "",
				pageText: context?.pageText || "",
				headings: Array.isArray(context?.headings)
					? context.headings
					: [],
				links: Array.isArray(context?.links) ? context.links : [],
			};
		} catch (error) {
			console.error("Failed to collect AI page context: ", error);
			return fallback;
		}
	}

	/**
	 * Wait for DOM to stabilize after initial load — handles React/Vue/SPA hydration.
	 * Uses MutationObserver to detect when DOM mutations stop for a quiet period.
	 */
	private async waitForDOMStability(
		webContents: any,
		quietMs = 800,
		timeoutMs = 5000,
	): Promise<void> {
		try {
			await webContents.executeJavaScript(
				`
				new Promise((resolve) => {
					if (document.readyState !== 'complete') {
						window.addEventListener('load', () => startObserving(), { once: true });
					} else {
						startObserving();
					}
					function startObserving() {
						let timer = null;
						const observer = new MutationObserver(() => {
							if (timer) clearTimeout(timer);
							timer = setTimeout(() => {
								observer.disconnect();
								resolve();
							}, ${quietMs});
						});
						observer.observe(document.body, {
							childList: true, subtree: true, characterData: true
						});
						// If no mutations happen within quietMs, resolve immediately
						timer = setTimeout(() => {
							observer.disconnect();
							resolve();
						}, ${quietMs});
						// Hard timeout
						setTimeout(() => {
							observer.disconnect();
							resolve();
						}, ${timeoutMs});
					}
				})
				`,
				true,
			);
		} catch {
			// Non-critical — continue with extraction even if stability wait fails
		}
	}

	private async executeActionScript(script: string): Promise<string> {
		const webContents = this.getWebContents();
		if (!webContents) return t("Webview is not ready.");
		try {
			const result = await webContents.executeJavaScript(script, true);
			if (typeof result === "string") return result;
			if (result === undefined || result === null) return "";
			return JSON.stringify(result);
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
	}

	async executeAIAssistantAction(action: AssistantAction): Promise<string> {
		const actionType = String(action.type || "")
			.toLowerCase()
			.trim();
		if (!actionType) return t("Action type is required.");

		if (actionType === "navigate" || actionType === "open") {
			const targetUrl = String(action.url || "").trim();
			if (!targetUrl) return t("Missing url in navigate action.");
			this.navigate(targetUrl);
			await this.waitForPageLoad();
			return `${t("Opened")}: ${targetUrl}`;
		}
		if (actionType === "open_new_tab") {
			const targetUrl = String(action.url || "").trim();
			if (!targetUrl) return t("Missing url in open_new_tab action.");
			// Create leaf directly to avoid same-tab reuse and listener conflicts
			this.app.workspace.getLeaf(true).setViewState({
				type: WEB_BROWSER_VIEW_ID,
				active: true,
				state: { url: targetUrl },
			});
			return `${t("Opened in new tab")}: ${targetUrl}`;
		}
		if (actionType === "back") {
			// @ts-ignore
			this.leaf?.history.back();
			await this.waitForPageLoad();
			return t("Moved back in history.");
		}
		if (actionType === "forward") {
			// @ts-ignore
			this.leaf?.history.forward();
			await this.waitForPageLoad();
			return t("Moved forward in history.");
		}
		if (actionType === "reload" || actionType === "refresh") {
			this.refresh();
			await this.waitForPageLoad();
			return t("Reloaded current page.");
		}
		if (actionType === "click") {
			const selector = String(action.selector || "").trim();
			if (!selector) return t("Missing selector in click action.");
			return this.executeActionScript(`
					(() => {
						const selector = ${JSON.stringify(selector)};
						const element = document.querySelector(selector);
						if (!element) return "Selector not found: " + selector;
						element.dispatchEvent(new MouseEvent("click", {
							bubbles: true,
							cancelable: true,
							view: window
						}));
						if (typeof element.click === "function") {
							element.click();
						}
						return "Clicked " + selector;
					})()
				`);
		}
		if (actionType === "type" || actionType === "input") {
			const selector = String(action.selector || "").trim();
			if (!selector) return t("Missing selector in type action.");
			const value = String(action.text || "");
			const shouldEnter = Boolean(action.enter);
			return this.executeActionScript(`
					(() => {
						const selector = ${JSON.stringify(selector)};
						const value = ${JSON.stringify(value)};
						const shouldEnter = ${shouldEnter};
						const element = document.querySelector(selector);
						if (!element) return "Selector not found: " + selector;
						if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
							return "Element is not an input: " + selector;
						}
						element.focus();
						element.value = value;
						element.dispatchEvent(new Event("input", { bubbles: true }));
						element.dispatchEvent(new Event("change", { bubbles: true }));
						if (shouldEnter) {
							element.dispatchEvent(new KeyboardEvent("keydown", {
								key: "Enter",
								code: "Enter",
								bubbles: true,
							}));
						}
						return "Typed into " + selector;
					})()
				`);
		}
		if (actionType === "scroll") {
			const offset = Number(action.y || action.amount || 400);
			const safeOffset = Number.isNaN(offset) ? 400 : offset;
			return this.executeActionScript(`
					(() => {
						const offset = ${safeOffset};
						window.scrollBy({
							top: offset,
							behavior: "smooth",
						});
						return "Scrolled by " + offset + "px";
					})()
				`);
		}
		if (actionType === "extract") {
			const selector = String(action.selector || "").trim();
			if (!selector) {
				return this.executeActionScript(`
						(() => {
							const selection = window.getSelection()?.toString().trim();
							if (selection) return selection;
							return (document.body?.innerText || "").trim().slice(0, 1200);
						})()
					`);
			}
			return this.executeActionScript(`
					(() => {
						const selector = ${JSON.stringify(selector)};
						const element = document.querySelector(selector);
						if (!element) return "Selector not found: " + selector;
						return (element.textContent || "").trim();
					})()
				`);
		}
		if (actionType === "script" || actionType === "evaluate") {
			const script = String(action.script || "").trim();
			if (!script) return t("Missing script in evaluate action.");
			return this.executeActionScript(script);
		}

		return `${t("Unsupported action type")}: ${actionType}`;
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

	getCurrentPageInfo(): { url: string; title: string } {
		return { url: this.currentUrl || "", title: this.currentTitle || "" };
	}

	showReadingIndicator(show: boolean): void {
		const webContents = this.getWebContents();
		if (!webContents) return;
		try {
			if (show) {
				webContents.executeJavaScript(
					`
					(() => {
						if (document.getElementById('__surfing_ai_reading')) return;
						const overlay = document.createElement('div');
						overlay.id = '__surfing_ai_reading';
						overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:2147483647;border:2px solid rgba(124,58,237,0.5);animation:__surfing_pulse 2s ease-in-out infinite;';
						const badge = document.createElement('div');
						badge.style.cssText = 'position:fixed;top:8px;right:8px;background:rgba(124,58,237,0.9);color:#fff;padding:4px 12px;border-radius:12px;font-size:12px;font-family:system-ui,sans-serif;z-index:2147483647;pointer-events:none;display:flex;align-items:center;gap:6px;';
						badge.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> AI Reading...';
						overlay.appendChild(badge);
						const style = document.createElement('style');
						style.id = '__surfing_ai_reading_style';
						style.textContent = '@keyframes __surfing_pulse{0%,100%{border-color:rgba(124,58,237,0.5)}50%{border-color:rgba(124,58,237,0.15)}}';
						document.head.appendChild(style);
						document.body.appendChild(overlay);
					})()
					`,
					true,
				);
			} else {
				webContents.executeJavaScript(
					`
					(() => {
						const el = document.getElementById('__surfing_ai_reading');
						if (el) el.remove();
						const st = document.getElementById('__surfing_ai_reading_style');
						if (st) st.remove();
					})()
					`,
					true,
				);
			}
		} catch {
			// Non-critical
		}
	}

	clearHistory(): void {
		// @ts-ignore
		const webContents = this.getWebContents();
		if (!webContents) return;

		webContents.clearHistory();
		webContents.executeJavaScript(
			"history.pushState({}, '', location.href)",
		);

		this.leaf.history.backHistory.splice(0);
		this.leaf.history.forwardHistory.splice(0);
	}

	getState(): WebBrowserViewState {
		return { url: this.currentUrl };
	}

	getCurrentTitle(): string {
		return this.currentTitle;
	}

	navigate(url: string, addToHistory = true, updateWebView = true) {
		if (url === "") {
			return;
		}

		if (addToHistory) {
			if (
				this.leaf.history.backHistory.last()?.state?.state?.url !==
				this.currentUrl
			) {
				this.leaf.history.backHistory.push({
					state: {
						type: WEB_BROWSER_VIEW_ID,
						state: this.getState(),
					},
					title: this.currentTitle,
					icon: "search",
				});
				// Enable the arrow highlight on the back arrow because there's now back history.
				this.headerEl.children[1].children[0].setAttribute(
					"aria-disabled",
					"false",
				);
			}
		}

		// TODO: move this to utils.ts
		// Support both http:// and https://
		// TODO: ?Should we support Localhost?
		// And the before one is : /[-a-zA-Z0-9@:%_\+.~#?&//=]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_\+.~#?&//=]*)?/gi; which will only match `blabla.blabla`
		// Support 192.168.0.1 for some local software server, and localhost
		// eslint-disable-next-line no-useless-escape
		const urlRegEx =
			/^(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._\+~#?&//=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/g;
		// eslint-disable-next-line no-useless-escape
		const urlRegEx2 =
			/((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=\+\$,\w]+@)?[A-Za-z0-9.-]+(:[0-9]+)?|(?:www.|[-;:&=\+\$,\w]+@)[A-Za-z0-9.-]+)((?:\/[\+~%\/.\w\-_]*)?\??(?:[-\+=&;%@.\w_]*)#?(?:[\w]*))?)/g;

		if (urlRegEx.test(url)) {
			const first7 = url.slice(0, 7).toLowerCase();
			const first8 = url.slice(0, 8).toLowerCase();
			if (
				!(
					first7 === "http://" ||
					first7 === "file://" ||
					first8 === "https://"
				)
			) {
				url = "https://" + url;
			}
		} else if (
			(!(url.startsWith("file://") || /\.htm(l)?/g.test(url)) &&
				!urlRegEx2.test(encodeURI(url))) ||
			!/^(https?|file):\/\//g.test(url)
		) {
			// If url is not a valid FILE url, search it with search engine.
			const allSearchEngine = [
				...SEARCH_ENGINES,
				...this.plugin.settings.customSearchEngine,
			];
			const currentSearchEngine = allSearchEngine.find(
				(engine) =>
					engine.name.toLowerCase() ===
					this.plugin.settings.defaultSearchEngine,
			);
			console.log(
				currentSearchEngine,
				allSearchEngine,
				this.plugin.settings.defaultSearchEngine,
			);

			// @ts-ignore
			url =
				(currentSearchEngine
					? currentSearchEngine.url
					: SEARCH_ENGINES[0].url) + url;
		}

		this.currentUrl = url;

		this.headerBar.setSearchBarUrl(url);

		if (updateWebView) {
			this.webviewEl.setAttribute("src", url);
		}
		this.searchBox?.unload();
		this.app.workspace.requestSaveLayout();
	}

	// TODO: Combine this with context menu method.
	getCurrentTimestamp(editor?: Editor) {
		// @ts-ignore
		const webContents = remote.webContents.fromId(
			this.webviewEl.getWebContentsId(),
		);
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
					timeStr = window.location.href.split('?')[0]+'?t=' + joinTimeStr;
				`,
				true,
			)
			.then((result: any) => {
				const timestamp =
					"[" + result.split("?t=")[1] + "](" + result + ") ";
				const originalCursor = editor?.posToOffset(editor?.getCursor());
				editor?.replaceRange(timestamp, editor?.getCursor());
				if (originalCursor)
					editor?.setCursor(
						editor?.offsetToPos(originalCursor + timestamp.length),
					);
			});
	}

	// TODO: Refresh the page.
	refresh() {
		// @ts-ignore
		const webContents = remote.webContents.fromId(
			this.webviewEl.getWebContentsId(),
		);
		webContents.reload();
	}

	copyHighLight() {
		const highlightFormat = this.plugin.settings.highlightFormat;

		const getCurrentTime = () => {
			let link = "";
			// eslint-disable-next-line no-useless-escape
			const timeString = highlightFormat.match(
				/\{TIME\:[^\{\}\[\]]*\}/g,
			)?.[0];
			if (timeString) {
				// eslint-disable-next-line no-useless-escape
				const momentTime = moment().format(
					timeString.replace(/{TIME:([^\}]*)}/g, "$1"),
				);
				link = highlightFormat.replace(timeString, momentTime);
				return link;
			}
			return link;
		};

		const getCurrentUrl = () => {
			return this.currentUrl;
		};

		const checkTime = () => {
			return highlightFormat.includes("{TIME");
		};

		// @ts-ignore
		const webContents = remote.webContents.fromId(
			this.webviewEl.getWebContentsId(),
		);

		webContents
			.executeJavaScript(
				`
				const selectionText = document.getSelection().toString();
				let tempText = encodeURIComponent(selectionText);
				const chineseRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/gi;
				const englishSentence = selectionText.split('\\n');

				if (selectionText.match(chineseRegex)?.length > 50) {
					if (englishSentence.length > 1) {
						const fistSentenceWords = englishSentence[0];
						const lastSentenceWords = englishSentence[englishSentence.length - 1];

						tempText = encodeURIComponent(fistSentenceWords.slice(0, 4)) + "," + encodeURIComponent(lastSentenceWords.slice(lastSentenceWords.length - 4, lastSentenceWords.length));
					} else {
						tempText = encodeURIComponent(selectionText.substring(0, 8)) + "," + encodeURIComponent(selectionText.substring(selectionText.length - 8, selectionText.length));
					}
				} else if (englishSentence.length > 1) {

					const fistSentenceWords = englishSentence[0].split(' ');
					const lastSentenceWords = englishSentence[englishSentence.length - 1].split(' ');

					tempText = encodeURIComponent(fistSentenceWords.slice(0, 3).join(' ')) + "," + encodeURIComponent(lastSentenceWords.slice(lastSentenceWords.length - 1, lastSentenceWords.length).join(' '));
				}

				let linkToHighlight = "${getCurrentUrl()}".replace(/\#\:\~\:text\=(.*)/g, "") + "#:~:text=" + tempText;

				let link = "";
				if (${checkTime()}) {
					link = "${getCurrentTime()}";
				}
				link = (link != "" ? link : "${highlightFormat}").replace(/\{URL\}/g, linkToHighlight).replace(/\{CONTENT\}/g, selectionText.replace(/\\n/g, " "));

				`,
				true,
			)
			.then((result: any) => {
				clipboard.writeText(result);
			});
	}
}

interface WebBrowserViewState extends Record<string, unknown> {
	url: string;
	active?: boolean;
}
