import SurfingPlugin from "../../surfingIndex";
import { Bookmark, CategoryType } from "../../types/bookmark";
import { BookMarkItem } from "./BookMarkItem";
import { ItemView, setIcon } from "obsidian";
import { initializeJson, loadJson } from "../../utils/json";
import { WEB_BROWSER_BOOKMARK_MANAGER_ID } from "../../surfingBookmarkManager";

export class BookMarkBar {
	private view: ItemView;
	private plugin: SurfingPlugin;
	private BookmarkBarEl: HTMLElement;
	private bookmarkData: Bookmark[];
	private categoryData: CategoryType[];

	constructor(view: ItemView, plugin: SurfingPlugin) {
		this.view = view;
		this.plugin = plugin;
	}

	async onload() {
		this.BookmarkBarEl = this.view.contentEl.createEl("div", {
			cls: "wb-bookmark-bar"
		})

		this.renderIcon();

		try {
			const { bookmarks, categories } = await loadJson();
			this.bookmarkData = bookmarks;
			this.categoryData = categories;
		} catch (e) {
			if (this.bookmarkData.length === 0) {
				await initializeJson();
				const { bookmarks, categories } = await loadJson();
				this.bookmarkData = bookmarks;
				this.categoryData = categories;
			}
		}

		// this.convertToBookmarkFolder(this.bookmarkData);
		this.render(this.bookmarkData, this.categoryData);
	}

	renderIcon() {
		const bookmarkManagerEl = this.BookmarkBarEl.createEl("div", {
			cls: "wb-bookmark-manager-entry"
		});

		const bookmarkManagerIconEl = bookmarkManagerEl.createEl("div", {
			cls: "wb-bookmark-manager-icon",
		})

		bookmarkManagerEl.onclick = async () => {
			const workspace = app.workspace;
			workspace.detachLeavesOfType(WEB_BROWSER_BOOKMARK_MANAGER_ID);
			await workspace.getLeaf(false).setViewState({ type: WEB_BROWSER_BOOKMARK_MANAGER_ID });
			workspace.revealLeaf(workspace.getLeavesOfType(WEB_BROWSER_BOOKMARK_MANAGER_ID)[0]);
		}

		setIcon(bookmarkManagerIconEl, "bookmark");
	}

	render(bookmarks: Bookmark[], categories: CategoryType[]) {
		categories?.forEach((item: CategoryType) => {
			new BookMarkItem(this.BookmarkBarEl, this.plugin, this.view, item, bookmarks).onload();
		})
	}

}
