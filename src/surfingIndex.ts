import {
	addIcon,
	App,
	Editor,
	editorInfoField,
	EventRef,
	HoverParent,
	HoverPopover,
	ItemView,
	Keymap,
	MarkdownPostProcessorContext,
	MarkdownPreviewRenderer,
	MarkdownPreviewRendererStatic,
	MarkdownView,
	Menu,
	Modal,
	Notice,
	parseYaml,
	Platform,
	Plugin,
	PopoverState,
	requireApiVersion,
	setIcon,
	TFile,
} from "obsidian";
import { HeaderBar } from "./component/HeaderBar";
import { SurfingView, WEB_BROWSER_VIEW_ID } from "./surfingView";
import {
	HTML_FILE_EXTENSIONS,
	SurfingFileView,
	WEB_BROWSER_FILE_VIEW_ID,
} from "./surfingFileView";
import { t } from "./translations/helper";
import { around } from "monkey-around";
import {
	DEFAULT_SETTINGS,
	SEARCH_ENGINES,
	SurfingSettings,
	SurfingSettingTab,
} from "./surfingPluginSetting";
import { InPageSearchBar } from "./component/inPageSearchBar";
import { tokenType } from "./types/obsidian";
import {
	checkIfWebBrowserAvailable,
	isEmailLink,
	isNormalLink,
} from "./utils/url";
import { InPageIconList } from "./component/InPageIconList";
import { InNodeWebView } from "./component/InNodeWebView";
import { BookMarkBar } from "./component/BookMarkBar/BookMarkBar";
import { EmbededWebView } from "./component/EmbededWebView";
import {
	BookmarkFileItem,
	createBookmarkFile,
	isInBookmarkFolder,
	refreshBookmarkCache,
	scanBookmarkFolder,
	updateBookmarkBar,
} from "./utils/bookmarkStore";
import { migrateBookmarks } from "./utils/bookmarkMigration";
import { nonElectronGetPageTitle } from "./utils/web";
import {
	TabTreeView,
	WEB_BROWSER_TAB_TREE_ID,
} from "./component/TabTreeView/TabTreeView";
import {
	AIAssistantView,
	WEB_BROWSER_AI_VIEW_ID,
} from "./component/AIAssistantView";
import "./App.css";
import { EditorView } from "@codemirror/view";
import { PopoverWebView } from "./component/PopoverWebView";
import { LastOpenedFiles } from "./component/LastOpenedFiles";
import { AdBlockManager } from "./adblock/adBlockManager";
import { ElementHidingManager } from "./adblock/elementHidingManager";
import { CookieManagerModal } from "./component/CookieManagerModal";
import { MCPBridge, MCPBridgeHost } from "./utils/mcpBridge";
import { checkProviderAvailability } from "./ai/providerFactory";

export default class SurfingPlugin extends Plugin {
	settings: SurfingSettings;
	settingsTab: SurfingSettingTab;
	adBlockManager: AdBlockManager;
	elementHidingManager: ElementHidingManager;
	mcpBridge: MCPBridge | null = null;
	bookmarkCache: BookmarkFileItem[] = [];
	// biome-ignore lint: history entries managed by AIAssistantSidebar
	aiChatHistory: unknown[] = [];
	private onLayoutChangeEventRef: EventRef;
	private applyURLDebounceTimer = 0;
	private urlOpened = false;

	// private patchInlineUrl = false;

	async onload() {
		await this.loadSettings();
		this.checkWebBrowser();

		// Initialize ad block and element hiding managers
		this.adBlockManager = new AdBlockManager(this);
		this.elementHidingManager = new ElementHidingManager(this);
		await this.adBlockManager.initialize();
		await this.elementHidingManager.initialize();

		this.settingsTab = new SurfingSettingTab(this.app, this);
		this.addSettingTab(this.settingsTab);

		this.registerView(
			WEB_BROWSER_VIEW_ID,
			(leaf) => new SurfingView(leaf, this),
		);
		this.registerView(
			WEB_BROWSER_FILE_VIEW_ID,
			(leaf) => new SurfingFileView(leaf, this),
		);
		this.settings.enableTreeView &&
			this.registerView(
				WEB_BROWSER_TAB_TREE_ID,
				(leaf) => new TabTreeView(leaf, this),
			);
		Platform.isDesktop &&
			this.settings.aiAssistant.enabled &&
			this.registerView(
				WEB_BROWSER_AI_VIEW_ID,
				(leaf) => new AIAssistantView(leaf, this),
			);

		try {
			if (this.settings.enableHtmlPreview)
				this.registerExtensions(
					HTML_FILE_EXTENSIONS,
					WEB_BROWSER_FILE_VIEW_ID,
				);
		} catch (error) {
			new Notice(
				`File extensions ${HTML_FILE_EXTENSIONS} had been registered by other plugin!`,
			);
		}

		// Bookmark migration and cache initialization
		if (this.settings.bookmarkManager.openBookMark) {
			if (!this.settings.bookmarkManager.bookmarksMigrated) {
				await migrateBookmarks(this);
			}
			this.bookmarkCache = await scanBookmarkFolder(this);
			this.registerBookmarkVaultEvents();
		}

		this.openTabTreeView();
		if (Platform.isDesktop) {
			this.openAIAssistantView();
			this.registerActiveLeafChangeForAI();
			this.startMCPBridge();

			// Check AI provider availability in background (non-blocking)
			if (this.settings.aiAssistant.enabled) {
				checkProviderAvailability(
					this.settings.aiAssistant,
					this.getAbsolutePluginDir(),
				);
			}
		}
		this.updateEmptyLeaves(false);
		this.registerContextMenu();
		this.registerCustomURI();
		this.registerCodeBlock();
		this.registerHoverPopover();

		this.patchMarkdownView();
		this.patchWindowOpen();
		this.patchMarkdownView();
		if (requireApiVersion("1.0.4")) this.patchEditMode();

		this.onLayoutChangeEventRef = this.app.workspace.on(
			"layout-change",
			() => {
				const activeView =
					this.app.workspace.getActiveViewOfType(ItemView);
				if (activeView) this.addHeaderAndSearchBar(activeView);
			},
		);

		this.registerCommands();
		this.registerCustomIcon();
		this.patchEmptyView();
		this.patchMarkdownPreviewRenderer();
		this.patchProperty();
		// this.settings.supportLivePreviewInlineUrl && this.patchInlinePreview();

		if (requireApiVersion("1.1.0") && this.settings.useWebview) {
			this.patchCanvasNode();
			this.patchCanvas();
		}
		this.registerEmbededHTML();
		if (this.settings.bookmarkManager.openBookMark) {
			this.registerRibbon();
		}
	}

	onunload() {
		this.adBlockManager?.destroy();
		if (Platform.isDesktop) {
			this.mcpBridge?.stop();
			this.mcpBridge = null;
		}
		this.app.workspace.detachLeavesOfType(WEB_BROWSER_VIEW_ID);
		this.settings.enableTreeView &&
			this.app.workspace.detachLeavesOfType(WEB_BROWSER_TAB_TREE_ID);
		Platform.isDesktop &&
			this.settings.aiAssistant.enabled &&
			this.app.workspace.detachLeavesOfType(WEB_BROWSER_AI_VIEW_ID);
		this.app.workspace.offref(this.onLayoutChangeEventRef);

		// Clean up header bar added to "New tab" views when plugin is disabled.
		// Using Obsidian getViewType
		this.updateEmptyLeaves(true);
		this.unRegisterEmbededHTML();
		// Refresh all Canvas to make sure they don't contain webview anymore.
		if (requireApiVersion("1.1.0") && this.settings.useWebview) {
			this.refreshAllRelatedView();
		}
	}

	private openTabTreeView() {
		this.app.workspace.onLayoutReady(this.onLayoutReady.bind(this));
	}

	onLayoutReady(): void {
		if (!this.settings.enableTreeView) return;
		if (
			this.app.workspace.getLeavesOfType(WEB_BROWSER_TAB_TREE_ID).length
		) {
			return;
		}
		this.app.workspace.getLeftLeaf(false)?.setViewState({
			type: WEB_BROWSER_TAB_TREE_ID,
		});
	}

	private openAIAssistantView() {
		if (!this.settings.aiAssistant.enabled) return;
		this.app.workspace.onLayoutReady(() => {
			if (
				this.app.workspace.getLeavesOfType(WEB_BROWSER_AI_VIEW_ID)
					.length
			) {
				return;
			}
			this.app.workspace.getRightLeaf(false)?.setViewState({
				type: WEB_BROWSER_AI_VIEW_ID,
			});
		});
	}

	private getAIAssistantView(): AIAssistantView | null {
		const leaves = this.app.workspace.getLeavesOfType(
			WEB_BROWSER_AI_VIEW_ID,
		);
		if (leaves.length === 0) return null;
		const view = leaves[0].view;
		// Guard against deferred views that haven't fully initialized yet
		if (!(view instanceof AIAssistantView)) return null;
		return view;
	}

	private registerActiveLeafChangeForAI() {
		if (!this.settings.aiAssistant.enabled) return;
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				const aiView = this.getAIAssistantView();
				if (!aiView) return;

				if (leaf?.view instanceof SurfingView) {
					// Switching to a SurfingView — update host to this page
					aiView.setHost(leaf.view);
					if (this.settings.aiAssistant.openByDefault) {
						const aiLeaf = this.app.workspace.getLeavesOfType(
							WEB_BROWSER_AI_VIEW_ID,
						)[0];
						if (aiLeaf) {
							this.app.workspace.revealLeaf(aiLeaf);
						}
					}
				}
				// Non-SurfingView: keep the current host (last active page).
				// The AI sidebar stays connected to the most recent SurfingView.
			}),
		);

		// Clean up host when its SurfingView leaf is closed
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				const aiView = this.getAIAssistantView();
				if (!aiView) return;
				const currentHost = aiView.getHost();
				if (!currentHost) return;
				// Check if the host's leaf is still in the workspace
				const surfingLeaves =
					this.app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID);
				const hostStillExists = surfingLeaves.some(
					(l) => l.view === currentHost,
				);
				if (!hostStillExists) {
					// Host leaf was closed — fall back to the most recent SurfingView
					if (surfingLeaves.length > 0) {
						aiView.setHost(surfingLeaves[0].view as SurfingView);
					} else {
						aiView.setHost(null);
					}
				}
			}),
		);
	}

	getAbsolutePluginDir(): string {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const path = require("path") as typeof import("path");
		// @ts-ignore - basePath is not in the public API
		const vaultBase: string = this.app.vault.adapter.basePath;
		const relDir =
			this.manifest.dir ||
			`${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		return path.resolve(vaultBase, relDir);
	}

	private async startMCPBridge() {
		if (
			!this.settings.aiAssistant.enabled ||
			!this.settings.aiAssistant.enableMCPServer
		)
			return;

		const pluginDir =
			this.manifest.dir ||
			`${this.app.vault.configDir}/plugins/${this.manifest.id}`;

		const maxLen = () => this.settings.aiAssistant.maxPageTextLength;

		// Helper: get any available SurfingView (active first, then most recent)
		const getAnySurfingView = (): SurfingView | null => {
			const activeView =
				this.app.workspace.getActiveViewOfType(SurfingView);
			if (activeView) return activeView;
			// Fallback to any open SurfingView leaf (most recently active first)
			const leaves =
				this.app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID);
			if (leaves.length > 0) {
				leaves.sort((a, b) => b.activeTime - a.activeTime);
				const view = leaves[0].view;
				if (view instanceof SurfingView) return view;
			}
			return null;
		};

		// Helper: ensure at least one SurfingView exists; creates a new tab if needed.
		// Returns the SurfingView after it's ready.
		const ensureSurfingTab = async (
			url?: string,
		): Promise<SurfingView | null> => {
			const existing = getAnySurfingView();
			if (existing) return existing;
			// No SurfingView open — spawn a new one
			const targetUrl = url || "about:blank";
			const existingIds = new Set(
				this.app.workspace
					.getLeavesOfType(WEB_BROWSER_VIEW_ID)
					.map((l) => (l as any).id),
			);
			SurfingView.spawnWebBrowserView(this, true, { url: targetUrl });
			for (let i = 0; i < 30; i++) {
				await new Promise((r) => setTimeout(r, 300));
				const allLeaves =
					this.app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID);
				const fresh = allLeaves.find(
					(l) => !existingIds.has((l as any).id),
				);
				if (fresh && fresh.view instanceof SurfingView) {
					const view = fresh.view as SurfingView;
					await view.waitForPageLoad(15000);
					return view;
				}
			}
			return null;
		};

		const bridgeHost: MCPBridgeHost = {
			getActiveHost: () => {
				return getAnySurfingView();
			},
			// MCP calls get a much higher text limit — the AI explicitly requested content
			maxPageTextLength: () => Math.max(maxLen(), 50000),

			// --- Page operations ---
			openPage: async (url: string) => {
				const existingIds = new Set(
					this.app.workspace
						.getLeavesOfType(WEB_BROWSER_VIEW_ID)
						.map((l) => (l as any).id),
				);
				SurfingView.spawnWebBrowserView(this, true, { url });
				// Poll for the new leaf
				let newView: SurfingView | null = null;
				for (let i = 0; i < 30; i++) {
					await new Promise((r) => setTimeout(r, 300));
					const allLeaves =
						this.app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID);
					const fresh = allLeaves.find(
						(l) => !existingIds.has((l as any).id),
					);
					if (fresh && fresh.view instanceof SurfingView) {
						newView = fresh.view as SurfingView;
						break;
					}
				}
				if (!newView) {
					return {
						url,
						title: "",
						pageText: "Failed to open page",
					};
				}
				await newView.waitForPageLoad(15000);
				const ctx = await newView.getAIAssistantPageContext(
					true,
					maxLen(),
				);
				return {
					url: ctx.url,
					title: ctx.title,
					pageText: ctx.pageText,
				};
			},

			executeAction: async (action: Record<string, unknown>) => {
				let view = getAnySurfingView();
				if (!view) {
					// For navigate/open actions, auto-create a new tab
					const actionType = String(action.type || "").toLowerCase();
					if (actionType === "navigate" || actionType === "open") {
						const url = String(action.url || "about:blank");
						view = await ensureSurfingTab(url);
						if (view)
							return `Opened new tab and navigated to ${url}`;
						return "Failed to create new Surfing tab";
					}
					return "No active Surfing tab. Use surfing_open_page or surfing_navigate to open one first.";
				}
				return view.executeAIAssistantAction(action as any);
			},

			// --- Consent gate ---
			getApprovalMode: () => {
				const aiView = this.getAIAssistantView();
				return aiView?.getApprovalMode() ?? "auto";
			},
			requestToolApproval: async (
				toolName: string,
				toolInput: Record<string, unknown>,
			) => {
				const aiView = this.getAIAssistantView();
				if (!aiView) return true;
				return aiView.requestMCPToolApproval(toolName, toolInput);
			},

			// --- Vault operations ---
			createNote: async (notePath: string, content: string) => {
				const path = notePath.endsWith(".md")
					? notePath
					: notePath + ".md";
				const existing = this.app.vault.getAbstractFileByPath(path);
				if (existing) {
					return JSON.stringify({
						error: `Note already exists: ${path}`,
					});
				}
				const dir = path.substring(0, path.lastIndexOf("/"));
				if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
					await this.app.vault.createFolder(dir);
				}
				const file = await this.app.vault.create(path, content);
				return JSON.stringify({
					success: true,
					path: file.path,
				});
			},
			editNote: async (
				notePath: string,
				content: string,
				mode: "append" | "prepend" | "replace",
			) => {
				const path = notePath.endsWith(".md")
					? notePath
					: notePath + ".md";
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!file || !(file instanceof TFile)) {
					return JSON.stringify({
						error: `Note not found: ${path}`,
					});
				}
				if (mode === "replace") {
					await this.app.vault.modify(file, content);
				} else if (mode === "prepend") {
					const existing = await this.app.vault.read(file);
					await this.app.vault.modify(
						file,
						content + "\n" + existing,
					);
				} else {
					// append (default)
					const existing = await this.app.vault.read(file);
					await this.app.vault.modify(
						file,
						existing + "\n" + content,
					);
				}
				return JSON.stringify({
					success: true,
					path: file.path,
					mode,
				});
			},
			readNote: async (notePath: string) => {
				const path = notePath.endsWith(".md")
					? notePath
					: notePath + ".md";
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!file || !(file instanceof TFile)) {
					return JSON.stringify({
						error: `Note not found: ${path}`,
					});
				}
				const content = await this.app.vault.read(file);
				return JSON.stringify({ path: file.path, content });
			},
		};

		// @ts-ignore - basePath is not in the public API
		const vaultBasePath: string = this.app.vault.adapter.basePath;
		this.mcpBridge = new MCPBridge(pluginDir, bridgeHost, vaultBasePath);

		try {
			await this.mcpBridge.start();
			await this.mcpBridge.writeFiles(this.app.vault.adapter);
		} catch (err) {
			console.error("Surfing: Failed to start MCP bridge:", err);
			this.mcpBridge = null;
		}
	}

	private registerRibbon() {
		this.addRibbonIcon("bookmark", "Open Bookmarks Folder", async () => {
			const folderPath =
				this.settings.bookmarkManager.bookmarkFolder ||
				"surfing-bookmarks";
			// @ts-ignore - reveal folder in file explorer
			const fileExplorer =
				this.app.workspace.getLeavesOfType("file-explorer")[0];
			if (fileExplorer) {
				this.app.workspace.revealLeaf(fileExplorer);
				// @ts-ignore
				fileExplorer.view?.revealInFolder?.(
					this.app.vault.getAbstractFileByPath(folderPath),
				);
			}
		});
	}

	private registerBookmarkVaultEvents() {
		this.registerEvent(
			this.app.vault.on("create", async (file) => {
				if (
					file.path &&
					isInBookmarkFolder(this, file.path) &&
					file.path.endsWith(".md")
				) {
					// Small delay to let metadataCache populate
					setTimeout(async () => {
						await refreshBookmarkCache(this);
						updateBookmarkBar(this);
					}, 200);
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on("modify", async (file) => {
				if (
					file.path &&
					isInBookmarkFolder(this, file.path) &&
					file.path.endsWith(".md")
				) {
					setTimeout(async () => {
						await refreshBookmarkCache(this);
						updateBookmarkBar(this);
					}, 200);
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on("delete", async (file) => {
				if (
					file.path &&
					isInBookmarkFolder(this, file.path) &&
					file.path.endsWith(".md")
				) {
					await refreshBookmarkCache(this);
					updateBookmarkBar(this);
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on("rename", async (file, oldPath) => {
				if (
					(file.path &&
						isInBookmarkFolder(this, file.path) &&
						file.path.endsWith(".md")) ||
					(oldPath &&
						isInBookmarkFolder(this, oldPath) &&
						oldPath.endsWith(".md"))
				) {
					setTimeout(async () => {
						await refreshBookmarkCache(this);
						updateBookmarkBar(this);
					}, 200);
				}
			}),
		);
	}

	// Add header bar to empty view.
	private addHeaderAndSearchBar(currentView: ItemView) {
		if (!currentView) return;
		// Check if new leaf's view is empty, else return.
		if (
			currentView.getViewType() != "empty" &&
			currentView.getViewType() !== "home-tab-view"
		)
			return;
		// Check if the "New tab" view has already been processed and has a header bar already.
		if (
			!currentView.headerEl.children[2].hasClass("web-browser-header-bar")
		) {
			const headerBar = new HeaderBar(
				currentView.titleContainerEl,
				this,
				currentView,
			);
			headerBar.onLoad();
			// Focus on current inputEl
			if (!this.settings.showSearchBarInPage) headerBar.focus();
			headerBar.addOnSearchBarEnterListener((url: string) => {
				SurfingView.spawnWebBrowserView(this, false, { url });
			});
		}

		if (this.app.plugins.getPlugin("home-tab")) return;
		if (this.settings.randomBackground) {
			currentView.contentEl.toggleClass("wb-random-background", true);
		}
		const emptyStateEl = (
			currentView.contentEl.children[0] as HTMLElement
		).hasClass("empty-state")
			? (currentView.contentEl.children[0] as HTMLElement)
			: null;
		if (!emptyStateEl) return;
		if (
			!emptyStateEl.hasClass("wb-page-search-bar") &&
			this.settings.showSearchBarInPage
		) {
			const inPageContainerEl = emptyStateEl.createEl("div", {
				cls: "wb-search-bar-container",
			});
			emptyStateEl?.addClass("wb-page-search-bar");

			const inPageSearchBar = new InPageSearchBar(
				inPageContainerEl,
				currentView,
				this,
			);
			if (this.settings.lastOpenedFiles) {
				new LastOpenedFiles(
					this,
					inPageSearchBar.inPageSearchBarContainerEl,
				).onload();
			}

			if (this.settings.useIconList) {
				new InPageIconList(emptyStateEl, currentView, this);
				const emptyActionsEl = emptyStateEl.querySelector(
					".empty-state-container",
				);

				if (emptyActionsEl) emptyActionsEl.addClass("wb-empty-actions");
			}

			inPageSearchBar.focus();
			inPageSearchBar.addOnSearchBarEnterListener((url: string) => {
				if (url.trim() === "" || this.settings.showOtherSearchEngines)
					return;
				SurfingView.spawnWebBrowserView(this, false, { url });
			});
		}
	}

	// Clean up header bar added to empty views when plugin is disabled.
	private removeHeaderAndSearchBar(currentView: ItemView) {
		if (!currentView) return;

		// Check if new leaf's view is empty, else return.
		if (
			currentView.getViewType() != "empty" &&
			currentView.getViewType() !== "home-tab-view"
		)
			return;

		// Check if the "New tab" view has already been processed and has a header bar already.
		if (currentView.titleContainerEl.hasClass("wb-header-bar")) {
			currentView.titleContainerEl.empty();
			currentView.titleContainerEl.removeClass("wb-header-bar");
		}

		// Remove config icon
		if (
			currentView.contentEl.children[1]?.hasClass("surfing-settings-icon")
		) {
			currentView.contentEl.children[1]?.detach();
		}

		if (this.app.plugins.getPlugin("home-tab")) return;
		// Remove in page search bar
		if (
			currentView.contentEl.children[0].hasClass("wb-page-search-bar") &&
			this.settings.showSearchBarInPage
		) {
			currentView.contentEl.children[0].children[1]?.detach();
			currentView.contentEl.children[0].children[1]?.empty();
			currentView.contentEl.children[0].children[1]?.detach();
			currentView.contentEl.children[0].removeClass("wb-page-search-bar");
		}
	}

	// Update all leaf contains empty view when restart Obsidian
	private updateEmptyLeaves(removeHeader?: boolean) {
		const emptyLeaves = this.app.workspace.getLeavesOfType("empty");
		const homeTabLeaves =
			this.app.workspace.getLeavesOfType("home-tab-view");

		const targetLeaves = [...emptyLeaves, ...homeTabLeaves];
		targetLeaves.forEach((leaf) => {
			if (leaf.view instanceof ItemView) {
				if (!removeHeader) this.addHeaderAndSearchBar(leaf.view);
				if (removeHeader) this.removeHeaderAndSearchBar(leaf.view);
			}
		});
	}

	// Support basic open web in Obsidian.
	private registerCustomURI() {
		if (!this.settings.openInObsidianWeb) return;
		this.registerObsidianProtocolHandler("web-open", async (e) => {
			let url = e.url;
			if (!url) return;
			if (decodeURI(url) !== url)
				url = decodeURI(url).toString().replace(/\s/g, "%20");
			if (this.settings.bookmarkManager.saveBookMark)
				new SaveBookmarkModal(this.app, url, this).open();
			else SurfingView.spawnWebBrowserView(this, true, { url: url });
		});
	}

	// Register right click menu on editor
	private registerContextMenu() {
		this.registerEvent(
			this.app.workspace.on(
				"editor-menu",
				(menu: Menu, editor: Editor, view: MarkdownView) => {
					if (!editor) {
						return;
					}
					if (editor.getSelection().length === 0) {
						const token = editor.getClickableTokenAt(
							editor.getCursor(),
						);
						if (token && token.type === "external-link") {
							menu.addItem((item) => {
								item.setIcon("surfing")
									.setTitle(t("Open With Surfing"))
									.onClick(() => {
										// @ts-ignore
										SurfingView.spawnWebBrowserView(
											this,
											true,
											{
												url: token.text,
											},
										);
									});
							}).addItem((item) => {
								item.setIcon("surfing")
									.setTitle(t("Open With External Browser"))
									.onClick(() => {
										// @ts-ignore
										window.open(
											token.text,
											"_blank",
											"external",
										);
									});
							});

							if (
								this.app.plugins.getPlugin(
									"obsidian-hover-editor",
								)
							) {
								menu.addItem((item) => {
									item.setIcon("surfing")
										.setTitle("Open With Hover Editor")
										.onClick(async () => {
											const hoverEditorPlugin =
												this.app.plugins.getPlugin(
													"obsidian-hover-editor",
												);

											if (!hoverEditorPlugin) {
												new Notice(
													"Please install obsidian-hover-editor plugin first",
												);
												return;
											}

											const leaf = await this.app.plugins
												.getPlugin(
													"obsidian-hover-editor",
												)
												?.spawnPopover(view.contentEl);

											if (!leaf) return;

											leaf.setViewState({
												type: "surfing-view",
												active: true,
												state: {
													url: token.text,
												},
											});
										});
								});
							}
						}

						return;
					}
					const selection = editor.getSelection();

					menu.addItem((item) => {
						// Add sub menu
						const searchEngines = [
							...SEARCH_ENGINES,
							...this.settings.customSearchEngine,
						];
						const subMenu = item
							.setTitle(`Search In Surfing`)
							.setIcon("search")
							.setSubmenu();
						searchEngines.forEach((engine) => {
							subMenu.addItem((item) => {
								item.setIcon("search")
									.setTitle(engine.name)
									.onClick(() => {
										// @ts-ignore
										SurfingView.spawnWebBrowserView(
											this,
											true,
											{
												url: engine.url + selection,
											},
										);
									});
							});
						});
					});
				},
			),
		);
	}

	private registerCommands() {
		this.addCommand({
			id: "open-surfing-view-next",
			name: "open surfing view next",
			callback: () => {
				this.app.workspace.getLeaf(true).setViewState({
					type: "surfing-view-next",
					active: true,
				});
			},
		});

		this.addCommand({
			id: "clear-browsing-data",
			name: "Clear browsing data",
			callback: () => {
				// @ts-ignore
				const session = remote.session.fromPartition(
					// @ts-ignore
					`persist:surfing-vault-${this.app.appId}`,
				);
				session
					.clearStorageData({
						storages: [
							"appcache",
							"cookies",
							"filesystem",
							"indexdb",
							"localstorage",
							"shadercache",
							"websql",
							"serviceworkers",
							"cachestorage",
						],
					})
					.then(() => {
						new Notice("Browsing data cleared");
					});
			},
		});

		this.addCommand({
			id: "manage-cookies",
			name: t("Manage Cookies for Current Site"),
			checkCallback: (checking: boolean) => {
				const surfingView =
					this.app.workspace.getActiveViewOfType(SurfingView);
				if (surfingView && surfingView.currentUrl) {
					if (!checking) {
						try {
							const hostname = new URL(surfingView.currentUrl)
								.hostname;
							new CookieManagerModal(
								this.app,
								this,
								hostname,
							).open();
						} catch (e) {
							// Invalid URL
						}
					}
					return true;
				}
			},
		});

		// Use checkCallback method to check if the view is WebBrowserView;
		// And change the default private to public.
		this.addCommand({
			id: "open-current-url-with-external-browser",
			name: t("Open Current URL In External Browser"),
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const webbrowserView =
					this.app.workspace.getActiveViewOfType(SurfingView);
				if (webbrowserView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						window.open(webbrowserView.getState()?.url, "_blank");
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			},
		});

		// Use checkCallback method to check if the view is WebBrowserView;
		// And change the default private to public.
		this.addCommand({
			id: "clear-current-page-history",
			name: t("Clear Current Page History"),
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const webbrowserView =
					this.app.workspace.getActiveViewOfType(SurfingView);
				if (webbrowserView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						webbrowserView.clearHistory();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			},
		});

		this.addCommand({
			id: "open-inspecter",
			name: "Open Inspecter",
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const surfingView =
					this.app.workspace.getActiveViewOfType(SurfingView);
				if (surfingView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						surfingView.openInpecter();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			},
		});

		// Use checkCallback method to check if the view is WebBrowserView;
		// And change the default private to public.
		this.addCommand({
			id: "refresh-page",
			name: t("Refresh Current Page"),
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const webbrowserView =
					this.app.workspace.getActiveViewOfType(SurfingView);
				if (webbrowserView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						webbrowserView.refresh();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			},
		});

		this.addCommand({
			id: "toggle-same-tab-globally",
			name: t("Toggle Same Tab In Web Browser"),
			callback: async () => {
				this.settings.openInSameTab = !this.settings.openInSameTab;
				await this.saveSettings();
			},
		});

		this.addCommand({
			id: "get-current-timestamp",
			name: t("Get Current Timestamp from Web Browser"),
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const lastActiveLeaves =
					this.app.workspace.getLeavesOfType("surfing-view");
				if (lastActiveLeaves.length === 0) return;

				const lastActiveLeaf = lastActiveLeaves.sort(
					(a, b) => b.activeTime - a.activeTime,
				)[0];

				const webbrowserView = lastActiveLeaf.view as SurfingView;
				const url = webbrowserView.getState()?.url;
				if (!url?.contains("bilibili")) return;

				webbrowserView.getCurrentTimestamp(editor);
			},
		});

		this.addCommand({
			id: "search-in-current-page-title-bar",
			name: t("Search In Current Page Title Bar"),
			callback: () => {
				const currentView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!currentView) return;
				if (currentView.headerEl.childNodes.length > 4) return;
				const searchBarEl = new HeaderBar(
					currentView.headerEl,
					this,
					currentView,
					false,
				);
				searchBarEl.onLoad();

				searchBarEl.addOnSearchBarEnterListener((url: string) => {
					SurfingView.spawnWebBrowserView(this, false, { url });
				});
				searchBarEl.focus();
			},
		});

		const searchEngines = [
			...SEARCH_ENGINES,
			...this.settings.customSearchEngine,
		];
		searchEngines.forEach((engine) => {
			this.addCommand({
				id: "using" + engine.name.replace(/\s/g, "-") + "-to-search",
				name: t("Using ") + engine.name + t(" to search"),
				editorCallback: (editor: Editor, view: MarkdownView) => {
					if (editor.getSelection().length === 0) return;
					const selection = editor.getSelection();

					// @ts-ignore
					SurfingView.spawnWebBrowserView(true, {
						url: engine.url + selection,
					});
				},
			});
		});

		this.addCommand({
			id: "toggle-dark-mode",
			name: t("Toggle Dark Mode"),
			callback: async () => {
				this.settings.darkMode = !this.settings.darkMode;
				await this.saveSettings();
				const webbrowserView =
					this.app.workspace.getActiveViewOfType(SurfingView);
				if (webbrowserView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					webbrowserView.refresh();
				}
			},
		});

		this.addCommand({
			id: "focus-on-current-search-bar",
			name: t("Focus On Current Search Bar"),
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const surfingView =
					this.app.workspace.getActiveViewOfType(SurfingView);
				if (surfingView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						const searchBarEl = surfingView.headerBar;
						if (searchBarEl) searchBarEl.focus();
					}

					return true;
				}
			},
		});

		if (Platform.isDesktop) {
			this.addCommand({
				id: "toggle-ai-assistant-sidebar",
				name: t("Toggle Surfing AI Assistant Sidebar"),
				callback: () => {
					if (!this.settings.aiAssistant.enabled) {
						new Notice(
							t(
								"Enable Surfing AI Assistant Sidebar to use this feature.",
							),
						);
						return;
					}
					const leaves = this.app.workspace.getLeavesOfType(
						WEB_BROWSER_AI_VIEW_ID,
					);
					if (leaves.length > 0) {
						this.app.workspace.revealLeaf(leaves[0]);
					} else {
						this.app.workspace.getRightLeaf(false)?.setViewState({
							type: WEB_BROWSER_AI_VIEW_ID,
						});
					}
				},
			});

			this.addCommand({
				id: "focus-ai-assistant-input",
				name: t("Focus Surfing AI Assistant Input"),
				callback: () => {
					if (!this.settings.aiAssistant.enabled) return;
					const leaves = this.app.workspace.getLeavesOfType(
						WEB_BROWSER_AI_VIEW_ID,
					);
					if (leaves.length > 0) {
						this.app.workspace.revealLeaf(leaves[0]);
						(leaves[0].view as AIAssistantView).focusInput();
					}
				},
			});
		}

		this.addCommand({
			id: "copy-link-to-highlight",
			name: t("Copy Link to Highlight"),
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const surfingView =
					this.app.workspace.getActiveViewOfType(SurfingView);
				if (surfingView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						surfingView.copyHighLight();
					}

					return true;
				}
			},
		});

		this.addCommand({
			id: "copy-surfing-tabs-as-markdown",
			name: "Copy Surfing Tabs as Markdown",
			callback: () => {
				const surfingLeaves =
					this.app.workspace.getLeavesOfType("surfing-view");
				if (surfingLeaves.length === 0) return;

				surfingLeaves.sort((a, b) => b.activeTime - a.activeTime);
				let markdown = "";
				surfingLeaves.forEach((leaf) => {
					const surfingView = leaf.view as SurfingView;
					const url = surfingView.currentUrl;

					if (!url) return;

					const title = surfingView.currentTitle;
					if (!title) return;
					if (markdown.length === 0)
						markdown = `- [${title}](<${url}>)`;
					else markdown += `\n- [${title}](<${url}>)`;
				});

				try {
					navigator.clipboard.writeText(markdown);
				} catch (e) {
					new Notice(
						t(
							"Copy failed, you may focus on surfing view, click the title bar, and try again.",
						),
					);
				}
			},
		});
	}

	private registerCustomIcon() {
		addIcon(
			"surfing",
			`<svg t="1669432317981" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1590" data-darkreader-inline-fill="" width="100" height="100"><path d="M330.926 1023.978c-11.78 0-21.328-9.562-21.328-21.344v-42.652c0-11.782 9.546-21.344 21.328-21.344s21.342 9.562 21.342 21.344v42.652c0 11.782-9.56 21.344-21.342 21.344z" fill="#EAAD7A" p-id="1591" data-darkreader-inline-fill="" style="--darkreader-inline-fill:#e2a36a;"></path><path d="M650.892 273.08C624.644 115.932 579.958 16.656 578.052 12.532a21.332 21.332 0 0 0-25.904-11.5c-1.406 0.468-35.186 11.28-70.262 24.842-20.936 8.062-37.998 15.466-50.7 21.936-22.046 11.25-32.014 20.092-35.358 31.404-2.578 7.188-24.764 54.842-48.232 105.246-39.138 84.088-92.746 199.27-136.086 298.016-23.796 54.248-41.92 97.714-53.84 129.212-21.952 57.998-20.89 69.652-17.204 78.872 4.172 10.466 13.282 21.842 82.808 55.342 36.28 17.466 85.76 39.278 147.07 64.902 104.088 43.464 207.894 83.372 208.926 83.746 2.468 0.968 5.062 1.438 7.656 1.438 3.124 0 6.218-0.688 9.124-2.062a21.284 21.284 0 0 0 11.124-12.532c35.308-106.152 55.808-217.832 60.84-331.952 4.034-91.246-1.716-184.21-17.122-276.362z" fill="#ED5564" p-id="1592" data-darkreader-inline-fill="" style="--darkreader-inline-fill:#cc5b60;"></path><path d="M650.892 273.08C624.644 115.932 579.958 16.656 578.052 12.532a21.332 21.332 0 0 0-25.904-11.5c-0.656 0.218-8.31 2.686-19.842 6.592a21.938 21.938 0 0 1 3.094 4.906c1.89 4.124 46.59 103.4 72.84 260.548 15.376 92.152 21.154 185.116 17.124 276.362-5.06 114.12-25.53 225.798-60.872 331.952a21.216 21.216 0 0 1-3.282 6.156c11.28 4.406 17.81 6.906 18.06 7 2.468 0.968 5.062 1.438 7.656 1.438 3.124 0 6.218-0.688 9.124-2.062a21.284 21.284 0 0 0 11.124-12.532c35.308-106.152 55.808-217.832 60.84-331.952 4.034-91.244-1.716-184.208-17.122-276.36z" fill="#FFFFFF" opacity=".2" p-id="1593" data-darkreader-inline-fill="" style="--darkreader-inline-fill:#ebe3d5;"></path><path d="M181.622 874.642c0 2.468 0.406 4.938 1.266 7.282 0.954 2.624 9.89 26.124 32.092 49.934 21.014 22.562 58.2 49.436 115.948 49.436h383.996c128.744 0 186.428-91.588 188.834-95.494a21.314 21.314 0 0 0 3.156-11.156H181.622z" fill="#F4BE8E" p-id="1594" data-darkreader-inline-fill="" style="--darkreader-inline-fill:#ecb177;"></path><path d="M685.924 584.064c-6.782-2.25-13.532-3.876-19.562-5.062a1292.052 1292.052 0 0 1-3.656 42.81c12.844 3.032 24.876 7.936 29.188 13.686-7.25 3.718-26.344 10.906-73.402 17.844-42.218 6.218-97.95 11-161.196 13.75-122.15 5.342-251.97 2.376-315.686-7.218-11.656-1.782-22.514 6.25-24.28 17.904-1.75 11.656 6.264 22.53 17.92 24.28 44.826 6.75 118.102 10.376 199.598 10.376 39.28 0 80.496-0.844 121.336-2.594 64.154-2.718 121.274-7.5 165.118-13.78 71.778-10.312 92.806-22.438 102.368-30.686 10.406-8.938 12.594-18.75 12.594-25.376 0-14.688-6.562-41.466-50.34-55.934z" fill="#434A54" p-id="1595" data-darkreader-inline-fill="" style="--darkreader-inline-fill:#555755;"></path></svg>`,
		);
	}

	private registerCodeBlock() {
		this.registerMarkdownCodeBlockProcessor(
			"surfing",
			(
				source: string,
				el: HTMLElement,
				ctx: MarkdownPostProcessorContext,
			) => {
				const yaml = parseYaml(source);
				if (!yaml || !yaml.url) return;

				const url = yaml.url;
				el.toggleClass("surfing-embed-website", true);

				const parentEl = el.createEl("div", {
					cls: "surfing-embed-website-container",
				});
				const webView = new PopoverWebView(parentEl, url, this);
				webView.onload();
			},
		);
	}

	private registerHoverPopover() {
		if (!this.settings.hoverPopover) return;
		this.registerEditorExtension(
			EditorView.domEventHandlers({
				mouseover: (e: MouseEvent, editorView: EditorView) => {
					if (
						!(e.target as HTMLElement).hasClass("cm-underline") &&
						!(e.target as HTMLElement).hasClass("external-link")
					)
						return;

					const editorInfo = editorView.state.field(editorInfoField);
					const editor: Editor = (editorInfo as any).editMode?.editor;

					const pos = editorView.posAtDOM(<Node>e.target);
					const editorPos = editor.offsetToPos(pos);

					const type = editor.getClickableTokenAt(editorPos);
					if (!type) return;

					if (!type.text.trim().startsWith("http")) return;

					this.app.workspace.trigger("hover-link", {
						event: e,
						source: "editor",
						hoverParent: editorInfo,
						targetEl: e.target,
						linktext: type.text.trim(),
					});
				},
			}),
		);

		this.registerMarkdownPostProcessor(
			(el, ctx: MarkdownPostProcessorContext) => {
				el.querySelectorAll("a").forEach((link) => {
					link.addEventListener("mouseover", (e) => {
						if (!link.hasClass("external-link")) return;

						if (!link.href || !link.href.trim().startsWith("http"))
							return;

						this.app.workspace.trigger("hover-link", {
							event: e,
							source: "preview",
							// Ideally, the hoverParent should be `view.previewMode` in Reading View,
							// but we don't have access to the view instance here.
							hoverParent: ctx,
							targetEl: link,
							linktext: link.href.trim(),
						});
					});
				});
			},
		);

		this.app.workspace.onLayoutReady(() => {
			const pagePreview =
				this.app.internalPlugins.plugins["page-preview"];
			const self = this;
			this.register(
				around(pagePreview.instance, {
					onLinkHover(old: any) {
						return function (
							hoverParent: HoverParent,
							targetEl: HTMLElement | null,
							linktext: string,
							sourcePath: string,
							state: any,
							...args: any[]
						) {
							if (
								linktext.startsWith("http://") ||
								linktext.startsWith("https://")
							) {
								let { hoverPopover } = hoverParent;
								if (
									hoverPopover &&
									hoverPopover.state !==
										(PopoverState as any).Hidden &&
									hoverPopover.targetEl === targetEl
								) {
									return;
								}
								hoverPopover = new HoverPopover(
									hoverParent,
									targetEl,
								);
								hoverPopover.hoverEl.addClass(
									"surfing-hover-popover",
								);

								setTimeout(() => {
									if (
										// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
										hoverPopover!.state !==
										(PopoverState as any).Hidden
									) {
										const parentEl =
											// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
											hoverPopover!.hoverEl.createDiv(
												"surfing-hover-popover-container",
											);
										const webView = new PopoverWebView(
											parentEl,
											linktext,
											self,
										);
										webView.onload();
									}
								}, 100);
								return;
							}

							return old.call(
								this,
								hoverParent,
								targetEl,
								linktext,
								sourcePath,
								state,
								...args,
							);
						};
					},
				}),
			);

			// Re-register the 'hover-link' & 'link-hover' workspace events handlers
			if (!pagePreview.enabled) return;
			pagePreview.disable();
			pagePreview.enable();

			this.register(() => {
				if (!pagePreview.enabled) return;
				pagePreview.disable();
				pagePreview.enable();
			});
		});
	}

	private checkWebBrowser() {
		const webBrowser = this.app.plugins.getPlugin("obsidian-web-browser");
		if (webBrowser)
			new Notice(
				t(
					"You enabled obsidian-web-browser plugin, please disable it/disable surfing to avoid conflict.",
				),
				4000,
			);
		const tabHeader = this.app.vault.getConfig("showViewHeader");
		if (!tabHeader)
			new Notice(
				t(
					"You didn't enable show tab title bar in apperance settings, please enable it to use surfing happily.",
				),
				4000,
			);
	}

	// TODO: Licat said that this method will be changed in the future.
	private patchMarkdownView() {
		const self = this;
		this.register(
			around(MarkdownView.prototype, {
				triggerClickableToken: (next) =>
					function (
						token: tokenType,
						newLeaf: boolean | string,
						...args: any
					) {
						if (token.type === "external-link") {
							if (newLeaf === "tab" || newLeaf === "window") {
								window.open(token.text, "_blank", "external");
								return;
							}
							const url =
								token.text !== decodeURI(token.text)
									? decodeURI(token.text)
									: token.text;
							if (checkIfWebBrowserAvailable(url)) {
								SurfingView.spawnWebBrowserView(self, true, {
									url: url,
								});
							} else {
								window.open(url, "_blank", "external");
							}
							return;
						}
						return next.call(this, token, newLeaf, ...args);
					},
			}),
		);
	}

	private patchEditMode() {
		const patchLivePreivewView = async (plugin: SurfingPlugin) => {
			const leaf = plugin.app.workspace.getLeavesOfType("markdown")[0];
			const view = leaf?.view;
			if (requireApiVersion("1.7.3") && leaf?.isDeferred) {
				await leaf.loadIfDeferred();
			}

			if (!leaf) return false;
			if (!view) return false;

			const editMode = view.editMode ?? view.sourceMode;

			if (!editMode) {
				console.error(
					"Failed to patch external link: no edit view found",
				);
				return false;
			}

			const MarkdownEditView = editMode.constructor;
			this.register(
				around(MarkdownEditView.prototype, {
					triggerClickableToken: (next) =>
						function (
							token: tokenType,
							newLeaf: boolean | string,
							...args: any
						) {
							if (token.type === "external-link") {
								if (newLeaf === "tab" || newLeaf === "window") {
									window.open(
										token.text,
										"_blank",
										"external",
									);
									return;
								}
								const url =
									token.text !== decodeURI(token.text)
										? decodeURI(token.text)
										: token.text;
								if (checkIfWebBrowserAvailable(url)) {
									SurfingView.spawnWebBrowserView(
										plugin,
										true,
										{
											url: url,
										},
									);
								} else {
									window.open(url, "_blank", "external");
								}
								return;
							}
							return next.call(this, token, newLeaf, ...args);
						},
				}),
			);
			console.log("Obsidian-Surfing: editmode external link patched");
			return true;
		};
		this.app.workspace.onLayoutReady(async () => {
			if (!(await patchLivePreivewView(this))) {
				const evt = this.app.workspace.on("layout-change", async () => {
					(await patchLivePreivewView(this)) &&
						this.app.workspace.offref(evt);
				});
				this.registerEvent(evt);
			}
		});
	}

	private patchWindowOpen() {
		const self = this;

		const preventSameUrl = () => {
			clearTimeout(this.applyURLDebounceTimer);
			this.urlOpened = true;
			this.applyURLDebounceTimer = window.setTimeout(() => {
				this.urlOpened = false;
			}, 300);
		};

		const currentUrlOpened = () => {
			return this.urlOpened;
		};

		// Use monkey-around to match current need.
		// @ts-ignore
		const uninstaller = around(window, {
			open: (next) =>
				function (
					url?: string | URL | undefined,
					target?: string | undefined,
					features?: string | undefined,
				) {
					let urlString = "";
					if (typeof url === "string") {
						urlString = url;
					} else if (url instanceof URL) {
						urlString = url.toString();
					}

					if (decodeURI(urlString) !== urlString)
						urlString = decodeURI(urlString)
							.toString()
							.replace(/\s/g, "%20");

					// 2. Perform default behavior if the url isn't "http://" or "https://"
					// No need anymore
					if (
						(urlString === "about:blank" && features) ||
						!checkIfWebBrowserAvailable(urlString) ||
						(urlString !== "about:blank" &&
							(target === "_blank" || target === "_self")) ||
						features === "external"
					) {
						return next(url, target, features);
					}

					if (
						urlString &&
						!target &&
						!features &&
						!currentUrlOpened()
					) {
						console.log(
							"Obsidian-Surfing: open url in web browser view",
						);
						SurfingView.spawnWebBrowserView(self, true, {
							url: urlString,
						});

						preventSameUrl();
					}

					return null;

					// // TODO: Open external link in current leaf when meta key isn't being held down.
					// SurfingView.spawnWebBrowserView(true, { url: urlString });
					// return null;
				},
		});
		this.register(uninstaller);
	}

	private patchMarkdownPreviewRenderer() {
		const self = this;
		const preventSameUrl = () => {
			clearTimeout(this.applyURLDebounceTimer);
			this.urlOpened = true;
			this.applyURLDebounceTimer = window.setTimeout(() => {
				this.urlOpened = false;
			}, 300);
		};

		const currentUrlOpened = () => {
			return this.urlOpened;
		};

		const uninstaller = around(
			MarkdownPreviewRenderer as MarkdownPreviewRendererStatic,
			{
				// @ts-ignore
				registerDomEvents: (next) =>
					function (
						el: HTMLElement,
						instance: { getFile?(): TFile },
						...args: unknown[]
					) {
						el?.on(
							"click",
							".external-link",
							(event: MouseEvent, targetEl: HTMLElement) => {
								event.preventDefault();

								if (targetEl) {
									const url = targetEl.getAttribute("href");
									if (url) {
										if (event.ctrlKey || event.metaKey) {
											window.open(
												url,
												"_blank",
												"external",
											);

											preventSameUrl();
											return;
										}

										if (
											checkIfWebBrowserAvailable(url) &&
											!currentUrlOpened()
										) {
											SurfingView.spawnWebBrowserView(
												self,
												true,
												{ url: url },
											);

											preventSameUrl();
										} else {
											window.open(
												url,
												"_blank",
												"external",
											);
										}
										return;
									}
								}
							},
						);

						return next.call(this, el, instance, ...args);
					},
			},
		);
		this.register(uninstaller);
	}

	private patchProperty() {
		if (!requireApiVersion("1.4.0")) return;
		const patchTextPropertyInList = (plugin: SurfingPlugin) => {
			const editor = plugin.app.workspace.activeEditor;
			// @ts-ignore
			const propertyList = editor?.metadataEditor?.rendered.filter(
				(property: any) => property.entry.type === "text",
			);

			if (!propertyList?.length) return false;

			const property = propertyList[0];
			if (!property) return false;

			const renderer = property.rendered;

			if (!renderer?.constructor) return false;

			this.register(
				around(renderer.constructor.prototype, {
					render: (next: any) =>
						async function (this: any, ...args: any) {
							next.apply(this, ...args);

							const linkEl = this.linkTextEl;
							const clonedLinkEl = linkEl.cloneNode(true);
							linkEl.parentNode?.replaceChild(
								clonedLinkEl,
								linkEl,
							);

							clonedLinkEl.onclick = (e: MouseEvent) => {
								if (e.button !== 0 && e.button !== 1) return;
								e.preventDefault();

								if (this.isWikilink()) {
									this.ctx.app.workspace.openLinkText(
										this.getLinkText(),
										this.ctx.sourcePath,
										Keymap.isModEvent(e),
										{
											active: true,
										},
									);
								} else if (isNormalLink(this.value)) {
									if (Keymap.isModEvent(e)) {
										window.open(this.value, "_blank");
										return;
									}
									SurfingView.spawnWebBrowserView(
										plugin,
										true,
										{
											url: this.value,
										},
									);
									return;
								} else if (isEmailLink(this.value)) {
									window.open(
										"mailto:" + this.value,
										"_blank",
									);
								}
							};

							clonedLinkEl.oncontextmenu = (e: MouseEvent) => {
								e.preventDefault();

								// 创建一个新的 DD 实例并添加不同的部分
								const menu = new Menu().addSections([
									"title",
									"correction",
									"spellcheck",
									"open",
									"selection",
									"clipboard",
									"action",
									"view",
									"info",
									"",
									"danger",
								]);

								// 检查当前元素是否是 Wikilink
								if (this.isWikilink()) {
									e.preventDefault();
									this.ctx.app.workspace.handleLinkContextMenu(
										menu,
										this.getLinkText(),
										this.ctx.sourcePath,
									);
								}
								// 检查当前元素的值是否是普通链接
								else if (isNormalLink(this.value)) {
									e.preventDefault();
									this.ctx.app.workspace.handleExternalLinkContextMenu(
										menu,
										this.value,
									);
								}
								// 检查当前元素的值是否是电子邮件链接
								else if (isEmailLink(this.value)) {
									e.preventDefault();
									this.ctx.app.workspace.handleExternalLinkContextMenu(
										menu,
										"mailto:" + this.value,
									);
								}

								// 在鼠标事件的位置显示菜单
								menu.showAtMouseEvent(e);
							};
						},
				}),
			);
			// @ts-ignore
			editor?.leaf?.rebuildView();
			console.log("Surfing: metadata editor get patched");
			return true;
		};
		this.app.workspace.onLayoutReady(() => {
			if (!patchTextPropertyInList(this)) {
				const evt = this.app.workspace.on("layout-change", () => {
					patchTextPropertyInList(this) &&
						this.app.workspace.offref(evt);
				});
				this.registerEvent(evt);
			}
		});
	}

	private patchEmptyView() {
		const patchEmptyView = () => {
			const leaf = this.app.workspace.getLeavesOfType("empty").first();
			const view = leaf?.view;
			// eslint-disable-next-line @typescript-eslint/no-this-alias
			const self = this;

			if (!view) return false;

			const EmptyView = view.constructor;
			this.register(
				around(EmptyView.prototype, {
					onOpen: (next) =>
						function (...args: any) {
							const pluginSetting =
								self.app.plugins.getPlugin("surfing").settings;
							if (
								!this.contentEl.querySelector(
									".wb-bookmark-bar",
								) &&
								pluginSetting.bookmarkManager.openBookMark
							) {
								this.contentEl.classList.add(
									"mod-wb-bookmark-bar",
								);
								new BookMarkBar(this, this.plugin).onload();
							}
							if (
								!this.contentEl.querySelector(
									".surfing-settings-icon",
								)
							) {
								const iconEl = this.contentEl.createDiv({
									cls: "surfing-settings-icon",
								});
								iconEl.addEventListener("click", () => {
									//@ts-expect-error, private method
									self.app.setting.open();
									//@ts-expect-error, private method
									self.app.setting.openTabById("surfing");
								});
								setIcon(iconEl, "settings");
							}
							return next.call(this, ...args);
						},
				}),
			);
			// Rebuild view after patch successfully;
			leaf?.rebuildView();
			console.log("Obsidian-Surfing: empty view patched");
			return true;
		};
		this.app.workspace.onLayoutReady(() => {
			if (!patchEmptyView()) {
				const evt = this.app.workspace.on("layout-change", () => {
					patchEmptyView() && this.app.workspace.offref(evt);
				});
				this.registerEvent(evt);
			}
		});

		// Dirty workaround to prevent webview cause Obsidian crashed
	}

	// Used for patching Obsidian canvas before its api released.
	private patchCanvasNode() {
		const patchUrlNode = (plugin: SurfingPlugin) => {
			const canvasView = plugin.app.workspace
				.getLeavesOfType("canvas")
				.first()?.view;
			// eslint-disable-next-line @typescript-eslint/no-this-alias
			const self = this;

			if (!canvasView) return false;
			const findNode = (map: any) => {
				for (const [, value] of map) {
					if (value.url !== undefined) {
						return value;
					}
				}
				return false;
			};

			const tempNode = findNode(canvasView.canvas.nodes);
			if (!tempNode) return false;

			const uninstaller = around(tempNode?.constructor.prototype, {
				render(next) {
					return function () {
						next.call(this);

						// TODO: Move this with surfing view's constructor to prevent multiple htmlelement
						if (this.canvas.isDragging) return;

						new InNodeWebView(
							this,
							self,
							"canvas",
							this?.canvas,
						).onload();
					};
				},
			});
			this.register(uninstaller);

			tempNode.render();
			console.log("Obsidian-Surfing: canvas view url node patched");
			return true;
		};

		this.app.workspace.onLayoutReady(() => {
			if (!patchUrlNode(this)) {
				const evt = this.app.workspace.on("layout-change", () => {
					patchUrlNode(this) && this.app.workspace.offref(evt);
				});
				this.registerEvent(evt);
			}
		});
	}

	// Used for patching Obsidian canvas before its api released.
	private patchCanvas() {
		const patchCanvasSelect = (plugin: SurfingPlugin) => {
			const canvasView = plugin.app.workspace
				.getLeavesOfType("canvas")
				.first()?.view;
			if (!canvasView) return false;

			const patchCanvasView = canvasView.canvas.constructor;
			const uninstaller = around(patchCanvasView.prototype, {
				selectOnly: (next) =>
					function (e: any) {
						next.call(this, e);
						if (!e.contentEl) return;
						if (
							e.url !== undefined &&
							!e.contentEl.classList.contains("wb-view-content")
						) {
							setTimeout(() => {
								e.render();
							}, 0);
						}
					},
			});
			this.register(uninstaller);

			console.log("Obsidian-Surfing: canvas view patched");
			return true;
		};

		this.app.workspace.onLayoutReady(() => {
			if (!patchCanvasSelect(this)) {
				const evt = this.app.workspace.on("layout-change", () => {
					patchCanvasSelect(this) && this.app.workspace.offref(evt);
				});
				this.registerEvent(evt);
			}
		});
	}

	private refreshAllRelatedView() {
		for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
			if (leaf) leaf.rebuildView();
		}
	}

	private registerEmbededHTML() {
		const self = this;
		// @ts-expect-error
		this.app.embedRegistry.registerExtension("html", (e, t, n) => {
			return new EmbededWebView(e, t, self.app, self);
		});
		// @ts-expect-error
		this.app.embedRegistry.registerExtension("htm", (e, t, n) => {
			return new EmbededWebView(e, t, self.app, self);
		});
	}

	unRegisterEmbededHTML() {
		// @ts-expect-error
		this.app.embedRegistry.unregisterExtension("html");
		// @ts-expect-error
		this.app.embedRegistry.unregisterExtension("htm");
	}

	async loadSettings() {
		const saved = (await this.loadData()) || {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		// Deep-merge nested objects so new default keys aren't lost
		this.settings.aiAssistant = Object.assign(
			{},
			DEFAULT_SETTINGS.aiAssistant,
			saved.aiAssistant,
		);
		this.settings.adBlock = Object.assign(
			{},
			DEFAULT_SETTINGS.adBlock,
			saved.adBlock,
		);
		this.settings.bookmarkManager = Object.assign(
			{},
			DEFAULT_SETTINGS.bookmarkManager,
			saved.bookmarkManager,
		);
		this.settings.elementHiding = Object.assign(
			{},
			DEFAULT_SETTINGS.elementHiding,
			saved.elementHiding,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SaveBookmarkModal extends Modal {
	private url: string;
	private plugin: SurfingPlugin;

	constructor(app: App, url: string, plugin: SurfingPlugin) {
		super(app);

		this.url = url;
		this.app = app;
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.parentElement?.classList.add("wb-bookmark-modal");

		contentEl.createEl("h2", { text: "Save Bookmark" });

		const btnContainerEl = contentEl.createDiv({
			cls: "wb-bookmark-modal-btn-container",
		});

		const saveBtnEl = btnContainerEl.createEl("button", { text: "Save" });
		saveBtnEl.onclick = async () => {
			this.close();
			const urlData = await nonElectronGetPageTitle(this.url);

			const category =
				this.plugin.settings.bookmarkManager.defaultCategory || "ROOT";

			await createBookmarkFile(this.plugin, {
				url: this.url,
				name: urlData?.title || "Untitled",
				description: urlData?.description || "",
				tags: [],
				category: [category],
			});

			new Notice("Bookmark saved.");
		};

		const openBtnEl = btnContainerEl.createEl("button", { text: "Open" });
		openBtnEl.onclick = () => {
			this.close();

			SurfingView.spawnWebBrowserView(this.plugin, true, {
				url: this.url,
			});
		};
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
