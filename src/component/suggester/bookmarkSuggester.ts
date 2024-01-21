import { TextInputSuggest } from "./suggest";
import type { App } from "obsidian";
import { SurfingView } from "../../surfingView";
import SurfingPlugin from "../../surfingIndex";
import { loadJson } from "../../utils/json";
import type { Bookmark } from "../../types/bookmark";
import { getComposedUrl } from "../../utils/url";

export class BookmarkSuggester extends TextInputSuggest<Bookmark> {
    private plugin: SurfingPlugin;
    private bookmarkData: Bookmark[] = [];
    private suggestions: Bookmark[] = [];

    constructor(public app: App, plugin: SurfingPlugin, public inputEl: HTMLInputElement | HTMLTextAreaElement) {
        super(app, inputEl);

        this.plugin = plugin;
    }

    getSuggestions(inputStr: string): Bookmark[] {
        const inputLowerCase: string = inputStr.toLowerCase();

        try {
            if (this.suggestions.length === 0) loadJson().then((data) => {
                this.bookmarkData = data.bookmarks;
                this.suggestions = this.bookmarkData;
            });
        } catch (e) {
            console.error(e);
        }

        if (this.suggestions.length === 0) return [];

        const filtered = this.suggestions.filter((item) => {
            if (item.url.toLowerCase().contains(inputLowerCase) || item.name.toLowerCase().contains(inputLowerCase)) return item;
        });

        if (!filtered) this.close();
        if (filtered?.length > 0) {
            filtered.unshift({
                id: "BOOKMARK",
                name: inputLowerCase,
                description: "",
                url: "",
                tags: "",
                category: [],
                created: 1111111111111,
                modified: 1111111111111,
            });
            return filtered;
        }

        return filtered ? filtered : [];
    }

    renderSuggestion(item: Bookmark, el: HTMLElement): void {
        const bookmarkSuggestContainerEl = el.createEl("div", {
            cls: "wb-bookmark-suggest-container"
        });
        bookmarkSuggestContainerEl.createEl("div", {
            text: item.name,
            cls: "wb-bookmark-suggestion-text"
        });
        bookmarkSuggestContainerEl.createEl("div", {
            text: item.url,
            cls: "wb-bookmark-suggestion-url"
        });
        el.classList.add("wb-bookmark-suggest-item");
    }

    selectSuggestion(item: Bookmark): void {
        if (!item) return;

        if (item.id === "BOOKMARK") {
            const finalUrl = getComposedUrl("", item.name);
            SurfingView.spawnWebBrowserView(false, {url: finalUrl});

            this.close();
            return;
        }

        SurfingView.spawnWebBrowserView(false, {url: item.url});
        this.close();
        return;
    }
}
