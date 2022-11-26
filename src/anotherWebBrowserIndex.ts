import { Editor, EventRef, ItemView, MarkdownView, Menu, Notice, Plugin, } from "obsidian";
import { HeaderBar } from "./component/headerBar";
import { AnotherWebBrowserView, WEB_BROWSER_VIEW_ID } from "./web_browser_view";
import { AnotherWebBrowserFileView, HTML_FILE_EXTENSIONS, WEB_BROWSER_FILE_VIEW_ID } from "./web_browser_file_view";
import { t } from "./translations/helper";
import { around } from "monkey-around";
import {
	AnotherWebBrowserPluginSettings,
	DEFAULT_SETTINGS,
	SEARCH_ENGINES,
	WebBrowserSettingTab
} from "./anotherWebBrowserSetting";
import { InPageSearchBar } from "./component/inPageSearchBar";

export default class AnotherWebBrowserPlugin extends Plugin {
	settings: AnotherWebBrowserPluginSettings;
	private onLayoutChangeEventRef: EventRef;

	async onload() {
		await this.loadSettings();
		this.checkWebBrowser();

		this.addSettingTab(new WebBrowserSettingTab(this.app, this));

		this.registerView(WEB_BROWSER_VIEW_ID, (leaf) => new AnotherWebBrowserView(leaf, this));
		this.registerView(WEB_BROWSER_FILE_VIEW_ID, (leaf) => new AnotherWebBrowserFileView(leaf));

		try {
			this.registerExtensions(HTML_FILE_EXTENSIONS, WEB_BROWSER_FILE_VIEW_ID);
		} catch (error) {
			new Notice(`File extensions ${ HTML_FILE_EXTENSIONS } had been registered by other plugin!`);
		}

		this.updateEmptyLeaves(false);
		this.registerContextMenu();
		this.registerCustomURI();
		// this.dispatchMarkdownView();
		this.dispatchWindowOpen();

		this.onLayoutChangeEventRef = this.app.workspace.on("layout-change", () => {
			const activeView = this.app.workspace.getActiveViewOfType(ItemView);
			if (activeView) this.addHeaderAndSearchBar(activeView);
		});

		this.registerCommands();
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(WEB_BROWSER_VIEW_ID);
		this.app.workspace.offref(this.onLayoutChangeEventRef);

		// Clean up header bar added to "New tab" views when plugin is disabled.
		// Using Obsidian getViewType
		this.updateEmptyLeaves(true);
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
				AnotherWebBrowserView.spawnWebBrowserView(false, { url });
			});
		}
		if (!currentView.contentEl.children[0].hasClass("wb-page-search-bar") && this.settings.showSearchBarInPage) {
			const inPageSearchBar = new InPageSearchBar(currentView.contentEl.children[0], this);
			if (currentView.contentEl.children[0].children[0]) {
				(currentView.contentEl.children[0].children[0] as HTMLElement).style.opacity = "0.4";
			}
			inPageSearchBar.focus();
			inPageSearchBar.addOnSearchBarEnterListener((url: string) => {
				AnotherWebBrowserView.spawnWebBrowserView(false, { url });
			});
		}
	}

	// Clean up header bar added to empty views when plugin is disabled.
	private removeHeaderAndSearchBar(currentView: ItemView) {
		if (!currentView) return;
		// Check if new leaf's view is empty, else return.
		if (currentView.getViewType() != "empty") return;
		// Check if the "New tab" view has already been processed and has a header bar already.
		if (currentView.headerEl.children[2].hasClass("web-browser-header-bar")) {
			currentView.headerEl.children[2].empty();
			currentView.headerEl.children[2].removeClass("web-browser-header-bar");
		}
		if (currentView.contentEl.children[0].hasClass("wb-page-search-bar") && this.settings.showSearchBarInPage) {
			currentView.contentEl.children[0].children[1].detach();
			currentView.contentEl.children[0].removeClass("wb-page-search-bar");
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

			AnotherWebBrowserView.spawnWebBrowserView(true, { url: url });
		});
	}

	// Register right click menu on editor
	private registerContextMenu() {
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, view: MarkdownView) => {
				if (!editor) {
					return;
				}
				if (editor.getSelection().length === 0) return;
				const selection = editor.getSelection();

				menu.addItem((item) => {
					// Add sub menu
					const searchEngines = [...SEARCH_ENGINES, ...this.settings.customSearchEngine]
					const subMenu = item.setTitle(`Search In WebBrowser`).setIcon('search').setSubmenu();
					searchEngines.forEach((engine) => {
						subMenu.addItem((item) => {
							item.setIcon('search')
								.setTitle(engine.name)
								.onClick(() => {
									// @ts-ignore
									AnotherWebBrowserView.spawnWebBrowserView(true, { url: engine.url + selection });
								})
						})
					})

					if (this.settings.defaultSearchEngine === 'custom') {
						subMenu.addItem((item) => {
							item.setIcon('search')
								.setTitle("custom")
								.onClick(() => {
									AnotherWebBrowserView.spawnWebBrowserView(true, { url: this.settings.customSearchEngine + selection });
								})
						})
					}

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
				const webbrowserView = this.app.workspace.getActiveViewOfType(AnotherWebBrowserView);
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
				const webbrowserView = this.app.workspace.getActiveViewOfType(AnotherWebBrowserView);
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
				const webbrowserView = this.app.workspace.getActiveViewOfType(AnotherWebBrowserView);
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
				const lastActiveLeaves = this.app.workspace.getLeavesOfType("another-web-browser-view");
				if (lastActiveLeaves.length === 0) return;

				const lastActiveLeaf = lastActiveLeaves.sort((a, b) => b.activeTime - a.activeTime)[0];

				const webbrowserView = lastActiveLeaf.view as AnotherWebBrowserView;
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
					AnotherWebBrowserView.spawnWebBrowserView(false, { url });
				});
				searchBarEl.focus();
			}
		});
	}

	private checkWebBrowser() {
		const webBrowser = app.plugins.getPlugin("obsidian-web-browser")
		if (webBrowser) new Notice(t("You enabled obsidian-web-browser plugin, please disable it/disable another-web-browser to avoid conflict."), 4000);
		const tabHeader = app.vault.getConfig("showViewHeader")
		if (!tabHeader) new Notice(t("You didn't enable show tab title bar in apperance settings, please enable it to use another web browser happily."), 4000);
	}

	// TODO: Licat said that this method will be changed in the future.
	// So we should not dispatch it now
	// private dispatchMarkdownView() {
	// 	this.register(
	// 		around(MarkdownView.prototype, {
	// 			triggerClickableToken: (next) =>
	// 				function (token: tokenType, newLeaf: boolean | string, ...args: any) {
	// 					console.log(token, newLeaf, args);
	// 					// if (token.type === "external-link") {
	// 					// 	const url = (token.text !== decodeURI(token.text)) ? decodeURI(token.text) : token.text;
	// 					// 	AnotherWebBrowserView.spawnWebBrowserView(true, { url: url });
	// 					// 	return;
	// 					// }
	// 					return next.call(this, token, newLeaf, ...args);
	// 				},
	// 		}),
	// 	);
	//
	// 	const patchEditView = () => {
	// 		const view = app.workspace.getLeavesOfType("markdown").first()?.view;
	// 		if (!view) return false;
	// 		const editMode = view.editMode ?? view.sourceMode;
	//
	// 		if (!editMode)
	// 			throw new Error(
	// 				"Failed to patch external link: no edit view found"
	// 			);
	//
	// 		const MarkdownEditView = editMode.constructor;
	// 		this.register(
	// 			around(MarkdownEditView.prototype, {
	// 				triggerClickableToken: (next) =>
	// 					function (token: tokenType, newLeaf: boolean | string, ...args: any) {
	// 						console.log(token, newLeaf, args);
	// 						// if (token.type === "external-link") {
	// 						// 	const url = (token.text !== decodeURI(token.text)) ? decodeURI(token.text) : token.text;
	// 						// 	AnotherWebBrowserView.spawnWebBrowserView(true, { url: url });
	// 						// 	return;
	// 						// }
	// 						return next.call(this, token, newLeaf, ...args);
	// 					},
	// 			})
	// 		);
	// 		console.log("Another-Web-browser: external link patched");
	// 		return true;
	// 	};
	// 	this.app.workspace.onLayoutReady(() => {
	// 		if (!patchEditView()) {
	// 			const evt = app.workspace.on("layout-change", () => {
	// 				patchEditView() && app.workspace.offref(evt);
	// 			});
	// 			this.registerEvent(evt);
	// 		}
	// 	});
	//
	// 	// TODO: we should hack markdown preview
	// 	this.register(
	// 		around(MarkdownRenderer.prototype, {
	// 			constructor: (next) =>
	// 				function (this: any, app: App, html: HTMLElement, ...args: any) {
	// 					const renderer = next.call(this, app, html, ...args);
	// 					console.log(args, renderer);
	// 					return renderer;
	// 				},
	// 		})
	// 	);
	// }

	dispatchWindowOpen() {
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
					// TODO: Change to `isWebUri()` when I change to use the valid-url library.
					if ((urlString === "about:blank" && features) || (!urlString.startsWith("http://") && !urlString.startsWith("https://") && !(urlString.startsWith("file://") && /\.htm(l)?/g.test(urlString))) || (urlString !== "about:blank" && target === "_blank")) {
						return next(url, target, features)
					}

					// TODO: Open external link in current leaf when meta key isn't being held down.
					AnotherWebBrowserView.spawnWebBrowserView(true, { url: urlString });
					return null;
				}
		})
		this.register(uninstaller);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
