import { ItemView, Menu, setIcon, WorkspaceLeaf } from "obsidian";
import SurfingPlugin from "../../surfingIndex";
import { SurfingView, WEB_BROWSER_VIEW_ID } from "../../surfingView";
import { TreeNode } from "./types";
import { TreeStore } from "./TreeStore";
import { DragReorder } from "./DragReorder";
import { random, SaveWorkspaceModal } from "./workspace";

export const WEB_BROWSER_TAB_TREE_ID = "surfing-tab-tree";

export class TabTreeView extends ItemView {
	private store: TreeStore;
	private dragReorder: DragReorder | null = null;
	private unsubscribeStore: (() => void) | null = null;
	private containerEl_tree: HTMLElement;
	private collapsedGroups: Set<string> = new Set();
	private selectedNodeId: string | null = null;

	constructor(leaf: WorkspaceLeaf, public plugin: SurfingPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return WEB_BROWSER_TAB_TREE_ID;
	}

	getDisplayText(): string {
		return "Surfing Tab Tree";
	}

	getIcon(): string {
		return "chrome";
	}

	protected async onOpen(): Promise<void> {
		const content = this.contentEl;
		content.empty();

		this.containerEl_tree = content.createDiv({
			cls: "surfing-tab-tree-container",
		});

		// Initialize store from saved settings
		const saved = this.plugin.settings.treeData || [];
		// Map saved data to TreeNode format (backwards compatible with NodeModel)
		const initial: TreeNode[] = saved.map((n: any) => ({
			id: String(n.id),
			parent: n.parent,
			droppable: n.droppable,
			text: n.text,
			data: n.data,
		}));
		this.store = new TreeStore(initial);

		// Set up drag reorder
		this.dragReorder = new DragReorder(this.containerEl_tree, {
			onReorder: (nodeId, newIndex) => {
				this.store.reorderNode(nodeId, newIndex);
			},
		});

		// Subscribe to store changes
		this.unsubscribeStore = this.store.subscribe(() => {
			this.renderTree();
			this.persistTree();
		});

		// Initial sync from workspace if tree is empty
		this.syncFromWorkspace();

		// Register workspace events
		this.registerEvent(
			this.app.workspace.on(
				// @ts-ignore - custom event
				"surfing:page-change",
				(url: string, view: SurfingView) => {
					this.updateTabData(view, url);
				}
			)
		);

		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				const leaves = this.app.workspace.getLeavesOfType(
					WEB_BROWSER_VIEW_ID
				);
				if (leaves.length === 0) {
					this.store.setNodes([]);
					return;
				}
				// Add any new leaves that aren't in the store yet
				for (const leaf of leaves) {
					if (!this.store.hasNode(leaf.id)) {
						const view = leaf.view as SurfingView;
						this.store.addNode({
							id: leaf.id,
							parent: 0,
							droppable: true,
							text: view.currentTitle || "New Tab",
							data: {
								fileType: "site",
								fileSize: "",
								icon: view.favicon,
							},
						});
					}
				}
				// Remove nodes whose leaves no longer exist
				const leafIds = new Set(leaves.map((l) => l.id));
				const nodes = this.store.getNodes();
				for (const node of nodes) {
					if (
						node.data.fileType === "site" &&
						!leafIds.has(node.id)
					) {
						this.store.removeNode(node.id);
					}
				}
			})
		);

		// Context menu for container
		this.containerEl_tree.addEventListener("contextmenu", (e) => {
			// Only fire if clicking on the container background, not on a tree item
			if ((e.target as HTMLElement).closest(".tree-item")) return;
			e.preventDefault();
			this.showContainerContextMenu(e);
		});

		// Initial render
		this.renderTree();
	}

	protected async onClose(): Promise<void> {
		if (this.unsubscribeStore) {
			this.unsubscribeStore();
			this.unsubscribeStore = null;
		}
		if (this.dragReorder) {
			this.dragReorder.destroy();
			this.dragReorder = null;
		}
	}

	private syncFromWorkspace(): void {
		if (this.store.getNodes().length > 0) {
			// Validate: if first site node's leaf doesn't exist, reset
			const firstSite = this.store
				.getNodes()
				.find((n) => n.data?.fileType === "site");
			if (firstSite) {
				const leaf = this.app.workspace.getLeafById(firstSite.id);
				if (!leaf) {
					this.store.setNodes([]);
				} else {
					return;
				}
			} else {
				return;
			}
		}

		const leaves =
			this.app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID);
		const nodes: TreeNode[] = leaves.map((leaf) => ({
			id: leaf.id,
			parent: 0,
			droppable: true,
			text: (leaf.view as SurfingView).currentTitle || "New Tab",
			data: {
				fileType: "site",
				fileSize: "",
				icon: (leaf.view as SurfingView).favicon,
			},
		}));
		if (nodes.length > 0) {
			this.store.setNodes(nodes);
		}
	}

	private updateTabData(view: SurfingView, url: string): void {
		const leafId = view.leaf.id;
		if (this.store.hasNode(leafId)) {
			this.store.updateNode(leafId, {
				text: url || view.currentTitle,
				data: {
					fileType: "site",
					fileSize: "",
					icon: view.favicon,
				},
			});
		} else {
			this.store.addNode({
				id: leafId,
				parent: 0,
				droppable: true,
				text: url || view.currentTitle,
				data: {
					fileType: "site",
					fileSize: "",
					icon: view.favicon,
				},
			});
		}
	}

	private persistTree(): void {
		this.plugin.settings.treeData = this.store.toJSON() as any;
		this.plugin.settingsTab.applySettingsUpdate();
	}

	private renderTree(): void {
		const container = this.containerEl_tree;
		container.empty();

		const nodes = this.store.getNodes();
		if (nodes.length === 0) {
			this.renderEmptyState(container);
			return;
		}

		// Render root-level nodes (parent === 0)
		const rootNodes = this.store.getChildren(0);
		for (const node of rootNodes) {
			if (node.data?.fileType === "workspace") {
				this.renderGroupNode(node, container);
			} else {
				this.renderLeafNode(node, container);
			}
		}
	}

	private renderEmptyState(container: HTMLElement): void {
		const wrapper = container.createDiv({
			cls: "tab-tree-empty-container",
		});
		const state = wrapper.createDiv({ cls: "tab-tree-empty-state" });
		const iconEl = state.createDiv();
		setIcon(iconEl, "globe");
		state.createSpan({ text: "No surfing tabs open" });
	}

	private renderGroupNode(node: TreeNode, parentEl: HTMLElement): void {
		const isCollapsed = this.collapsedGroups.has(node.id);
		const treeItem = parentEl.createDiv({ cls: "tree-item" });

		// Self row
		const selfEl = treeItem.createDiv({
			cls: "tree-item-self is-clickable",
		});

		// Collapse icon
		const collapseIcon = selfEl.createDiv({
			cls: "tree-item-icon collapse-icon",
		});
		setIcon(collapseIcon, "right-triangle");
		if (!isCollapsed) {
			collapseIcon.classList.add("is-collapsed");
		}
		collapseIcon.style.transform = isCollapsed
			? "rotate(0deg)"
			: "rotate(90deg)";
		collapseIcon.addEventListener("click", (e) => {
			e.stopPropagation();
			if (this.collapsedGroups.has(node.id)) {
				this.collapsedGroups.delete(node.id);
			} else {
				this.collapsedGroups.add(node.id);
			}
			this.renderTree();
		});

		// Folder icon
		const folderIcon = selfEl.createDiv({ cls: "tree-item-icon" });
		setIcon(folderIcon, "folder");

		// Group name
		selfEl.createDiv({ cls: "tree-item-inner", text: node.text });

		// Drag handle
		selfEl.addEventListener("pointerdown", (e) => {
			this.dragReorder?.onPointerDown(e, selfEl, node.id);
		});

		// Children container
		if (!isCollapsed) {
			const childrenEl = treeItem.createDiv({
				cls: "tree-item-children",
			});
			const children = this.store.getChildren(
				parseInt(node.id) || (node.id as any)
			);
			for (const child of children) {
				this.renderLeafNode(child, childrenEl);
			}
		}
	}

	private renderLeafNode(node: TreeNode, parentEl: HTMLElement): void {
		const treeItem = parentEl.createDiv({ cls: "tree-item" });
		const isSelected = this.selectedNodeId === node.id;

		const selfEl = treeItem.createDiv({
			cls: `tree-item-self is-clickable${isSelected ? " is-selected" : ""}`,
		});

		// Favicon icon
		const iconEl = selfEl.createDiv({ cls: "tree-item-icon" });
		if (node.data?.icon) {
			if (node.data.icon instanceof HTMLImageElement) {
				const img = iconEl.createEl("img", {
					cls: "surfing-tab-favicon",
				});
				img.src = node.data.icon.src;
				img.width = 16;
				img.height = 16;
			} else if (typeof node.data.icon === "string") {
				if (
					node.data.icon.startsWith("http") ||
					node.data.icon.startsWith("data:")
				) {
					const img = iconEl.createEl("img", {
						cls: "surfing-tab-favicon",
					});
					img.src = node.data.icon;
					img.width = 16;
					img.height = 16;
				} else {
					setIcon(iconEl, node.data.icon || "globe");
				}
			}
		} else {
			setIcon(iconEl, "globe");
		}

		// Title text with ellipsis
		selfEl.createDiv({
			cls: "tree-item-inner",
			text: node.text || "Untitled",
		});

		// Click to activate leaf
		selfEl.addEventListener("click", (e) => {
			e.stopPropagation();
			this.selectedNodeId = node.id;
			const leaf = this.app.workspace.getLeafById(node.id);
			if (leaf) {
				this.app.workspace.setActiveLeaf(leaf);
			}
			this.renderTree();
		});

		// Context menu
		selfEl.addEventListener("contextmenu", (e) => {
			e.stopPropagation();
			e.preventDefault();
			this.showNodeContextMenu(e, node);
		});

		// Drag handle
		selfEl.addEventListener("pointerdown", (e) => {
			this.dragReorder?.onPointerDown(e, selfEl, node.id);
		});
	}

	private showContainerContextMenu(e: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle("New Group")
				.setIcon("folder")
				.onClick(() => {
					new SaveWorkspaceModal(
						this.app,
						this.plugin,
						(result) => {
							this.store.addNode({
								id: random(16),
								parent: 0,
								droppable: true,
								text: result,
								data: {
									fileType: "workspace",
									fileSize: "",
									icon: "folder",
								},
							});
						}
					).open();
				});
		});
		menu.showAtPosition({ x: e.clientX, y: e.clientY });
	}

	private showNodeContextMenu(e: MouseEvent, _node: TreeNode): void {
		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle("Close Tab")
				.setIcon("x")
				.onClick(() => {
					const leaf = this.app.workspace.getLeafById(_node.id);
					if (leaf) {
						leaf.detach();
					}
					this.store.removeNode(_node.id);
				});
		});
		menu.showAtPosition({ x: e.clientX, y: e.clientY });
	}
}
