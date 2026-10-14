import { setIcon, WorkspaceLeaf } from "obsidian";
import type * as Electron from "electron";
import SurfingPlugin from "../surfingIndex";

export default class searchBox {
	plugin: SurfingPlugin;
	leaf: WorkspaceLeaf;

	webContents: Electron.WebContents;
	closeButtonEl!: HTMLElement;
	backwardButtonEl!: HTMLElement;
	forwardButtonEl!: HTMLElement;
	inputEl!: HTMLInputElement;
	searchBoxEl!: HTMLElement;
	clicked!: boolean;

	private readonly onUnload = () => this.unload();
	private readonly onBackward = () => this.backward();
	private readonly onForward = () => this.forward();
	private readonly onSearch = (event: KeyboardEvent) => this.search(event);
	private readonly onExist = (event: KeyboardEvent) => this.exist(event);

	constructor(leaf: WorkspaceLeaf, webContents: Electron.WebContents, plugin: SurfingPlugin, removeChild?: boolean) {
		this.leaf = leaf;
		this.webContents = webContents;
		this.plugin = plugin;

		this.onload();
	}

	onload() {
		const containerEl = this.leaf.view.contentEl;
		this.searchBoxEl = containerEl.createDiv({
			cls: "wb-search-box"
		});
		this.inputEl = this.searchBoxEl.createEl("input", {
			type: "text",
			placeholder: "",
			cls: "wb-search-input"
		});
		const searchButtonGroupEl = this.searchBoxEl.createDiv({
			cls: "wb-search-button-group"
		});
		this.backwardButtonEl = searchButtonGroupEl.createDiv({
			cls: "wb-search-button search-forward"
		});
		this.forwardButtonEl = searchButtonGroupEl.createDiv({
			cls: "wb-search-button search-backward"
		});
		this.closeButtonEl = searchButtonGroupEl.createDiv({
			cls: "wb-search-button search-close"
		});

		this.closeButtonEl.addEventListener("click", this.onUnload);
		this.backwardButtonEl.addEventListener("click", this.onBackward);
		this.forwardButtonEl.addEventListener("click", this.onForward);
		this.inputEl.addEventListener("keyup", this.onSearch);
		this.inputEl.addEventListener("keyup", this.onExist);

		setIcon(this.closeButtonEl, "x");
		setIcon(this.backwardButtonEl, "arrow-up");
		setIcon(this.forwardButtonEl, "arrow-down");

		this.inputEl.focus();
	}

	search(event: KeyboardEvent) {
		event.preventDefault();
		if (this.inputEl.value === "") return;

		if (event.key === "Enter" && !event.shiftKey) {
			this.forward();
		}
		if (event.key === "Enter" && event.shiftKey) {
			this.backward();
		}
	}

	exist(event: KeyboardEvent) {
		event.preventDefault();
		if (event.key === "Escape") {
			this.unload();
		}
	}

	backward() {
		if (this.inputEl.value === "") return;

		if (!this.clicked) {
			this.webContents.findInPage(this.inputEl.value, {
				forward: false,
				findNext: true
			});
		} else {
			this.webContents.findInPage(this.inputEl.value, {
				forward: false,
				findNext: false
			});
		}
		this.clicked = true;
	}

	forward() {
		if (this.inputEl.value === "") return;
		if (!this.clicked) {
			this.webContents.findInPage(this.inputEl.value, {
				forward: true,
				findNext: true
			});
		} else {
			this.webContents.findInPage(this.inputEl.value, {
				forward: true,
				findNext: false
			});
		}
		this.clicked = true;
	}

	unload() {
		this.webContents.stopFindInPage('clearSelection');
		this.inputEl.value = "";

		this.closeButtonEl.removeEventListener("click", this.onUnload);
		this.backwardButtonEl.removeEventListener("click", this.onBackward);
		this.forwardButtonEl.removeEventListener("click", this.onForward);
		this.inputEl.removeEventListener('keyup', this.onSearch);
		this.inputEl.removeEventListener('keyup', this.onExist);

		this.searchBoxEl.detach();
	}
}
