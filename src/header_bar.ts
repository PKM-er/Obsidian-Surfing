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
