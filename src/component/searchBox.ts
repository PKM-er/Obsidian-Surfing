import { setIcon, WorkspaceLeaf } from "obsidian";
import AnotherWebBrowserPlugin from "../anotherWebBrowserIndex";

export default class searchBox {
	plugin: AnotherWebBrowserPlugin;
	leaf: WorkspaceLeaf;

	webContents: any;
	closeButtonEl: HTMLElement;
	backwardButtonEl: HTMLElement;
	forwardButtonEl: HTMLElement;
	inputEl: HTMLInputElement;
	searchBoxEl: HTMLElement;
	clicked: boolean;

	constructor(leaf: WorkspaceLeaf, webContents: any, plugin: AnotherWebBrowserPlugin, removeChild?: boolean) {
		this.leaf = leaf;
		this.webContents = webContents;
		this.plugin = plugin;

		this.onload();
	}

	onload() {
		const containerEl = this.leaf.view.contentEl;
		this.searchBoxEl = containerEl.createEl("div", {
			cls: "web-browser-search-box"
		});
		this.inputEl = this.searchBoxEl.createEl("input", {
			type: "text",
			placeholder: "",
			cls: "web-browser-search-input"
		});
		const searchButtonGroupEl = this.searchBoxEl.createEl("div", {
			cls: "web-browser-search-button-group"
		});
		this.backwardButtonEl = searchButtonGroupEl.createEl("div", {
			cls: "web-browser-search-button search-forward"
		});
		this.forwardButtonEl = searchButtonGroupEl.createEl("div", {
			cls: "web-browser-search-button search-backward"
		});
		this.closeButtonEl = searchButtonGroupEl.createEl("div", {
			cls: "web-browser-search-button search-close"
		});

		this.closeButtonEl.addEventListener("click", this.unload.bind(this));
		this.backwardButtonEl.addEventListener("click", this.backward.bind(this));
		this.forwardButtonEl.addEventListener("click", this.forward.bind(this));
		this.inputEl.addEventListener("keyup", this.search.bind(this))
		this.inputEl.addEventListener("keyup", this.exist.bind(this))

		setIcon(this.closeButtonEl, "x", 8);
		setIcon(this.backwardButtonEl, "arrow-up", 8);
		setIcon(this.forwardButtonEl, "arrow-down", 8);

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
		if (event.key === "Esc") {
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
		this.webContents.stopFindInPage('clearSelection')
		this.inputEl.value = "";

		this.closeButtonEl.removeEventListener("click", this.unload);
		this.backwardButtonEl.removeEventListener("click", this.backward);
		this.forwardButtonEl.removeEventListener("click", this.forward);
		this.inputEl.removeEventListener('keyup', this.search);
		this.inputEl.removeEventListener('keyup', this.exist);

		this.searchBoxEl.detach();
	}
}
