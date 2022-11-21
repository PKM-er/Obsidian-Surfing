// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as obsidian from 'obsidian';

declare module "obsidian" {
	export interface ItemView {
		headerEl: HTMLDivElement
	}

	export interface WorkspaceLeaf {
		id: string
		history: {
			backHistory: Array<any>,
			forwardHistory: Array<any>
		},
		tabHeaderInnerIconEl: HTMLDivElement,
		tabHeaderInnerTitleEl: HTMLDivElement
	}
}
