import { Plugin } from "obsidian";
import { WebBrowserView, WEB_BROWSER_VIEW_ID } from "./view";

export default class MyPlugin extends Plugin {
	async onload() {
		await this.loadSettings();

		this.registerView(WEB_BROWSER_VIEW_ID, (leaf) => new WebBrowserView(leaf));

		// TODO: Replace ribbon icon with better way to open web browser tab.
		this.addRibbonIcon("search", "Web Browser", (event: PointerEvent) => {
			WebBrowserView.spawnWebBrowserView(
				process.platform === "darwin" ? event.metaKey : event.ctrlKey,
				{
					url: "https://duckduckgo.com"
				}
			);
		});
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(WEB_BROWSER_VIEW_ID);
	}

	async loadSettings() {
	}

	async saveSettings() {
	}
}
