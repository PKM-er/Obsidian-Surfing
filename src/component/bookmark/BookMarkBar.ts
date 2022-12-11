import SurfingPlugin from "../../surfingIndex";
import { Bookmark, BookmarkFolder } from "../../types/bookmark";
import { BookMarkItem } from "./BookMarkItem";
import { ItemView } from "obsidian";

export class BookMarkBar {
	private view: ItemView;
	private plugin: SurfingPlugin;
	private BookmarkBarEl: HTMLElement;

	constructor(view: ItemView, plugin: SurfingPlugin) {
		this.view = view;
		this.plugin = plugin;
	}

	onload() {
		this.BookmarkBarEl = this.view.contentEl.createEl("div", {
			cls: "wb-bookmark-bar"
		})

		const testData: BookmarkFolder = {
			title: "",
			children: [
				{
					title: "test12222222222222222",
					url: "https://www.baidu.com",
					created: "2021-08-01",
					star: true,
				},
				{
					title: "test12222222222222222",
					url: "https://www.baidu.com",
					created: "2021-08-01",
					star: true,
				},
				{
					title: "test12222222222222222",
					url: "https://www.baidu.com",
					created: "2021-08-01",
					star: true,
				},
				{
					title: "test12222222222222222",
					url: "https://www.baidu.com",
					created: "2021-08-01",
					star: true,
				},
				{
					title: "test12222222222222222",
					url: "https://www.baidu.com",
					created: "2021-08-01",
					star: true,
				},
				{
					title: "test12222222222222222",
					url: "https://www.baidu.com",
					created: "2021-08-01",
					star: true,
				},
				{
					title: "next",
					children: [
						{
							title: "test12222222222222222",
							url: "https://www.baidu.com",
							created: "2021-08-01",
							star: true,
						},
						{
							title: "test12222222222222222",
							url: "https://www.baidu.com",
							created: "2021-08-01",
							star: true,
						},
						{
							title: "test12222222222222222",
							url: "https://www.baidu.com",
							created: "2021-08-01",
							star: true,
						},
						{
							title: "test12222222222222222",
							url: "https://www.baidu.com",
							created: "2021-08-01",
							star: true,
						},
						{
							title: "test12222222222222222",
							url: "https://www.baidu.com",
							created: "2021-08-01",
							star: true,
						},
						{
							title: "test12222222222222222",
							url: "https://www.baidu.com",
							created: "2021-08-01",
							star: true,
						},
					],
					parent: undefined,
					root: false,
				}
			],
			parent: undefined,
			root: true,
		}

		this.render(testData);
	}

	render(data: BookmarkFolder) {
		const { children } = data;
		children.forEach((item: Bookmark | BookmarkFolder) => {
			new BookMarkItem(this.BookmarkBarEl, this.plugin, this.view, item).onload();
		})
	}

}
