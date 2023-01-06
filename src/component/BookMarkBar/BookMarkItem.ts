import { SurfingView } from "../../surfingView";
import SurfingPlugin from "../../surfingIndex";
import { Bookmark, CategoryType } from "../../types/bookmark";
import { ItemView, Menu, setIcon } from "obsidian";

export class BookMarkItem {
	private parentEl: HTMLElement;
	private plugin: SurfingPlugin;
	private readonly item: CategoryType;
	private view: ItemView;
	private readonly bookmark: Bookmark[];

	constructor(parentEl: HTMLElement, plugin: SurfingPlugin, view: ItemView, item: CategoryType, bookmark: Bookmark[]) {
		this.parentEl = parentEl;
		this.plugin = plugin;
		this.item = item;
		this.view = view;
		this.bookmark = bookmark;
	}

	onload() {
		if (typeof this.item === "object" && (this.item.value || this.item.children) && this.item.value !== "ROOT") {
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
			text: this.item.label,
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

			this.loopMenu(menu, this.item);

			menu.showAtPosition({
				x: currentPos.left,
				y: currentPos.bottom,
			});

		}
	}

	loopMenu(menu: Menu, category: CategoryType) {
		if (category?.children) category?.children.forEach((child) => {
			let subMenu: Menu | undefined;
			menu.addItem((item) =>
				subMenu = item.setTitle(child.label).setIcon('folder-closed').setSubmenu()
			);

			if (!child?.children) {
				const bookmark = this.bookmark.filter((item) => {
					if (!item.category.length) return false;
					return item.category[item.category.length - 1] === child.value;
				});

				if (bookmark.length > 0) {
					bookmark.forEach((bookmarkItem) => {
						subMenu?.addItem((item) => {
							item.setIcon('surfing')
								.setTitle(bookmarkItem.name)
								.onClick((e: MouseEvent) => {
									// @ts-ignore
									if (e.shiftKey) {
										window.open(bookmarkItem.url, "_blank", "external");
										return;
									}
									if (!e.ctrlKey && !e.metaKey) SurfingView.spawnWebBrowserView(false, { url: bookmarkItem.url });
									else SurfingView.spawnWebBrowserView(true, { url: bookmarkItem.url });
								})
						});
					});
				}
			}

			if (child?.children && subMenu) this.loopMenu(subMenu, child);
		});

		const bookmark = this.bookmark.filter((item) => {
			if (!item.category.length) return false;
			return item.category[item.category.length - 1]?.contains(category.value);
		});

		if (bookmark.length > 0) {
			bookmark.forEach((bookmarkItem) => {
				menu.addItem((item) => {
					item.setIcon('surfing')
						.setTitle(bookmarkItem.name)
						.onClick((e: MouseEvent) => {
							if (e.shiftKey) {
								window.open(bookmarkItem.url, "_blank", "external");
								return;
							}
							if (!e.ctrlKey && !e.metaKey) SurfingView.spawnWebBrowserView(false, { url: bookmarkItem.url });
							else SurfingView.spawnWebBrowserView(true, { url: bookmarkItem.url });
						})
				});
			});
		}
	}

	renderBookmark() {
		if (this.bookmark.length === 0) return;
		const rootBookmark = this.bookmark.filter((item) => (item?.category[0] === this.item?.value && item?.category.length === 1));

		if (rootBookmark?.length > 0) {
			rootBookmark.forEach((bookmarkItem) => {
				const bookmarkEl = this.parentEl.createEl("div", {
					cls: "wb-bookmark-item"
				});
				const folderIconEl = bookmarkEl.createEl("div", {
					cls: "wb-bookmark-item-icon",
				})

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
					if (!e.ctrlKey && !e.metaKey) SurfingView.spawnWebBrowserView(false, { url: bookmarkItem.url });
					else SurfingView.spawnWebBrowserView(true, { url: bookmarkItem.url });
				}
			});
		}


	}

}
