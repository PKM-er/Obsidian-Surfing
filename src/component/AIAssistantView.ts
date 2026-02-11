import { ItemView, WorkspaceLeaf } from "obsidian";
import SurfingPlugin from "../surfingIndex";
import {
	AIAssistantSidebar,
	AssistantHost,
	ApprovalMode,
} from "./AIAssistantSidebar";
import { t } from "../translations/helper";

export const WEB_BROWSER_AI_VIEW_ID = "surfing-ai-assistant";

export class AIAssistantView extends ItemView {
	plugin: SurfingPlugin;
	private sidebar: AIAssistantSidebar | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: SurfingPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return WEB_BROWSER_AI_VIEW_ID;
	}

	getDisplayText(): string {
		return t("Surfing AI");
	}

	getIcon(): string {
		return "bot";
	}

	async onOpen() {
		this.contentEl.empty();
		this.contentEl.toggleClass("wb-ai-assistant-view", true);
		this.sidebar = new AIAssistantSidebar(
			this.contentEl,
			this.plugin,
			null,
		);
		this.sidebar.render();
	}

	async onClose() {
		this.sidebar?.destroy();
		this.sidebar = null;
	}

	setHost(host: AssistantHost | null) {
		this.sidebar?.setHost(host);
	}

	getHost(): AssistantHost | null {
		return this.sidebar?.getHost() ?? null;
	}

	focusInput() {
		this.sidebar?.focusInput();
	}

	getApprovalMode(): ApprovalMode {
		return this.sidebar?.getApprovalMode() ?? "auto";
	}

	requestMCPToolApproval(
		toolName: string,
		toolInput: Record<string, unknown>,
	): Promise<boolean> {
		return (
			this.sidebar?.requestMCPToolApproval(toolName, toolInput) ??
			Promise.resolve(true)
		);
	}
}
