import SurfingPlugin from "../surfingIndex";
import { t } from "../translations/helper";
import { Component, ItemView, Scope, setIcon } from "obsidian";
import { BookmarkSuggester } from "./suggester/bookmarkSuggester";
import { FileSuggester } from "./suggester/fileSuggester";

export class HeaderBar extends Component {
	plugin: SurfingPlugin;
	private searchBar: HTMLInputElement;
	private onSearchBarEnterListener = new Array<(url: string) => void>;
	private view: ItemView;
	private parentEl: Element;
	private removeHeaderChild = true;

	constructor(parent: Element, plugin: SurfingPlugin, view: ItemView, removeHeaderChild?: boolean) {
		super();
		this.plugin = plugin;
		this.view = view;

		this.parentEl = parent;
		if (removeHeaderChild !== undefined) this.removeHeaderChild = removeHeaderChild;
	}

	onLoad() {
		// CSS class removes the gradient at the right of the header bar.
		this.parentEl.addClass("wb-header-bar");

		if (this.removeHeaderChild) this.parentEl.empty();

		this.initScope();

		if (this.plugin.settings.showRefreshButton && this.removeHeaderChild && this.view.getViewType() !== "empty") {
			const refreshButton = this.parentEl.createEl("div", {
				cls: "wb-refresh-button"
			});
			refreshButton.addEventListener("click", () => {
				this.view.leaf.rebuildView();
			});

			setIcon(refreshButton, "refresh-cw");
		}

		// Create search bar in header bar.
		// Use Obsidian CreateEL method.
		this.searchBar = this.parentEl.createEl("input", {
			type: "text",
			placeholder: t("Search with") + this.plugin.settings.defaultSearchEngine + t("or enter address"),
			cls: "wb-search-bar"
		});

		this.registerDomEvent(this.searchBar, "keydown", (event: KeyboardEvent) => {
			if (!event) {
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const event = window.event as KeyboardEvent;
			}
			if (event.key === "Enter") {
				// When enter is pressed, search for the url.
				for (const listener of this.onSearchBarEnterListener) {
					listener(this.searchBar.value);
				}
			}
		});

		if (!this.plugin.settings.bookmarkManager.openBookMark) new FileSuggester(app, this.plugin, this.searchBar, this.view);
		if (this.plugin.settings.bookmarkManager.openBookMark) new BookmarkSuggester(app, this.plugin, this.searchBar);

		// Use focusin to bubble up to the parent
		// Rather than just input element itself.
		// this.searchBar.addEventListener("focusin", (event: FocusEvent) => {
		// 	this.searchBar.select();
		// });
		this.registerDomEvent(this.searchBar, "focusin", (event: FocusEvent) => {
			this.searchBar.select();
		});

		// When focusout, unselect the text to prevent it is still selected when focus back
		// It will trigger some unexpected behavior,like you will not select all text and the cursor will set to current position;
		// The expected behavior is that you will select all text when focus back;
		// this.searchBar.addEventListener("focusout", (event: FocusEvent) => {
		// 	window.getSelection()?.removeAllRanges();
		// 	if (!this.removeChild) {
		// 		this.searchBar.detach();
		// 	}
		// });
		this.registerDomEvent(this.searchBar, "focusout", (event: FocusEvent) => {
			window.getSelection()?.removeAllRanges();
			if (!this.removeHeaderChild) {
				this.searchBar.detach();
			}
		});
	}

	initScope() {
		// console.log(this.view.scope);
		if (!this.view.scope) {
			this.view.scope = new Scope(this.plugin.app.scope);
			(this.view.scope as Scope).register([], '/', (evt) => {
				if (evt.target === this.searchBar) return;
				evt.preventDefault();
				this.searchBar.focus();
			});
		} else {
			(this.view.scope as Scope).register([], '/', (evt) => {
				if (evt.target === this.searchBar) return;
				evt.preventDefault();
				this.searchBar.focus();
			});
		}
	}

	addOnSearchBarEnterListener(listener: (url: string) => void) {
		this.onSearchBarEnterListener.push(listener);
	}

	setSearchBarUrl(url: string) {
		this.searchBar.value = url;
	}

	focus() {
		this.searchBar.focus();
	}
}
