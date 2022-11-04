import { EventRef, ItemView, Notice, Plugin } from "obsidian";
import { HeaderBar } from "./header_bar";
import { FunctionHooks } from "./hooks";
import { WebBrowserView, WEB_BROWSER_VIEW_ID } from "./web_browser_view";
import { HTML_FILE_EXTENSIONS, WEB_BROWSER_FILE_VIEW_ID, WebBrowserFileView } from "./web_browser_file_view";

export default class MyPlugin extends Plugin {
	private onLayoutChangeEventRef: EventRef;

	async onload() {
		await this.loadSettings();

		this.registerView(WEB_BROWSER_VIEW_ID, (leaf) => new WebBrowserView(leaf));

		// Feature to support html/htm files.
		this.registerView(WEB_BROWSER_FILE_VIEW_ID, (leaf) => new WebBrowserFileView(leaf));

		try {
			this.registerExtensions(HTML_FILE_EXTENSIONS, WEB_BROWSER_FILE_VIEW_ID);
		} catch (error) {
			new Notice(`File extensions ${HTML_FILE_EXTENSIONS} had been registered by other plugin!`);
		}

		FunctionHooks.onload();

		// Add header bar to "New tab" view.
		this.onLayoutChangeEventRef = this.app.workspace.on("layout-change", () => {
			var activeView = this.app.workspace.getActiveViewOfType(ItemView);
			if (activeView) {
				// Check if the view is a "New tab" view. I don't think this class is used elsewhere. I sure hope not.
				if (activeView.contentEl.children[0].hasClass("empty-state")) {
					// Check if the "New tab" view has already been processed and has a header bar already.
					if (!activeView.headerEl.children[2].hasClass("web-browser-header-bar")) {
						var headerBar = new HeaderBar(activeView.headerEl.children[2]);
						// Focus on current inputEl
						headerBar.focus();
						headerBar.addOnSearchBarEnterListener((url: string) => {
							WebBrowserView.spawnWebBrowserView(false, { url });
						});
					}
				}
			}
		});

		// Use checkCallback method to check if the view is WebBrowserView;
		// And change the default private to public.
		this.addCommand({
		    id: 'open-current-url-with-external-browser',
		    name: 'Open Current Url With External Browser',
		    checkCallback: (checking: boolean) => {
		        // Conditions to check
		        const webbrowserView = this.app.workspace.getActiveViewOfType(WebBrowserView);
		        if (webbrowserView) {
		            // If checking is true, we're simply "checking" if the command can be run.
		            // If checking is false, then we want to actually perform the operation.
		            if (!checking) {
						FunctionHooks.ogWindow$Open.call(window, webbrowserView.getState()?.url, "_blank");
		            }

		            // This command will only show up in Command Palette when the check function returns true
		            return true;
		        }
		    }
		});
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(WEB_BROWSER_VIEW_ID);
		FunctionHooks.onunload();
		this.app.workspace.offref(this.onLayoutChangeEventRef);

		// Clean up header bar added to "New tab" views when plugin is disabled.
		var searchBars = document.getElementsByClassName("web-browser-search-bar");
		while (searchBars.length > 0) {
			searchBars[0].parentElement?.removeChild(searchBars[0]);
		}
	}

	async loadSettings() {
	}

	async saveSettings() {
	}
}
