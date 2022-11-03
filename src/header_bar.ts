export class HeaderBar {
    private searchBar: HTMLInputElement;
    private onSearchBarEnterListener = new Array<(url: string) => void>;

    constructor(parent: Element) {
        // CSS class removes the gradient at the right of the header bar.
        parent.addClass("web-browser-header-bar");
        // Remove default title from header bar.
        parent.removeChild(parent.children[1]);

        // Create search bar in header bar.
        this.searchBar = document.createElement("input");
        this.searchBar.type = "text";
        this.searchBar.placeholder = "Search with DuckDuckGo or enter address"
        this.searchBar.addClass("web-browser-search-bar");
        parent.appendChild(this.searchBar);

		// TODO: Would this be ok to use Obsidian add domlistener instead?
        this.searchBar.addEventListener("keydown", (event: KeyboardEvent) => {
            if (!event) { var event = window.event as KeyboardEvent; }
            if (event.key === "Enter") {
                for (var listener of this.onSearchBarEnterListener) {
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
