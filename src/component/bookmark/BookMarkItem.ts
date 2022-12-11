import { SurfingView } from "../../surfingView";
import SurfingPlugin from "../../surfingIndex";
import { Bookmark, BookmarkFolder } from "../../types/bookmark";
import { ItemView, Menu, setIcon } from "obsidian";

export class BookMarkItem {
	private parentEl: HTMLElement;
	private plugin: SurfingPlugin;
	private readonly item: BookmarkFolder | Bookmark;
	private view: ItemView;

	constructor(parentEl: HTMLElement, plugin: SurfingPlugin, view: ItemView, item: BookmarkFolder | Bookmark) {
		this.parentEl = parentEl;
		this.plugin = plugin;
		this.item = item;
		this.view = view;
	}

	onload() {
		if (typeof this.item === "object" && this.item.hasOwnProperty("children")) {
			this.renderFolder();
		} else {
			this.renderBookmark();
		}
	}

	renderFolder() {
		const folderEl = this.parentEl.createEl("div", {
			cls: "wb-bookmark-folder"
		});
		const folderIconEl = folderEl.createEl("div", {
			cls: "wb-bookmark-folder-icon",
		})
		folderEl.createEl("div", {
			cls: "wb-bookmark-folder-title",
			text: this.item.title,
		});

		setIcon(folderIconEl, "folder");

		let currentPos: DOMRect;

		folderEl.onclick = (e: MouseEvent) => {
			const menu = new Menu();

			if (!currentPos) {
				const targetEl = e.target as HTMLElement;
				const parentElement = targetEl.parentElement as HTMLElement;

				if (parentElement.classList.contains("wb-bookmark-folder")) currentPos = parentElement.getBoundingClientRect();
				else currentPos = targetEl.getBoundingClientRect();
			}

			(this.item as BookmarkFolder).children.forEach((bookmarkItem: Bookmark) => {
				menu.addItem((item) => {
					item.setIcon('surfing')
						.setTitle(bookmarkItem.title)
						.onClick(() => {
							// @ts-ignore
							SurfingView.spawnWebBrowserView(false, { url: bookmarkItem.url });
						})
				});
			});

			menu.showAtPosition({
				x: currentPos.left,
				y: currentPos.bottom,
			});

		}
	}

	renderBookmark() {
		const bookmarkEl = this.parentEl.createEl("div", {
			cls: "wb-bookmark-item"
		});
		const folderIconEl = bookmarkEl.createEl("div", {
			cls: "wb-bookmark-item-icon",
		})

		setIcon(folderIconEl, "album");

		bookmarkEl.createEl("div", {
			cls: "wb-bookmark-item-title",
			text: this.item.title,
		});
		bookmarkEl.onclick = () => {
			// @ts-ignore
			SurfingView.spawnWebBrowserView(false, { url: this.item.url });
		}
	}

}
