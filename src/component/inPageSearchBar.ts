import SurfingPlugin from "../surfingIndex";
import { t } from "../translations/helper";
import { SearchEngineSuggester } from "./suggester/searchSuggester";
import { ItemView } from "obsidian";

export class InPageSearchBar {
    plugin: SurfingPlugin;
    private inPageSearchBarInputEl: HTMLInputElement;
    private SearchBarInputContainerEl: HTMLElement;
    private inPageSearchBarContainerEl: HTMLDivElement;
    private onSearchBarEnterListener = new Array<(url: string) => void>;
    private searchEnginesSuggester: SearchEngineSuggester;

    private view: ItemView;

    constructor(parent: Element, view: ItemView, plugin: SurfingPlugin) {
        this.plugin = plugin;
        this.view = view;

        this.inPageSearchBarContainerEl = parent.createEl("div", {
            cls: "wb-page-search-bar-container"
        });

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

        // TODO: Would this be ok to use Obsidian add domlistener instead?
        this.inPageSearchBarInputEl.addEventListener("keyup", (event: KeyboardEvent) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            if (!event) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const event = window.event as KeyboardEvent;
            }
            if (event.key === "Enter") {
                for (const listener of this.onSearchBarEnterListener) {
                    listener(this.inPageSearchBarInputEl.value);
                }
            }
        }, false);

        // Use focusin to bubble up to the parent
        // Rather than just input element itself.
        this.inPageSearchBarInputEl.addEventListener("focusin", (event: FocusEvent) => {
            this.inPageSearchBarInputEl.select();
        });

        // When focusout, unselect the text to prevent it is still selected when focus back
        // It will trigger some unexpected behavior,like you will not select all text and the cursor will set to current position;
        // The expected behavior is that you will select all text when focus back;
        this.inPageSearchBarInputEl.addEventListener("focusout", (event: FocusEvent) => {
            window.getSelection()?.removeAllRanges();
        });

        if (this.plugin.settings.showOtherSearchEngines) this.searchEnginesSuggester = new SearchEngineSuggester(app, this.plugin, this.inPageSearchBarInputEl, this.view);
    }

    addOnSearchBarEnterListener(listener: (url: string) => void) {
        this.onSearchBarEnterListener.push(listener);
    }

    focus() {
        this.inPageSearchBarInputEl.focus();
    }
}
