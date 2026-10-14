import { TextInputSuggest } from "./suggest";
import type { App } from "obsidian";
import { SurfingView } from "../../surfingView";
import SurfingPlugin from "../../surfingIndex";
import type { BookmarkFileItem } from "../../utils/bookmarkStore";
import { getComposedUrl } from "../../utils/url";

interface BookmarkSuggestion {
    isSearchFallback: boolean;
    name: string;
    url: string;
    item?: BookmarkFileItem;
}

export class BookmarkSuggester extends TextInputSuggest<BookmarkSuggestion> {
    private plugin: SurfingPlugin;

    constructor(public app: App, plugin: SurfingPlugin, public inputEl: HTMLInputElement | HTMLTextAreaElement) {
        super(app, inputEl);

        this.plugin = plugin;
    }

    getSuggestions(inputStr: string): BookmarkSuggestion[] {
        const inputLowerCase: string = inputStr.toLowerCase();
        const bookmarks = this.plugin.bookmarkCache;

        if (!bookmarks || bookmarks.length === 0) return [];

        const filtered: BookmarkSuggestion[] = bookmarks
            .filter((item) => {
                return item.url.toLowerCase().contains(inputLowerCase) || item.name.toLowerCase().contains(inputLowerCase);
            })
            .map((item) => ({
                isSearchFallback: false,
                name: item.name,
                url: item.url,
                item,
            }));

        if (!filtered || filtered.length === 0) {
            this.close();
            return [];
        }

        // Add search fallback as first item
        filtered.unshift({
            isSearchFallback: true,
            name: inputLowerCase,
            url: "",
        });

        return filtered;
    }

    renderSuggestion(suggestion: BookmarkSuggestion, el: HTMLElement): void {
        const bookmarkSuggestContainerEl = el.createDiv({
            cls: "wb-bookmark-suggest-container"
        });
        bookmarkSuggestContainerEl.createDiv({
            text: suggestion.name,
            cls: "wb-bookmark-suggestion-text"
        });
        bookmarkSuggestContainerEl.createDiv({
            text: suggestion.url,
            cls: "wb-bookmark-suggestion-url"
        });
        el.classList.add("wb-bookmark-suggest-item");
    }

    selectSuggestion(suggestion: BookmarkSuggestion): void {
        if (!suggestion) return;

        if (suggestion.isSearchFallback) {
            const finalUrl = getComposedUrl("", suggestion.name);
            SurfingView.spawnWebBrowserView(this.plugin, false, {url: finalUrl});

            this.close();
            return;
        }

        SurfingView.spawnWebBrowserView(this.plugin, false, {url: suggestion.url});
        this.close();
        return;
    }
}
