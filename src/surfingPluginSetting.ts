import {
	App,
	DropdownComponent,
	Notice,
	Platform,
	PluginSettingTab,
	SearchComponent,
	setIcon,
	Setting
} from "obsidian";
import { t } from "./translations/helper";
import { clipboard } from "electron";
import SurfingPlugin from "./surfingIndex";
import { NodeModel } from "@minoru/react-dnd-treeview";
import { CustomData } from "./component/TabTreeView/types";

type settingSearchInfo = {
	containerEl: HTMLElement,
	name: string,
	description: string,
	options: SearchOptionInfo[],
	alias?: string
}
type TabContentInfo = { content: HTMLElement, heading: HTMLElement, navButton: HTMLElement }
export type SearchOptionInfo = { name: string, description: string, options?: DropdownRecord[] }

export interface SurfingSettings {
	defaultSearchEngine: string;
	customSearchEngine: SearchEngine[];
	ignoreList: string[];
	hoverPopover: boolean;
	alwaysShowCustomSearch: boolean;
	showOtherSearchEngines: boolean;
	showSearchBarInPage: boolean;
	customHighlightFormat: boolean;
	markdownPath: string;
	highlightFormat: string;
	openInSameTab: boolean;
	showRefreshButton: boolean;
	highlightInSameTab: boolean;
	openInObsidianWeb: boolean;
	useCustomIcons: boolean;
	useWebview: boolean;
	useIconList: boolean;
	darkMode: boolean;
	randomBackground: boolean;
	lastOpenedFiles: boolean;
	bookmarkManager: {
		openBookMark: boolean;
		saveBookMark: boolean;
		sendToReadWise: boolean;
		pagination: string;
		category: string;
		defaultCategory: string;
		defaultColumnList: string[];
		defaultFilterType: string;
	},
	treeData: NodeModel<CustomData>[];
	enableHtmlPreview: boolean;
	supportLivePreviewInlineUrl: boolean;
	enableTreeView: boolean;
}

export interface SearchEngine {
	name: string;
	url: string;
}

const defaultCategory = `- Computer
    - 算法
    - 数据结构
- obsidian
    - surfing
    - dataview
`;

const defaultColumnList = [
	"name",
	"description",
	"url",
	"category",
	"tags",
	"created",
	"modified",
	"action",
];

export const DEFAULT_SETTINGS: SurfingSettings = {
	defaultSearchEngine: 'duckduckgo',
	customSearchEngine: [{
		name: 'duckduckgo',
		url: 'https://duckduckgo.com/?q=',
	}],
	hoverPopover: true,
	ignoreList: ["notion", "craft"],
	alwaysShowCustomSearch: false,
	showOtherSearchEngines: false,
	showSearchBarInPage: false,
	markdownPath: "/",
	customHighlightFormat: false,
	highlightFormat: '[{CONTENT}]({URL})',
	highlightInSameTab: false,
	openInSameTab: false,
	showRefreshButton: false,
	openInObsidianWeb: false,
	useCustomIcons: false,
	useWebview: false,
	useIconList: true,
	darkMode: false,
	randomBackground: false,
	lastOpenedFiles: false,
	bookmarkManager: {
		openBookMark: false,
		saveBookMark: false,
		sendToReadWise: false,
		pagination: "12",
		category: defaultCategory,
		defaultCategory: "ROOT",
		defaultColumnList: defaultColumnList,
		defaultFilterType: 'tree',
	},
	treeData: [],
	enableHtmlPreview: true,
	supportLivePreviewInlineUrl: false,
	enableTreeView: false,
};
// Add search engines here for the future used.
export const SEARCH_ENGINES: SearchEngine[] = [
	{
		name: 'Google',
		url: 'https://www.google.com/search?q=',
	},
	{
		name: 'Bing',
		url: 'https://www.bing.com/search?q=',
	},
	{
		name: 'Duckduckgo',
		url: 'https://duckduckgo.com/?q=',
	},
	{
		name: 'Yahoo',
		url: 'https://search.yahoo.com/search?p=',
	},
	{
		name: 'Baidu',
		url: 'https://www.baidu.com/s?wd=',
	},
	{
		name: 'Yandex',
		url: 'https://yandex.com/search/?text=',
	},
	{
		name: 'Wikipedia',
		url: 'https://en.wikipedia.org/w/index.php?search=',
	}
];

const tabNameToTabIconId: Record<string, string> = {
	General: 'chrome',
	Search: 'search',
	Theme: 'brush',
	Bookmark: 'bookmark'
};

export class DropdownRecord {
	public value: string;
	public description: string;

	constructor(value: string, description: string) {
		this.value = value;
		this.description = description;
	}
}

export class SurfingSettingTab extends PluginSettingTab {
	plugin: SurfingPlugin;
	private applyDebounceTimer = 0;
	private tabContent: Map<string, TabContentInfo> = new Map<string, TabContentInfo>();
	private selectedTab = 'General';
	private search: SearchComponent;
	private searchSettingInfo: Map<string, settingSearchInfo[]> = new Map();
	private searchZeroState: HTMLDivElement;
	private navigateEl: HTMLElement;

	constructor(app: App, plugin: SurfingPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	public applySettingsUpdate() {
		clearTimeout(this.applyDebounceTimer);
		const plugin = this.plugin;
		this.applyDebounceTimer = window.setTimeout(() => {
			plugin.saveSettings();
		}, 100);
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		this.generateSettingsTitle();
		this.addTabHeader();
	}

	private generateSettingsTitle() {
		const linterHeader = this.containerEl.createDiv('wb-setting-title');
		linterHeader.createEl('h2', {text: 'Web Browser'});
		this.generateSearchBar(linterHeader);
	}

	private addTabHeader() {
		const navContainer = this.containerEl.createEl('nav', {cls: 'wb-setting-header'});
		this.navigateEl = navContainer.createDiv('wb-setting-tab-group');
		const settingsEl = this.containerEl.createDiv('wb-setting-content');

		this.createTabAndContent('General', this.navigateEl, settingsEl, (el: HTMLElement, tabName: string) => this.generateGeneralSettings(tabName, el));
		this.createTabAndContent('Search', this.navigateEl, settingsEl, (el: HTMLElement, tabName: string) => this.generateSearchSettings(tabName, el));
		this.createTabAndContent('Theme', this.navigateEl, settingsEl, (el: HTMLElement, tabName: string) => this.generateThemeSettings(tabName, el));
		this.createTabAndContent('Bookmark', this.navigateEl, settingsEl, (el: HTMLElement, tabName: string) => this.generateBookmarkManagerSettings(tabName, el));

		this.createSearchZeroState(settingsEl);
	}

	generateSearchBar(containerEl: HTMLElement) {
		// based on https://github.com/valentine195/obsidian-settings-search/blob/master/src/main.ts#L294-L308
		const searchSetting = new Setting(containerEl);
		searchSetting.settingEl.style.border = 'none';
		searchSetting.addSearch((s: SearchComponent) => {
			this.search = s;
		});

		this.search.setPlaceholder(t('Search all settings'));

		this.search.inputEl.oninput = () => {
			for (const tabInfo of this.tabContent) {
				const tab = tabInfo[1];
				tab.navButton.removeClass('wb-navigation-item-selected');
				(tab.content as HTMLElement).show();
				(tab.heading as HTMLElement).show();

				const searchVal = this.search.getValue();
				if (this.selectedTab == '' && searchVal.trim() != '') {
					this.searchSettings(searchVal.toLowerCase());
				}

				this.selectedTab = '';
			}
			this.navigateEl.addClass('wb-setting-searching');
		};

		// this.search.clearButtonEl.addEventListener('click', () => {
		// 	this.selectedTab = 'General';
		// })

		this.search.inputEl.onblur = () => {
			this.navigateEl.removeClass('wb-setting-searching');
		};

		this.search.onChange((value: string) => {
			if (value === '') {
				this.navigateEl.children[0].dispatchEvent(new PointerEvent('click'));
			}
			this.searchSettings(value.toLowerCase());
		});
	}

	createTabAndContent(tabName: string, navigateEl: HTMLElement, containerEl: HTMLElement, generateTabContent?: (el: HTMLElement, tabName: string) => void) {
		const displayTabContent = this.selectedTab === tabName;
		const tabEl = navigateEl.createDiv('wb-navigation-item');

		const tabClass = 'wb-desktop';
		tabEl.addClass(tabClass);

		setIcon(tabEl.createEl("div", {cls: 'wb-navigation-item-icon'}), tabNameToTabIconId[tabName]);
		// @ts-ignore
		tabEl.createSpan().setText(t(tabName));

		tabEl.onclick = () => {
			if (this.selectedTab == tabName) {
				return;
			}

			tabEl.addClass('wb-navigation-item-selected');
			const tab = this.tabContent.get(tabName);
			(tab?.content as HTMLElement).show();

			if (this.selectedTab != '') {
				const tabInfo = this.tabContent.get(this.selectedTab);
				tabInfo?.navButton.removeClass('wb-navigation-item-selected');
				(tabInfo?.content as HTMLElement).hide();
			} else {
				(this.searchZeroState as HTMLElement).hide();


				for (const settingTab of this.searchSettingInfo) {
					for (const setting of settingTab[1]) {
						(setting.containerEl as HTMLElement).show();
					}
				}

				for (const tabInfo of this.tabContent) {
					const tab = tabInfo[1];
					(tab.heading as HTMLElement).hide();
					if (tabName !== tabInfo[0]) {
						(tab.content as HTMLElement).hide();
					}
				}
			}

			this.selectedTab = tabName;
		};

		const tabContent = containerEl.createDiv('wb-tab-settings');

		const tabHeader = tabContent.createEl('h2', {cls: "wb-setting-heading", text: tabName + ' Settings'});
		(tabHeader as HTMLElement).hide();

		tabContent.id = tabName.toLowerCase().replace(' ', '-');
		if (!displayTabContent) {
			(tabContent as HTMLElement).hide();
		} else {
			tabEl.addClass('wb-navigation-item-selected');
		}

		if (generateTabContent) {
			generateTabContent(tabContent, tabName);
		}

		this.tabContent.set(tabName, {content: tabContent, heading: tabHeader, navButton: tabEl});
	}

	private searchSettings(searchVal: string) {
		const tabsWithSettingsInSearchResults = new Set<string>();
		const showSearchResultAndAddTabToResultList = (settingContainer: HTMLElement, tabName: string) => {
			(settingContainer as HTMLElement).show();

			if (!tabsWithSettingsInSearchResults.has(tabName)) {
				tabsWithSettingsInSearchResults.add(tabName);
			}
		};

		for (const tabSettingInfo of this.searchSettingInfo) {
			const tabName = tabSettingInfo[0];
			const tabSettings = tabSettingInfo[1];
			for (const settingInfo of tabSettings) {
				// check the more common things first and then make sure to search the options since it will be slower to do that
				// Note: we check for an empty string for searchVal to see if the search is essentially empty which will display all rules
				if (searchVal.trim() === '' || settingInfo.alias?.includes(searchVal) || settingInfo.description.includes(searchVal) || settingInfo.name.includes(searchVal)) {
					showSearchResultAndAddTabToResultList(settingInfo.containerEl, tabName);
				} else if (settingInfo.options) {
					for (const optionInfo of settingInfo.options) {
						if (optionInfo.description.toLowerCase().includes(searchVal) || optionInfo.name.toLowerCase().includes(searchVal)) {
							showSearchResultAndAddTabToResultList(settingInfo.containerEl, tabName);

							break;
						} else if (optionInfo.options) {
							for (const optionsForOption of optionInfo.options) {
								if (optionsForOption.description.toLowerCase().includes(searchVal) || optionsForOption.value.toLowerCase().includes(searchVal)) {
									showSearchResultAndAddTabToResultList(settingInfo.containerEl, tabName);

									break;
								}
							}
						}

						(settingInfo.containerEl as HTMLElement).hide();
					}
				} else {
					(settingInfo.containerEl as HTMLElement).hide();
				}
			}
		}

		// display any headings that have setting results and hide any that do not
		for (const tabInfo of this.tabContent) {
			if (tabsWithSettingsInSearchResults.has(tabInfo[0])) {
				(tabInfo[1].heading as HTMLElement).show();
			} else {
				(tabInfo[1].heading as HTMLElement).hide();
			}
		}

		if (tabsWithSettingsInSearchResults.size === 0) {
			(this.searchZeroState as HTMLElement).show();
		} else {
			(this.searchZeroState as HTMLElement).hide();
		}
	}

	private generateGeneralSettings(tabName: string, wbContainerEl: HTMLElement) {
		this.addOpenInSameTab(tabName, wbContainerEl);
		this.addHoverPopover(tabName, wbContainerEl);
		this.addEnableHTMLPreview(tabName, wbContainerEl);
		this.addTreeView(tabName, wbContainerEl);
		this.addInlinePreview(tabName, wbContainerEl);
		this.addRefreshButton(tabName, wbContainerEl);
		this.addHighlightFormat(tabName, wbContainerEl);
		this.addMarkdownPath(tabName, wbContainerEl);
		this.addReplaceIframeInCanvas(tabName, wbContainerEl);
		this.addOpenInObsidianWeb(tabName, wbContainerEl);
		this.addAboutInfo(tabName, wbContainerEl);
	}

	private generateSearchSettings(tabName: string, wbContainerEl: HTMLElement): void {
		this.addInpageSearch(tabName, wbContainerEl);
		this.addSearchEngine(tabName, wbContainerEl);
	}

	private generateThemeSettings(tabName: string, wbContainerEl: HTMLElement): void {
		this.useIconList(tabName, wbContainerEl);
		this.addDarkMode(tabName, wbContainerEl);
		this.addRandomBackground(tabName, wbContainerEl);
		this.addMyIcons(tabName, wbContainerEl);
	}

	private generateBookmarkManagerSettings(tabName: string, wbContainerEl: HTMLElement): void {
		this.addBookmarkManagerSettings(tabName, wbContainerEl);
	}

	// @ts-ignore
	private addSettingToMasterSettingsList(tabName: string, containerEl: HTMLElement, name = '', description = '', options: SearchOptionInfo[] = null, alias: string = null) {
		const settingInfo = {
			containerEl: containerEl,
			name: name.toLowerCase(),
			description: description.toLowerCase(),
			options: options,
			alias: alias
		};

		if (!this.searchSettingInfo.has(tabName)) {
			this.searchSettingInfo.set(tabName, [settingInfo]);
		} else {
			this.searchSettingInfo.get(tabName)?.push(settingInfo);
		}
	}

	private createSearchZeroState(containerEl: HTMLElement) {
		this.searchZeroState = containerEl.createDiv();
		(this.searchZeroState as HTMLElement).hide();
		this.searchZeroState.createEl(Platform.isMobile ? 'h3' : 'h2', {text: 'No settings match search'}).style.textAlign = 'center';
	}

	private addRefreshButton(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = t('Show Refresh Button Near Search Bar');
		const setting = new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.showRefreshButton)
					.onChange(async (value) => {
						this.plugin.settings.showRefreshButton = value;
						this.applySettingsUpdate();
					});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName);
	}

	private addInpageSearch(tabName: string, wbContainerEl: HTMLElement) {
		let settingName = t('Show Search Bar In Empty Page');
		let setting = new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.showSearchBarInPage)
					.onChange(async (value) => {
						this.plugin.settings.showSearchBarInPage = value;
						this.applySettingsUpdate();

						setTimeout(() => {
							this.display();
						}, 200);
					});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName);

		if (!this.plugin.settings.showSearchBarInPage) {
			return;
		}

		settingName = 'Show last opened files';
		setting = new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.lastOpenedFiles)
					.onChange(async (value) => {
						this.plugin.settings.lastOpenedFiles = value;
						this.applySettingsUpdate();
					});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName);
	}

	private addSearchEngine(tabName: string, wbContainerEl: HTMLElement) {
		let settingName = t('Default Search Engine');
		let setting = new Setting(wbContainerEl)
			.setName(settingName)
			.addDropdown(async (drowdown: DropdownComponent) => {
				const aDropdown = drowdown
					.addOption('duckduckgo', t('DuckDuckGo'))
					.addOption('google', t('Google'))
					.addOption('bing', t('Bing'))
					.addOption('yahoo', t('Yahoo'))
					.addOption('baidu', t('Baidu'));

				this.plugin.settings.customSearchEngine.forEach((value, key) => {
					aDropdown.addOption(value.name, value.name);
				});

				aDropdown.setValue(this.plugin.settings.defaultSearchEngine).onChange(async (value) => {
					this.plugin.settings.defaultSearchEngine = value;
					this.applySettingsUpdate();
					// Force refresh
					this.display();
				});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName);

		settingName = t('Show Other Search Engines When Searching') + " " + t('(Reload to take effect)');
		setting = new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.showOtherSearchEngines)
					.onChange(async (value) => {
						this.plugin.settings.showOtherSearchEngines = value;
						this.applySettingsUpdate();
					});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName);

		settingName = t('Disable / to search when on these sites');
		setting = new Setting(wbContainerEl)
			.setName(settingName)
			.addText((text) => {
				text.setPlaceholder(DEFAULT_SETTINGS.ignoreList.join(","))
					.setValue(this.plugin.settings.ignoreList.join(","))
					.onChange(async (value) => {
						this.plugin.settings.ignoreList = value.split(",");
						this.applySettingsUpdate();
					});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName);

		settingName = t('Always Show Custom Engines');
		setting = new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.alwaysShowCustomSearch)
					.onChange(async (value) => {
						this.plugin.settings.alwaysShowCustomSearch = value;
						this.applySettingsUpdate();
						// Force refresh
						this.display();
					});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName);

		if (!this.plugin.settings.alwaysShowCustomSearch) {
			return;
		}

		if (typeof this.plugin.settings.customSearchEngine !== "object") {
			this.plugin.settings.customSearchEngine = DEFAULT_SETTINGS.customSearchEngine;
		}

		settingName = t('Add new custom search engine');
		setting = new Setting(wbContainerEl)
			.setName(settingName)
			.addButton((button) => button
				.setButtonText('+')
				.onClick(async () => {
					this.plugin.settings.customSearchEngine.push({
						name: `Custom Search ${this.plugin.settings.customSearchEngine.length + 1}`,
						url: 'https://www.google.com/search?q=',
					});
					await this.plugin.saveSettings();
					this.display();
				}));

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName);

		this.plugin.settings.customSearchEngine.forEach((searchEngine, index) => {
			settingName = searchEngine.name ? searchEngine.name : t('Custom Search') + `${this.plugin.settings.customSearchEngine.length > 1 ? ` ${index + 1}` : ''}`;
			const topLevelSetting = new Setting(wbContainerEl)
				.setClass('search-engine-setting')
				.setName(settingName)
				.addButton((button) => button
					.setButtonText(t('Delete Custom Search'))
					.onClick(async () => {
						this.plugin.settings.customSearchEngine.splice(index, 1);
						await this.plugin.saveSettings();
						this.display();
					}));

			const mainSettingsEl = topLevelSetting.settingEl.createEl('div', 'search-engine-main-settings');

			const mainSettingsNameEl = mainSettingsEl.createEl('div', 'search-engine-main-settings-name');
			const mainSettingsUrlEl = mainSettingsEl.createEl('div', 'search-engine-main-settings-url');

			mainSettingsNameEl.createEl('label', {text: t('Name')});
			mainSettingsNameEl.createEl('input', {
				cls: 'search-engine-name-input',
				type: 'text',
				value: searchEngine.name,
			}).on('change', '.search-engine-name-input', async (evt: Event) => {
				const target = evt.target as HTMLInputElement;
				this.plugin.settings.customSearchEngine[index] = {...searchEngine, name: target.value};
				await this.plugin.saveSettings();
			});

			mainSettingsUrlEl.createEl('label', {text: t('Url')});
			mainSettingsUrlEl.createEl('input', {
				cls: 'search-engine-url-input',
				type: 'text',
				value: searchEngine.url,
			}).on('change', '.search-engine-url-input', async (evt: Event) => {
				const target = evt.target as HTMLInputElement;
				this.plugin.settings.customSearchEngine[index] = {...searchEngine, url: target.value};
				await this.plugin.saveSettings();
			});

			this.addSettingToMasterSettingsList(tabName, topLevelSetting.settingEl, settingName + t("Search Engine"));
		});
	}

	private addMarkdownPath(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = t('Save As Markdown Path');
		const setting = new Setting(wbContainerEl)
			.setName(settingName)
			.addText((text) => text
				.setPlaceholder(t('Path like /_Tempcard'))
				.setValue(this.plugin.settings.markdownPath)
				.onChange(async (value) => {
					this.plugin.settings.markdownPath = value;
					this.applySettingsUpdate();
				}));

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName);
	}

	private addHighlightFormat(tabName: string, wbContainerEl: HTMLElement) {
		let settingName = t('Custom Link to Highlight Format');
		let setting = new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.customHighlightFormat)
					.onChange(async (value) => {
						this.plugin.settings.customHighlightFormat = value;
						this.applySettingsUpdate();
						// Force refresh
						this.display();
					});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName);

		if (!this.plugin.settings.customHighlightFormat) {
			return;
		}

		settingName = t('Copy Link to Highlight Format');
		let settingDesc = t("Set copy link to text fragment format. [{CONTENT}]({URL}) By default. You can also set {TIME:YYYY-MM-DD HH:mm:ss} to get the current date.");
		setting = new Setting(wbContainerEl)
			.setName(settingName)
			.setDesc(settingDesc)
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

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName, settingDesc);

		settingName = t('Jump to Opened Page');
		settingDesc = t("When click on the URL from same domain name in the note, jump to the same surfing view rather than opening a new Surfing view.");
		setting = new Setting(wbContainerEl)
			.setName(settingName)
			.setDesc(settingDesc)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.highlightInSameTab)
					.onChange(async (value) => {
						this.plugin.settings.highlightInSameTab = value;
						this.applySettingsUpdate();
					});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName, settingDesc);
	}

	private addOpenInSameTab(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = t('Open URL In Same Tab');
		const setting = new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.openInSameTab)
					.onChange(async (value) => {
						this.plugin.settings.openInSameTab = value;
						this.applySettingsUpdate();
						this.display();
					});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName);
	}

	private addHoverPopover(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = t('Hover Popover');
		const settingDesc = t('Show a popover when hover on the link.');
		const setting = new Setting(wbContainerEl)
			.setName(settingName)
			.setDesc(settingDesc)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.hoverPopover)
					.onChange(async (value) => {
						this.plugin.settings.hoverPopover = value;
						this.applySettingsUpdate();
					});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName, settingDesc);
	}

	private addEnableHTMLPreview(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = t('Enable HTML Preview');
		const settingDesc = t('Enable HTML Preview in Surfing');
		const setting = new Setting(wbContainerEl)
			.setName(settingName)
			.setDesc(settingDesc)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.enableHtmlPreview)
					.onChange(async (value) => {
						this.plugin.settings.enableHtmlPreview = value;
						this.applySettingsUpdate();
					});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName, settingDesc);
	}

	private addTreeView(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = t('Enable Tree View');
		const settingDesc = t('Enable Tree View in Surfing');
		const setting = new Setting(wbContainerEl)
			.setName(settingName)
			.setDesc(settingDesc)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.enableTreeView)
					.onChange(async (value) => {
						this.plugin.settings.enableTreeView = value;
						this.applySettingsUpdate();
					});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName, settingDesc);

	}

	private addInlinePreview(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = t('Enable Inline Preview');
		const settingDesc = t('Enable inline preview with surfing. Currently only support Live preview');
		const setting = new Setting(wbContainerEl)
			.setName(settingName)
			.setDesc(settingDesc)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.supportLivePreviewInlineUrl)
					.onChange(async (value) => {
						this.plugin.settings.supportLivePreviewInlineUrl = value;
						this.applySettingsUpdate();
					});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName, settingDesc);
	}

	private addReplaceIframeInCanvas(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = t('[Experimental] Replace Iframe In Canvas') + t('(Reload to take effect)');
		const setting = new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.useWebview)
					.onChange(async (value) => {
						this.plugin.settings.useWebview = value;
						this.applySettingsUpdate();
					});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName);
	}

	private addOpenInObsidianWeb(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = t('Open URL In Obsidian Web From Other Software') + " " + t('(Reload to take effect)');
		const setting = new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.openInObsidianWeb)
					.onChange(async (value) => {
						this.plugin.settings.openInObsidianWeb = value;
						this.applySettingsUpdate();
						this.display();
					});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName);

		if (!this.plugin.settings.openInObsidianWeb) {
			return;
		}

		const bookmarkLetsContainerEl = wbContainerEl.createDiv({cls: 'bookmarklets-container'});
		const bookmarkLetsBtn = bookmarkLetsContainerEl.createEl('button', {
			cls: "wb-btn"
		});

		bookmarkLetsBtn.createEl("a", {
			text: `Obsidian BookmarkLets Code`,
			cls: 'cm-url',
			href: 'javascript:(function(){var%20i%20%3Ddocument.location.href%3B%20document.location.href%3D%22obsidian%3A%2F%2Fweb-open%3Furl%3D%22%20%2B%20encodeURIComponent%28i%29%3B})();'
		});
		bookmarkLetsBtn.addEventListener("click", (e) => {
			e.preventDefault();
			clipboard.writeText(`javascript:(function(){var%20i%20%3Ddocument.location.href%3B%20document.location.href%3D%22obsidian%3A%2F%2Fweb-open%3Furl%3D%22%20%2B%20encodeURIComponent%28i%29%3B})();`);
			new Notice(t("Copy BookmarkLets Success"));
		});
		bookmarkLetsContainerEl.createEl("span", {
			cls: "wb-btn-tip",
			text: t("   <- Drag or click on me")
		});

		this.addSettingToMasterSettingsList(tabName, bookmarkLetsContainerEl, settingName);
	}

	private addAboutInfo(tabName: string, wbContainerEl: HTMLElement) {

		const bookmarkLetsContainerEl = wbContainerEl.createDiv({cls: 'wb-about-card'});

		setIcon(bookmarkLetsContainerEl.createDiv({cls: 'wb-about-icon'}), 'surfing');

		bookmarkLetsContainerEl.createEl('div', {cls: "wb-about-text", text: 'Surfing'});

		const text = this.plugin.manifest.version;
		const url = "https://github.com/Quorafind/Obsidian-Surfing/releases/tag/" + text;

		bookmarkLetsContainerEl.createEl("a", {cls: 'wb-about-version', href: url, text: text});

		this.addSettingToMasterSettingsList(tabName, bookmarkLetsContainerEl, "surfing");
	}

	// TODO: Refresh all empty view.
	private useIconList(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = t('Use icon list to replace defult text actions in empty view') + t('(Reload to take effect)');
		const setting = new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.useIconList)
					.onChange(async (value) => {
						this.plugin.settings.useIconList = value;
						this.applySettingsUpdate();
					});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName);
	}

	private addDarkMode(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = t("Toggle Dark Mode");
		const setting = new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.darkMode)
					.onChange(async (value) => {
						this.plugin.settings.darkMode = value;
						this.applySettingsUpdate();
					});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName);
	}

	private addRandomBackground(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = "Random Background";
		const setting = new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.randomBackground)
					.onChange(async (value) => {
						this.plugin.settings.randomBackground = value;
						this.applySettingsUpdate();
					});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, settingName);
	}

	private addMyIcons(tabName: string, wbContainerEl: HTMLElement) {
		let settingName = t("Working On, Not Available Now");
		let setting = new Setting(wbContainerEl)
			.setName(settingName);

		setting.settingEl.classList.add("wb-theme-settings-working-on");

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, "theme");

		settingName = t("Random Icons From Default Art");
		setting = new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.useCustomIcons)
					.setDisabled(true)
					.onChange(async (value) => {
						this.plugin.settings.useCustomIcons = value;
						this.applySettingsUpdate();
					});
			});

		this.addSettingToMasterSettingsList(tabName, setting.settingEl, "theme surfing");
	}

	private addBookmarkManagerSettings(tabName: string, wbContainerEl: HTMLElement) {
		const openBookmarkManager = new Setting(wbContainerEl)
			.setName(t("Open BookmarkBar & Bookmark Manager"))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.bookmarkManager.openBookMark)
					.onChange(async (value) => {
						this.plugin.settings.bookmarkManager.openBookMark = value;
						this.applySettingsUpdate();
						this.display();
					});
			});
		this.addSettingToMasterSettingsList(tabName, openBookmarkManager.settingEl, t("Open BookmarkBar & Bookmark Manager"));

		if (!this.plugin.settings.bookmarkManager.openBookMark) return;

		const saveBookmark = new Setting(wbContainerEl)
			.setName(t("Save Bookmark When Open URI"))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.bookmarkManager.saveBookMark)
					.onChange(async (value) => {
						this.plugin.settings.bookmarkManager.saveBookMark = value;
						this.applySettingsUpdate();
					});
			});
		this.addSettingToMasterSettingsList(tabName, saveBookmark.settingEl, t("Save Bookmark When Open URI"));

		const sendToReadWise = new Setting(wbContainerEl)
			.setName(t("Send to ReadWise"))
			.setDesc(t("Add a action in page header to Send to ReadWise."))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.bookmarkManager.sendToReadWise)
					.onChange(async (value) => {
						this.plugin.settings.bookmarkManager.sendToReadWise = value;
						this.applySettingsUpdate();
					});
			});
		this.addSettingToMasterSettingsList(tabName, sendToReadWise.settingEl, t("Send to ReadWise"));


		const paginationSetting = new Setting(wbContainerEl)
			.setName(t("Pagination"))
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.bookmarkManager.pagination)
					.setValue(this.plugin.settings.bookmarkManager.pagination)
					.onChange(async (value) => {
						if (value === "") {
							this.plugin.settings.bookmarkManager.pagination = DEFAULT_SETTINGS.bookmarkManager.pagination;
							this.applySettingsUpdate();
							// Force refresh
							this.display();
						}
						this.plugin.settings.bookmarkManager.pagination = value;
						this.applySettingsUpdate();
					}),
			);
		this.addSettingToMasterSettingsList(tabName, paginationSetting.settingEl, t("Pagination"));

		const categorySetting = new Setting(wbContainerEl)
			.setName(t("Category"))
			.addTextArea((text) => {
				text.setPlaceholder(DEFAULT_SETTINGS.bookmarkManager.category)
					.setValue(this.plugin.settings.bookmarkManager.category)
					.onChange((value) => {
						this.plugin.settings.bookmarkManager.category = value === "" ? DEFAULT_SETTINGS.bookmarkManager.category : value;
						this.applySettingsUpdate();
					});
			});
		this.addSettingToMasterSettingsList(tabName, categorySetting.settingEl, t("Category"));

		const defaultCategory = new Setting(wbContainerEl)
			.setName(t("Default Category (Use , to split)"))
			.addText((text) => {
				text.setPlaceholder(DEFAULT_SETTINGS.bookmarkManager.defaultCategory)
					.setValue(this.plugin.settings.bookmarkManager.defaultCategory)
					.onChange((value) => {
						this.plugin.settings.bookmarkManager.defaultCategory = value;
						this.applySettingsUpdate();
					});
			});
		this.addSettingToMasterSettingsList(tabName, defaultCategory.settingEl, t("Default Category (Use , to split)"));


		const defaultColumnList = new Setting(wbContainerEl)
			.setName(t("Default Column List"))
			.addText((text) => {
				text.setPlaceholder(DEFAULT_SETTINGS.bookmarkManager.defaultColumnList.join(" "))
					.setValue(this.plugin.settings.bookmarkManager.defaultColumnList.join(" "))
					.onChange(async (value) => {
						if (value === "") {
							this.plugin.settings.bookmarkManager.defaultColumnList = DEFAULT_SETTINGS.bookmarkManager.defaultColumnList;
							this.applySettingsUpdate();
							this.display();
						}
						this.plugin.settings.bookmarkManager.defaultColumnList = value.split(" ");
						this.applySettingsUpdate();
					});
			});
		this.addSettingToMasterSettingsList(tabName, defaultColumnList.settingEl, t("Default Column List"));

		const defaultFilterType = new Setting(wbContainerEl)
			.setName(t("Default Category Filter Type"))
			.addDropdown(async (drowdown: DropdownComponent) => {
				const aDropdown = drowdown
					.addOption('tree', t('Tree'))
					.addOption('menu', t('Menu'));

				aDropdown.setValue(this.plugin.settings.bookmarkManager.defaultFilterType).onChange(async (value) => {
					this.plugin.settings.bookmarkManager.defaultFilterType = value;
					this.applySettingsUpdate();
				});
			});

		this.addSettingToMasterSettingsList(tabName, defaultFilterType.settingEl, t("Default Category Filter Type"));
	}
}
