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

	// Tick current search box so that make it run again when Obsidian Reload
	tick(result: ResultNoteApi[]) {
		if (this.result !== result) this.result = result;

		// @ts-ignore
		if (this.result !== result) this.result = result;

		if (!this.result || this.result?.length === 0) {
			this.show();
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

	public async update(query: string) {
		if (this.query === query) return;

		this.wbOmniSearchCtnEl.empty();
		this.query = query;

		// @ts-ignore
		const result = await omnisearch?.search(this.query);

		this.tick(result);

		if (!result || result?.length === 0) {
			setTimeout(async () => {
				// @ts-ignore
				const result = await omnisearch.search(this.query);
				this.tick(result);
			}, 3000);
		}
	}

	onunload() {
		this.wbOmniSearchCtnEl.empty();
		this.wbOmniSearchCtnEl.detach();
	}
}
