// Surfing's settings as declarative definitions (Obsidian 1.13+).
//
// Obsidian renders, groups and searches the settings from these definitions.
// Older versions never call getSettingDefinitions() and use the imperative
// display() of SurfingSettingTab instead.
import {
	Notice,
	Platform,
	setIcon,
	Setting,
	SettingDefinitionItem,
	SettingGroupItem,
} from "obsidian";
import { clipboard } from "electron";
import { t } from "../translations/helper";
import type { SurfingSettingTab } from "../surfingPluginSetting";
import { DEFAULT_SETTINGS } from "../surfingPluginSetting";
import { bridgeSettingDefinitions } from "../extensions/ui/settings-tab";
import { TxtFileSuggester } from "../component/suggester/txtFileSuggester";

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
	"mcp.enabled": {
		// The controller generates the token, saves and starts or stops the server.
		store: async (tab, value) => {
			await tab.plugin.mcp?.setEnabled(value === true);
		},
		after: (tab) => tab.refreshSettings(),
	},
	"mcp.port": {
		store: async (tab, value) => {
			await tab.plugin.mcp?.setPort(typeof value === "number" ? value : DEFAULT_SETTINGS.mcp.port);
		},
		after: (tab) => tab.refreshSettings(),
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
	if (Platform.isDesktop && tab.plugin.mcp) {
		pages.push({
			type: "page",
			name: t("MCP"),
			desc: t("Let AI agents see and control the web pages open in Obsidian."),
			items: mcpItems(tab),
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
				{
					name: t("Independent Sessions Per Tab"),
					desc: t(
						"Each browser tab gets its own session with separate cookies. Requires reload.",
					),
					control: { type: "toggle", key: "sessionIsolation" },
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
						.addText((input) => {
							input
								.setPlaceholder("URL or vault path")
								.setValue(filterList.url)
								.onChange(async (value) => {
									filterLists[index].url = value;
									await tab.plugin.saveSettings();
								});
							new TxtFileSuggester(tab.app, input.inputEl);
						})
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

/** "abcd…wxyz" for showing a secret without exposing it. */
export function maskToken(token: string): string {
	if (!token) return "";
	return token.length <= 8 ? "•".repeat(token.length) : token.slice(0, 4) + "…" + token.slice(-4);
}

function mcpItems(tab: SurfingSettingTab): SettingDefinitionItem[] {
	const plugin = tab.plugin;
	const settings = plugin.settings.mcp;
	const controller = plugin.mcp;
	if (!controller) return [];
	const enabled = () => settings.enabled;
	const snippets = controller.snippets();
	const hidden = (snippet: string) =>
		settings.token ? snippet.split(settings.token).join(maskToken(settings.token)) : snippet;
	const snippetRow = (name: string, snippet: string): SettingGroupItem => ({
		name,
		visible: enabled,
		render: (setting) => {
			setting.settingEl.addClass("wb-mcp-snippet-setting");
			setting.descEl.createEl("pre", { cls: "wb-mcp-snippet", text: hidden(snippet) });
			setting.addButton((button) =>
				button.setButtonText(t("Copy")).onClick(() => {
					clipboard.writeText(snippet);
					new Notice(t("Copied."));
				}),
			);
		},
	});
	const sites = (list: string[]) =>
		list.map((site) => ({
			name: site,
			render: (setting: Setting) => {
				setting.setName(site);
			},
		}));

	return [
		{
			type: "group",
			items: [
				{
					name: t("Enable MCP server"),
					desc: t(
						"Lets AI agents such as Claude Code and Codex CLI read and control the web pages open in Obsidian. Only programs on this computer that have the access token can connect.",
					),
					control: { type: "toggle", key: "mcp.enabled" },
				},
				{
					name: t("Status"),
					desc: controller.statusText(),
					visible: enabled,
				},
				{
					name: t("Port"),
					desc: t("The server listens on this port of 127.0.0.1 only."),
					control: {
						type: "number",
						key: "mcp.port",
						min: 1024,
						max: 65535,
						step: 1,
						defaultValue: DEFAULT_SETTINGS.mcp.port,
						validate: (value) =>
							Number.isInteger(value) && value >= 1024 && value <= 65535
								? undefined
								: t("Enter a port between 1024 and 65535."),
					},
				},
				{
					name: t("Access token"),
					desc: maskToken(settings.token) || t("Generated when the server is first enabled."),
					visible: enabled,
					render: (setting) => {
						setting.addButton((button) =>
							button.setButtonText(t("Copy")).onClick(() => {
								clipboard.writeText(settings.token);
								new Notice(t("Copied."));
							}),
						);
						setting.addButton((button) =>
							button
								.setButtonText(t("Regenerate"))
								.setWarning()
								.onClick(async () => {
									await controller.regenerateToken();
									new Notice(t("New token generated. Update the clients you connected."));
									tab.refreshSettings();
								}),
						);
					},
				},
			],
		},
		{
			type: "group",
			heading: t("Connect a client"),
			items: [
				snippetRow("Claude Code", snippets.claudeCode),
				snippetRow("Codex CLI (~/.codex/config.toml)", snippets.codex),
				snippetRow(t("Other clients (JSON)"), snippets.json),
			],
		},
		{
			type: "group",
			heading: t("Permissions"),
			items: [
				{
					name: t("Site access"),
					desc: t("Ask the first time an agent uses a site, or let agents use every site that is not blocked."),
					control: {
						type: "dropdown",
						key: "mcp.siteAccess",
						options: { ask: t("Ask"), allow: t("Allow all sites") },
					},
				},
				{
					name: t("Allow running JavaScript in pages"),
					desc: t(
						"Warning: lets agents run any code in the pages they control, with access to your logged-in sessions on those sites. Leave off unless you need it.",
					),
					control: { type: "toggle", key: "mcp.allowScripts" },
				},
			],
		},
		{
			type: "list",
			heading: t("Approved sites"),
			emptyState: t("No approved sites. Sites you choose to always allow appear here."),
			onDelete: (index) => {
				settings.approvedSites.splice(index, 1);
				void plugin.saveSettings();
				tab.refreshSettings();
			},
			items: sites(settings.approvedSites),
		},
		{
			type: "list",
			heading: t("Blocked sites"),
			emptyState: t("No blocked sites. Agents cannot read or act on blocked sites. Use example.com or *.example.com."),
			addItem: {
				name: t("Block a site"),
				action: () => {
					settings.blockedSites.push("");
					void plugin.saveSettings();
					tab.refreshSettings();
				},
			},
			onDelete: (index) => {
				settings.blockedSites.splice(index, 1);
				void plugin.saveSettings();
				tab.refreshSettings();
			},
			items: settings.blockedSites.map((site, index) => ({
				name: site || t("New blocked site"),
				aliases: [site],
				render: (setting: Setting) => {
					setting.addText((input) =>
						input
							.setPlaceholder("example.com")
							.setValue(site)
							.onChange((value) => {
								settings.blockedSites[index] = value.trim();
								tab.applySettingsUpdate();
							}),
					);
				},
			})),
		},
	];
}
