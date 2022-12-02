import { WorkspaceLeaf } from "obsidian";
import SurfingPlugin from "../surfingIndex";
import { OmniSearchItem } from "./OmniSearchItem";


export type ResultNoteApi = {
	score: number
	path: string
	basename: string
	foundWords: string[]
	matches: SearchMatchApi[]
}
export type SearchMatchApi = {
	match: string
	offset: number
}

export class OmniSearchContainer {
	private leaf: WorkspaceLeaf;
	private plugin: SurfingPlugin;
	private wbOmniSearchBoxEl: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: SurfingPlugin) {
		this.plugin = plugin;
		this.leaf = leaf;
	}

	onload() {
		this.wbOmniSearchBoxEl = this.leaf.view.contentEl.createEl("div", {
			cls: "wb-omni-box"
		})
	}

	hide() {
		if (this.wbOmniSearchBoxEl.isShown()) this.wbOmniSearchBoxEl.hide();
	}

	show() {
		if (!this.wbOmniSearchBoxEl.isShown()) this.wbOmniSearchBoxEl.show();
	}

	public async update(query: string) {
		this.wbOmniSearchBoxEl.empty();

		// @ts-ignore
		const result = await omnisearch.search(query);

		console.log(result);
		if (result.length > 0) {
			result.forEach((item: ResultNoteApi) => {
				(new OmniSearchItem(this.wbOmniSearchBoxEl, item.path, item.foundWords, item.matches)).onload();
			})
		}
	}

	onunload() {
		this.wbOmniSearchBoxEl.empty();
		this.wbOmniSearchBoxEl.detach();
	}
}
