import { TreeNode } from "./types";

type Listener = () => void;

export class TreeStore {
	private nodes: TreeNode[] = [];
	private listeners: Set<Listener> = new Set();

	constructor(initial: TreeNode[] = []) {
		this.nodes = [...initial];
	}

	getNodes(): TreeNode[] {
		return this.nodes;
	}

	setNodes(nodes: TreeNode[]): void {
		this.nodes = [...nodes];
		this.notify();
	}

	addNode(node: TreeNode): void {
		this.nodes = [...this.nodes, node];
		this.notify();
	}

	updateNode(id: string, patch: Partial<TreeNode>): void {
		const idx = this.nodes.findIndex((n) => n.id === id);
		if (idx === -1) return;
		this.nodes = [
			...this.nodes.slice(0, idx),
			{ ...this.nodes[idx], ...patch },
			...this.nodes.slice(idx + 1),
		];
		this.notify();
	}

	removeNode(id: string): void {
		this.nodes = this.nodes.filter((n) => n.id !== id);
		this.notify();
	}

	getChildren(parentId: number): TreeNode[] {
		return this.nodes.filter((n) => n.parent === parentId);
	}

	findNode(id: string): TreeNode | undefined {
		return this.nodes.find((n) => n.id === id);
	}

	hasNode(id: string): boolean {
		return this.nodes.some((n) => n.id === id);
	}

	/** Move a node to `newIndex` among its same-parent siblings. */
	reorderNode(nodeId: string, newIndex: number): void {
		const node = this.findNode(nodeId);
		if (!node) return;
		const parentId = node.parent;

		// Extract siblings in current order
		const siblings: TreeNode[] = [];
		for (const n of this.nodes) {
			if (n.parent === parentId) siblings.push(n);
		}
		const oldIdx = siblings.findIndex((n) => n.id === nodeId);
		if (oldIdx === -1) return;
		siblings.splice(oldIdx, 1);
		const clamped = Math.max(0, Math.min(newIndex, siblings.length));
		siblings.splice(clamped, 0, node);

		// Rebuild array: replace sibling slots with reordered siblings
		const result: TreeNode[] = [];
		let si = 0;
		for (const n of this.nodes) {
			if (n.parent === parentId) {
				result.push(siblings[si++]);
			} else {
				result.push(n);
			}
		}
		this.nodes = result;
		this.notify();
	}

	toJSON(): TreeNode[] {
		return [...this.nodes];
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}
}
