import { TFile } from "obsidian";
import type { SearchMatchApi } from "./OmniSearchContainer";
import { SplitContent } from "../utils/splitContent";

export class OmniSearchItem {
	private parent: HTMLElement;
	private path: string;
	private foundWords: string[];
	private matches: SearchMatchApi[];

	constructor(parent: HTMLElement, path: string, foundWords: string[], matches: SearchMatchApi[]) {
		this.parent = parent;
		this.path = path;
		this.foundWords = foundWords;
		this.matches = matches;
	}

	async onload() {
		const wbOmniSearchItemEl = this.parent.createEl("div", {
			cls: "wb-omni-item"
		})
		wbOmniSearchItemEl.createEl("div", {
			cls: "wb-omni-item-path",
			text: this.path,
		});
		const itemListEl = wbOmniSearchItemEl.createEl("div", {
			cls: "wb-omni-item-content-list",
		});

		const file = app.vault.getAbstractFileByPath(this.path);
		let content = "";
		if (file instanceof TFile) content = await app.vault.cachedRead(file);
		if (!file) return;

		const contentSearch = new SplitContent(content);


		if (this.matches.length > 0) {
			this.matches.forEach((word: SearchMatchApi) => {
				const textEl = itemListEl.createEl("div", {
					cls: "wb-content-list-text",
				})
				textEl.innerHTML = contentSearch.search(word.offset, true);
			})
		}
	}
}
