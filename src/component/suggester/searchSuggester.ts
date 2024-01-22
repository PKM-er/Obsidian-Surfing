import { TextInputSuggest } from "./suggest";
import { App, FuzzyMatch, ItemView, prepareFuzzySearch, TFile } from "obsidian";
import { t } from "../../translations/helper";
import { SEARCH_ENGINES, SearchEngine } from "../../surfingPluginSetting";
import { SurfingView } from "../../surfingView";
import SurfingPlugin from "../../surfingIndex";
import { getComposedUrl } from "../../utils/url";

export class SearchEngineSuggester extends TextInputSuggest<string> {
	private searchEngines: SearchEngine[];
	private searchEnginesString: string[] = [];
	private plugin: SurfingPlugin;

	private mode: 'web' | 'file' = 'web';

	private files: TFile[] = [];

	private view: ItemView;

	constructor(public app: App, plugin: SurfingPlugin, public inputEl: HTMLInputElement | HTMLTextAreaElement, view: ItemView) {
		super(app, inputEl);

		this.plugin = plugin;
		this.files = this.app.vault.getFiles();
		this.view = view;
	}

	fuzzySearchItemsOptimized(query: string, items: string[]): FuzzyMatch<string>[] {
		const preparedSearch = prepareFuzzySearch(query);

		return items
			.map((item) => {
				const result = preparedSearch(item);
				if (result) {
					return {
						item: item,
						match: result,
					};
				}
				return null;
			})
			.filter(Boolean) as FuzzyMatch<string>[];
	}

	getSuggestions(inputStr: string): string[] {
		if (inputStr.trim().startsWith('/')) {
			this.mode = 'file';

			const names = this.files.map((file) => file.path);

			const query = this.fuzzySearchItemsOptimized(inputStr.slice(1), names)
				.sort((a, b) => {
					return b.match.score - a.match.score;
				}).map((match) => match.item);

			return query;
		}

		this.mode = 'web';

		this.searchEnginesString = [];

		const currentDefault = this.plugin.settings.defaultSearchEngine;
		this.searchEngines = [...SEARCH_ENGINES, ...this.plugin.settings.customSearchEngine].sort(function (x, y) {
			return x.name.toLowerCase() == currentDefault.toLowerCase() ? -1 : y.name.toLowerCase() == currentDefault.toLowerCase() ? 1 : 0;
		});

		this.searchEngines.forEach((item) => {
			this.searchEnginesString.push(item.name);
		});

		return this.searchEnginesString;
	}

	renderSuggestion(item: string, el: HTMLElement): void {
		switch (this.mode) {
			case 'web':
				el.createEl("div", {
					text: t("Search with") + item,
					cls: "wb-search-suggestion-text"
				});
				el.classList.add("wb-search-suggest-item");
				break;
			case 'file':
				el.createEl("div", {
					text: 'Open ' + item,
					cls: "wb-search-suggestion-text"
				});
				el.classList.add("wb-search-suggest-item");
				break;
		}
	}

	async selectSuggestion(item: string) {
		const currentInputValue: string = this.inputEl.value;

		if (currentInputValue.trim() === '') return;

		switch (this.mode) {
			case 'web': {
				const currentSearchEngine = this.searchEngines.find((engine) => engine.name === item);
				const url = (currentSearchEngine ? currentSearchEngine.url : SEARCH_ENGINES[0].url);

				const finalUrl = getComposedUrl(url, currentInputValue);
				SurfingView.spawnWebBrowserView(false, {url: finalUrl});
				break;
			}
			case 'file': {
				const file = this.files.find((file) => file.path === item);
				if (file) {
					await this.view.leaf.openFile(file);
				}
				break;
			}
		}
	}
}
