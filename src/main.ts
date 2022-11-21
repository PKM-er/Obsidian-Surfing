import { App, DropdownComponent, EventRef, ItemView, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { HeaderBar } from "./header_bar";
import { FunctionHooks } from "./hooks";
import { WEB_BROWSER_VIEW_ID, WebBrowserView } from "./web_browser_view";
import { HTML_FILE_EXTENSIONS, WEB_BROWSER_FILE_VIEW_ID, WebBrowserFileView } from "./web_browser_file_view";
import { EditorView } from "@codemirror/view";

interface WebBrowserPluginSettings {
	defaultSearchEngine: string;
	customSearchUrl: string;
}

const DEFAULT_SETTINGS: WebBrowserPluginSettings = {
	defaultSearchEngine: 'duckduckgo',
	customSearchUrl: 'https://duckduckgo.com/?q=',
}

export const SEARCH_ENGINES = {
	'google': 'https://www.google.com/search?q=',
	'bing': 'https://www.bing.com/search?q=',
	'duckduckgo': 'https://duckduckgo.com/?q=',
	'yahoo': 'https://search.yahoo.com/search?p=',
	'baidu': 'https://www.baidu.com/s?wd=',
	'wikipedia': 'https://en.wikipedia.org/w/index.php?search=',
};

export default class MyPlugin extends Plugin {
	settings: WebBrowserPluginSettings;
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
		// Update all leaf contains empty view when restart Obsidian
		this.updateEmptyLeaf(false);
		// Patch link hover behavior
		// Add header bar to "New tab" view.
		this.onLayoutChangeEventRef = this.app.workspace.on("layout-change", () => {
			const activeView = this.app.workspace.getActiveViewOfType(ItemView);
			if (activeView) this.addHeader(activeView);
		});

		// Use checkCallback method to check if the view is WebBrowserView;
		// And change the default private to public.
		this.addCommand({
			id: 'open-current-url-with-external-browser',
			name: 'Open Current Url With External Browser',
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
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(WEB_BROWSER_VIEW_ID);
		FunctionHooks.onunload();
		this.app.workspace.offref(this.onLayoutChangeEventRef);

		// Clean up header bar added to "New tab" views when plugin is disabled.
		// Using Obsidian getViewType
		this.updateEmptyLeaf(true);
	}

	addHeader(currentView: ItemView) {
		if (!currentView) return;
		// Check if new leaf's view is empty, else return.
		if (currentView.getViewType() != "empty") return;
		// Check if the "New tab" view has already been processed and has a header bar already.
		if (!currentView.headerEl.children[2].hasClass("web-browser-header-bar")) {
			const headerBar = new HeaderBar(currentView.headerEl.children[2]);
			// Focus on current inputEl
			headerBar.focus();
			headerBar.addOnSearchBarEnterListener((url: string) => {
				WebBrowserView.spawnWebBrowserView(false, { url });
			});
		}
	}

	removeHeader(currentView: ItemView) {
		console.log(currentView.headerEl.children[2]);
		if (!currentView) return;
		// Check if new leaf's view is empty, else return.
		if (currentView.getViewType() != "empty") return;
		// Check if the "New tab" view has already been processed and has a header bar already.
		if (currentView.headerEl.children[2].hasClass("web-browser-header-bar")) {
			currentView.headerEl.children[2].empty();
			currentView.headerEl.children[2].removeClass("web-browser-header-bar");
		}
	}

	updateEmptyLeaf(remove?: boolean) {
		const emptyLeaves = this.app.workspace.getLeavesOfType("empty");
		emptyLeaves.forEach((leaf) => {
			if (leaf.view instanceof ItemView) {
				if (!remove) this.addHeader(leaf.view);
				if (remove) this.removeHeader(leaf.view);
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
	plugin: MyPlugin;
	private applyDebounceTimer = 0;

	constructor(app: App, plugin: MyPlugin) {
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
	}

	addSearchEngine() {
		new Setting(this.containerEl)
			.setName('Default Search Engine')
			.setDesc("")
			.addDropdown(async (drowdown: DropdownComponent) => {
				drowdown
					.addOption('duckduckgo', 'DuckDuckGo')
					.addOption('google', 'Google')
					.addOption('bing', 'Bing')
					.addOption('yahoo', 'Yahoo')
					.addOption('baidu', 'Baidu')
					.addOption('custom', 'Custom')
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
			.setName('Set Custom Search Engine Url')
			.setDesc("Set custom search engine url for yourself. 'Duckduckgo' By default")
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
}
