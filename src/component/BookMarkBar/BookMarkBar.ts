import SurfingPlugin from "../../surfingIndex";
import { BookmarkFileItem } from "../../utils/bookmarkStore";
import { BookMarkItem } from "./BookMarkItem";
import { ItemView, setIcon } from "obsidian";

export class BookMarkBar {
	private view: ItemView;
	private plugin: SurfingPlugin;
	private BookmarkBarEl: HTMLElement;
	private BookmarkBarContainerEl: HTMLElement;

	constructor(view: ItemView, plugin: SurfingPlugin) {
		this.view = view;
		this.plugin = plugin;
	}

	async onload() {
		// Remove existing bar if re-loading
		const existing = this.view.contentEl.querySelector(".wb-bookmark-bar");
		if (existing) existing.detach();

		this.BookmarkBarEl = this.view.contentEl.createEl("div", {
			cls: "wb-bookmark-bar",
		});

		this.renderIcon();

		const bookmarks = this.plugin.bookmarkCache;
		this.render(bookmarks);
	}

	renderIcon() {
		const bookmarkManagerEl = this.BookmarkBarEl.createEl("div", {
			cls: "wb-bookmark-manager-entry",
		});

		const bookmarkManagerIconEl = bookmarkManagerEl.createEl("div", {
			cls: "wb-bookmark-manager-icon",
		});

		bookmarkManagerEl.onclick = async () => {
			// Open bookmarks folder in file explorer
			const folderPath =
				this.plugin.settings.bookmarkManager.bookmarkFolder ||
				"surfing-bookmarks";
			const fileExplorer =
				this.plugin.app.workspace.getLeavesOfType("file-explorer")[0];
			if (fileExplorer) {
				this.plugin.app.workspace.revealLeaf(fileExplorer);
				const folder =
					this.plugin.app.vault.getAbstractFileByPath(folderPath);
				if (folder) {
					// @ts-ignore
					fileExplorer.view?.revealInFolder?.(folder);
				}
			}
		};

		setIcon(bookmarkManagerIconEl, "bookmark");
	}

	render(bookmarks: BookmarkFileItem[]) {
		if (this.BookmarkBarContainerEl) this.BookmarkBarContainerEl.detach();

		this.BookmarkBarContainerEl = this.BookmarkBarEl.createEl("div", {
			cls: "wb-bookmark-bar-container",
		});

		// Group bookmarks by their top-level category
		const categoryMap = new Map<string, BookmarkFileItem[]>();

		for (const bm of bookmarks) {
			const topCat = bm.category.length > 0 ? bm.category[0] : "ROOT";
			if (!categoryMap.has(topCat)) {
				categoryMap.set(topCat, []);
			}
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			categoryMap.get(topCat)!.push(bm);
		}

		// Render non-ROOT folders first, then ROOT items
		for (const [cat, items] of categoryMap) {
			if (cat !== "ROOT") {
				new BookMarkItem(
					this.BookmarkBarContainerEl,
					this.plugin,
					this.view,
					cat,
					items,
					false,
				).onload();
			}
		}

		// Render ROOT bookmarks as top-level items
		const rootItems = categoryMap.get("ROOT") || [];
		for (const item of rootItems) {
			new BookMarkItem(
				this.BookmarkBarContainerEl,
				this.plugin,
				this.view,
				"ROOT",
				[item],
				true,
			).onload();
		}
	}
}
