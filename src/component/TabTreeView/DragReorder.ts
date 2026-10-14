/**
 * Pointer-event-based drag-to-reorder engine for tree items.
 * Reimplements the intra-group reorder algorithm from Obsidian's internal Uc()
 * using Pointer Events so it works within our custom tree view.
 */

import { Component } from "obsidian";

export interface DragReorderCallbacks {
	/** Called when user drops a node at a new index among its siblings. */
	onReorder(nodeId: string, newIndex: number): void;
	/** Called when user drops a node onto a group. */
	onMoveToGroup(nodeId: string, groupId: string): void;
}

const DRAG_THRESHOLD = 5; // px before entering drag mode
const SCROLL_EDGE = 50; // px from edge to start auto-scroll
const SCROLL_SPEED = 8; // base px per frame

export class DragReorder extends Component {
	private container: HTMLElement;
	private callbacks: DragReorderCallbacks;

	private dragging = false;
	private sourceEl: HTMLElement | null = null;
	private ghostEl: HTMLElement | null = null;
	private indicator: HTMLElement | null = null;
	private sourceId = "";
	private startX = 0;
	private startY = 0;
	private scrollInterval = 0;
	private currentDropIndex = -1;
	private siblings: HTMLElement[] = [];
	private dropTargetGroupId: string | null = null;
	private highlightedGroupEl: HTMLElement | null = null;

	// Bound handlers for cleanup
	private boundPointerMove: (e: PointerEvent) => void;
	private boundPointerUp: (e: PointerEvent) => void;

	constructor(container: HTMLElement, callbacks: DragReorderCallbacks) {
		super();
		this.container = container;
		this.callbacks = callbacks;
		this.boundPointerMove = (e: PointerEvent) => this.onPointerMove(e);
		this.boundPointerUp = (e: PointerEvent) => this.onPointerUp(e);
	}

	/** Attach to a tree-item-self element for drag initiation. */
	onPointerDown(e: PointerEvent, itemSelfEl: HTMLElement, nodeId: string): void {
		// Only primary button
		if (e.button !== 0) return;
		this.sourceEl = itemSelfEl.closest(".tree-item");
		if (!this.sourceEl) return;
		this.sourceId = nodeId;
		this.startX = e.clientX;
		this.startY = e.clientY;
		this.dragging = false;

		document.addEventListener("pointermove", this.boundPointerMove);
		document.addEventListener("pointerup", this.boundPointerUp);
	}

	private onPointerMove(e: PointerEvent): void {
		const dx = e.clientX - this.startX;
		const dy = e.clientY - this.startY;

		if (!this.dragging) {
			if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
			this.enterDragMode();
		}

		if (!this.ghostEl || !this.sourceEl) return;

		// Position ghost at cursor
		this.ghostEl.style.left = `${e.clientX + 8}px`;
		this.ghostEl.style.top = `${e.clientY - 12}px`;

		// Check if hovering over a group node
		const groupTarget = this.findGroupTarget(e.clientX, e.clientY);
		if (groupTarget) {
			// Hovering over a group — highlight it, hide reorder indicator
			this.dropTargetGroupId = groupTarget.id;
			this.highlightGroup(groupTarget.el);
			if (this.indicator) this.indicator.removeClass("is-visible");
			this.currentDropIndex = -1;
		} else {
			// Not over a group — show reorder indicator
			this.dropTargetGroupId = null;
			this.clearGroupHighlight();
			this.updateDropIndicator(e.clientY);
		}

		// Auto-scroll
		this.handleAutoScroll(e.clientY);
	}

	private onPointerUp(_e: PointerEvent): void {
		document.removeEventListener("pointermove", this.boundPointerMove);
		document.removeEventListener("pointerup", this.boundPointerUp);

		if (this.dragging) {
			if (this.dropTargetGroupId) {
				this.callbacks.onMoveToGroup(this.sourceId, this.dropTargetGroupId);
			} else if (this.currentDropIndex >= 0) {
				this.callbacks.onReorder(this.sourceId, this.currentDropIndex);
			}
		}

		this.exitDragMode();
	}

	private enterDragMode(): void {
		this.dragging = true;
		if (!this.sourceEl) return;

		// Collect siblings (same-parent tree-items)
		const parentChildren = this.sourceEl.parentElement;
		if (!parentChildren) return;
		this.siblings = Array.from(
			parentChildren.querySelectorAll<HTMLElement>(":scope > .tree-item")
		);

		// Create ghost
		this.ghostEl = this.sourceEl.cloneNode(true) as HTMLElement;
		this.ghostEl.classList.add("surfing-drag-ghost");
		this.ghostEl.style.width = `${this.sourceEl.offsetWidth}px`;
		document.body.appendChild(this.ghostEl);

		// Hide source
		this.sourceEl.classList.add("surfing-drag-source-hidden");

		// Create indicator
		this.indicator = this.container.createDiv({ cls: "surfing-drop-indicator" });

		document.body.classList.add("is-grabbing");
	}

	private exitDragMode(): void {
		if (this.ghostEl) {
			this.ghostEl.remove();
			this.ghostEl = null;
		}
		if (this.indicator) {
			this.indicator.remove();
			this.indicator = null;
		}
		if (this.sourceEl) {
			this.sourceEl.classList.remove("surfing-drag-source-hidden");
			this.sourceEl = null;
		}
		if (this.scrollInterval) {
			window.clearInterval(this.scrollInterval);
			this.scrollInterval = 0;
		}
		this.clearGroupHighlight();
		this.dropTargetGroupId = null;
		document.body.classList.remove("is-grabbing");
		this.dragging = false;
		this.siblings = [];
		this.currentDropIndex = -1;
	}

	private updateDropIndicator(cursorY: number): void {
		if (!this.indicator || this.siblings.length === 0) return;

		let insertIdx = this.siblings.length;
		for (let i = 0; i < this.siblings.length; i++) {
			const rect = this.siblings[i].getBoundingClientRect();
			const mid = rect.top + rect.height / 2;
			if (cursorY < mid) {
				insertIdx = i;
				break;
			}
		}
		this.currentDropIndex = insertIdx;

		// Position indicator
		let indicatorTop: number;
		if (insertIdx < this.siblings.length) {
			indicatorTop = this.siblings[insertIdx].getBoundingClientRect().top;
		} else {
			const last = this.siblings[this.siblings.length - 1];
			indicatorTop = last.getBoundingClientRect().bottom;
		}

		const containerRect = this.container.getBoundingClientRect();
		this.indicator.style.top = `${indicatorTop - containerRect.top + this.container.scrollTop}px`;
		this.indicator.addClass("is-visible");
	}

	private handleAutoScroll(cursorY: number): void {
		const rect = this.container.getBoundingClientRect();
		const topDist = cursorY - rect.top;
		const botDist = rect.bottom - cursorY;

		if (this.scrollInterval) {
			window.clearInterval(this.scrollInterval);
			this.scrollInterval = 0;
		}

		if (topDist < SCROLL_EDGE && topDist > 0) {
			const factor = 1 - topDist / SCROLL_EDGE;
			this.scrollInterval = window.setInterval(() => {
				this.container.scrollTop -= SCROLL_SPEED * factor;
			}, 16);
		} else if (botDist < SCROLL_EDGE && botDist > 0) {
			const factor = 1 - botDist / SCROLL_EDGE;
			this.scrollInterval = window.setInterval(() => {
				this.container.scrollTop += SCROLL_SPEED * factor;
			}, 16);
		}
	}

	/** Find group .tree-item-self under cursor, excluding the source node. */
	private findGroupTarget(
		x: number,
		y: number
	): { id: string; el: HTMLElement } | null {
		const els = this.container.querySelectorAll<HTMLElement>(
			'.tree-item[data-group-id] > .tree-item-self'
		);
		for (const selfEl of els) {
			const treeItem = selfEl.closest('.tree-item') as HTMLElement;
			const groupId = treeItem?.dataset.groupId;
			if (!groupId || groupId === this.sourceId) continue;
			const rect = selfEl.getBoundingClientRect();
			if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
				return { id: groupId, el: selfEl };
			}
		}
		return null;
	}

	private highlightGroup(el: HTMLElement): void {
		if (this.highlightedGroupEl === el) return;
		this.clearGroupHighlight();
		el.classList.add("surfing-drop-target-group");
		this.highlightedGroupEl = el;
	}

	private clearGroupHighlight(): void {
		if (this.highlightedGroupEl) {
			this.highlightedGroupEl.classList.remove("surfing-drop-target-group");
			this.highlightedGroupEl = null;
		}
	}

	onunload(): void {
		this.exitDragMode();
		document.removeEventListener("pointermove", this.boundPointerMove);
		document.removeEventListener("pointerup", this.boundPointerUp);
	}
}
