import SurfingPlugin from "../../surfingIndex";
import { Bookmark, CategoryType } from "../../types/bookmark";
import { BookMarkItem } from "./BookMarkItem";
import { ItemView } from "obsidian";
import { initializeJson, loadJson } from "../../utils/json";

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

	// convertToBookmarkFolder(data: Bookmark[]) {
	// 	const groupBy = (list: Bookmark[], keyGetter: any) => {
	// 		const map = new Map();
	// 		list.forEach((item) => {
	// 			const key = keyGetter(item);
	// 			const collection = map.get(key);
	// 			if (!collection) {
	// 				item.category.splice(0, 1);
	// 				map.set(key, [item]);
	// 			} else {
	// 				collection.push(item);
	// 			}
	// 		});
	// 		return map;
	// 	}
	//
	// 	const group = groupBy(data, (item: Bookmark) => item.category[0]);
	// 	const result = Array.from(group, ([name, children]) => ({ name, children }));
	// 	console.log(result);
	// }

	render(bookmarks: Bookmark[], categories: CategoryType[]) {
		categories.forEach((item: CategoryType) => {
			new BookMarkItem(this.BookmarkBarEl, this.plugin, this.view, item, bookmarks).onload();
		})
	}

}
