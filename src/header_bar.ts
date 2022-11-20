export class HeaderBar {
	private searchBar: HTMLInputElement;
	private onSearchBarEnterListener = new Array<(url: string) => void>;

	constructor(parent: Element) {
		// CSS class removes the gradient at the right of the header bar.
		parent.addClass("web-browser-header-bar");
		// Remove default title from header bar.
		// Use Obsidian API to remove the title.
		parent.empty();

		// Create search bar in header bar.
		// Use Obsidian CreateEL method.
		this.searchBar = parent.createEl("input", {
			type: "text",
			placeholder: "Search with DuckDuckGo or enter address",
			cls: "web-browser-search-bar"
		});

		// TODO: Would this be ok to use Obsidian add domlistener instead?
		this.searchBar.addEventListener("keydown", (event: KeyboardEvent) => {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			if (!event) {
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const event = window.event as KeyboardEvent;
			}
			if (event.key === "Enter") {
				for (const listener of this.onSearchBarEnterListener) {
					listener(this.searchBar.value);
				}
			}
		}, false);

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
