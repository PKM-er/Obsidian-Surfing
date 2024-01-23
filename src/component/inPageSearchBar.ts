import SurfingPlugin from "../surfingIndex";
import { t } from "../translations/helper";
import { SearchEngineSuggester } from "./suggester/searchSuggester";
import { Component, ItemView, Scope } from "obsidian";

export class InPageSearchBar extends Component {
	plugin: SurfingPlugin;
	private inPageSearchBarInputEl: HTMLInputElement;
	private SearchBarInputContainerEl: HTMLElement;
	inPageSearchBarContainerEl: HTMLDivElement;
	private onSearchBarEnterListener = new Array<(url: string) => void>;
	private searchEnginesSuggester: SearchEngineSuggester;

	private view: ItemView;

	constructor(parent: Element, view: ItemView, plugin: SurfingPlugin) {
		super();
		this.plugin = plugin;
		this.view = view;

		this.inPageSearchBarContainerEl = parent.createEl("div", {
			cls: "wb-page-search-bar-container"
		});

		// @ts-ignore
		this.initScope();

		this.inPageSearchBarContainerEl.createEl("div", {
			text: "Surfing",
			cls: "wb-page-search-bar-text"
		});

		this.SearchBarInputContainerEl = this.inPageSearchBarContainerEl.createEl("div", {
			cls: "wb-page-search-bar-input-container"
		});

		// Create search bar in header bar.
		// Use Obsidian CreateEL method.
		this.inPageSearchBarInputEl = this.SearchBarInputContainerEl.createEl("input", {
			type: "text",
			placeholder: t("Search with") + this.plugin.settings.defaultSearchEngine + t("or enter address"),
			cls: "wb-page-search-bar-input"
		});

		this.registerDomEvent(this.inPageSearchBarInputEl, "keydown", (event: KeyboardEvent) => {
			if (!event) {
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const event = window.event as KeyboardEvent;
			}
			if (event.key === "Enter") {
				for (const listener of this.onSearchBarEnterListener) {
					listener(this.inPageSearchBarInputEl.value);
				}
			}
		});

		this.registerDomEvent(this.inPageSearchBarInputEl, "focusin", (event: FocusEvent) => {
			this.inPageSearchBarInputEl.select();
		});

		this.registerDomEvent(this.inPageSearchBarInputEl, "focusout", (event: FocusEvent) => {
			window.getSelection()?.removeAllRanges();
		});

		if (this.plugin.settings.showOtherSearchEngines) this.searchEnginesSuggester = new SearchEngineSuggester(app, this.plugin, this.inPageSearchBarInputEl, this.view);
	}

	addOnSearchBarEnterListener(listener: (url: string) => void) {
		this.onSearchBarEnterListener.push(listener);
	}

	initScope() {
		if (!this.view.scope) {
			this.view.scope = new Scope(this.plugin.app.scope);
			(this.view.scope as Scope).register([], 'i', (evt) => {
				if (evt.target === this.inPageSearchBarInputEl) return;
				evt.preventDefault();
				this.inPageSearchBarInputEl.focus();
			});
		} else {
			(this.view.scope as Scope).register([], 'i', (evt) => {
				if (evt.target === this.inPageSearchBarInputEl) return;
				evt.preventDefault();
				this.inPageSearchBarInputEl.focus();
			});
		}
	}

	focus() {
		this.inPageSearchBarInputEl.focus();
	}
}
