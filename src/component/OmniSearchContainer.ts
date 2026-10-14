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

interface OmnisearchApi {
	search(query: string): Promise<ResultNoteApi[] | undefined>;
}

function getOmnisearch(): OmnisearchApi | undefined {
	return (window as Window & { omnisearch?: OmnisearchApi }).omnisearch;
}

export class OmniSearchContainer {
	private leaf: WorkspaceLeaf;
	private plugin: SurfingPlugin;
	private wbOmniSearchCtnEl!: HTMLElement;
	private query: string | undefined;
	private result: ResultNoteApi[] | undefined;

	constructor(leaf: WorkspaceLeaf, plugin: SurfingPlugin) {
		this.plugin = plugin;
		this.leaf = leaf;
	}

	onload() {
		this.wbOmniSearchCtnEl = this.leaf.view.contentEl.createDiv({
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
		this.wbOmniSearchCtnEl.createDiv({
			text: "No results found",
			cls: "wb-omni-item-notfound"
		})
	}

	// Tick current search box so that make it run again when Obsidian Reload
	tick(result: ResultNoteApi[] | undefined) {
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
				void (new OmniSearchItem(this.wbOmniSearchCtnEl, item.path, item.foundWords, item.matches, this.plugin)).onload();
			})
		}
	}

	public async update(query: string) {
		if (this.query === query) return;

		this.wbOmniSearchCtnEl.empty();
		this.query = query;

		const result = await getOmnisearch()?.search(this.query);

		this.tick(result);

		if (!result || result?.length === 0) {
			window.setTimeout(() => {
				void (async () => {
				const result = await getOmnisearch()?.search(this.query ?? query);
				this.tick(result);
							})();
			}, 3000);
		}
	}

	onunload() {
		this.wbOmniSearchCtnEl.empty();
		this.wbOmniSearchCtnEl.detach();
	}
}
