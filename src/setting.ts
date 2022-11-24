import { App, DropdownComponent, Notice, PluginSettingTab, Setting } from "obsidian";
import { t } from "./translations/helper";
import { clipboard } from "electron";
import AnotherWebBrowserPlugin from "./anotherWebBrowserIndex";

export interface AnotherWebBrowserPluginSettings {
	defaultSearchEngine: string;
	customSearchUrl: string;
	showSearchBarInPage: boolean;
	customHighlightFormat: boolean;
	highlightFormat: string;
	openInSameTab: boolean;
	openInObsidianWeb: boolean;
}

export const DEFAULT_SETTINGS: AnotherWebBrowserPluginSettings = {
	defaultSearchEngine: 'duckduckgo',
	customSearchUrl: 'https://duckduckgo.com/?q=',
	showSearchBarInPage: false,
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

export class WebBrowserSettingTab extends PluginSettingTab {
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
		this.addInpageSearch();
		this.addHighlightFormat();
		this.addOpenInSameTab();
		this.addOpenInObsidianWeb();
	}

	addInpageSearch() {
		new Setting(this.containerEl)
			.setName(t('Show Search Bar In Empty Page'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.showSearchBarInPage)
					.onChange(async (value) => {
						this.plugin.settings.showSearchBarInPage = value
						this.applySettingsUpdate()
						this.display()
					})
			})
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


		const bookmarkLetsEl = createEl("a", {
			text: `Obsidian BookmarkLets Code`,
			cls: 'cm-url',
			href: 'javascript:(function(){var%20i%20%3Ddocument.location.href%3B%20document.location.href%3D%22obsidian%3A%2F%2Fweb-open%3Furl%3D%22%20%2B%20encodeURIComponent%28i%29%3B})();'
		})
		bookmarkLetsEl.addEventListener("click", () => {
			clipboard.writeText(`javascript:(function(){var%20i%20%3Ddocument.location.href%3B%20document.location.href%3D%22obsidian%3A%2F%2Fweb-open%3Furl%3D%22%20%2B%20encodeURIComponent%28i%29%3B})();`)
			new Notice(t("Copy BookmarkLets Success"))
		})
		this.containerEl.appendChild(bookmarkLetsEl
		);

	}
}
