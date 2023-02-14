import { ItemView, WorkspaceLeaf } from "obsidian";
import SurfingPlugin from "../../surfingIndex";
import React from "react";
import ReactDOM from "react-dom/client";
import TabTree from "./TabTree";

export const WEB_BROWSER_TAB_TREE_ID = "surfing-tab-tree";

export class TabTreeView extends ItemView {
	constructor(leaf: WorkspaceLeaf, public plugin: SurfingPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return WEB_BROWSER_TAB_TREE_ID;
	}

	getDisplayText() {
		return "Surfing Tab Tree";
	}

	getIcon(): string {
		return "chrome";
	}

	protected async onOpen(): Promise<void> {
		ReactDOM.createRoot(this.containerEl).render(
			<React.StrictMode>
				<TabTree
					plugin={ this.plugin }
				/>
			</React.StrictMode>
		);
	}
}
