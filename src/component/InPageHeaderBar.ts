import { t } from "../translations/helper";


export class InPageHeaderBar {
	private node: any;
	private url: string;
	private searchBar: HTMLInputElement;
	private onSearchBarEnterListener = new Array<(url: string) => void>;

	constructor(node: any, url: string) {
		this.node = node;
		this.url = url
	}

	onload() {
		const pluginSettings = app.plugins.getPlugin("surfing").settings;

		console.log("InPageHeaderBar onload");

		this.searchBar = this.node?.contentEl.createEl("input", {
			type: "text",
			placeholder: t("Search with") + pluginSettings.defaultSearchEngine + t("or enter address"),
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
