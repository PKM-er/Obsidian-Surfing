import * as obsidian from 'obsidian';

declare module "obsidian" {
	export interface ItemView {
		headerEl: HTMLDivElement
	}

	export interface WorkspaceLeaf {
		history: {
			backHistory: Array<any>,
			forwardHistory: Array<any>
		},
		tabHeaderInnerIconEl: HTMLDivElement,
		tabHeaderInnerTitleEl: HTMLDivElement
	}
}

