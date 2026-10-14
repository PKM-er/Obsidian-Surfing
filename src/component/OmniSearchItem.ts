import { sanitizeHTMLToDom, TFile } from "obsidian";
import type { SearchMatchApi } from "./OmniSearchContainer";
import { SplitContent } from "../utils/splitContent";
import SurfingPlugin from "../surfingIndex";

export class OmniSearchItem {
	private parent: HTMLElement;
	private path: string;
	private foundWords: string[];
	private matches: SearchMatchApi[];
	private plugin: SurfingPlugin;

	constructor(parent: HTMLElement, path: string, foundWords: string[], matches: SearchMatchApi[], plugin: SurfingPlugin) {
		this.parent = parent;
		this.path = path;
		this.foundWords = foundWords;
		this.matches = matches;
		this.plugin = plugin;
	}

	async onload() {
		const wbOmniSearchItemEl = this.parent.createDiv({
			cls: "wb-omni-item"
		})
		wbOmniSearchItemEl.createDiv({
			cls: "wb-omni-item-path",
			text: this.path,
		});
		const itemListEl = wbOmniSearchItemEl.createDiv({
			cls: "wb-omni-item-content-list",
		});

		const file = this.plugin.app.vault.getAbstractFileByPath(this.path);
		let content = "";
		if (file instanceof TFile) content = await this.plugin.app.vault.cachedRead(file);
		if (!file) return;

		const contentSearch = new SplitContent(content);


		if (this.matches.length > 0) {
			this.matches.forEach((word: SearchMatchApi) => {
				const textEl = itemListEl.createDiv({
					cls: "wb-content-list-text",
				})
				textEl.appendChild(sanitizeHTMLToDom(contentSearch.search(word.offset, true)));
			})
		}
	}
}
