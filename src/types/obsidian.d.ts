declare module "obsidian" {
	interface ItemView {
		headerEl: HTMLDivElement
	}

	interface WorkspaceLeaf {
		history: {
			backHistory: Array<any>,
			forwardHistory: Array<any>
		},
		tabHeaderInnerIconEl: HTMLDivElement,
		tabHeaderInnerTitleEl: HTMLDivElement
	}
}
