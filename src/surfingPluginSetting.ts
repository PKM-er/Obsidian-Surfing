import {
	App,
	DropdownComponent,
	Notice,
	Platform,
	PluginSettingTab,
	requireApiVersion,
	setIcon,
	Setting,
	SettingDefinitionItem,
} from "obsidian";
import { t } from "./translations/helper";
import { clipboard } from "electron";
import SurfingPlugin from "./surfingIndex";
import { TreeNode } from "./component/TabTreeView/types";
import { FilterListEntry } from "./types/adblock";
import {
	BridgeSettings,
	DEFAULT_SETTINGS as DEFAULT_BRIDGE_SETTINGS,
} from "./extensions/types";
import { renderBridgeSettings } from "./extensions/ui/settings-tab";
import { groupSettings } from "./utils/settingGroups";
import {
	getSurfingDefinitions,
	maskToken,
	readControl,
	writeControl,
} from "./settings/definitions";
import { SEARCH_ENGINES, SearchEngine } from "./searchEngines";
import { TxtFileSuggester } from "./component/suggester/txtFileSuggester";

export { SEARCH_ENGINES, type SearchEngine };

type TabContentInfo = {
	content: HTMLElement;
	navButton: HTMLElement;
};

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
		bookmarkFolder: string;
		defaultCategory: string;
		bookmarksMigrated: boolean;
	};
	treeData: TreeNode[];
	enableHtmlPreview: boolean;
	supportLivePreviewInlineUrl: boolean;
	enableTreeView: boolean;
	focusSearchBarViaKeyboard: boolean;
	/** The MCP server that lets external AI agents control web pages (src/mcp). */
	mcp: {
		enabled: boolean;
		port: number;
		/** Bearer token clients must send; generated the first time the server is enabled. */
		token: string;
		/** "ask": prompt the first time an agent uses a site. "allow": no prompts. */
		siteAccess: "ask" | "allow";
		approvedSites: string[];
		/** Domains agents must not read or act on. */
		blockedSites: string[];
		/** Offer the javascript tool, which runs code in pages. */
		allowScripts: boolean;
	};
	sessionIsolation: boolean;
	adBlock: {
		enabled: boolean;
		filterLists: FilterListEntry[];
	};
	/** Chrome extensions (src/extensions). */
	chromeExtensions: BridgeSettings;
	elementHiding: {
		enabled: boolean;
	};
}


export const DEFAULT_SETTINGS: SurfingSettings = {
	defaultSearchEngine: "duckduckgo",
	customSearchEngine: [
		{
			name: "duckduckgo",
			url: "https://duckduckgo.com/?q=",
		},
	],
	hoverPopover: true,
	ignoreList: ["notion", "craft"],
	alwaysShowCustomSearch: false,
	showOtherSearchEngines: false,
	showSearchBarInPage: false,
	markdownPath: "/",
	customHighlightFormat: false,
	highlightFormat: "[{CONTENT}]({URL})",
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
		bookmarkFolder: "surfing-bookmarks",
		defaultCategory: "ROOT",
		bookmarksMigrated: false,
	},
	treeData: [],
	enableHtmlPreview: true,
	supportLivePreviewInlineUrl: false,
	enableTreeView: false,
	focusSearchBarViaKeyboard: true,
	mcp: {
		enabled: false,
		port: 27125,
		token: "",
		siteAccess: "ask",
		approvedSites: [],
		blockedSites: [],
		allowScripts: false,
	},
	sessionIsolation: false,
	adBlock: {
		enabled: false,
		filterLists: [],
	},
	elementHiding: {
		enabled: true,
	},
	chromeExtensions: DEFAULT_BRIDGE_SETTINGS,
};

const tabNameToTabIconId = {
	General: "chrome",
	Search: "search",
	Theme: "brush",
	Bookmark: "bookmark",
	"Ad Block": "shield",
	Extensions: "puzzle",
	MCP: "plug",
} as const;

type TabName = keyof typeof tabNameToTabIconId;

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
	private tabContent: Map<string, TabContentInfo> = new Map<
		string,
		TabContentInfo
	>();
	private selectedTab = "General";
	private navigateEl!: HTMLElement;

	constructor(app: App, plugin: SurfingPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		if (requireApiVersion("1.11.0")) this.icon = "surfing";
	}

	/** Obsidian 1.13+ renders and searches the settings from these. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return getSurfingDefinitions(this);
	}

	getControlValue(key: string): unknown {
		return readControl(this, key);
	}

	setControlValue(key: string, value: unknown): Promise<void> {
		return writeControl(this, key, value);
	}

	/** Rebuild the page after its items changed (Obsidian 1.13+). */
	refreshSettings() {
		if (requireApiVersion("1.13.0")) this.update();
	}

	/** Re-evaluate which settings are visible or disabled (Obsidian 1.13+). */
	refreshState() {
		if (requireApiVersion("1.13.0")) this.refreshDomState();
	}

	public applySettingsUpdate() {
		window.clearTimeout(this.applyDebounceTimer);
		const plugin = this.plugin;
		this.applyDebounceTimer = window.setTimeout(() => {
			void plugin.saveSettings();
		}, 100);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.generateSettingsTitle();
		this.addTabHeader();
	}

	private generateSettingsTitle() {
		const linterHeader = this.containerEl.createDiv("wb-setting-title");
		new Setting(linterHeader).setName("Web browser").setHeading();
	}

	private addTabHeader() {
		const navContainer = this.containerEl.createEl("nav", {
			cls: "wb-setting-header",
		});
		this.navigateEl = navContainer.createDiv("wb-setting-tab-group");
		const settingsEl = this.containerEl.createDiv("wb-setting-content");

		this.createTabAndContent(
			"General",
			this.navigateEl,
			settingsEl,
			(el: HTMLElement, tabName: string) =>
				this.generateGeneralSettings(tabName, el),
		);
		this.createTabAndContent(
			"Search",
			this.navigateEl,
			settingsEl,
			(el: HTMLElement, tabName: string) =>
				this.generateSearchSettings(tabName, el),
		);
		this.createTabAndContent(
			"Theme",
			this.navigateEl,
			settingsEl,
			(el: HTMLElement, tabName: string) =>
				this.generateThemeSettings(tabName, el),
		);
		this.createTabAndContent(
			"Bookmark",
			this.navigateEl,
			settingsEl,
			(el: HTMLElement, tabName: string) =>
				this.generateBookmarkManagerSettings(tabName, el),
		);
		this.createTabAndContent(
			"Ad Block",
			this.navigateEl,
			settingsEl,
			(el: HTMLElement, tabName: string) =>
				this.generateAdBlockSettings(tabName, el),
		);
		Platform.isDesktop &&
			this.plugin.chromeExtensions &&
			this.createTabAndContent(
				"Extensions",
				this.navigateEl,
				settingsEl,
				(el: HTMLElement) => this.generateExtensionsSettings(el),
			);
		Platform.isDesktop &&
			this.plugin.mcp &&
			this.createTabAndContent(
				"MCP",
				this.navigateEl,
				settingsEl,
				(el: HTMLElement) => this.generateMcpSettings(el),
			);
	}

	createTabAndContent(
		tabName: TabName,
		navigateEl: HTMLElement,
		containerEl: HTMLElement,
		generateTabContent?: (el: HTMLElement, tabName: TabName) => void,
	) {
		const displayTabContent = this.selectedTab === tabName;
		const tabEl = navigateEl.createDiv("wb-navigation-item");

		const tabClass = "wb-desktop";
		tabEl.addClass(tabClass);

		setIcon(
			tabEl.createDiv({ cls: "wb-navigation-item-icon" }),
			tabNameToTabIconId[tabName],
		);
		tabEl.createSpan().setText(t(tabName));

		tabEl.onclick = () => {
			if (this.selectedTab == tabName) {
				return;
			}

			tabEl.addClass("wb-navigation-item-selected");
			const tab = this.tabContent.get(tabName);
			(tab?.content as HTMLElement).show();

			const tabInfo = this.tabContent.get(this.selectedTab);
			tabInfo?.navButton.removeClass("wb-navigation-item-selected");
			tabInfo?.content.hide();

			this.selectedTab = tabName;
		};

		const tabContent = containerEl.createDiv("wb-tab-settings");

		tabContent.id = tabName.toLowerCase().replace(" ", "-");
		if (!displayTabContent) {
			(tabContent as HTMLElement).hide();
		} else {
			tabEl.addClass("wb-navigation-item-selected");
		}

		if (generateTabContent) {
			generateTabContent(tabContent, tabName);
			groupSettings(tabContent);
		}

		this.tabContent.set(tabName, {
			content: tabContent,
			navButton: tabEl,
		});
	}

	private generateGeneralSettings(
		tabName: string,
		wbContainerEl: HTMLElement,
	) {
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

	private generateSearchSettings(
		tabName: string,
		wbContainerEl: HTMLElement,
	): void {
		this.addInpageSearch(tabName, wbContainerEl);
		this.addSearchEngine(tabName, wbContainerEl);
	}

	private generateThemeSettings(
		tabName: string,
		wbContainerEl: HTMLElement,
	): void {
		this.useIconList(tabName, wbContainerEl);
		this.addDarkMode(tabName, wbContainerEl);
		this.addRandomBackground(tabName, wbContainerEl);
		this.addMyIcons(tabName, wbContainerEl);
	}

	/** Show this page the next time the settings open. */
	selectTab(tabName: string) {
		this.selectedTab = tabName;
	}

	/** A minimal MCP page for Obsidian versions without declarative settings. */
	private generateMcpSettings(wbContainerEl: HTMLElement): void {
		const controller = this.plugin.mcp;
		if (!controller) return;
		const settings = this.plugin.settings.mcp;
		const content = wbContainerEl.createDiv();
		const render = () => {
			content.empty();
			new Setting(content)
				.setName(t("Enable MCP server"))
				.setDesc(t("Lets AI agents such as Claude Code and Codex CLI read and control the web pages open in Obsidian. Only programs on this computer that have the access token can connect."))
				.addToggle((toggle) =>
					toggle.setValue(settings.enabled).onChange(async (value) => {
						await controller.setEnabled(value);
						render();
					}),
				);
			if (settings.enabled) {
				new Setting(content).setName(t("Status")).setDesc(controller.statusText());
			}
			new Setting(content)
				.setName(t("Port"))
				.setDesc(t("The server listens on this port of 127.0.0.1 only."))
				.addText((text) =>
					text.setValue(String(settings.port)).onChange(async (value) => {
						const port = Number(value);
						if (!Number.isInteger(port) || port < 1024 || port > 65535) return;
						await controller.setPort(port);
					}),
				);
			if (!settings.enabled) return;
			new Setting(content)
				.setName(t("Access token"))
				.setDesc(maskToken(settings.token))
				.addButton((button) =>
					button.setButtonText(t("Copy")).onClick(() => {
						clipboard.writeText(settings.token);
						new Notice(t("Copied."));
					}),
				)
				.addButton((button) =>
					button
						.setButtonText(t("Regenerate"))
						.setWarning()
						.onClick(async () => {
							await controller.regenerateToken();
							new Notice(t("New token generated. Update the clients you connected."));
							render();
						}),
				);
			const claudeCode = controller.snippets().claudeCode;
			new Setting(content)
				.setName("Claude Code")
				.setDesc(claudeCode.split(settings.token).join(maskToken(settings.token)))
				.addButton((button) =>
					button.setButtonText(t("Copy")).onClick(() => {
						clipboard.writeText(claudeCode);
						new Notice(t("Copied."));
					}),
				);
		};
		render();
	}

	private generateExtensionsSettings(wbContainerEl: HTMLElement): void {
		const bridge = this.plugin.chromeExtensions;
		if (!bridge) return;
		const content = wbContainerEl.createDiv();
		const render = () => {
			content.empty();
			renderBridgeSettings(content, bridge, render);
			groupSettings(content);
		};
		render();
	}

	private generateBookmarkManagerSettings(
		tabName: string,
		wbContainerEl: HTMLElement,
	): void {
		this.addBookmarkManagerSettings(tabName, wbContainerEl);
	}

	private addRefreshButton(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = t("Show Refresh Button Near Search Bar");
		new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.showRefreshButton)
					.onChange(async (value) => {
						this.plugin.settings.showRefreshButton = value;
						this.applySettingsUpdate();
					});
			});
	}

	private addInpageSearch(tabName: string, wbContainerEl: HTMLElement) {
		let settingName = t("Show Search Bar In Empty Page");
		new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.showSearchBarInPage)
					.onChange(async (value) => {
						this.plugin.settings.showSearchBarInPage = value;
						this.applySettingsUpdate();

						window.setTimeout(() => {
							this.display();
						}, 200);
					});
			});

		if (!this.plugin.settings.showSearchBarInPage) {
			return;
		}

		settingName = "Show last opened files";
		new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.lastOpenedFiles)
					.onChange(async (value) => {
						this.plugin.settings.lastOpenedFiles = value;
						this.applySettingsUpdate();
					});
			});
	}

	private addSearchEngine(tabName: string, wbContainerEl: HTMLElement) {
		let settingName = t("Default Search Engine");
		new Setting(wbContainerEl)
			.setName(settingName)
			.addDropdown(async (drowdown: DropdownComponent) => {
				const aDropdown = drowdown
					.addOption("duckduckgo", t("DuckDuckGo"))
					.addOption("google", t("Google"))
					.addOption("bing", t("Bing"))
					.addOption("yahoo", t("Yahoo"))
					.addOption("baidu", t("Baidu"));

				this.plugin.settings.customSearchEngine.forEach(
					(value, key) => {
						aDropdown.addOption(value.name, value.name);
					},
				);

				aDropdown
					.setValue(this.plugin.settings.defaultSearchEngine)
					.onChange(async (value) => {
						this.plugin.settings.defaultSearchEngine = value;
						this.applySettingsUpdate();
						// Force refresh
						this.display();
					});
			});

		settingName =
			t("Show Other Search Engines When Searching") +
			" " +
			t("(Reload to take effect)");
		new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.showOtherSearchEngines)
					.onChange(async (value) => {
						this.plugin.settings.showOtherSearchEngines = value;
						this.applySettingsUpdate();
					});
			});

		settingName = t("Focus search bar via keyboard");
		new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.focusSearchBarViaKeyboard)
					.onChange(async (value) => {
						this.plugin.settings.focusSearchBarViaKeyboard = value;
						this.applySettingsUpdate();

						window.setTimeout(() => {
							this.display();
						}, 200);
					});
			});

		if (this.plugin.settings.focusSearchBarViaKeyboard) {
			settingName = t("Disable / to search when on these sites");
			new Setting(wbContainerEl)
				.setName(settingName)
				.addText((text) => {
					text.setPlaceholder(DEFAULT_SETTINGS.ignoreList.join(","))
						.setValue(this.plugin.settings.ignoreList.join(","))
						.onChange(async (value) => {
							this.plugin.settings.ignoreList = value.split(",");
							this.applySettingsUpdate();
						});
				});
		}

		settingName = t("Always Show Custom Engines");
		new Setting(wbContainerEl)
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

		if (!this.plugin.settings.alwaysShowCustomSearch) {
			return;
		}

		if (typeof this.plugin.settings.customSearchEngine !== "object") {
			this.plugin.settings.customSearchEngine =
				DEFAULT_SETTINGS.customSearchEngine;
		}

		settingName = t("Add new custom search engine");
		new Setting(wbContainerEl)
			.setName(settingName)
			.addButton((button) =>
				button.setButtonText("+").onClick(async () => {
					this.plugin.settings.customSearchEngine.push({
						name: `Custom Search ${
							this.plugin.settings.customSearchEngine.length + 1
						}`,
						url: "https://www.google.com/search?q=",
					});
					await this.plugin.saveSettings();
					this.display();
				}),
			);

		this.plugin.settings.customSearchEngine.forEach(
			(searchEngine, index) => {
				settingName = searchEngine.name
					? searchEngine.name
					: t("Custom Search") +
						`${
							this.plugin.settings.customSearchEngine.length > 1
								? ` ${index + 1}`
								: ""
						}`;
				const topLevelSetting = new Setting(wbContainerEl)
					.setClass("search-engine-setting")
					.setName(settingName)
					.addButton((button) =>
						button
							.setButtonText(t("Delete Custom Search"))
							.onClick(async () => {
								this.plugin.settings.customSearchEngine.splice(
									index,
									1,
								);
								await this.plugin.saveSettings();
								this.display();
							}),
					);

				const mainSettingsEl = topLevelSetting.settingEl.createDiv(
					"search-engine-main-settings",
				);

				const mainSettingsNameEl = mainSettingsEl.createDiv(
					"search-engine-main-settings-name",
				);
				const mainSettingsUrlEl = mainSettingsEl.createDiv(
					"search-engine-main-settings-url",
				);

				mainSettingsNameEl.createEl("label", { text: t("Name") });
				mainSettingsNameEl
					.createEl("input", {
						cls: "search-engine-name-input",
						type: "text",
						value: searchEngine.name,
					})
					.on(
						"change",
						".search-engine-name-input",
						async (evt: Event) => {
							const target = evt.target as HTMLInputElement;
							this.plugin.settings.customSearchEngine[index] = {
								...searchEngine,
								name: target.value,
							};
							await this.plugin.saveSettings();
						},
					);

				mainSettingsUrlEl.createEl("label", { text: t("Url") });
				mainSettingsUrlEl
					.createEl("input", {
						cls: "search-engine-url-input",
						type: "text",
						value: searchEngine.url,
					})
					.on(
						"change",
						".search-engine-url-input",
						async (evt: Event) => {
							const target = evt.target as HTMLInputElement;
							this.plugin.settings.customSearchEngine[index] = {
								...searchEngine,
								url: target.value,
							};
							await this.plugin.saveSettings();
						},
					);
			},
		);
	}

	private addMarkdownPath(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = t("Save As Markdown Path");
		new Setting(wbContainerEl)
			.setName(settingName)
			.addText((text) =>
				text
					.setPlaceholder(t("Path like /_Tempcard"))
					.setValue(this.plugin.settings.markdownPath)
					.onChange(async (value) => {
						this.plugin.settings.markdownPath = value;
						this.applySettingsUpdate();
					}),
			);
	}

	private addHighlightFormat(tabName: string, wbContainerEl: HTMLElement) {
		let settingName = t("Custom Link to Highlight Format");
		new Setting(wbContainerEl)
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

		if (!this.plugin.settings.customHighlightFormat) {
			return;
		}

		settingName = t("Copy Link to Highlight Format");
		let settingDesc = t(
			"Set copy link to text fragment format. [{CONTENT}]({URL}) By default. You can also set {TIME:YYYY-MM-DD HH:mm:ss} to get the current date.",
		);
		new Setting(wbContainerEl)
			.setName(settingName)
			.setDesc(settingDesc)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.highlightFormat)
					.setValue(this.plugin.settings.highlightFormat)
					.onChange(async (value) => {
						if (value === "") {
							this.plugin.settings.highlightFormat =
								DEFAULT_SETTINGS.highlightFormat;
							this.applySettingsUpdate();
							// Force refresh
							this.display();
						}
						this.plugin.settings.highlightFormat = value;
						this.applySettingsUpdate();
					}),
			);

		settingName = t("Jump to Opened Page");
		settingDesc = t(
			"When click on the URL from same domain name in the note, jump to the same surfing view rather than opening a new Surfing view.",
		);
		new Setting(wbContainerEl)
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
	}

	private addOpenInSameTab(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = t("Open URL In Same Tab");
		new Setting(wbContainerEl)
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
	}

	private addHoverPopover(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = t("Hover Popover");
		const settingDesc = t("Show a popover when hover on the link.");
		new Setting(wbContainerEl)
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
	}

	private addEnableHTMLPreview(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = t("Enable HTML Preview");
		const settingDesc = t("Enable HTML Preview in Surfing");
		new Setting(wbContainerEl)
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
	}

	private addTreeView(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = t("Enable Tree View");
		const settingDesc = t("Enable Tree View in Surfing");
		new Setting(wbContainerEl)
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
	}

	private addInlinePreview(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = t("Enable Inline Preview") + " [Deprecated]";
		const settingDesc = t(
			"Enable inline preview with surfing. Currently only support Live preview",
		);
		new Setting(wbContainerEl)
			.setName(settingName)
			.setDesc(settingDesc)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.supportLivePreviewInlineUrl)
					.onChange(async (value) => {
						this.plugin.settings.supportLivePreviewInlineUrl =
							value;
						this.applySettingsUpdate();
					});
			});
	}

	private addReplaceIframeInCanvas(
		tabName: string,
		wbContainerEl: HTMLElement,
	) {
		const settingName =
			t("[Experimental] Replace Iframe In Canvas") +
			t("(Reload to take effect)");
		new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.useWebview)
					.onChange(async (value) => {
						this.plugin.settings.useWebview = value;
						this.applySettingsUpdate();
					});
			});
	}

	private addOpenInObsidianWeb(tabName: string, wbContainerEl: HTMLElement) {
		const settingName =
			t("Open URL In Obsidian Web From Other Software") +
			" " +
			t("(Reload to take effect)");
		new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.openInObsidianWeb)
					.onChange(async (value) => {
						this.plugin.settings.openInObsidianWeb = value;
						this.applySettingsUpdate();
						this.display();
					});
			});

		if (!this.plugin.settings.openInObsidianWeb) {
			return;
		}

		const bookmarkLetsContainerEl = wbContainerEl.createDiv({
			cls: "bookmarklets-container",
		});
		const bookmarkLetsBtn = bookmarkLetsContainerEl.createEl("button", {
			cls: "wb-btn",
		});

		bookmarkLetsBtn.createEl("a", {
			text: "Obsidian bookmarklets code",
			cls: "cm-url",
			href: "javascript:(function(){var%20i%20%3Ddocument.location.href%3B%20document.location.href%3D%22obsidian%3A%2F%2Fweb-open%3Furl%3D%22%20%2B%20encodeURIComponent%28i%29%3B})();",
		});
		bookmarkLetsBtn.addEventListener("click", (e) => {
			e.preventDefault();
			clipboard.writeText(
				`javascript:(function(){var%20i%20%3Ddocument.location.href%3B%20document.location.href%3D%22obsidian%3A%2F%2Fweb-open%3Furl%3D%22%20%2B%20encodeURIComponent%28i%29%3B})();`,
			);
			new Notice(t("Copy BookmarkLets Success"));
		});
		bookmarkLetsContainerEl.createSpan({
			cls: "wb-btn-tip",
			text: t("   <- Drag or click on me"),
		});
	}

	private addAboutInfo(tabName: string, wbContainerEl: HTMLElement) {
		const bookmarkLetsContainerEl = wbContainerEl.createDiv({
			cls: "wb-about-card",
		});

		setIcon(
			bookmarkLetsContainerEl.createDiv({ cls: "wb-about-icon" }),
			"surfing",
		);

		bookmarkLetsContainerEl.createDiv({
			cls: "wb-about-text",
			text: "Surfing",
		});

		const text = this.plugin.manifest.version;
		const url =
			"https://github.com/Quorafind/Obsidian-Surfing/releases/tag/" +
			text;

		bookmarkLetsContainerEl.createEl("a", {
			cls: "wb-about-version",
			href: url,
			text: text,
		});
	}

	// TODO: Refresh all empty view.
	private useIconList(tabName: string, wbContainerEl: HTMLElement) {
		const settingName =
			t("Use icon list to replace defult text actions in empty view") +
			t("(Reload to take effect)");
		new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.useIconList)
					.onChange(async (value) => {
						this.plugin.settings.useIconList = value;
						this.applySettingsUpdate();
					});
			});
	}

	private addDarkMode(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = t("Toggle Dark Mode");
		new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.darkMode)
					.onChange(async (value) => {
						this.plugin.settings.darkMode = value;
						this.applySettingsUpdate();
					});
			});
	}

	private addRandomBackground(tabName: string, wbContainerEl: HTMLElement) {
		const settingName = "Random Background";
		new Setting(wbContainerEl)
			.setName(settingName)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.randomBackground)
					.onChange(async (value) => {
						this.plugin.settings.randomBackground = value;
						this.applySettingsUpdate();
					});
			});
	}

	private addMyIcons(tabName: string, wbContainerEl: HTMLElement) {
		let settingName = t("Working On, Not Available Now");
		const setting = new Setting(wbContainerEl).setName(settingName);

		setting.settingEl.classList.add("wb-theme-settings-working-on");

		settingName = t("Random Icons From Default Art");
		new Setting(wbContainerEl)
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
	}

	private addBookmarkManagerSettings(
		tabName: string,
		wbContainerEl: HTMLElement,
	) {
		new Setting(wbContainerEl)
			.setName(t("Open BookmarkBar & Bookmark Manager"))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.bookmarkManager.openBookMark)
					.onChange(async (value) => {
						this.plugin.settings.bookmarkManager.openBookMark =
							value;
						this.applySettingsUpdate();
						this.display();
					});
			});

		if (!this.plugin.settings.bookmarkManager.openBookMark) return;

		new Setting(wbContainerEl)
			.setName(t("Save Bookmark When Open URI"))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.bookmarkManager.saveBookMark)
					.onChange(async (value) => {
						this.plugin.settings.bookmarkManager.saveBookMark =
							value;
						this.applySettingsUpdate();
					});
			});

		new Setting(wbContainerEl)
			.setName(t("Send to ReadWise"))
			.setDesc(t("Add a action in page header to Send to ReadWise."))
			.addToggle((toggle) => {
				toggle
					.setValue(
						this.plugin.settings.bookmarkManager.sendToReadWise,
					)
					.onChange(async (value) => {
						this.plugin.settings.bookmarkManager.sendToReadWise =
							value;
						this.applySettingsUpdate();
					});
			});

		new Setting(wbContainerEl)
			.setName(t("Bookmark Folder"))
			.setDesc(t("Vault folder where bookmark files are stored."))
			.addText((text) => {
				text.setPlaceholder(
					DEFAULT_SETTINGS.bookmarkManager.bookmarkFolder,
				)
					.setValue(
						this.plugin.settings.bookmarkManager.bookmarkFolder,
					)
					.onChange((value) => {
						this.plugin.settings.bookmarkManager.bookmarkFolder =
							value ||
							DEFAULT_SETTINGS.bookmarkManager.bookmarkFolder;
						this.applySettingsUpdate();
					});
			});

		new Setting(wbContainerEl)
			.setName(t("Default Category"))
			.addText((text) => {
				text.setPlaceholder(
					DEFAULT_SETTINGS.bookmarkManager.defaultCategory,
				)
					.setValue(
						this.plugin.settings.bookmarkManager.defaultCategory,
					)
					.onChange((value) => {
						this.plugin.settings.bookmarkManager.defaultCategory =
							value;
						this.applySettingsUpdate();
					});
			});
	}

	private generateAdBlockSettings(
		tabName: string,
		wbContainerEl: HTMLElement,
	) {
		let settingName = t("Enable Ad Blocking");
		new Setting(wbContainerEl)
			.setName(settingName)
			.setDesc(t("Block requests to domains in your filter lists."))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.adBlock.enabled)
					.onChange(async (value) => {
						this.plugin.settings.adBlock.enabled = value;
						await this.plugin.saveSettings();
						if (this.plugin.adBlockManager) {
							await this.plugin.adBlockManager.reload();
						}
						this.display();
					}),
			);

		settingName = t("Enable Element Hiding");
		new Setting(wbContainerEl)
			.setName(settingName)
			.setDesc(t("Allow picking and hiding page elements."))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.elementHiding.enabled)
					.onChange(async (value) => {
						this.plugin.settings.elementHiding.enabled = value;
						await this.plugin.saveSettings();
					}),
			);

		if (this.plugin.settings.adBlock.enabled) {
			settingName = t("Filter Lists");
			const filterListSetting = new Setting(wbContainerEl)
				.setName(settingName)
				.setDesc(t("Manage filter lists for ad blocking."));

			filterListSetting.addButton((button) =>
				button.setButtonText("+").onClick(async () => {
					this.plugin.settings.adBlock.filterLists.push({
						name: "New Filter",
						url: "",
						enabled: true,
					});
					await this.plugin.saveSettings();
					this.display();
				}),
			);

			filterListSetting.addButton((button) =>
				button
					.setButtonText(t("Reload Filter Lists"))
					.onClick(async () => {
						if (this.plugin.adBlockManager) {
							await this.plugin.adBlockManager.reload();
							new Notice(t("Filter lists reloaded."));
						}
					}),
			);

			this.plugin.settings.adBlock.filterLists.forEach(
				(filterList, index) => {
					const filterSetting = new Setting(wbContainerEl).setClass(
						"search-engine-setting",
					);

					filterSetting.addText((text) =>
						text
							.setPlaceholder("Name")
							.setValue(filterList.name)
							.onChange(async (value) => {
								this.plugin.settings.adBlock.filterLists[
									index
								].name = value;
								await this.plugin.saveSettings();
							}),
					);

					filterSetting.addText((text) => {
						text
							.setPlaceholder("URL or vault path")
							.setValue(filterList.url)
							.onChange(async (value) => {
								this.plugin.settings.adBlock.filterLists[
									index
								].url = value;
								await this.plugin.saveSettings();
							});
						new TxtFileSuggester(this.app, text.inputEl);
					});

					filterSetting.addToggle((toggle) =>
						toggle
							.setValue(filterList.enabled)
							.onChange(async (value) => {
								this.plugin.settings.adBlock.filterLists[
									index
								].enabled = value;
								await this.plugin.saveSettings();
							}),
					);

					filterSetting.addExtraButton((button) =>
						button.setIcon("trash").onClick(async () => {
							this.plugin.settings.adBlock.filterLists.splice(
								index,
								1,
							);
							await this.plugin.saveSettings();
							this.display();
						}),
					);
				},
			);
		}
	}
}
