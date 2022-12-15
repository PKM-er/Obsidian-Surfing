import { ItemView, WorkspaceLeaf } from "obsidian";
import SurfingPlugin from "./surfingIndex";
import React from "react";
import ReactDOM from "react-dom/client";
import BookmarkManager from "./component/BookmarkManager/BookmarkManager";
import { initializeJson, loadJson } from "./utils/json";
import { Bookmark } from "./types/bookmark";

export const WEB_BROWSER_BOOKMARK_MANAGER_ID = "surfing-bookmark-manager";

export class SurfingBookmarkManagerView extends ItemView {
	private bookmarkData: Bookmark[] = [];

	constructor(leaf: WorkspaceLeaf, public plugin: SurfingPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return WEB_BROWSER_BOOKMARK_MANAGER_ID;
	}

	getDisplayText() {
		return "Surfing Bookmark Manager";
	}

	getIcon(): string {
		return "album";
	}

	protected async onOpen(): Promise<void> {
		try {
			const { bookmarks } = await loadJson();
			this.bookmarkData = bookmarks;
		} catch (e) {
			if (this.bookmarkData.length === 0) {
				await initializeJson();
				const { bookmarks } = await loadJson();
				this.bookmarkData = bookmarks;
			}
		}

		ReactDOM.createRoot(this.containerEl).render(
			<React.StrictMode>
				<BookmarkManager
					bookmarks={this.bookmarkData}
					plugin={this.plugin}
				/>
			</React.StrictMode>
		);
	}
}
