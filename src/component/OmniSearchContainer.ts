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
	private wbOmniSearchCtnEl: HTMLElement;
	private query: string;
	private result: ResultNoteApi[];

	constructor(leaf: WorkspaceLeaf, plugin: SurfingPlugin) {
		this.plugin = plugin;
		this.leaf = leaf;
	}

	onload() {
		this.wbOmniSearchCtnEl = this.leaf.view.contentEl.createEl("div", {
			cls: "wb-omni-box"
		})
		this.hide();
	}

	hide() {
		if (this.wbOmniSearchCtnEl.isShown()) this.wbOmniSearchCtnEl.hide();
	}

	show() {
		if (!this.wbOmniSearchCtnEl.isShown()) this.wbOmniSearchCtnEl.show();
	}

	notFound() {
		this.wbOmniSearchCtnEl.empty();
		this.wbOmniSearchCtnEl.createEl("div", {
			text: "No results found",
			cls: "wb-omni-item-notfound"
		})
	}

	public async update(query: string) {
		if (this.query === query) return;

		this.wbOmniSearchCtnEl.empty();
		this.query = query;

		console.log(query);

		// @ts-ignore
		const result = await omnisearch.search(this.query);
		// @ts-ignore
		if (this.result !== result) this.result = result;

		if (!this.result || this.result?.length === 0) {
			this.notFound();
			return;
		}

		if (this.result.length > 0) {
			if (!this.result[0].foundWords.find(word => word === this.query)) {
				this.notFound();
				return;
			}
			this.show();
			this.result.forEach((item: ResultNoteApi) => {
				(new OmniSearchItem(this.wbOmniSearchCtnEl, item.path, item.foundWords, item.matches)).onload();
			})
		}
	}

	onunload() {
		this.wbOmniSearchCtnEl.empty();
		this.wbOmniSearchCtnEl.detach();
	}
}
