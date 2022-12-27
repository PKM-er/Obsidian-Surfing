import {
	addIcon,
	Editor,
	EventRef,
	ItemView,
	MarkdownPreviewRenderer,
	MarkdownPreviewRendererStatic,
	MarkdownView,
	Menu,
	Notice,
	Plugin, requireApiVersion,
	setIcon,
	TFile,
} from "obsidian";
import { HeaderBar } from "./component/HeaderBar";
import { SurfingView, WEB_BROWSER_VIEW_ID } from "./surfingView";
import { HTML_FILE_EXTENSIONS, SurfingFileView, WEB_BROWSER_FILE_VIEW_ID } from "./surfingFileView";
import { t } from "./translations/helper";
import { around } from "monkey-around";
import { DEFAULT_SETTINGS, SEARCH_ENGINES, SurfingSettings, SurfingSettingTab } from "./surfingPluginSetting";
import { InPageSearchBar } from "./component/inPageSearchBar";
import { tokenType } from "./types/obsidian";
import { checkIfWebBrowserAvailable } from "./utils/url";
import { InPageIconList } from "./component/InPageIconList";
import { InNodeWebView } from "./component/InNodeWebView";
import { BookMarkBar } from "./component/BookMarkBar/BookMarkBar";
import { SurfingBookmarkManagerView, WEB_BROWSER_BOOKMARK_MANAGER_ID } from './surfingBookmarkManager'
import { EmbededWebView } from "./component/EmbededWebView";


export default class SurfingPlugin extends Plugin {
	settings: SurfingSettings;
	private onLayoutChangeEventRef: EventRef;

	async onload() {
		await this.loadSettings();
		this.checkWebBrowser();

		this.addSettingTab(new SurfingSettingTab(this.app, this));

		this.registerView(WEB_BROWSER_VIEW_ID, (leaf) => new SurfingView(leaf, this));
		this.registerView(WEB_BROWSER_FILE_VIEW_ID, (leaf) => new SurfingFileView(leaf));
		if (this.settings.bookmarkManager.openBookMark) this.registerView(WEB_BROWSER_BOOKMARK_MANAGER_ID, (leaf) => new SurfingBookmarkManagerView(leaf, this));

		try {
			this.registerExtensions(HTML_FILE_EXTENSIONS, WEB_BROWSER_FILE_VIEW_ID);
		} catch (error) {
			new Notice(`File extensions ${ HTML_FILE_EXTENSIONS } had been registered by other plugin!`);
		}

		this.updateEmptyLeaves(false);
		this.registerContextMenu();
		this.registerCustomURI();

		this.patchMarkdownView();
		this.patchWindowOpen();
		this.patchMarkdownView();
		if (requireApiVersion("1.0.4")) this.patchEditMode()

		this.onLayoutChangeEventRef = this.app.workspace.on("layout-change", () => {
			const activeView = this.app.workspace.getActiveViewOfType(ItemView);
			if (activeView) this.addHeaderAndSearchBar(activeView);
		});

		this.registerCommands();
		this.registerCustomIcon();
		this.patchEmptyView();
		this.patchMarkdownPreviewRenderer();
		if (requireApiVersion("1.1.0") && this.settings.useWebview) {
			this.patchCanvasNode();
			this.patchCanvas();
			this.registerEmbededHTML();
		}
		if (this.settings.bookmarkManager.openBookMark) {
			this.registerRibbon();
		}
	}


	onunload() {
		this.app.workspace.detachLeavesOfType(WEB_BROWSER_VIEW_ID);
		this.app.workspace.offref(this.onLayoutChangeEventRef);

		// Clean up header bar added to "New tab" views when plugin is disabled.
		// Using Obsidian getViewType
		this.updateEmptyLeaves(true);

		// Refresh all Canvas to make sure they don't contain webview anymore.
		if (requireApiVersion("1.1.0") && this.settings.useWebview) {
			this.refreshAllRelatedView();
			this.unRegisterEmbededHTML();
		}
	}

	private registerRibbon() {
		this.addRibbonIcon('bookmark', WEB_BROWSER_BOOKMARK_MANAGER_ID, async () => {
			const workspace = this.app.workspace
			workspace.detachLeavesOfType(WEB_BROWSER_BOOKMARK_MANAGER_ID)
			await workspace.getLeaf(false).setViewState({ type: WEB_BROWSER_BOOKMARK_MANAGER_ID })
			workspace.revealLeaf(workspace.getLeavesOfType(WEB_BROWSER_BOOKMARK_MANAGER_ID)[0])
		})
	}

	// Add header bar to empty view.
	private addHeaderAndSearchBar(currentView: ItemView) {
		if (!currentView) return;
		// Check if new leaf's view is empty, else return.
		if (currentView.getViewType() != "empty") return;
		// Check if the "New tab" view has already been processed and has a header bar already.
		if (!currentView.headerEl.children[2].hasClass("web-browser-header-bar")) {
			const headerBar = new HeaderBar(currentView.headerEl.children[2], this);
			// Focus on current inputEl
			if (!this.settings.showSearchBarInPage) headerBar.focus();
			headerBar.addOnSearchBarEnterListener((url: string) => {
				SurfingView.spawnWebBrowserView(false, { url });
			});
		}

		const emptyStateEl = (currentView.contentEl.children[0] as HTMLElement).hasClass("empty-state") ? currentView.contentEl.children[0] as HTMLElement : null;
		if (!emptyStateEl) return;
		if (!emptyStateEl.hasClass("wb-page-search-bar") && this.settings.showSearchBarInPage) {
			const inPageContainerEl = emptyStateEl.createEl('div', {
				cls: "wb-search-bar-container"
			});
			emptyStateEl?.addClass("wb-page-search-bar");

			const inPageSearchBar = new InPageSearchBar(inPageContainerEl, this);
			if (this.settings.useIconList) {
				new InPageIconList(emptyStateEl, currentView, this);
				const emptyActionsEl = emptyStateEl.querySelector(".empty-state-container");

				if (emptyActionsEl) emptyActionsEl.addClass("wb-empty-actions");
			}


			inPageSearchBar.focus();
			inPageSearchBar.addOnSearchBarEnterListener((url: string) => {
				if (/^\s{0,}$/.test(url) || this.settings.showOtherSearchEngines) return;
				SurfingView.spawnWebBrowserView(false, { url });
			});
		}
	}

	// Clean up header bar added to empty views when plugin is disabled.
	private removeHeaderAndSearchBar(currentView: ItemView) {
		if (!currentView) return;

		// Check if new leaf's view is empty, else return.
		if (currentView.getViewType() != "empty") return;

		// Check if the "New tab" view has already been processed and has a header bar already.
		if (currentView.headerEl.children[2].hasClass("wb-header-bar")) {
			currentView.headerEl.children[2].empty();
			currentView.headerEl.children[2].removeClass("wb-header-bar");
		}

		// Remove in page search bar
		if (currentView.contentEl.children[0].hasClass("wb-page-search-bar") && this.settings.showSearchBarInPage) {
			currentView.contentEl.children[0].children[1]?.detach();
			currentView.contentEl.children[0].children[1]?.empty();
			currentView.contentEl.children[0].children[1]?.detach();
			currentView.contentEl.children[0].removeClass("wb-page-search-bar");
		}

		// Remove config icon
		if (currentView.contentEl.children[1]?.hasClass("surfing-settings-icon")) {
			currentView.contentEl.children[1]?.detach();
		}
	}

	// Update all leaf contains empty view when restart Obsidian
	private updateEmptyLeaves(removeHeader?: boolean) {
		const emptyLeaves = this.app.workspace.getLeavesOfType("empty");
		emptyLeaves.forEach((leaf) => {
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
			if (decodeURI(url) !== url) url = decodeURI(url).toString().replace(/\s/g, "%20");

			SurfingView.spawnWebBrowserView(true, { url: url });
		});
	}

	// Register right click menu on editor
	private registerContextMenu() {
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, view: MarkdownView) => {
				if (!editor) {
					return;
				}
				if (editor.getSelection().length === 0) {
					const token = editor.getClickableTokenAt(editor.getCursor());
					if (token && token.type === "external-link") {
						menu.addItem((item) => {
							item.setIcon('surfing')
								.setTitle(t('Open With Surfing'))
								.onClick(() => {
									// @ts-ignore
									SurfingView.spawnWebBrowserView(true, { url: token.text });
								})
						}).addItem((item) => {
							item.setIcon('surfing')
								.setTitle(t('Open With External Browser'))
								.onClick(() => {
									// @ts-ignore
									window.open(token.text, '_blank', 'external')
								})
						})
					}

					return;
				}
				const selection = editor.getSelection();

				menu.addItem((item) => {
					// Add sub menu
					const searchEngines = [...SEARCH_ENGINES, ...this.settings.customSearchEngine];
					const subMenu = item.setTitle(`Search In Surfing`).setIcon('search').setSubmenu();
					searchEngines.forEach((engine) => {
						subMenu.addItem((item) => {
							item.setIcon('search')
								.setTitle(engine.name)
								.onClick(() => {
									// @ts-ignore
									SurfingView.spawnWebBrowserView(true, { url: engine.url + selection });
								})
						})
					})
				})
			}))
	}

	private registerCommands() {
		// Use checkCallback method to check if the view is WebBrowserView;
		// And change the default private to public.
		this.addCommand({
			id: 'open-current-url-with-external-browser',
			name: t('Open Current URL In External Browser'),
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const webbrowserView = this.app.workspace.getActiveViewOfType(SurfingView);
				if (webbrowserView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						window.open(webbrowserView.getState()?.url, "_blank");
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// Use checkCallback method to check if the view is WebBrowserView;
		// And change the default private to public.
		this.addCommand({
			id: 'clear-current-page-history',
			name: t('Clear Current Page History'),
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const webbrowserView = this.app.workspace.getActiveViewOfType(SurfingView);
				if (webbrowserView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						webbrowserView.clearHistory();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// Use checkCallback method to check if the view is WebBrowserView;
		// And change the default private to public.
		this.addCommand({
			id: 'refresh-page',
			name: t('Refresh Current Page'),
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const webbrowserView = this.app.workspace.getActiveViewOfType(SurfingView);
				if (webbrowserView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						webbrowserView.refresh();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		this.addCommand({
			id: 'toggle-same-tab-globally',
			name: t('Toggle Same Tab In Web Browser'),
			callback: async () => {
				this.settings.openInSameTab = !this.settings.openInSameTab;
				await this.saveSettings()
			}
		});


		this.addCommand({
			id: 'get-current-timestamp',
			name: t('Get Current Timestamp from Web Browser'),
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const lastActiveLeaves = this.app.workspace.getLeavesOfType("surfing-view");
				if (lastActiveLeaves.length === 0) return;

				const lastActiveLeaf = lastActiveLeaves.sort((a, b) => b.activeTime - a.activeTime)[0];

				const webbrowserView = lastActiveLeaf.view as SurfingView;
				const url = webbrowserView.getState()?.url;
				if (!url?.contains("bilibili")) return;

				webbrowserView.getCurrentTimestamp(editor);
			}
		});

		this.addCommand({
			id: 'search-in-current-page-title-bar',
			name: t('Search In Current Page Title Bar'),
			callback: () => {
				const currentView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!currentView) return;
				if (currentView.headerEl.childNodes.length > 4) return;
				const searchBarEl = new HeaderBar(currentView.headerEl, this, false);
				searchBarEl.addOnSearchBarEnterListener((url: string) => {
					SurfingView.spawnWebBrowserView(false, { url });
				});
				searchBarEl.focus();
			}
		});

		const searchEngines = [...SEARCH_ENGINES, ...this.settings.customSearchEngine]
		searchEngines.forEach((engine) => {
			this.addCommand({
				id: 'using' + engine.name.replace(/\s/g, '-') + '-to-search',
				name: t('Using ') + engine.name + t(' to search'),
				editorCallback: (editor: Editor, view: MarkdownView) => {
					if (editor.getSelection().length === 0) return;
					const selection = editor.getSelection();

					// @ts-ignore
					SurfingView.spawnWebBrowserView(true, { url: engine.url + selection });
				}
			});
		})

		this.addCommand({
			id: 'toggle-dark-mode',
			name: t('Toggle Dark Mode'),
			callback: async () => {
				this.settings.darkMode = !this.settings.darkMode;
				await this.saveSettings()
				const webbrowserView = this.app.workspace.getActiveViewOfType(SurfingView);
				if (webbrowserView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					webbrowserView.refresh();

				}
			}
		})

	}

	private registerCustomIcon() {
		addIcon('surfing', `<svg t="1669432317981" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1590" data-darkreader-inline-fill="" width="100" height="100"><path d="M330.926 1023.978c-11.78 0-21.328-9.562-21.328-21.344v-42.652c0-11.782 9.546-21.344 21.328-21.344s21.342 9.562 21.342 21.344v42.652c0 11.782-9.56 21.344-21.342 21.344z" fill="#EAAD7A" p-id="1591" data-darkreader-inline-fill="" style="--darkreader-inline-fill:#e2a36a;"></path><path d="M650.892 273.08C624.644 115.932 579.958 16.656 578.052 12.532a21.332 21.332 0 0 0-25.904-11.5c-1.406 0.468-35.186 11.28-70.262 24.842-20.936 8.062-37.998 15.466-50.7 21.936-22.046 11.25-32.014 20.092-35.358 31.404-2.578 7.188-24.764 54.842-48.232 105.246-39.138 84.088-92.746 199.27-136.086 298.016-23.796 54.248-41.92 97.714-53.84 129.212-21.952 57.998-20.89 69.652-17.204 78.872 4.172 10.466 13.282 21.842 82.808 55.342 36.28 17.466 85.76 39.278 147.07 64.902 104.088 43.464 207.894 83.372 208.926 83.746 2.468 0.968 5.062 1.438 7.656 1.438 3.124 0 6.218-0.688 9.124-2.062a21.284 21.284 0 0 0 11.124-12.532c35.308-106.152 55.808-217.832 60.84-331.952 4.034-91.246-1.716-184.21-17.122-276.362z" fill="#ED5564" p-id="1592" data-darkreader-inline-fill="" style="--darkreader-inline-fill:#cc5b60;"></path><path d="M650.892 273.08C624.644 115.932 579.958 16.656 578.052 12.532a21.332 21.332 0 0 0-25.904-11.5c-0.656 0.218-8.31 2.686-19.842 6.592a21.938 21.938 0 0 1 3.094 4.906c1.89 4.124 46.59 103.4 72.84 260.548 15.376 92.152 21.154 185.116 17.124 276.362-5.06 114.12-25.53 225.798-60.872 331.952a21.216 21.216 0 0 1-3.282 6.156c11.28 4.406 17.81 6.906 18.06 7 2.468 0.968 5.062 1.438 7.656 1.438 3.124 0 6.218-0.688 9.124-2.062a21.284 21.284 0 0 0 11.124-12.532c35.308-106.152 55.808-217.832 60.84-331.952 4.034-91.244-1.716-184.208-17.122-276.36z" fill="#FFFFFF" opacity=".2" p-id="1593" data-darkreader-inline-fill="" style="--darkreader-inline-fill:#ebe3d5;"></path><path d="M181.622 874.642c0 2.468 0.406 4.938 1.266 7.282 0.954 2.624 9.89 26.124 32.092 49.934 21.014 22.562 58.2 49.436 115.948 49.436h383.996c128.744 0 186.428-91.588 188.834-95.494a21.314 21.314 0 0 0 3.156-11.156H181.622z" fill="#F4BE8E" p-id="1594" data-darkreader-inline-fill="" style="--darkreader-inline-fill:#ecb177;"></path><path d="M685.924 584.064c-6.782-2.25-13.532-3.876-19.562-5.062a1292.052 1292.052 0 0 1-3.656 42.81c12.844 3.032 24.876 7.936 29.188 13.686-7.25 3.718-26.344 10.906-73.402 17.844-42.218 6.218-97.95 11-161.196 13.75-122.15 5.342-251.97 2.376-315.686-7.218-11.656-1.782-22.514 6.25-24.28 17.904-1.75 11.656 6.264 22.53 17.92 24.28 44.826 6.75 118.102 10.376 199.598 10.376 39.28 0 80.496-0.844 121.336-2.594 64.154-2.718 121.274-7.5 165.118-13.78 71.778-10.312 92.806-22.438 102.368-30.686 10.406-8.938 12.594-18.75 12.594-25.376 0-14.688-6.562-41.466-50.34-55.934z" fill="#434A54" p-id="1595" data-darkreader-inline-fill="" style="--darkreader-inline-fill:#555755;"></path></svg>`)
	}

	private checkWebBrowser() {
		const webBrowser = app.plugins.getPlugin("obsidian-web-browser")
		if (webBrowser) new Notice(t("You enabled obsidian-web-browser plugin, please disable it/disable surfing to avoid conflict."), 4000);
		const tabHeader = app.vault.getConfig("showViewHeader")
		if (!tabHeader) new Notice(t("You didn't enable show tab title bar in apperance settings, please enable it to use surfing happily."), 4000);
	}

	// TODO: Licat said that this method will be changed in the future.
	private patchMarkdownView() {
		this.register(
			around(MarkdownView.prototype, {
				triggerClickableToken: (next) =>
					function (token: tokenType, newLeaf: boolean | string, ...args: any) {
						if (token.type === "external-link") {
							if (newLeaf === 'tab' || newLeaf === 'window') {
								window.open(token.text, '_blank', 'external');
								return;
							}
							const url = (token.text !== decodeURI(token.text)) ? decodeURI(token.text) : token.text;
							if (checkIfWebBrowserAvailable(url)) {
								SurfingView.spawnWebBrowserView(true, { url: url });
							} else {
								window.open(url, '_blank', 'external');
							}
							return;
						}
						return next.call(this, token, newLeaf, ...args);
					},
			}),
		);
	}

	private patchEditMode() {
		const patchLivePreivewView = () => {
			const view = app.workspace.getLeavesOfType("markdown").first()?.view;
			if (!view) return false;
			const editMode = view.editMode ?? view.sourceMode;

			if (!editMode)
				throw new Error(
					"Failed to patch external link: no edit view found"
				);

			const MarkdownEditView = editMode.constructor;
			this.register(
				around(MarkdownEditView.prototype, {
					triggerClickableToken: (next) =>
						function (token: tokenType, newLeaf: boolean | string, ...args: any) {
							if (token.type === "external-link") {
								if (newLeaf === 'tab' || newLeaf === 'window') {
									window.open(token.text, '_blank', 'external');
									return;
								}
								const url = (token.text !== decodeURI(token.text)) ? decodeURI(token.text) : token.text;
								if (checkIfWebBrowserAvailable(url)) {
									SurfingView.spawnWebBrowserView(true, { url: url });
								} else {
									window.open(url, '_blank', 'external');
								}
								return;
							}
							return next.call(this, token, newLeaf, ...args);
						},
				})
			);
			console.log("Obsidian-Surfing: editmode external link patched");
			return true;
		};
		this.app.workspace.onLayoutReady(() => {
			if (!patchLivePreivewView()) {
				const evt = app.workspace.on("layout-change", () => {
					patchLivePreivewView() && app.workspace.offref(evt);
				});
				this.registerEvent(evt);
			}
		});
	}

	private patchWindowOpen() {
		// Use monkey-around to match current need.
		// @ts-ignore
		const uninstaller = around(window, {
			open: (next) =>
				function (url?: string | URL | undefined, target?: string | undefined, features?: string | undefined) {
					let urlString = "";
					if (typeof url === "string") {
						urlString = url;
					} else if (url instanceof URL) {
						urlString = url.toString();
					}

					if (decodeURI(urlString) !== urlString) urlString = decodeURI(urlString).toString().replace(/\s/g, "%20");

					// 2. Perform default behavior if the url isn't "http://" or "https://"
					// No need anymore
					if ((urlString === "about:blank" && features) || !checkIfWebBrowserAvailable(urlString) || (urlString !== "about:blank" && (target === "_blank" || target === "_self")) || features === 'external') {
						return next(url, target, features);
					}

					// if (urlString && !target && !features) {
					// 	console.log("Obsidian-Surfing: open url in web browser view");
					// 	SurfingView.spawnWebBrowserView(true, { url: urlString });
					// }

					return null;


					// // TODO: Open external link in current leaf when meta key isn't being held down.
					// SurfingView.spawnWebBrowserView(true, { url: urlString });
					// return null;
				}
		});
		this.register(uninstaller);
	}

	private patchMarkdownPreviewRenderer() {
		const uninstaller = around(MarkdownPreviewRenderer as MarkdownPreviewRendererStatic, {
			// @ts-ignore
			registerDomEvents: (next) =>
				function (el: HTMLElement, instance: { getFile?(): TFile; }, ...args: unknown[]) {
					el?.on("click", ".external-link", (event: MouseEvent, targetEl: HTMLElement) => {
						if (targetEl) {
							const url = targetEl.getAttribute("href");
							if (url) {
								if (event.ctrlKey) {
									window.open(url, '_blank', 'external');
									return;
								}
								if (checkIfWebBrowserAvailable(url)) {
									SurfingView.spawnWebBrowserView(true, { url: url });
								} else {
									window.open(url, '_blank', 'external');
								}
								return;
							}
						}
					});

					return next.call(this, el, instance, ...args);
				},
		});
		this.register(uninstaller);
	}

	private patchEmptyView() {
		const patchEmptyView = () => {
			const leaf = app.workspace.getLeavesOfType("empty").first();
			const view = leaf?.view;

			if (!view) return false;

			const EmptyView = view.constructor;
			this.register(
				around(EmptyView.prototype, {
					onOpen: (next) =>
						function (...args: any) {
							const pluginSetting = app.plugins.getPlugin("surfing").settings;
							if (!this.contentEl.querySelector(".wb-bookmark-bar") && pluginSetting.bookmarkManager.openBookMark) {
								this.contentEl.classList.add("mod-wb-bookmark-bar");
								new BookMarkBar(this, this.plugin).onload();
							}
							if (!this.contentEl.querySelector('.surfing-settings-icon')) {
								const iconEl = this.contentEl.createDiv({
									cls: 'surfing-settings-icon'
								})
								iconEl.addEventListener('click', () => {
									//@ts-expect-error, private method
									app.setting.open();
									//@ts-expect-error, private method
									app.setting.openTabById('surfing');
								})
								setIcon(iconEl, 'settings');
							}
							return next.call(this, ...args);
						},
				})
			);
			// Rebuild view after patch successfully;
			leaf?.rebuildView();
			console.log("Obsidian-Surfing: empty view patched");
			return true;
		};
		this.app.workspace.onLayoutReady(() => {
			if (!patchEmptyView()) {
				const evt = app.workspace.on("layout-change", () => {
					patchEmptyView() && app.workspace.offref(evt);
				});
				this.registerEvent(evt);
			}
		});

		// Dirty workaround to prevent webview cause Obsidian crashed

	}

	// Used for patching Obsidian canvas before its api released.
	private patchCanvasNode() {
		const patchUrlNode = () => {
			const canvasView = app.workspace.getLeavesOfType("canvas").first()?.view;

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

						new InNodeWebView(this, this?.canvas).onload();
					}
				},
			});
			this.register(uninstaller);

			tempNode.render();
			console.log("Obsidian-Surfing: canvas view url node patched");
			return true;
		}

		this.app.workspace.onLayoutReady(() => {
			if (!patchUrlNode()) {
				const evt = app.workspace.on("layout-change", () => {
					patchUrlNode() && app.workspace.offref(evt);
				});
				this.registerEvent(evt);
			}
		});
	}

	// Used for patching Obsidian canvas before its api released.
	private patchCanvas() {
		const patchCanvasSelect = () => {
			const canvasView = app.workspace.getLeavesOfType("canvas").first()?.view;
			if (!canvasView) return false;

			const patchCanvasView = canvasView.canvas.constructor;
			const uninstaller = around(patchCanvasView.prototype, {
				selectOnly: (next) =>
					function (e: any) {
						next.call(this, e);
						if (e.url !== undefined && !e.contentEl.classList.contains("wb-view-content")) {
							setTimeout(() => {
								e.render();
							}, 0);
						}
					},
			});
			this.register(uninstaller);

			console.log("Obsidian-Surfing: canvas view patched");
			return true;
		}

		this.app.workspace.onLayoutReady(() => {
			if (!patchCanvasSelect()) {
				const evt = app.workspace.on("layout-change", () => {
					patchCanvasSelect() && app.workspace.offref(evt);
				});
				this.registerEvent(evt);
			}
		});
	}

	private refreshAllRelatedView() {
		for (const leaf of app.workspace.getLeavesOfType("canvas")) {
			if (leaf) leaf.rebuildView();
		}
	}

	private registerEmbededHTML() {
		// @ts-expect-error
		app.embedRegistry.registerExtension("html", (e, t, n) => {
			return new EmbededWebView(e, t);
		});
		// @ts-expect-error
		app.embedRegistry.registerExtension("htm", (e, t, n) => {
			return new EmbededWebView(e, t);
		});
	}

	unRegisterEmbededHTML() {
		// @ts-expect-error
		app.embedRegistry.unregisterExtension("html");
		// @ts-expect-error
		app.embedRegistry.unregisterExtension("htm");
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
