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
			cls: "web-browser-search-bar"});

        this.searchBar.addEventListener("keydown", (event: KeyboardEvent) => {
            if (!event) { var event = window.event as KeyboardEvent; }
            if (event.key === "Enter") {
                for (var listener of this.onSearchBarEnterListener) {
                    listener(this.searchBar.value);
                }
            }
        }, false);
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
