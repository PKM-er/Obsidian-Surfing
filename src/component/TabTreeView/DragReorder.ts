/**
 * Pointer-event-based drag-to-reorder engine for tree items.
 * Reimplements the intra-group reorder algorithm from Obsidian's internal Uc()
 * using Pointer Events so it works within our custom tree view.
 */

export interface DragReorderCallbacks {
	/** Called when user drops a node at a new index among its siblings. */
	onReorder(nodeId: string, newIndex: number): void;
}

const DRAG_THRESHOLD = 5; // px before entering drag mode
const SCROLL_EDGE = 50; // px from edge to start auto-scroll
const SCROLL_SPEED = 8; // base px per frame

export class DragReorder {
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

	// Bound handlers for cleanup
	private boundPointerMove: (e: PointerEvent) => void;
	private boundPointerUp: (e: PointerEvent) => void;

	constructor(container: HTMLElement, callbacks: DragReorderCallbacks) {
		this.container = container;
		this.callbacks = callbacks;
		this.boundPointerMove = this.onPointerMove.bind(this);
		this.boundPointerUp = this.onPointerUp.bind(this);
	}

	/** Attach to a tree-item-self element for drag initiation. */
	onPointerDown(e: PointerEvent, itemSelfEl: HTMLElement, nodeId: string): void {
		// Only primary button
		if (e.button !== 0) return;
		this.sourceEl = itemSelfEl.closest(".tree-item") as HTMLElement;
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

		// Find drop position among siblings
		this.updateDropIndicator(e.clientY);

		// Auto-scroll
		this.handleAutoScroll(e.clientY);
	}

	private onPointerUp(_e: PointerEvent): void {
		document.removeEventListener("pointermove", this.boundPointerMove);
		document.removeEventListener("pointerup", this.boundPointerUp);

		if (this.dragging && this.currentDropIndex >= 0) {
			this.callbacks.onReorder(this.sourceId, this.currentDropIndex);
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
		this.ghostEl.style.position = "fixed";
		this.ghostEl.style.pointerEvents = "none";
		this.ghostEl.style.zIndex = "9999";
		this.ghostEl.style.opacity = "0.8";
		this.ghostEl.style.width = `${this.sourceEl.offsetWidth}px`;
		document.body.appendChild(this.ghostEl);

		// Hide source
		this.sourceEl.classList.add("surfing-drag-source-hidden");

		// Create indicator
		this.indicator = document.createElement("div");
		this.indicator.classList.add("surfing-drop-indicator");
		this.container.appendChild(this.indicator);

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
			clearInterval(this.scrollInterval);
			this.scrollInterval = 0;
		}
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
		this.indicator.style.display = "block";
	}

	private handleAutoScroll(cursorY: number): void {
		const rect = this.container.getBoundingClientRect();
		const topDist = cursorY - rect.top;
		const botDist = rect.bottom - cursorY;

		if (this.scrollInterval) {
			clearInterval(this.scrollInterval);
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

	destroy(): void {
		this.exitDragMode();
		document.removeEventListener("pointermove", this.boundPointerMove);
		document.removeEventListener("pointerup", this.boundPointerUp);
	}
}
