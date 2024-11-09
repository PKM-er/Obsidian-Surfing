import { FileSystemAdapter, FileView, TFile, WorkspaceLeaf } from "obsidian";
import { SurfingView } from "./surfingView";
import SurfingPlugin from "./surfingIndex";

export const HTML_FILE_EXTENSIONS = ["html", "htm"];
export const WEB_BROWSER_FILE_VIEW_ID = "surfing-file-view";

export class SurfingFileView extends FileView {
	allowNoFile: false;
	private plugin: SurfingPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: SurfingPlugin) {
		super(leaf);
		this.allowNoFile = false;
		this.plugin = plugin;
	}

	async onLoadFile(file: TFile): Promise<void> {
		const adapter = this.app.vault.adapter as FileSystemAdapter;
		const urlString = "file:///" + (adapter.getBasePath() + "/" + file.path).toString().replace(/\s/g, "%20");
		SurfingView.spawnWebBrowserView(this.plugin, true, {url: urlString});
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
