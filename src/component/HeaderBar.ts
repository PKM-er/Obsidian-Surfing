import SurfingPlugin from "../surfingIndex";
import { t } from "../translations/helper";
import { ItemView, setIcon } from "obsidian";
import { BookmarkSuggester } from "./suggester/bookmarkSuggester";

export class HeaderBar {
	plugin: SurfingPlugin;
	private searchBar: HTMLInputElement;
	private onSearchBarEnterListener = new Array<(url: string) => void>;
	private view: ItemView;
	private parentEl: Element;
	removeChild = true;

	constructor(parent: Element, plugin: SurfingPlugin, view: ItemView, removeChild?: boolean) {
		this.plugin = plugin;
		this.view = view;

		this.parentEl = parent;
		if (removeChild !== undefined) this.removeChild = removeChild;
	}

	onLoad() {
		// CSS class removes the gradient at the right of the header bar.
		this.parentEl.addClass("wb-header-bar");

		if (this.removeChild) this.parentEl.empty();

		if (this.plugin.settings.showRefreshButton && this.removeChild && this.view.getViewType() !== "empty") {
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

		// TODO: Would this be ok to use Obsidian add domlistener instead?
		this.searchBar.addEventListener("keydown", (event: KeyboardEvent) => {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
		}, false);

		new BookmarkSuggester(app, this.plugin, this.searchBar);

		// Use focusin to bubble up to the parent
		// Rather than just input element itself.
		this.searchBar.addEventListener("focusin", (event: FocusEvent) => {
			this.searchBar.select();
		})

		// When focusout, unselect the text to prevent it is still selected when focus back
		// It will trigger some unexpected behavior,like you will not select all text and the cursor will set to current position;
		// The expected behavior is that you will select all text when focus back;
		this.searchBar.addEventListener("focusout", (event: FocusEvent) => {
			window.getSelection()?.removeAllRanges();
			if (!this.removeChild) {
				this.searchBar.detach();
			}
		})
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
