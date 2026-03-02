import SurfingPlugin from "../../surfingIndex";
import { Bookmark, CategoryType } from "../../types/bookmark";
import { BookMarkItem } from "./BookMarkItem";
import { ItemView, Menu, Notice, setIcon } from "obsidian";
import { initializeJson, loadJson } from "../../utils/json";
import { WEB_BROWSER_BOOKMARK_MANAGER_ID } from "../../surfingBookmarkManager";
import { SurfingView } from "../../surfingView";

export class BookMarkBar {
	private view: ItemView;
	private plugin: SurfingPlugin;
	private BookmarkBarEl: HTMLElement;
	private BookmarkBarContainerEl: HTMLElement;
	private bookmarkData: Bookmark[] = [];
	private categoryData: CategoryType[] = [];

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
			const { bookmarks, categories } = await loadJson(this.plugin);
			this.bookmarkData = bookmarks;
			this.categoryData = categories;
		} catch (e) {
			if (this.bookmarkData?.length === 0 || !this.bookmarkData) {
				await initializeJson(this.plugin);
				const { bookmarks, categories } = await loadJson(this.plugin);
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
			const workspace = this.plugin.app.workspace;
			workspace.detachLeavesOfType(WEB_BROWSER_BOOKMARK_MANAGER_ID);
			await workspace.getLeaf(false).setViewState({ type: WEB_BROWSER_BOOKMARK_MANAGER_ID });
			workspace.revealLeaf(workspace.getLeavesOfType(WEB_BROWSER_BOOKMARK_MANAGER_ID)[0]);
		}

		setIcon(bookmarkManagerIconEl, "bookmark");
	}

	render(bookmarks: Bookmark[], categories: CategoryType[]) {

		if (this.BookmarkBarContainerEl) this.BookmarkBarContainerEl.detach();

		// Move root to the end;
		const rootCategory = categories.shift();
		if (rootCategory) categories.push(rootCategory);

		this.BookmarkBarContainerEl = this.BookmarkBarEl.createEl("div", {
			cls: "wb-bookmark-bar-container"
		});

		categories?.forEach((item: CategoryType) => {
			new BookMarkItem(this.BookmarkBarContainerEl, this.plugin, this.view, item, bookmarks).onload();
		})

		// Add scripts section
		this.renderScripts();
	}

	/**
	 * Render custom scripts in the bookmark bar.
	 * Scripts appear after bookmarks, separated by a vertical line.
	 * Clicking a script executes it via executeCustomScript().
	 */
	renderScripts() {
		const scripts = this.plugin.settings.customScripts?.filter(s => s.enabled) || [];
		if (scripts.length === 0) return;

		// Add separator
		const separatorEl = this.BookmarkBarContainerEl.createEl("div", {
			cls: "wb-bookmark-bar-separator"
		});
		separatorEl.createEl("span", { cls: "wb-separator-line" });

		// Add script items
		scripts.forEach((script) => {
			const scriptEl = this.BookmarkBarContainerEl.createEl("div", {
				cls: "wb-bookmark-bar-script-item",
				attr: { "data-script-id": script.id }
			});

			const iconEl = scriptEl.createEl("div", {
				cls: "wb-bookmark-bar-script-icon"
			});
			setIcon(iconEl, "code");

			scriptEl.createEl("span", {
				cls: "wb-bookmark-bar-script-name",
				text: script.name
			});

			scriptEl.onclick = async () => {
				if (this.view instanceof SurfingView) {
					try {
						await this.view.executeCustomScript(script.code);
						new Notice(`Script executed: ${script.name}`);
					} catch (error) {
						// Error handled in executeCustomScript
					}
				}
			};

			// Right-click context menu
			scriptEl.oncontextmenu = (e) => {
				e.preventDefault();
				const menu = new Menu();
				menu.addItem((item) => {
					item.setTitle("Run script")
						.setIcon("play")
						.onClick(async () => {
							if (this.view instanceof SurfingView) {
								try {
									await this.view.executeCustomScript(script.code);
									new Notice(`Script executed: ${script.name}`);
								} catch (error) {
									// Error handled in executeCustomScript
								}
							}
						});
				});
				menu.showAtMouseEvent(e);
			};
		});
	}
}

export const updateBookmarkBar = (plugin: SurfingPlugin, bookmarks: Bookmark[], categories: CategoryType[], refreshBookmarkManager: boolean) => {
	if (refreshBookmarkManager) {
		const currentBookmarkLeaves = plugin.app.workspace.getLeavesOfType("surfing-bookmark-manager");
		if (currentBookmarkLeaves.length > 0) {
			currentBookmarkLeaves[0].rebuildView();
		}
	}

	const emptyLeaves = plugin.app.workspace.getLeavesOfType("empty");
	if (emptyLeaves.length > 0) {
		emptyLeaves.forEach((leaf) => {
			leaf.rebuildView();
		})
	}

	const surfingLeaves = plugin.app.workspace.getLeavesOfType("surfing-view");
	if (surfingLeaves.length > 0) {
		surfingLeaves.forEach((leaf) => {
			// @ts-ignore
			leaf.view?.bookmarkBar?.render(bookmarks, categories);
		})
	}
}

export const refreshBookmarkBarScripts = (plugin: SurfingPlugin) => {
	// Refresh empty views
	const emptyLeaves = plugin.app.workspace.getLeavesOfType("empty");
	emptyLeaves.forEach((leaf) => {
		leaf.rebuildView();
	});

	// Refresh surfing views - re-render scripts section
	const surfingLeaves = plugin.app.workspace.getLeavesOfType("surfing-view");
	surfingLeaves.forEach((leaf) => {
		// @ts-ignore
		const bookmarkBar = leaf.view?.bookmarkBar;
		if (bookmarkBar) {
			// Remove existing scripts and re-render
			const container = bookmarkBar.BookmarkBarContainerEl;
			if (container) {
				// Remove old separator and scripts
				container.querySelectorAll('.wb-bookmark-bar-separator, .wb-bookmark-bar-script-item').forEach((el: Element) => el.remove());
				// Re-render scripts
				bookmarkBar.renderScripts();
			}
		}
	});
}
