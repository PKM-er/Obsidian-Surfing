import { FileSystemAdapter, FileView, TFile, WorkspaceLeaf } from "obsidian";
import { WebBrowserView } from "./web_browser_view";

export const HTML_FILE_EXTENSIONS = ["html","htm"];
export const WEB_BROWSER_FILE_VIEW_ID = "web-browser-file-view";

export class WebBrowserFileView extends FileView {
	allowNoFile: false;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	async onLoadFile(file: TFile): Promise<void> {
		const adapter = this.app.vault.adapter as FileSystemAdapter;
		const urlString = "file:///" + (adapter.getBasePath() + "/" + file.path).toString().replace(/\s/g, "%20");
		WebBrowserView.spawnWebBrowserView(true, { url: urlString });
		if(this.leaf) this.leaf.detach();
	}

	onunload(): void {
	}

	canAcceptExtension(extension: string) {
		return HTML_FILE_EXTENSIONS.includes(extension);
	}

	getViewType() {
		return WEB_BROWSER_FILE_VIEW_ID;
	}
}
