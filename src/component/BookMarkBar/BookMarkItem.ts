import { SurfingView } from "../../surfingView";
import SurfingPlugin from "../../surfingIndex";
import { BookmarkFileItem } from "../../utils/bookmarkStore";
import { ItemView, Menu, setIcon } from "obsidian";

export class BookMarkItem {
	private parentEl: HTMLElement;
	private plugin: SurfingPlugin;
	private readonly categoryName: string;
	private view: ItemView;
	private readonly bookmarks: BookmarkFileItem[];
	private readonly isRoot: boolean;

	constructor(
		parentEl: HTMLElement,
		plugin: SurfingPlugin,
		view: ItemView,
		categoryName: string,
		bookmarks: BookmarkFileItem[],
		isRoot: boolean,
	) {
		this.parentEl = parentEl;
		this.plugin = plugin;
		this.categoryName = categoryName;
		this.view = view;
		this.bookmarks = bookmarks;
		this.isRoot = isRoot;
	}

	onload() {
		if (this.isRoot) {
			this.renderBookmark();
		} else {
			this.renderFolder();
		}
	}

	renderFolder() {
		const folderEl = this.parentEl.createEl("div", {
			cls: "wb-bookmark-folder"
		});
		const folderIconEl = folderEl.createEl("div", {
			cls: "wb-bookmark-folder-icon",
		});
		folderEl.createEl("div", {
			cls: "wb-bookmark-folder-title",
			text: this.categoryName,
		});

		setIcon(folderIconEl, "folder-closed");

		let currentPos: DOMRect;

		folderEl.onclick = (e: MouseEvent) => {
			const menu = new Menu();

			if (!currentPos) {
				const targetEl = e.target as HTMLElement;
				const parentElement = targetEl.parentElement as HTMLElement;

				if (parentElement.classList.contains("wb-bookmark-folder")) currentPos = parentElement.getBoundingClientRect();
				else currentPos = targetEl.getBoundingClientRect();
			}

			for (const bookmarkItem of this.bookmarks) {
				menu.addItem((item) => {
					item.setIcon("surfing")
						.setTitle(bookmarkItem.name)
						.onClick((e: MouseEvent) => {
							if (e.shiftKey) {
								window.open(bookmarkItem.url, "_blank", "external");
								return;
							}
							if (!e.ctrlKey && !e.metaKey) SurfingView.spawnWebBrowserView(this.plugin, false, { url: bookmarkItem.url });
							else SurfingView.spawnWebBrowserView(this.plugin, true, { url: bookmarkItem.url });
						});
				});
			}

			menu.showAtPosition({
				x: currentPos.left,
				y: currentPos.bottom,
			});
		};
	}

	renderBookmark() {
		if (this.bookmarks.length === 0) return;

		for (const bookmarkItem of this.bookmarks) {
			const bookmarkEl = this.parentEl.createEl("div", {
				cls: "wb-bookmark-item"
			});
			const folderIconEl = bookmarkEl.createEl("div", {
				cls: "wb-bookmark-item-icon",
			});

			setIcon(folderIconEl, "album");

			bookmarkEl.createEl("div", {
				cls: "wb-bookmark-item-title",
				text: bookmarkItem.name,
			});
			bookmarkEl.onclick = (e: MouseEvent) => {
				if (e.shiftKey) {
					window.open(bookmarkItem.url, "", "external");
					return;
				}
				if (!e.ctrlKey && !e.metaKey) SurfingView.spawnWebBrowserView(this.plugin, false, { url: bookmarkItem.url });
				else SurfingView.spawnWebBrowserView(this.plugin, true, { url: bookmarkItem.url });
			};
		}
	}
}
