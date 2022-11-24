import AnotherWebBrowserPlugin from "../anotherWebBrowserIndex";
import { t } from "../translations/helper";

export class InPageSearchBar {
	plugin: AnotherWebBrowserPlugin;
	private inPageSearchBarEl: HTMLInputElement;
	private inPageSearchBarContainerEl: HTMLDivElement;
	private onSearchBarEnterListener = new Array<(url: string) => void>;

	constructor(parent: Element, plugin: AnotherWebBrowserPlugin) {
		this.plugin = plugin;
		// CSS class removes the gradient at the right of the header bar.
		parent.addClass("wb-page-search-bar");
		// Remove default title from header bar.
		// Use Obsidian API to remove the title.

		this.inPageSearchBarContainerEl = parent.createEl("div", {
			cls: "wb-page-search-bar-container"
		});

		this.inPageSearchBarContainerEl.createEl("div", {
			text: "Surf It",
			cls: "wb-page-search-bar-text"
		})

		// Create search bar in header bar.
		// Use Obsidian CreateEL method.
		this.inPageSearchBarEl = this.inPageSearchBarContainerEl.createEl("input", {
			type: "text",
			placeholder: t("Search with") + this.plugin.settings.defaultSearchEngine + t("or enter address"),
			cls: "wb-page-search-bar-input"
		});

		// TODO: Would this be ok to use Obsidian add domlistener instead?
		this.inPageSearchBarEl.addEventListener("keydown", (event: KeyboardEvent) => {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			if (!event) {
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const event = window.event as KeyboardEvent;
			}
			if (event.key === "Enter") {
				for (const listener of this.onSearchBarEnterListener) {
					listener(this.inPageSearchBarEl.value);
				}
			}
		}, false);

		// Use focusin to bubble up to the parent
		// Rather than just input element itself.
		this.inPageSearchBarEl.addEventListener("focusin", (event: FocusEvent) => {
			this.inPageSearchBarEl.select();
		})

		// When focusout, unselect the text to prevent it is still selected when focus back
		// It will trigger some unexpected behavior,like you will not select all text and the cursor will set to current position;
		// The expected behavior is that you will select all text when focus back;
		this.inPageSearchBarEl.addEventListener("focusout", (event: FocusEvent) => {
			window.getSelection()?.removeAllRanges();
		})
	}

	addOnSearchBarEnterListener(listener: (url: string) => void) {
		this.onSearchBarEnterListener.push(listener);
	}

	focus() {
		this.inPageSearchBarEl.focus();
	}
}
