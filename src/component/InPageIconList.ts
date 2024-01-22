import SurfingPlugin from "../surfingIndex";
import { ButtonComponent, ItemView } from "obsidian";
import { t } from "../translations/helper";

export class InPageIconList {
	plugin: SurfingPlugin;
	view: ItemView;
	private closeBtnEl: HTMLElement;
	private searchBtnEl: HTMLElement;
	private createBtnEl: HTMLElement;
	private iconListEl: HTMLElement;

	private searchBtn: ButtonComponent;
	private createBtn: ButtonComponent;
	private closeBtn: ButtonComponent;

	constructor(parent: Element, view: ItemView, plugin: SurfingPlugin) {
		this.plugin = plugin;
		this.view = view;
		// Remove default title from header bar.
		// Use Obsidian API to remove the title.

		this.iconListEl = parent.createEl("div", {
			cls: "wb-icon-list-container"
		});


		this.createBtnEl = this.iconListEl.createEl("div", {
			cls: "wb-create-btn"
		});

		this.searchBtnEl = this.iconListEl.createEl("div", {
			cls: "wb-search-btn"
		});

		this.closeBtnEl = this.iconListEl.createEl("div", {
			cls: "wb-close-btn"
		});


		this.closeBtn = new ButtonComponent(this.closeBtnEl);
		this.createBtn = new ButtonComponent(this.createBtnEl);
		this.searchBtn = new ButtonComponent(this.searchBtnEl);


		this.createBtn.setIcon("file-plus").onClick(() => {
			app.commands.executeCommandById("file-explorer:new-file");
		});
		this.searchBtn.setIcon("file-search-2").onClick(() => {
			app.commands.executeCommandById("switcher:open");
		});
		this.closeBtn.setIcon("x-square").onClick(() => {
			if (this.view?.leaf) this.view?.leaf.detach();
		});

		this.closeBtn.setTooltip(t("Close Current Leaf"));
		this.createBtn.setTooltip(t("Create A New Note"));
		this.searchBtn.setTooltip(t("Open Quick Switcher"));

		// setIcon(this.createBtnEl, "file-plus");
		// setIcon(this.searchBtnEl, "file-search-2");
		// setIcon(this.closeBtnEl, "x-square");
		//
		// this.plugin.registerDomEvent(this.createBtnEl, 'click', () => {
		// 	app.commands.executeCommandById("file-explorer:new-file");
		// })
		//
		// this.plugin.registerDomEvent(this.searchBtnEl, 'click', () => {
		// 	app.commands.executeCommandById("switcher:open");
		// })
		//
		// this.plugin.registerDomEvent(this.closeBtnEl, 'click', () => {
		// 	if (this.view?.leaf) this.view?.leaf.detach();
		// })

	}

	onunload() {
		this.searchBtn.buttonEl.detach();
		this.createBtn.buttonEl.detach();
		this.closeBtn.buttonEl.detach();
	}
}
