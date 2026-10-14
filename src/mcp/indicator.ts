// The "controlled by an agent" marker on a tab: a pill in the view header and
// an outline around the page, shown while a client has acted on the tab in
// the last few seconds.
import { Menu, WorkspaceLeaf } from "obsidian";
import { t } from "../translations/helper";

const IDLE_MS = 10_000;
const CONTROLLED_CLASS = "wb-mcp-controlled";

interface Marker {
	pill: HTMLElement;
	content: HTMLElement;
	host: string;
	timer: number;
}

export class AgentIndicator {
	private markers = new Map<WorkspaceLeaf, Marker>();

	constructor(private onStop: (host: string) => void) {}

	/** The client just acted on this tab (showing a page of `host`). */
	mark(leaf: WorkspaceLeaf, host: string): void {
		const existing = this.markers.get(leaf);
		if (existing) {
			existing.host = host;
			window.clearTimeout(existing.timer);
			existing.timer = window.setTimeout(() => this.unmark(leaf), IDLE_MS);
			return;
		}
		const container = leaf.view.containerEl;
		const actions = container.querySelector<HTMLElement>(".view-actions");
		const content = container.querySelector<HTMLElement>(".view-content") ?? container;
		if (!actions) return;

		const pill = createDiv({ cls: "wb-mcp-indicator" });
		pill.setAttribute("aria-label", t("Controlled by an MCP client"));
		pill.createSpan({ cls: "wb-mcp-indicator-dot" });
		pill.createSpan({ cls: "wb-mcp-indicator-text", text: t("Agent") });
		const marker: Marker = {
			pill,
			content,
			host,
			timer: window.setTimeout(() => this.unmark(leaf), IDLE_MS),
		};
		pill.addEventListener("click", (event) => {
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle(t("Stop: revoke this site for this session"))
					.setIcon("octagon-x")
					.onClick(() => {
						this.onStop(marker.host);
						this.unmark(leaf);
					}),
			);
			menu.showAtMouseEvent(event);
		});
		actions.prepend(pill);
		content.addClass(CONTROLLED_CLASS);
		this.markers.set(leaf, marker);
	}

	unmark(leaf: WorkspaceLeaf): void {
		const marker = this.markers.get(leaf);
		if (!marker) return;
		window.clearTimeout(marker.timer);
		marker.pill.remove();
		marker.content.removeClass(CONTROLLED_CLASS);
		this.markers.delete(leaf);
	}

	isMarked(leaf: WorkspaceLeaf): boolean {
		return this.markers.has(leaf);
	}

	clear(): void {
		for (const leaf of Array.from(this.markers.keys())) this.unmark(leaf);
	}
}
