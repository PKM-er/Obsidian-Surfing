import { TextInputSuggest } from "./suggest";
import type { App } from "obsidian";
import { t } from "src/translations/helper";
import { SEARCH_ENGINES, SearchEngine } from "../../surfingPluginSetting";
import { SurfingView } from "../../surfingView";
import SurfingPlugin from "../../surfingIndex";
import { getFinalUrl } from "../../utils/urltest";

export class SearchEngineSuggester extends TextInputSuggest<string> {
	private searchEngines: SearchEngine[];
	private searchEnginesString: string[] = [];
	private plugin: SurfingPlugin;

	constructor(public app: App, plugin: SurfingPlugin, public inputEl: HTMLInputElement | HTMLTextAreaElement) {
		super(app, inputEl);

		this.plugin = plugin;
	}

	getSuggestions(inputStr: string): string[] {
		this.searchEnginesString = [];

		const currentDefault = this.plugin.settings.defaultSearchEngine;
		this.searchEngines = [...SEARCH_ENGINES, ...this.plugin.settings.customSearchEngine].sort(function (x, y) {
			return x.name == currentDefault ? -1 : y.name == currentDefault ? 1 : 0;
		});
		this.searchEngines.forEach((item) => {
			this.searchEnginesString.push(item.name);
		})

		return this.searchEnginesString;
	}

	renderSuggestion(item: string, el: HTMLElement): void {
		el.createEl("div", {
			text: t("Search with") + item,
			cls: "wb-search-suggestion-text"
		})
		el.classList.add("wb-search-suggest-item");
	}

	selectSuggestion(item: string): void {
		const currentInputValue: string = this.inputEl.value;

		console.log("hellow");

		if (/^\s{0,}$/.test(currentInputValue)) return;

		const currentSearchEngine = this.searchEngines.find((engine) => engine.name === item);
		const url = (currentSearchEngine ? currentSearchEngine.url : SEARCH_ENGINES[0].url);

		let finalUrl = getFinalUrl(url, currentInputValue);

		SurfingView.spawnWebBrowserView(false, { url: finalUrl });
	}
}
