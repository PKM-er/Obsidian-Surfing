export {} // Hacky way to avoid cannot compile error.

// Add hidden properties to Obsidian API classes for type-checking.
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
