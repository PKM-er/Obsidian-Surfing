import { TextInputSuggest } from "./suggest";
import SurfingPlugin from "../../surfingIndex";
import { App, FuzzyMatch, ItemView, prepareFuzzySearch, TFile } from "obsidian";
import { SurfingView } from "../../surfingView";
import { getComposedUrl } from "../../utils/url";

const MAX_FILE_SUGGESTIONS = 50;

interface CustomItem {
    path: string;
    type: string;
}

export class FileSuggester extends TextInputSuggest<CustomItem> {
    private plugin: SurfingPlugin;

    private files: TFile[];
    private view: ItemView;

    constructor(public app: App, plugin: SurfingPlugin, public inputEl: HTMLInputElement | HTMLTextAreaElement, view: ItemView) {
        super(app, inputEl);

        this.plugin = plugin;
        this.view = view;

        this.files = this.app.vault.getFiles();
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

    getSuggestions(inputStr: string): CustomItem[] {
        const names = this.files.map((file) => file.path);
        // A query of one character or less matches every file in the vault,
        // and rendering all of them froze Obsidian on large vaults.
        const text = inputStr.trim();
        const matches = text.length < 2 ? [] : this.fuzzySearchItemsOptimized(text, names);

        const query = matches
            .sort((a, b) => {
                return b.match.score - a.match.score;
            }).slice(0, MAX_FILE_SUGGESTIONS).map((match) => {
                return {
                    path: match.item,
                    type: 'file'
                };
            });

        // Add a blank item to the top of the list
        query.unshift({
            path: inputStr,
            type: 'web'
        });

        return query;
    }

    renderSuggestion(item: CustomItem, el: HTMLElement): void {
        const bookmarkSuggestContainerEl = el.createDiv({
            cls: "wb-bookmark-suggest-container"
        });
        bookmarkSuggestContainerEl.createDiv({
            text: item.path,
            cls: "wb-bookmark-suggestion-text"
        });
        el.classList.add("wb-bookmark-suggest-item");
    }

    selectSuggestion(item: CustomItem): void {
        void (async () => {
        if (!item) return;

        switch (item.type) {
            case 'web': {
                const finalUrl = getComposedUrl("", item.path);
                SurfingView.spawnWebBrowserView(this.plugin, false, {url: finalUrl});
                break;
            }
            case 'file': {
                const file = this.files.find((file) => file.path === item.path);
                if (file) {
                    await this.view.leaf.openFile(file);
                }
                break;
            }
        }

        this.close();
        return;
        })();
    }
}
