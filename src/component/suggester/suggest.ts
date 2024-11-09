// Credits go to Liam's Periodic Notes Plugin: https://github.com/liamcain/obsidian-periodic-notes

import { App, Platform, Scope } from "obsidian";
import type { ISuggestOwner } from "obsidian";
import { createPopper } from "@popperjs/core";
import type { Instance as PopperInstance } from "@popperjs/core";
import { SEARCH_ENGINES } from "../../surfingPluginSetting";

const wrapAround = (value: number, size: number): number => {
	return ((value % size) + size) % size;
};

class Suggest<T> {
	private owner: ISuggestOwner<T>;
	private values: T[];
	private suggestions: HTMLDivElement[];
	private selectedItem: number;
	private containerEl: HTMLElement;
	private app: App;

	constructor(owner: ISuggestOwner<T>, containerEl: HTMLElement, scope: Scope, app: App) {
		this.owner = owner;
		this.containerEl = containerEl;
		this.app = app;

		containerEl.on(
			"click",
			".suggestion-item",
			this.onSuggestionClick.bind(this)
		);
		containerEl.on(
			"mousemove",
			".suggestion-item",
			this.onSuggestionMouseover.bind(this)
		);

		scope.register([], "ArrowUp", (event) => {
			if (!event.isComposing) {
				this.setSelectedItem(this.selectedItem - 1, true);
				return false;
			}
		});

		scope.register([], "ArrowDown", (event) => {
			if (!event.isComposing) {
				this.setSelectedItem(this.selectedItem + 1, true);
				return false;
			}
		});

		scope.register([], "Enter", (event) => {
			if (!event.isComposing) {
				this.useSelectedItem(event);
				return false;
			}
		});


		// Register Control+Number to select specific items.
		const pluginSettings = this.app.plugins.getPlugin("surfing").settings;
		const searchEngines = [...SEARCH_ENGINES, ...pluginSettings.customSearchEngine];
		for (let i = 0; i < searchEngines.length; i++) {
			if (i === 9) {
				scope.register(["Mod"], "0", (event) => {
					if (!event.isComposing) {
						this.setSelectedItem(i, false);
						this.useSelectedItem(event);
						return false;
					}
				});
				break;
			}
			scope.register(["Mod"], `${ i + 1 }`, (event) => {
				if (!event.isComposing) {
					this.setSelectedItem(i, false);
					this.useSelectedItem(event);
					return false;
				}
			});
		}


	}

	onSuggestionClick(event: MouseEvent, el: HTMLDivElement): void {
		event.preventDefault();

		const item = this.suggestions.indexOf(el);
		this.setSelectedItem(item, false);
		this.useSelectedItem(event);
	}

	onSuggestionMouseover(_event: MouseEvent, el: HTMLDivElement): void {
		const item = this.suggestions.indexOf(el);
		this.setSelectedItem(item, false);
	}

	setSuggestions(values: T[]) {
		this.containerEl.empty();
		const suggestionEls: HTMLDivElement[] = [];

		values.forEach((value, index) => {
			const suggestionEl = this.containerEl.createDiv("suggestion-item");
			this.owner.renderSuggestion(value, suggestionEl);
			if (index < 10) {
				suggestionEl.createEl("div", {
					text: `${ Platform.isMacOS ? "CMD + " : "Ctrl + " }` + `${ index != 9 ? index + 1 : 0 }`,
					cls: "wb-search-suggestion-index"
				})
			}
			suggestionEls.push(suggestionEl);
		});

		this.values = values;
		this.suggestions = suggestionEls;
		this.setSelectedItem(0, false);
	}

	useSelectedItem(event: MouseEvent | KeyboardEvent) {
		const currentValue = this.values[this.selectedItem];
		if (currentValue) {
			this.owner.selectSuggestion(currentValue, event);
		}
	}

	setSelectedItem(selectedIndex: number, scrollIntoView: boolean) {
		const normalizedIndex = wrapAround(selectedIndex, this.suggestions.length);
		const prevSelectedSuggestion = this.suggestions[this.selectedItem];
		const selectedSuggestion = this.suggestions[normalizedIndex];

		prevSelectedSuggestion?.removeClass("is-selected");
		selectedSuggestion?.addClass("is-selected");

		this.selectedItem = normalizedIndex;

		if (scrollIntoView) {
			selectedSuggestion.scrollIntoView(false);
		}
	}
}

export abstract class TextInputSuggest<T> implements ISuggestOwner<T> {
	protected app: App;
	protected inputEl: HTMLInputElement | HTMLTextAreaElement;

	private popper: PopperInstance;
	private scope: Scope;
	private suggestEl: HTMLElement;
	private suggest: Suggest<T>;

	constructor(app: App, inputEl: HTMLInputElement | HTMLTextAreaElement) {
		this.app = app;
		this.inputEl = inputEl;
		this.scope = new Scope();

		this.suggestEl = createDiv("wb-search-suggestion-container");
		const suggestion = this.suggestEl.createDiv("wb-search-suggestion");
		this.suggest = new Suggest(this, suggestion, this.scope, this.app);

		this.scope.register([], "Escape", this.close.bind(this));

		this.inputEl.addEventListener("input", this.onInputChanged.bind(this));
		this.inputEl.addEventListener("focus", this.onInputChanged.bind(this));
		this.inputEl.addEventListener("blur", this.close.bind(this));
		this.suggestEl.on(
			"mousedown",
			".wb-search-suggestion-container",
			(event: MouseEvent) => {
				event.preventDefault();
			}
		);
	}

	onInputChanged(): void {
		const inputStr = this.inputEl.value;
		const suggestions = this.getSuggestions(inputStr);

		if (!suggestions || (/^\s{0,}$/.test(inputStr))) {
			this.close();
			return;
		}

		if (suggestions.length > 0) {
			this.suggest.setSuggestions(suggestions);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			this.open((<any>this.app).dom.appContainerEl, this.inputEl);
		} else {
			this.close()
		}
	}

	open(container: HTMLElement, inputEl: HTMLElement): void {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(<any>this.app).keymap.pushScope(this.scope);

		container.appendChild(this.suggestEl);
		this.popper = createPopper(inputEl, this.suggestEl, {
			placement: "bottom-start",
			modifiers: [
				{
					name: "sameWidth",
					enabled: true,
					fn: ({ state, instance }) => {
						// Note: positioning needs to be calculated twice -
						// first pass - positioning it according to the width of the popper
						// second pass - position it with the width bound to the reference element
						// we need to early exit to avoid an infinite loop
						const targetWidth = `${ state.rects.reference.width }px`;
						if (state.styles.popper.width === targetWidth) {
							return;
						}
						state.styles.popper.width = targetWidth;
						instance.update();
					},
					phase: "beforeWrite",
					requires: ["computeStyles"],
				},
				{
					name: 'offset',
					options: {
						offset: [0, 5],
					},
				}
			],
		});
	}

	close(): void {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(<any>this.app).keymap.popScope(this.scope);

		this.suggest.setSuggestions([]);
		if (this.popper)
			this.popper.destroy();
		this.suggestEl.detach();
	}

	abstract getSuggestions(inputStr: string): T[];

	abstract renderSuggestion(item: T, el: HTMLElement): void;

	abstract selectSuggestion(item: T): void;
}
