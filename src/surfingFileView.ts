import { FileSystemAdapter, FileView, TFile, WorkspaceLeaf } from "obsidian";
import { SurfingView } from "./surfingView";

export const HTML_FILE_EXTENSIONS = ["html", "htm"];
export const WEB_BROWSER_FILE_VIEW_ID = "surfing-file-view";

export class SurfingFileView extends FileView {
	allowNoFile: false;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.allowNoFile = false;
	}

	async onLoadFile(file: TFile): Promise<void> {
		const adapter = this.app.vault.adapter as FileSystemAdapter;
		const urlString = "file:///" + (adapter.getBasePath() + "/" + file.path).toString().replace(/\s/g, "%20");
		SurfingView.spawnWebBrowserView(true, {url: urlString});
		if (this.leaf) this.leaf.detach();
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
