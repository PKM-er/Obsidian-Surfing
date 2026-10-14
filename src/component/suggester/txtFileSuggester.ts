import { TextInputSuggest } from "./suggest";
import { App, prepareFuzzySearch, TFile } from "obsidian";

export class TxtFileSuggester extends TextInputSuggest<string> {
    private files: TFile[];
    private onSelect?: (path: string) => void;

    /**
     * Suggests the vault's .txt files. Picking one fills the input and fires
     * its "input" event, so a Setting's onChange saves it; `onSelect` is for
     * anything else.
     */
    constructor(app: App, inputEl: HTMLInputElement | HTMLTextAreaElement, onSelect?: (path: string) => void) {
        super(app, inputEl, false);
        this.onSelect = onSelect;
        this.files = this.app.vault.getFiles().filter((f) => f.extension === "txt");
    }

    getSuggestions(inputStr: string): string[] {
        const paths = this.files.map((f) => f.path);
        if (!inputStr) return paths.slice(0, 20);

        const prepared = prepareFuzzySearch(inputStr);
        return paths
            .map((p) => {
                const result = prepared(p);
                return result ? { path: p, score: result.score } : null;
            })
            .filter(Boolean)
            .sort((a, b) => b!.score - a!.score)
            .map((m) => m!.path)
            .slice(0, 20);
    }

    renderSuggestion(item: string, el: HTMLElement): void {
        el.createEl("div", { text: item, cls: "wb-bookmark-suggestion-text" });
        el.classList.add("wb-bookmark-suggest-item");
    }

    selectSuggestion(item: string): void {
        if (!item) return;
        this.inputEl.value = item;
        this.inputEl.dispatchEvent(new Event("input"));
        this.onSelect?.(item);
        this.close();
    }
}
