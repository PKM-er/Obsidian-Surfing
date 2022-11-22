import {
	App,
	DropdownComponent,
	Editor,
	EventRef,
	ItemView,
	MarkdownView,
	Menu,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting
} from "obsidian";
import { HeaderBar } from "./header_bar";
import { FunctionHooks } from "./hooks";
import { WEB_BROWSER_VIEW_ID, WebBrowserView } from "./web_browser_view";
import { HTML_FILE_EXTENSIONS, WEB_BROWSER_FILE_VIEW_ID, WebBrowserFileView } from "./web_browser_file_view";
import { t } from "./translations/helper";

// import { around } from "monkey-around";

interface AnotherWebBrowserPluginSettings {
	defaultSearchEngine: string;
	customSearchUrl: string;
	customHighlightFormat: boolean;
	highlightFormat: string;
	openInSameTab: boolean;
	openInObsidianWeb: boolean;
}

const DEFAULT_SETTINGS: AnotherWebBrowserPluginSettings = {
	defaultSearchEngine: 'duckduckgo',
	customSearchUrl: 'https://duckduckgo.com/?q=',
	customHighlightFormat: false,
	highlightFormat: '[{CONTENT}]({URL})',
	openInSameTab: false,
	openInObsidianWeb: false,
}

// Add search engines here for the future used.
export const SEARCH_ENGINES = {
	'google': 'https://www.google.com/search?q=',
	'bing': 'https://www.bing.com/search?q=',
	'duckduckgo': 'https://duckduckgo.com/?q=',
	'yahoo': 'https://search.yahoo.com/search?p=',
	'baidu': 'https://www.baidu.com/s?wd=',
	'wikipedia': 'https://en.wikipedia.org/w/index.php?search=',
};

export default class AnotherWebBrowserPlugin extends Plugin {
	settings: AnotherWebBrowserPluginSettings;
	private onLayoutChangeEventRef: EventRef;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new WebBrowserSettingTab(this.app, this));

		this.registerView(WEB_BROWSER_VIEW_ID, (leaf) => new WebBrowserView(leaf, this));

		// Feature to support html/htm files.
		this.registerView(WEB_BROWSER_FILE_VIEW_ID, (leaf) => new WebBrowserFileView(leaf));

		try {
			this.registerExtensions(HTML_FILE_EXTENSIONS, WEB_BROWSER_FILE_VIEW_ID);
		} catch (error) {
			new Notice(`File extensions ${ HTML_FILE_EXTENSIONS } had been registered by other plugin!`);
		}

		FunctionHooks.onload();


		this.updateEmptyLeaf(false);
		this.registerContextMenu();
		this.registerCustomURI();

		this.onLayoutChangeEventRef = this.app.workspace.on("layout-change", () => {
			const activeView = this.app.workspace.getActiveViewOfType(ItemView);
			if (activeView) this.addHeader(activeView);
		});

		this.registerCommands();
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(WEB_BROWSER_VIEW_ID);
		FunctionHooks.onunload();
		this.app.workspace.offref(this.onLayoutChangeEventRef);

		// Clean up header bar added to "New tab" views when plugin is disabled.
		// Using Obsidian getViewType
		this.updateEmptyLeaf(true);
	}

	// Add header bar to empty view.
	private addHeader(currentView: ItemView) {
		if (!currentView) return;
		// Check if new leaf's view is empty, else return.
		if (currentView.getViewType() != "empty") return;
		// Check if the "New tab" view has already been processed and has a header bar already.
		if (!currentView.headerEl.children[2].hasClass("web-browser-header-bar")) {
			const headerBar = new HeaderBar(currentView.headerEl.children[2], this);
			// Focus on current inputEl
			headerBar.focus();
			headerBar.addOnSearchBarEnterListener((url: string) => {
				WebBrowserView.spawnWebBrowserView(false, { url });
			});
		}
	}

	// Clean up header bar added to empty views when plugin is disabled.
	private removeHeader(currentView: ItemView) {
		if (!currentView) return;
		// Check if new leaf's view is empty, else return.
		if (currentView.getViewType() != "empty") return;
		// Check if the "New tab" view has already been processed and has a header bar already.
		if (currentView.headerEl.children[2].hasClass("web-browser-header-bar")) {
			currentView.headerEl.children[2].empty();
			currentView.headerEl.children[2].removeClass("web-browser-header-bar");
		}
	}

	// Update all leaf contains empty view when restart Obsidian
	private updateEmptyLeaf(remove?: boolean) {
		const emptyLeaves = this.app.workspace.getLeavesOfType("empty");
		emptyLeaves.forEach((leaf) => {
			if (leaf.view instanceof ItemView) {
				if (!remove) this.addHeader(leaf.view);
				if (remove) this.removeHeader(leaf.view);
			}
		});
	}

	// Support basic open web in Obsidian.
	registerCustomURI() {
		if (!this.settings.openInObsidianWeb) return;
		this.registerObsidianProtocolHandler("web-open", async (e) => {
			let url = e.url;
			if (!url) return;
			if (decodeURI(url) !== url) url = decodeURI(url).toString().replace(/\s/g, "%20");

			WebBrowserView.spawnWebBrowserView(true, { url: url });
		});
	}

	// Register right click menu on editor
	registerContextMenu() {
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, view: MarkdownView) => {
				if (!editor) {
					return;
				}
				if (editor.getSelection().length === 0) return;
				const selection = editor.getSelection();

				menu.addItem((item) => {
					// Add sub menu
					const subMenu = item.setTitle(`Search In WebBrowser`).setIcon('search').setSubmenu();
					for (const key in SEARCH_ENGINES) {
						subMenu.addItem((item) => {
							item.setIcon('search')
								.setTitle(key)
								.onClick(() => {
									// @ts-ignore
									WebBrowserView.spawnWebBrowserView(true, { url: SEARCH_ENGINES[key] + selection });
								})
						})
					}
					if (this.settings.defaultSearchEngine === 'custom') {
						subMenu.addItem((item) => {
							item.setIcon('search')
								.setTitle("custom")
								.onClick(() => {
									WebBrowserView.spawnWebBrowserView(true, { url: this.settings.customSearchUrl + selection });
								})
						})
					}

				})
			}))
	}

	registerCommands() {
		// Use checkCallback method to check if the view is WebBrowserView;
		// And change the default private to public.
		this.addCommand({
			id: 'open-current-url-with-external-browser',
			name: t('Open Current URL In External Browser'),
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const webbrowserView = this.app.workspace.getActiveViewOfType(WebBrowserView);
				if (webbrowserView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						FunctionHooks.ogWindow$Open.call(window, webbrowserView.getState()?.url, "_blank");
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
				const webbrowserView = this.app.workspace.getActiveViewOfType(WebBrowserView);
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
			name: 'Get Current Timestamp from Web Browser',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const lastActiveLeaves = this.app.workspace.getLeavesOfType("another-web-browser-view");
				if (lastActiveLeaves.length === 0) return;

				const lastActiveLeaf = lastActiveLeaves.sort((a, b) => b.activeTime - a.activeTime)[0];

				const webbrowserView = lastActiveLeaf.view as WebBrowserView;
				const url = webbrowserView.getState()?.url;
				if (!url?.contains("bilibili")) return;

				webbrowserView.getCurrentTimestamp(editor);
			}
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}


class WebBrowserSettingTab extends PluginSettingTab {
	plugin: AnotherWebBrowserPlugin;
	private applyDebounceTimer = 0;

	constructor(app: App, plugin: AnotherWebBrowserPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	applySettingsUpdate() {
		clearTimeout(this.applyDebounceTimer);
		const plugin = this.plugin;
		this.applyDebounceTimer = window.setTimeout(() => {
			plugin.saveSettings();
		}, 100);
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Web Browser' });

		this.addSearchEngine();
		this.addHighlightFormat();
		this.addOpenInSameTab();
		this.addOpenInObsidianWeb();
	}

	addSearchEngine() {
		new Setting(this.containerEl)
			.setName(t('Default Search Engine'))
			.setDesc("")
			.addDropdown(async (drowdown: DropdownComponent) => {
				drowdown
					.addOption('duckduckgo', t('DuckDuckGo'))
					.addOption('google', t('Google'))
					.addOption('bing', t('Bing'))
					.addOption('yahoo', t('Yahoo'))
					.addOption('baidu', t('Baidu'))
					.addOption('custom', t('Custom'))
					.setValue(this.plugin.settings.defaultSearchEngine).onChange(async (value) => {
					this.plugin.settings.defaultSearchEngine = value;
					this.applySettingsUpdate();
					// Force refresh
					this.display();
				});
			});

		if (!(this.plugin.settings.defaultSearchEngine === 'custom')) {
			return;
		}

		new Setting(this.containerEl)
			.setName(t('Set Custom Search Engine Url'))
			.setDesc(t("Set custom search engine url for yourself. 'Duckduckgo' By default"))
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.customSearchUrl)
					.setValue(this.plugin.settings.customSearchUrl)
					.onChange(async (value) => {
						this.plugin.settings.customSearchUrl = value;
						this.applySettingsUpdate();
					}),
			);
	}

	addHighlightFormat() {
		new Setting(this.containerEl)
			.setName(t('Custom Link to Highlight Format'))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.customHighlightFormat)
					.onChange(async (value) => {
						this.plugin.settings.customHighlightFormat = value;
						this.applySettingsUpdate();
						// Force refresh
						this.display();
					});
			})

		if (!this.plugin.settings.customHighlightFormat) {
			return;
		}

		new Setting(this.containerEl)
			.setName(t('Copy Link to Highlight Format'))
			.setDesc(t("Set copy link to text fragment format. [{CONTENT}]({URL}) By default. You can also set {TIME:YYYY-MM-DD HH:mm:ss} to get the current date."))
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.highlightFormat)
					.setValue(this.plugin.settings.highlightFormat)
					.onChange(async (value) => {
						if (value === "") {
							this.plugin.settings.highlightFormat = DEFAULT_SETTINGS.highlightFormat;
							this.applySettingsUpdate();
							// Force refresh
							this.display();
						}
						this.plugin.settings.highlightFormat = value;
						this.applySettingsUpdate();
					}),
			);
	}

	addOpenInSameTab() {
		new Setting(this.containerEl)
			.setName(t('Open URL In Same Tab'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.openInSameTab)
					.onChange(async (value) => {
						this.plugin.settings.openInSameTab = value
						this.applySettingsUpdate()
						this.display()
					})
			})
	}

	addOpenInObsidianWeb() {
		new Setting(this.containerEl)
			.setName(t('Open URL In Obsidian Web'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.openInObsidianWeb)
					.onChange(async (value) => {
						this.plugin.settings.openInObsidianWeb = value;
						this.applySettingsUpdate();
						this.display();
					})
			})

		if (!this.plugin.settings.openInObsidianWeb) {
			return;
		}

		this.containerEl.appendChild(
			createEl("div", {
				text: t("You can drag or copy the link below to your browser bookmark bar. This bookmarklet will allow you to jump from external web browser to Obsidian"),
			})
		);

		this.containerEl.appendChild(
			createEl("a", {
				text: `Obsidian Web`,
				href: `javascript:(function(){var%20i%20%3Ddocument.location.href%3B%20document.location.href%3D%22obsidian%3A%2F%2Fweb-open%3Furl%3D%22%20%2B%20encodeURIComponent%28i%29%3B})();`,
			})
		);

	}
}
