// Surfing's settings as declarative definitions (Obsidian 1.13+).
//
// Obsidian renders, groups and searches the settings from these definitions.
// Older versions never call getSettingDefinitions() and use the imperative
// display() of SurfingSettingTab instead.
import {
	Notice,
	Platform,
	setIcon,
	SettingDefinitionItem,
	SettingGroupItem,
} from "obsidian";
import { clipboard } from "electron";
import { t } from "../translations/helper";
import type {
	AIAssistantProvider,
	SurfingSettingTab,
} from "../surfingPluginSetting";
import { DEFAULT_SETTINGS } from "../surfingPluginSetting";
import {
	checkProviderAvailability,
	getCachedAvailability,
} from "../ai/providerFactory";
import { bridgeSettingDefinitions } from "../extensions/ui/settings-tab";

/** Prefix of the keys of the Extensions page: they live in `chromeExtensions`. */
const BRIDGE_KEY_PREFIX = "chromeExtensions.";

const BOOKMARKLET =
	"javascript:(function(){var%20i%20%3Ddocument.location.href%3B%20document.location.href%3D%22obsidian%3A%2F%2Fweb-open%3Furl%3D%22%20%2B%20encodeURIComponent%28i%29%3B})();";

/**
 * How a control key is stored. Keys are dotted paths into the plugin's
 * settings; a binding adjusts the stored value for the control, or does
 * more than store it.
 */
interface ControlBinding {
	/** Stored value -> value shown in the control. */
	read?: (stored: unknown) => unknown;
	/** Value of the control -> stored value. */
	write?: (value: unknown) => unknown;
	/** Store the value some other way than writing the key. */
	store?: (tab: SurfingSettingTab, value: unknown) => Promise<void>;
	/** Runs after the value is stored and saved. */
	after?: (tab: SurfingSettingTab, value: unknown) => void | Promise<void>;
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function splitList(value: unknown, separator: string): string[] {
	return text(value)
		.split(separator)
		.map((s) => s.trim())
		.filter(Boolean);
}

const recheckProviders = async (tab: SurfingSettingTab) => {
	await checkProviderAvailability(tab.plugin.settings.aiAssistant);
};

const CONTROL_BINDINGS: Record<string, ControlBinding> = {
	ignoreList: {
		read: (stored) => (Array.isArray(stored) ? stored.join(",") : ""),
		write: (value) => text(value).split(","),
	},
	highlightFormat: {
		write: (value) => text(value) || DEFAULT_SETTINGS.highlightFormat,
	},
	"adBlock.enabled": {
		after: async (tab) => {
			await tab.plugin.adBlockManager?.reload();
		},
	},
	"bookmarkManager.bookmarkFolder": {
		write: (value) =>
			text(value) || DEFAULT_SETTINGS.bookmarkManager.bookmarkFolder,
	},
	"aiAssistant.codexCommand": {
		write: (value) => text(value).trim(),
		after: recheckProviders,
	},
	"aiAssistant.claudeCommand": {
		write: (value) => text(value).trim(),
		after: recheckProviders,
	},
	"aiAssistant.customCommand": {
		write: (value) => text(value).trim(),
	},
	"aiAssistant.pageReadBlocklist": {
		read: (stored) => (Array.isArray(stored) ? stored.join(", ") : ""),
		write: (value) => splitList(value, ","),
	},
	[`${BRIDGE_KEY_PREFIX}compatibilityEnabled`]: {
		// The bridge applies the change to the extension files and saves.
		store: async (tab, value) => {
			const bridge = tab.plugin.chromeExtensions;
			await bridge?.withNotice(() =>
				bridge.setCompatibilityEnabled(value === true),
			);
		},
		after: (tab) => tab.refreshSettings(),
	},
	[`${BRIDGE_KEY_PREFIX}debug`]: {
		after: (tab) => tab.refreshSettings(),
	},
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readPath(root: unknown, key: string): unknown {
	let node = root;
	for (const part of key.split(".")) {
		if (!isRecord(node)) return undefined;
		node = node[part];
	}
	return node;
}

function writePath(root: unknown, key: string, value: unknown): void {
	const parts = key.split(".");
	const last = parts.pop();
	let node = root;
	for (const part of parts) {
		if (!isRecord(node)) return;
		node = node[part];
	}
	if (last && isRecord(node)) node[last] = value;
}

/** The value of a control key, as the control shows it. */
export function readControl(tab: SurfingSettingTab, key: string): unknown {
	const stored = readPath(tab.plugin.settings, key);
	const read = CONTROL_BINDINGS[key]?.read;
	return read ? read(stored) : stored;
}

/** Store a value the user entered for a control key and run its side effects. */
export async function writeControl(
	tab: SurfingSettingTab,
	key: string,
	value: unknown,
): Promise<void> {
	const binding = CONTROL_BINDINGS[key];
	if (binding?.store) {
		await binding.store(tab, value);
	} else {
		writePath(
			tab.plugin.settings,
			key,
			binding?.write ? binding.write(value) : value,
		);
		if (binding?.after) {
			await tab.plugin.saveSettings();
		} else {
			tab.applySettingsUpdate();
		}
	}
	await binding?.after?.(tab, value);
	// Settings that depend on this one show or hide themselves.
	tab.refreshState();
}

/** One page per tab of the imperative settings, in the same order. */
export function getSurfingDefinitions(
	tab: SurfingSettingTab,
): SettingDefinitionItem[] {
	const pages: SettingDefinitionItem[] = [
		{
			type: "page",
			name: t("General"),
			desc: t("Links, previews, highlights and saving pages."),
			items: generalItems(tab),
		},
		{
			type: "page",
			name: t("Search"),
			desc: t("The search bar, search engines and shortcuts."),
			items: searchItems(tab),
		},
		{
			type: "page",
			name: t("Theme"),
			desc: t("How Surfing views look."),
			items: themeItems(),
		},
		{
			type: "page",
			name: t("Bookmark"),
			desc: t("The bookmark bar and the bookmark manager."),
			items: bookmarkItems(tab),
		},
		{
			type: "page",
			name: t("Ad Block"),
			desc: t("Block ads and hide elements on web pages."),
			items: adBlockItems(tab),
		},
	];
	if (Platform.isDesktop && tab.plugin.chromeExtensions) {
		pages.push({
			type: "page",
			name: t("Extensions"),
			desc: t("Install and manage Chrome extensions."),
			items: bridgeSettingDefinitions(
				tab.plugin.chromeExtensions,
				() => tab.refreshSettings(),
				BRIDGE_KEY_PREFIX,
			),
		});
	}
	if (Platform.isDesktop) {
		pages.push({
			type: "page",
			name: t("AI"),
			desc: t("The AI assistant sidebar, its providers and page access."),
			items: aiItems(tab),
		});
	}
	return pages;
}

function generalItems(tab: SurfingSettingTab): SettingDefinitionItem[] {
	const settings = tab.plugin.settings;
	return [
		{
			type: "group",
			items: [
				{
					name: t("Open URL In Same Tab"),
					control: { type: "toggle", key: "openInSameTab" },
				},
				{
					name: t("Hover Popover"),
					desc: t("Show a popover when hover on the link."),
					control: { type: "toggle", key: "hoverPopover" },
				},
				{
					name: t("Enable HTML Preview"),
					desc: t("Enable HTML Preview in Surfing"),
					control: { type: "toggle", key: "enableHtmlPreview" },
				},
				{
					name: t("Enable Tree View"),
					desc: t("Enable Tree View in Surfing"),
					control: { type: "toggle", key: "enableTreeView" },
				},
				{
					name: t("Enable Inline Preview") + " [Deprecated]",
					desc: t(
						"Enable inline preview with surfing. Currently only support Live preview",
					),
					control: { type: "toggle", key: "supportLivePreviewInlineUrl" },
				},
				{
					name: t("Show Refresh Button Near Search Bar"),
					control: { type: "toggle", key: "showRefreshButton" },
				},
			],
		},
		{
			type: "group",
			heading: t("Highlights and saving"),
			items: [
				{
					name: t("Custom Link to Highlight Format"),
					control: { type: "toggle", key: "customHighlightFormat" },
				},
				{
					name: t("Copy Link to Highlight Format"),
					desc: t(
						"Set copy link to text fragment format. [{CONTENT}]({URL}) By default. You can also set {TIME:YYYY-MM-DD HH:mm:ss} to get the current date.",
					),
					control: {
						type: "text",
						key: "highlightFormat",
						placeholder: DEFAULT_SETTINGS.highlightFormat,
					},
					visible: () => settings.customHighlightFormat,
				},
				{
					name: t("Jump to Opened Page"),
					desc: t(
						"When click on the URL from same domain name in the note, jump to the same surfing view rather than opening a new Surfing view.",
					),
					control: { type: "toggle", key: "highlightInSameTab" },
					visible: () => settings.customHighlightFormat,
				},
				{
					name: t("Save As Markdown Path"),
					control: {
						type: "text",
						key: "markdownPath",
						placeholder: t("Path like /_Tempcard"),
					},
				},
			],
		},
		{
			type: "group",
			heading: t("Integrations"),
			items: [
				{
					name:
						t("[Experimental] Replace Iframe In Canvas") +
						t("(Reload to take effect)"),
					control: { type: "toggle", key: "useWebview" },
				},
				{
					name:
						t("Open URL In Obsidian Web From Other Software") +
						" " +
						t("(Reload to take effect)"),
					control: { type: "toggle", key: "openInObsidianWeb" },
				},
				{
					name: t("Obsidian bookmarklets code"),
					desc: t("   <- Drag or click on me").trim(),
					visible: () => settings.openInObsidianWeb,
					render: (setting) => {
						const button = setting.controlEl.createEl("button", {
							cls: "wb-btn",
						});
						button.createEl("a", {
							text: t("Obsidian bookmarklets code"),
							cls: "cm-url",
							href: BOOKMARKLET,
						});
						button.addEventListener("click", (e) => {
							e.preventDefault();
							clipboard.writeText(BOOKMARKLET);
							new Notice(t("Copy BookmarkLets Success"));
						});
					},
				},
			],
		},
		{
			type: "group",
			items: [
				{
					name: "Surfing",
					render: (setting) => {
						setting.settingEl.addClass("wb-about-card");
						setIcon(
							setting.settingEl.createDiv({ cls: "wb-about-icon" }),
							"surfing",
						);
						setting.controlEl.createEl("a", {
							cls: "wb-about-version",
							href:
								"https://github.com/Quorafind/Obsidian-Surfing/releases/tag/" +
								tab.plugin.manifest.version,
							text: tab.plugin.manifest.version,
						});
					},
				},
			],
		},
	];
}

function searchItems(tab: SurfingSettingTab): SettingDefinitionItem[] {
	const settings = tab.plugin.settings;
	if (typeof settings.customSearchEngine !== "object") {
		settings.customSearchEngine = DEFAULT_SETTINGS.customSearchEngine;
	}
	const engines = settings.customSearchEngine;
	const engineOptions: Record<string, string> = {
		duckduckgo: t("DuckDuckGo"),
		google: t("Google"),
		bing: t("Bing"),
		yahoo: t("Yahoo"),
		baidu: t("Baidu"),
	};
	for (const engine of engines) engineOptions[engine.name] = engine.name;

	return [
		{
			type: "group",
			heading: t("Search bar"),
			items: [
				{
					name: t("Show Search Bar In Empty Page"),
					control: { type: "toggle", key: "showSearchBarInPage" },
				},
				{
					name: t("Show last opened files"),
					control: { type: "toggle", key: "lastOpenedFiles" },
					visible: () => settings.showSearchBarInPage,
				},
			],
		},
		{
			type: "group",
			heading: t("Search engines"),
			items: [
				{
					name: t("Default Search Engine"),
					control: {
						type: "dropdown",
						key: "defaultSearchEngine",
						options: engineOptions,
					},
				},
				{
					name:
						t("Show Other Search Engines When Searching") +
						" " +
						t("(Reload to take effect)"),
					control: { type: "toggle", key: "showOtherSearchEngines" },
				},
				{
					name: t("Focus search bar via keyboard"),
					control: { type: "toggle", key: "focusSearchBarViaKeyboard" },
				},
				{
					name: t("Disable / to search when on these sites"),
					control: {
						type: "text",
						key: "ignoreList",
						placeholder: DEFAULT_SETTINGS.ignoreList.join(","),
					},
					visible: () => settings.focusSearchBarViaKeyboard,
				},
				{
					name: t("Always Show Custom Engines"),
					control: { type: "toggle", key: "alwaysShowCustomSearch" },
				},
			],
		},
		{
			type: "list",
			heading: t("Custom search engines"),
			emptyState: t("No custom search engines."),
			visible: () => settings.alwaysShowCustomSearch,
			addItem: {
				name: t("Add new custom search engine"),
				action: () => {
					engines.push({
						name: `Custom Search ${engines.length + 1}`,
						url: "https://www.google.com/search?q=",
					});
					void tab.plugin.saveSettings();
					tab.refreshSettings();
				},
			},
			onDelete: (index) => {
				engines.splice(index, 1);
				void tab.plugin.saveSettings();
				tab.refreshSettings();
			},
			items: engines.map((engine, index) => ({
				name: engine.name
					? engine.name
					: t("Custom Search") +
						(engines.length > 1 ? ` ${index + 1}` : ""),
				aliases: [t("Search Engine"), engine.url],
				render: (setting) => {
					setting
						.addText((input) =>
							input
								.setPlaceholder(t("Name"))
								.setValue(engine.name)
								.onChange((value) => {
									engines[index] = { ...engines[index], name: value };
									tab.applySettingsUpdate();
								}),
						)
						.addText((input) =>
							input
								.setPlaceholder(t("Url"))
								.setValue(engine.url)
								.onChange((value) => {
									engines[index] = { ...engines[index], url: value };
									tab.applySettingsUpdate();
								}),
						);
				},
			})),
		},
	];
}

function themeItems(): SettingDefinitionItem[] {
	return [
		{
			type: "group",
			items: [
				{
					name:
						t("Use icon list to replace defult text actions in empty view") +
						t("(Reload to take effect)"),
					control: { type: "toggle", key: "useIconList" },
				},
				{
					name: t("Toggle Dark Mode"),
					control: { type: "toggle", key: "darkMode" },
				},
				{
					name: t("Random Background"),
					control: { type: "toggle", key: "randomBackground" },
				},
				{
					name: t("Working On, Not Available Now"),
					aliases: ["theme"],
					render: (setting) => {
						setting.settingEl.addClass("wb-theme-settings-working-on");
					},
				},
				{
					name: t("Random Icons From Default Art"),
					aliases: ["theme surfing"],
					control: {
						type: "toggle",
						key: "useCustomIcons",
						disabled: true,
					},
				},
			],
		},
	];
}

function bookmarkItems(tab: SurfingSettingTab): SettingDefinitionItem[] {
	const settings = tab.plugin.settings;
	const enabled = () => settings.bookmarkManager.openBookMark;
	return [
		{
			type: "group",
			items: [
				{
					name: t("Open BookmarkBar & Bookmark Manager"),
					control: { type: "toggle", key: "bookmarkManager.openBookMark" },
				},
				{
					name: t("Save Bookmark When Open URI"),
					control: { type: "toggle", key: "bookmarkManager.saveBookMark" },
					visible: enabled,
				},
				{
					name: t("Send to ReadWise"),
					desc: t("Add a action in page header to Send to ReadWise."),
					control: { type: "toggle", key: "bookmarkManager.sendToReadWise" },
					visible: enabled,
				},
				{
					name: t("Bookmark Folder"),
					desc: t("Vault folder where bookmark files are stored."),
					control: {
						type: "text",
						key: "bookmarkManager.bookmarkFolder",
						placeholder: DEFAULT_SETTINGS.bookmarkManager.bookmarkFolder,
					},
					visible: enabled,
				},
				{
					name: t("Default Category"),
					control: {
						type: "text",
						key: "bookmarkManager.defaultCategory",
						placeholder: DEFAULT_SETTINGS.bookmarkManager.defaultCategory,
					},
					visible: enabled,
				},
			],
		},
	];
}

function adBlockItems(tab: SurfingSettingTab): SettingDefinitionItem[] {
	const settings = tab.plugin.settings;
	const filterLists = settings.adBlock.filterLists;
	const enabled = () => settings.adBlock.enabled;
	return [
		{
			type: "group",
			items: [
				{
					name: t("Enable Ad Blocking"),
					desc: t("Block requests to domains in your filter lists."),
					control: { type: "toggle", key: "adBlock.enabled" },
				},
				{
					name: t("Enable Element Hiding"),
					desc: t("Allow picking and hiding page elements."),
					control: { type: "toggle", key: "elementHiding.enabled" },
				},
			],
		},
		{
			type: "group",
			visible: enabled,
			items: [
				{
					name: t("Filter Lists"),
					desc: t("Manage filter lists for ad blocking."),
					render: (setting) => {
						setting.addButton((button) =>
							button
								.setButtonText(t("Reload Filter Lists"))
								.onClick(async () => {
									if (tab.plugin.adBlockManager) {
										await tab.plugin.adBlockManager.reload();
										new Notice(t("Filter lists reloaded."));
									}
								}),
						);
					},
				},
			],
		},
		{
			type: "list",
			visible: enabled,
			emptyState: t("No filter lists."),
			addItem: {
				name: t("Add filter list"),
				action: () => {
					filterLists.push({
						name: "New Filter",
						url: "",
						enabled: true,
					});
					void tab.plugin.saveSettings();
					tab.refreshSettings();
				},
			},
			onDelete: (index) => {
				filterLists.splice(index, 1);
				void tab.plugin.saveSettings();
				tab.refreshSettings();
			},
			items: filterLists.map((filterList, index) => ({
				name: filterList.name || t("Filter Lists"),
				aliases: [filterList.url],
				render: (setting) => {
					setting
						.addText((input) =>
							input
								.setPlaceholder("Name")
								.setValue(filterList.name)
								.onChange(async (value) => {
									filterLists[index].name = value;
									await tab.plugin.saveSettings();
								}),
						)
						.addText((input) =>
							input
								.setPlaceholder("URL or vault path")
								.setValue(filterList.url)
								.onChange(async (value) => {
									filterLists[index].url = value;
									await tab.plugin.saveSettings();
								}),
						)
						.addToggle((toggle) =>
							toggle
								.setValue(filterList.enabled)
								.onChange(async (value) => {
									filterLists[index].enabled = value;
									await tab.plugin.saveSettings();
								}),
						);
				},
			})),
		},
	];
}

/** The status of the AI providers, with install links and a refresh link. */
function providerStatus(tab: SurfingSettingTab): DocumentFragment {
	const availability = getCachedAvailability();
	const codex = availability.codex
		? "Codex: OK"
		: `Codex: ${t("not installed")}`;
	const claude = availability.claude
		? "Claude Code: OK"
		: `Claude Code: ${t("not installed")}`;
	return createFragment((frag) => {
		frag.appendText(`${codex} | ${claude} `);
		if (!availability.codex || !availability.claude) {
			frag.appendText("— ");
			if (!availability.codex) {
				frag.createEl("a", {
					text: t("Install Codex"),
					href: "https://github.com/openai/codex",
				}).setAttr("target", "_blank");
				frag.appendText(" ");
			}
			if (!availability.claude) {
				frag.createEl("a", {
					text: t("Install Claude Code"),
					href: "https://docs.anthropic.com/en/docs/claude-code/overview",
				}).setAttr("target", "_blank");
			}
		}
		frag.createEl("br");
		frag.createEl("a", {
			text: t("Refresh Status"),
			href: "#",
		}).addEventListener("click", (e) => {
			e.preventDefault();
			void checkProviderAvailability(tab.plugin.settings.aiAssistant).then(
				() => tab.refreshSettings(),
			);
		});
	});
}

function aiItems(tab: SurfingSettingTab): SettingDefinitionItem[] {
	const settings = tab.plugin.settings;
	const defaults = DEFAULT_SETTINGS.aiAssistant;
	const enabled = () => settings.aiAssistant.enabled;
	const availability = getCachedAvailability();
	const providers: Record<AIAssistantProvider, string> = {
		codex: availability.codex
			? t("Codex")
			: `${t("Codex")} (${t("not installed")})`,
		claude: availability.claude
			? t("Claude Code")
			: `${t("Claude Code")} (${t("not installed")})`,
		custom: t("Custom"),
	};
	const assistant: SettingGroupItem[] = [
		{
			name: t("Open AI Sidebar By Default"),
			control: { type: "toggle", key: "aiAssistant.openByDefault" },
		},
		{
			name: t("Default AI Provider"),
			control: {
				type: "dropdown",
				key: "aiAssistant.defaultProvider",
				options: providers,
			},
		},
		{
			name: t("Provider Status"),
			desc: providerStatus(tab),
		},
		{
			name: t("Include Current Page Text In Prompt"),
			control: { type: "toggle", key: "aiAssistant.includePageText" },
		},
		{
			name: t("Max Page Text Length"),
			control: {
				type: "slider",
				key: "aiAssistant.maxPageTextLength",
				min: 500,
				max: 12000,
				step: 100,
			},
		},
		{
			name: t("AI System Prompt"),
			desc: t(
				"Use placeholders: {prompt}, {url}, {title}, {selection}, {page_text}.",
			),
			control: { type: "textarea", key: "aiAssistant.systemPrompt" },
		},
	];
	const commands: SettingGroupItem[] = [
		{
			name: t("Codex Command"),
			desc: t(
				"Command name or full path to the Codex CLI executable. e.g. codex or C:\\\\Users\\\\you\\\\.npm\\\\codex",
			),
			control: {
				type: "text",
				key: "aiAssistant.codexCommand",
				placeholder: defaults.codexCommand,
			},
		},
		{
			name: t("Claude Command"),
			desc: t(
				"Command name or full path to the Claude Code executable. e.g. claude or /usr/local/bin/claude",
			),
			control: {
				type: "text",
				key: "aiAssistant.claudeCommand",
				placeholder: defaults.claudeCommand,
			},
		},
		{
			name: t("Custom AI Command"),
			control: {
				type: "text",
				key: "aiAssistant.customCommand",
				placeholder: defaults.customCommand,
			},
		},
		{
			name: t("Custom AI Arguments"),
			control: {
				type: "text",
				key: "aiAssistant.customArgs",
				placeholder: defaults.customArgs,
			},
		},
	];
	const access: SettingGroupItem[] = [
		{
			name: t("Independent Sessions Per Tab"),
			desc: t(
				"Each browser tab gets its own session with separate cookies. Requires reload.",
			),
			control: { type: "toggle", key: "sessionIsolation" },
		},
		{
			name: t("Page Read Blocklist"),
			desc: t(
				"Domains where AI cannot read page content. Comma-separated, e.g. bank.com,mail.google.com",
			),
			control: {
				type: "text",
				key: "aiAssistant.pageReadBlocklist",
				placeholder: "bank.com, mail.google.com",
			},
		},
		{
			name: t("Enable MCP Page Server"),
			desc: t("Expose current page as MCP tool for AI CLIs."),
			control: { type: "toggle", key: "aiAssistant.enableMCPServer" },
		},
	];
	return [
		{
			type: "group",
			items: [
				{
					name: t("Enable Surfing AI Assistant Sidebar"),
					desc: t("Show a right-side AI chat panel in Surfing view."),
					control: { type: "toggle", key: "aiAssistant.enabled" },
				},
			],
		},
		{ type: "group", visible: enabled, items: assistant },
		{
			type: "group",
			heading: t("AI commands"),
			visible: enabled,
			items: commands,
		},
		{
			type: "group",
			heading: t("Pages and sessions"),
			visible: enabled,
			items: access,
		},
	];
}
