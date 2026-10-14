import {
	Editor,
	ItemView,
	MarkdownRenderer,
	MarkdownView,
	Notice,
	Platform,
	ViewStateResult,
	type App,
	WorkspaceLeaf,
} from "obsidian";
import Defuddle from "defuddle";
import { HeaderBar } from "./component/HeaderBar";
import type * as Electron from "electron";
import { clipboard } from "electron";
import SurfingPlugin from "./surfingIndex";
import { t } from "./translations/helper";
import searchBox from "./component/SearchBox";
import { SEARCH_ENGINES } from "./surfingPluginSetting";
import { OmniSearchContainer } from "./component/OmniSearchContainer";
import { BookMarkBar } from "./component/BookMarkBar/BookMarkBar";
import { createBookmarkFile, isUrlBookmarked } from "./utils/bookmarkStore";
import { callMoment } from "./utils/moment";
import { findSearchEngine, isAppLink } from "./utils/url";
import type {
	AssistantAction,
	AssistantPageContext,
	AssistantHost,
} from "./component/AIAssistantSidebar";
import type { AIAssistantView } from "./component/AIAssistantView";
import { ContentScriptInjector } from "./component/ContentScriptInjector";
import { AIPageBridge } from "./component/AIPageBridge";
import { ContextMenuHandler } from "./component/ContextMenuHandler";
import { WebviewManager } from "./component/WebviewManager";
import {
	WEB_BROWSER_VIEW_ID,
	type WebBrowserViewState,
} from "./surfingViewTypes";

// Re-export for backward compatibility
export { WEB_BROWSER_VIEW_ID, type WebBrowserViewState };

const WEB_BROWSER_AI_VIEW_ID = "surfing-ai-assistant";

/** Obsidian internal: the vault's unique id. */
interface AppWithId {
	appId: string;
}

/** Obsidian internal: an entry of a leaf's back/forward history. */
interface HistoryEntry {
	state?: { state?: { url?: string } };
}

export class SurfingView extends ItemView implements AssistantHost {
	plugin: SurfingPlugin;
	private searchBox?: searchBox;
	currentUrl = "";
	currentTitle = "Surfing";

	headerBar!: HeaderBar;
	favicon!: HTMLImageElement;
	private searchContainer?: OmniSearchContainer;

	bookmarkBar?: BookMarkBar;

	private omnisearchEnabled: boolean;

	private contentInjector: ContentScriptInjector;
	private aiPageBridge: AIPageBridge;
	private contextMenuHandler: ContextMenuHandler;
	private webviewManager!: WebviewManager;
	private readerModeActive = false;
	/** A load Surfing started (navigate) has not committed yet. */
	private loadPending = false;
	private readerOverlayEl: HTMLElement | null = null;

	get webviewEl(): Electron.WebviewTag {
		return this.webviewManager?.webviewEl;
	}

	constructor(leaf: WorkspaceLeaf, plugin: SurfingPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.contentInjector = new ContentScriptInjector(plugin);
		this.contextMenuHandler = new ContextMenuHandler({
			plugin,
			getUrl: () => this.currentUrl,
			getTitle: () => this.currentTitle,
			leaf: this.leaf,
			contentEl: this.contentEl,
			webviewEl: this.webviewEl,
			navigateFn: (url: string) => this.navigate(url),
			copyHighLightFn: () => this.copyHighLight(),
		});
		this.aiPageBridge = new AIPageBridge({
			getWebContents: () => this.getWebContents(),
			getCurrentUrl: () => this.currentUrl,
			getCurrentTitle: () => this.currentTitle,
			navigate: (url: string) => this.navigate(url),
			waitForPageLoad: (timeout?: number) =>
				this.waitForPageLoad(timeout),
			refresh: () => this.refresh(),
			getLeaf: () => this.leaf,
			getContentEl: () => this.contentEl,
			getApp: () => this.app,
		});

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
						(leaf.view as SurfingView).navigate(state.url, false, true);
						leaf.rebuildView();
						app.workspace.setActiveLeaf(leaf);
						return;
					}
				}
			}

			void app.workspace.getLeaf(newLeaf).setViewState({
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
					: app.workspace.createLeafBySplit(
							activeViewLeaf,
						);
			localStorage.setItem("web-browser-leaf-id", leaf.id);

			void leaf.setViewState({
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
				void app.workspace.getLeaf(newLeaf).setViewState({
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
		const webContents = this.getWebContents();
		if (webContents) webContents.openDevTools();
	}

	createWebview = () => {
		this.contentEl.empty();

		if (this.plugin.settings.bookmarkManager.openBookMark) {
			this.bookmarkBar = new BookMarkBar(
				this.leaf.view as SurfingView,
				this.plugin,
			);
			void this.bookmarkBar.onload();
		}

		this.webviewManager = new WebviewManager({
			plugin: this.plugin,
			appId: (this.app as App & AppWithId).appId,
			leafId: this.leaf.id,
			contentEl: this.contentEl,
			sessionIsolation: this.plugin.settings.sessionIsolation,
			getCurrentUrl: () => this.currentUrl,
			recreateWebview: () => this.createWebview(),
			callbacks: {
				onDomReady: (webContents: Electron.WebContents) => {
					void (async () => {
					// Open new browser tab if the web view requests it.
					webContents.setWindowOpenHandler((event: Electron.HandlerDetails) => {
						if (isAppLink(event.url)) {
							window.open(event.url, "_external");
						} else {
							SurfingView.spawnWebBrowserView(this.plugin, true, {
								url: event.url,
								active: event.disposition !== "background-tab",
							});
						}
						// @electron/remote never hands a renderer callback's
						// result to the main process, which treats that as
						// "deny": the page's window is always replaced by a tab.
						return { action: "deny" };
					});

					await this.contextMenuHandler.register(
						webContents,
						this.webviewEl,
					);
					await this.contentInjector.inject(webContents);
					})();
				},
				onKeyboardEvent: (
					emulatedKeyboardEvent: KeyboardEvent,
					webContents: Electron.WebContents,
				) => {
					// TODO: Allow set hotkey in webview;
					if (
						this.plugin.settings.focusSearchBarViaKeyboard &&
						emulatedKeyboardEvent.key === "/"
					) {
						console.debug("focus search bar via keyboard");
						if (
							!this.plugin.settings.ignoreList.find(
								(item: string) =>
									this.currentUrl.contains(
										item.toLowerCase(),
									),
							)
						) {
							void webContents
								.executeJavaScript(
									`(e => !!e && (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement || e.isContentEditable))(document.activeElement)`,
									true,
								)
								.then((result: unknown) => {
									if (!result) this.headerBar.focus();
								});
							return;
						}
					}

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
				},
				onDragStartInject: (webContents: Electron.WebContents) => {
					const highlightFormat =
						this.plugin.settings.highlightFormat;
					const getCurrentTime = () => {
						let link = "";
						const timeString = highlightFormat.match(
							/\{TIME:[^{}[\]]*\}/g,
						)?.[0];
						if (timeString) {
							const momentTime = callMoment().format(
								timeString.replace(/{TIME:([^}]*)}/g, "$1"),
							);
							link = highlightFormat.replace(
								timeString,
								momentTime,
							);
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

								const linkToHighlight = e.srcElement.baseURI.replace(/#:~:text=(.*)/g, "") + "#:~:text=" + tempText;
								let link = "";
								if ("${highlightFormat}".includes("{TIME")) {
									link = "${getCurrentTime()}";
								}
								link = (link != "" ? link : "${highlightFormat}").replace(/{URL}/g, linkToHighlight).replace(/{CONTENT}/g, selectionText.replace(/\\n/g, " "));

								e.dataTransfer.setData('text/plain', link);
							}
						});
						`,
							true,
						);
				},
				onFocus: () => {
					this.app.workspace.setActiveLeaf(this.leaf);
					activeDocument.body.dispatchEvent(
						new MouseEvent("click", { bubbles: true }),
					);
				},
				onFaviconUpdate: (favicons: string[]) => {
					if (favicons[0] !== undefined)
						this.favicon.src = favicons[0];
					this.leaf.tabHeaderInnerIconEl.empty();
					this.leaf.tabHeaderInnerIconEl.appendChild(this.favicon);
				},
				onTitleUpdate: (title: string) => {
					if (this.omnisearchEnabled) this.updateSearchBox();
					this.leaf.tabHeaderInnerTitleEl.innerText = title;
					this.currentTitle = title;

					this.app.workspace.trigger(
						"surfing:page-change",
						title,
						this,
					);
				},
				onNavigate: (url: string, inPage: boolean) => {
					if (this.readerModeActive && !inPage) {
						this.readerOverlayEl?.remove();
						this.readerOverlayEl = null;
						this.readerModeActive = false;
						this.webviewEl.setCssProps({ display: "" });
					}
					this.pageNavigated(url, inPage);
				},
				onNavigationFailed: () => {
					this.loadPending = false;
				},
				onMenuClose: () => {
					this.contextMenuHandler?.close();
				},
				onDestroyed: () => {
					this.createWebview();
				},
			},
		});
		this.webviewManager.create();

		if (this.currentUrl) this.navigate(this.currentUrl);
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
		this.favicon = createEl("img");
		this.favicon.width = 16;
		this.favicon.height = 16;

		this.contentEl.addClass("wb-view-content");

		// Create main web view frame that displays the website.

		if (this.omnisearchEnabled)
			this.searchContainer = new OmniSearchContainer(
				this.leaf,
				this.plugin,
			);
		if (this.omnisearchEnabled) this.searchContainer?.onload();

		// Once per view: createWebview runs again whenever the webview is rebuilt.
		this.headerBar.addOnSearchBarEnterListener((url: string) => {
			this.navigate(url);
		});

		this.createWebview();
		this.initHeaderButtons();

		// Obsidian redraws tab headers when tabs move; put the favicon back.
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				const iconEl = this.leaf.tabHeaderInnerIconEl;
				if (this.favicon.getAttribute("src") && !iconEl.contains(this.favicon)) {
					iconEl.empty();
					iconEl.appendChild(this.favicon);
				}
			}),
		);
	}

	onload() {
		super.onload();
		this.contextMenuHandler?.close();
	}

	async onClose() {
		this.contextMenuHandler?.close();
	}

	initHeaderButtons() {
		this.addAction("book-open", t("Toggle Reader Mode"), () => {
			void this.toggleReaderMode();
		});

		if (Platform.isDesktop && this.plugin.settings.aiAssistant.enabled) {
			this.addAction(
				"bot",
				t("Toggle Surfing AI Assistant Sidebar"),
				() => {
					const leaves = this.app.workspace.getLeavesOfType(
						WEB_BROWSER_AI_VIEW_ID,
					);
					if (leaves.length > 0) {
						void this.app.workspace.revealLeaf(leaves[0]);
						(leaves[0].view as AIAssistantView).focusInput();
					} else {
						const rightLeaf =
							this.app.workspace.getRightLeaf(false);
						void rightLeaf?.setViewState({
							type: WEB_BROWSER_AI_VIEW_ID,
						});
						if (rightLeaf) {
							void this.app.workspace.revealLeaf(rightLeaf);
						}
					}
				},
			);
		}
		this.addAction("settings", t("settings"), () => {
			this.app.setting.open();
			this.app.setting.openTabById("surfing");
		});
		this.addAction("star", t("star"), async () => {
			if (isUrlBookmarked(this.plugin, this.currentUrl)) {
				new Notice("Bookmark already exists.");
				return;
			}

			let description = "";
			try {
				const webContents = this.getWebContents();
				const result: unknown = await webContents?.executeJavaScript(
					`document.querySelector('meta[name="description"]')?.content`,
				);
				if (typeof result === "string" && result) description = result;
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
			this.addAction("book", t("Send to ReadWise"), () => {
				const sendToReadWise = (title: string, url: string) => {
					open(
						"https://readwise.io/save?title=" +
							encodeURIComponent(title) +
							"&url=" +
							encodeURIComponent(url),
					);
				};

				try {
					sendToReadWise(this.currentTitle, this.currentUrl);
					new Notice("Save success!");
				} catch {
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
		const regex = /^(?:https?:\/\/)?(?:[^@/\n]+@)?(?:www\.)?([^:/?\n]+)/g;
		const currentUrl = this.currentUrl?.match(regex)?.[0];
		if (!currentUrl) return;
		const currentSearchEngine = searchEngines.find((engine) =>
			engine.url.startsWith(currentUrl),
		);
		if (!currentSearchEngine) return;
		const webContents = this.getWebContents();
		if (!webContents) return;

		try {
			void webContents
				.executeJavaScript(
					`
											document.querySelector('input')?.value
										`,
					true,
				)
				.then((result: unknown) => {
					if (typeof result !== "string") return;
					void this.searchContainer?.update(result.toLowerCase());
				});
		} catch (err) {
			console.error("Failed to copy: ", err);
		}
	}

	private getWebContents(): Electron.WebContents | null {
		return this.webviewManager?.getWebContents() ?? null;
	}

	// -- AssistantHost delegation --

	async getAIAssistantPageContext(
		includePageText: boolean,
		maxPageTextLength: number,
	): Promise<AssistantPageContext> {
		return this.aiPageBridge.getAIAssistantPageContext(
			includePageText,
			maxPageTextLength,
		);
	}

	async executeAIAssistantAction(action: AssistantAction): Promise<string> {
		return this.aiPageBridge.executeAIAssistantAction(action);
	}

	waitForPageLoad(timeout = 10000): Promise<void> {
		return (
			this.webviewManager?.waitForPageLoad(timeout) ?? Promise.resolve()
		);
	}

	getCurrentPageInfo(): { url: string; title: string } {
		return this.aiPageBridge.getCurrentPageInfo();
	}

	showReadingIndicator(show: boolean): void {
		this.aiPageBridge.showReadingIndicator(show);
	}

	clearHistory(): void {
		this.webviewManager?.clearHistory(this.leaf.history);
	}

	getState(): WebBrowserViewState {
		return { url: this.currentUrl };
	}

	getCurrentTitle(): string {
		return this.currentTitle;
	}

	/** Record the current page in the tab's back history (once). */
	private pushHistory() {
		if (!this.currentUrl) return;
		if (
			(this.leaf.history.backHistory as HistoryEntry[]).last()?.state?.state?.url ===
			this.currentUrl
		)
			return;
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

	/**
	 * The page committed a navigation: a link, a redirect, a script, or the
	 * page's own history. Its URL is taken as it is (never searched for).
	 * Loads Surfing started itself were recorded by navigate() already, and
	 * same-document changes (pushState, #hash) are not new history entries.
	 */
	private pageNavigated(url: string, inPage: boolean) {
		if (!inPage) {
			const own = this.loadPending;
			this.loadPending = false;
			if (!own && url !== this.currentUrl) this.pushHistory();
			this.searchBox?.unload();
		}
		if (!url || url === this.currentUrl) return;
		this.currentUrl = url;
		this.headerBar.setSearchBarUrl(url);
		this.app.workspace.requestSaveLayout();
	}

	navigate(url: string, addToHistory = true, updateWebView = true) {
		if (url === "") {
			return;
		}

		if (isAppLink(url)) {
			window.open(url.trim(), "_external");
			return;
		}

		if (addToHistory) this.pushHistory();

		// Local servers ("localhost:3000", "192.168.0.1/admin") have no TLD
		// for the address check below.
		if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#]|$)/i.test(url.trim()))
			url = "http://" + url.trim();

		// TODO: move this to utils.ts
		// Support both http:// and https://
		// TODO: ?Should we support Localhost?
		// And the before one is : /[-a-zA-Z0-9@:%_\+.~#?&//=]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_\+.~#?&//=]*)?/gi; which will only match `blabla.blabla`
		// Support 192.168.0.1 for some local software server, and localhost
		const urlRegEx =
			/^(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._+~#?&//=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)$/g;
		const urlRegEx2 =
			/((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=+$,\w]+@)?[A-Za-z0-9.-]+(:[0-9]+)?|(?:www.|[-;:&=+$,\w]+@)[A-Za-z0-9.-]+)((?:\/[+~%/.\w\-_]*)?\??(?:[-+=&;%@.\w_]*)#?(?:[\w]*))?)/g;

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
			url =
				findSearchEngine(
					this.plugin.settings.defaultSearchEngine,
					this.plugin.settings.customSearchEngine,
				).url + url;
		}

		this.currentUrl = url;

		this.headerBar.setSearchBarUrl(url);

		if (updateWebView) {
			this.loadPending = true;
			this.webviewEl.setAttribute("src", url);
		}
		this.searchBox?.unload();
		this.app.workspace.requestSaveLayout();
	}

	// TODO: Combine this with context menu method.
	getCurrentTimestamp(editor?: Editor) {
		const webContents = this.getWebContents();
		if (!webContents) return;
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
					timeStr = window.location.href.split('?')[0]+'?t=' + joinTimeStr;
				`,
				true,
			)
			.then((result: unknown) => {
				if (typeof result !== "string") return;
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

	refresh() {
		this.webviewManager?.refresh();
	}

	async toggleReaderMode(): Promise<void> {
		if (this.readerModeActive) {
			this.readerOverlayEl?.remove();
			this.readerOverlayEl = null;
			this.readerModeActive = false;
			this.webviewEl.setCssProps({ display: "" });
			return;
		}

		const webContents = this.getWebContents();
		if (!webContents) return;

		try {
			await AIPageBridge.waitForDOMStability(webContents);

			const rawHtml: unknown = await webContents.executeJavaScript(
				`document.documentElement.outerHTML`,
				true,
			);
			const html = typeof rawHtml === "string" ? rawHtml : "";

			const parser = new DOMParser();
			const doc = parser.parseFromString(html, "text/html");

			const baseEl = createEl("base");
			baseEl.href = this.currentUrl.replace(/\?(.*)/g, "");
			doc.head.prepend(baseEl);

			const result = new Defuddle(doc, {
				url: this.currentUrl,
				markdown: true,
			}).parse();

			const markdown = result.content || "";

			const containerEl = this.webviewManager.getContainerEl();
			this.readerOverlayEl = containerEl.createDiv({
				cls: "wb-reader-mode-overlay",
			});

			this.readerOverlayEl.createEl("h1", {
				cls: "wb-reader-mode-title",
				text: result.title || this.currentTitle,
			});

			if (result.author || result.published) {
				const metaEl = this.readerOverlayEl.createDiv({
					cls: "wb-reader-mode-meta",
				});
				if (result.author) metaEl.createSpan({ text: result.author });
				if (result.published)
					metaEl.createSpan({ text: result.published });
			}

			const contentEl = this.readerOverlayEl.createDiv({
				cls: "wb-reader-mode-content",
			});
			await MarkdownRenderer.render(
				this.app,
				markdown,
				contentEl,
				"",
				this,
			);

			this.webviewEl.setCssProps({ display: "none" });
			this.readerModeActive = true;
		} catch (err) {
			console.error("Reader mode failed:", err);
		}
	}

	copyHighLight() {
		const highlightFormat = this.plugin.settings.highlightFormat;

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

		const getCurrentUrl = () => {
			return this.currentUrl;
		};

		const checkTime = () => {
			return highlightFormat.includes("{TIME");
		};

		const webContents = this.getWebContents();
		if (!webContents) return;

		void webContents
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

				let linkToHighlight = "${getCurrentUrl()}".replace(/#:~:text=(.*)/g, "") + "#:~:text=" + tempText;

				let link = "";
				if (${checkTime()}) {
					link = "${getCurrentTime()}";
				}
				link = (link != "" ? link : "${highlightFormat}").replace(/{URL}/g, linkToHighlight).replace(/{CONTENT}/g, selectionText.replace(/\\n/g, " "));

				`,
				true,
			)
			.then((result: unknown) => {
				if (typeof result === "string") clipboard.writeText(result);
			});
	}
}
