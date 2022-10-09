import { addIcon, App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { WebBrowserView, WEB_BROWSER_VIEW_ID } from './view';

export default class MyPlugin extends Plugin {
	async onload() {
		await this.loadSettings();

		this.registerView(WEB_BROWSER_VIEW_ID, (leaf) => new WebBrowserView(leaf));

		// TODO: Replace ribbon icon with better way to open web browser tab.
		this.addRibbonIcon('search', 'Web Browser', (event: PointerEvent) => {
			let leaf = this.app.workspace.getLeaf(process.platform === "darwin" ? event.metaKey : event.ctrlKey);
			leaf.setViewState({ type: WEB_BROWSER_VIEW_ID, active: true });
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
