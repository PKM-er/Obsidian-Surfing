import {
	Component,
	MarkdownRenderer,
	Menu,
	Notice,
	setIcon,
	FuzzySuggestModal,
	App,
	TFile,
	FileSystemAdapter,
} from "obsidian";
import SurfingPlugin from "../surfingIndex";
import { SurfingView } from "../surfingView";
import { t } from "../translations/helper";
import type { AIProviderEvent } from "../ai/types";
import { createProvider, getCachedAvailability } from "../ai/providerFactory";
import {
	loadChatHistoryFromDB,
	saveChatHistoryToDB,
	clearChatHistoryDB,
} from "../utils/chatHistoryDB";

export type AssistantProvider = "codex" | "claude" | "custom";
export type ApprovalMode = "ask" | "auto" | "deny";

export interface InteractiveElement {
	type: string;
	text: string;
	selector: string;
	href?: string;
	inputType?: string;
	placeholder?: string;
	name?: string;
}

export interface AssistantPageContext {
	url: string;
	title: string;
	selectionText: string;
	pageText: string;
	headings: string[];
	links: string[];
	interactiveElements?: InteractiveElement[];
}

export interface AssistantAction {
	type: string;
	[key: string]: unknown;
}

export interface AssistantHost {
	getAIAssistantPageContext(
		includePageText: boolean,
		maxPageTextLength: number,
	): Promise<AssistantPageContext>;
	executeAIAssistantAction(action: AssistantAction): Promise<string>;
	getCurrentPageInfo(): { url: string; title: string };
	showReadingIndicator(show: boolean): void;
}

type AssistantResponse = {
	reply: string;
	actions: AssistantAction[];
};

// AgentEvent is now AIProviderEvent from ../ai/types
type AgentEvent = AIProviderEvent;

interface ChatHistoryEntry {
	id: string;
	role: "user" | "assistant";
	content: string;
	events?: AgentEvent[];
	timestamp: number;
}

export class AIAssistantSidebar extends Component {
	private readonly parentEl: HTMLElement;
	private readonly plugin: SurfingPlugin;
	private host: AssistantHost | null;

	private rootEl!: HTMLElement;
	private listEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendButtonEl!: HTMLButtonElement;
	private statusEl!: HTMLElement;
	private isRunning = false;
	private selectedItems: Set<string> = new Set();
	private historyLoaded = false;
	private pageReadEnabled = true;
	private currentAbortController: AbortController | null = null;
	private sessionApprovedTools: Set<string> = new Set();
	// Cursor-like composer fields
	private providerPillEl!: HTMLElement;
	private approvalPillEl!: HTMLElement;
	private approvalMode: ApprovalMode = "ask";
	private attachedFiles: TFile[] = [];
	// Context strip fields
	private contextStripEl!: HTMLElement;
	private contextPages: { url: string; title: string }[] = [];
	private todoUnsubscribe: (() => void) | null = null;

	constructor(
		parentEl: HTMLElement,
		plugin: SurfingPlugin,
		host: AssistantHost | null,
	) {
		super();
		this.parentEl = parentEl;
		this.plugin = plugin;
		this.host = host;
	}

	setHost(host: AssistantHost | null) {
		this.host = host;
		this.refreshWebContext();
		// Never disable input/send based on host — allow typing even without an active page
		if (this.sendButtonEl) {
			this.sendButtonEl.disabled = this.isRunning;
		}
		if (this.inputEl) {
			this.inputEl.disabled = this.isRunning;
		}
	}

	getHost(): AssistantHost | null {
		return this.host;
	}

	/* ---------- lifecycle ---------- */

	render() {
		this.parentEl.empty();
		this.rootEl = this.parentEl.createDiv({ cls: "wb-ai-sidebar" });
		this.renderHeader();
		this.listEl = this.rootEl.createDiv({ cls: "wb-ai-chat-list" });
		this.renderComposer();
		void this.loadAndReplayHistory();

		// Subscribe to todo changes from MCP bridge
		if (this.plugin.mcpBridge) {
			this.todoUnsubscribe = this.plugin.mcpBridge.onTodoChange(() => {
				this.updateTodoSection();
			});
		}

		// Refresh web context on focus
		this.registerDomEvent(this.parentEl, "mouseenter", () => {
			this.refreshWebContext();
		});
	}

	destroy() {
		this.todoUnsubscribe?.();
		this.todoUnsubscribe = null;
		this.unload();
		this.parentEl.empty();
	}

	focusInput() {
		this.inputEl?.focus();
	}

	/* ---------- chat history ---------- */

	private get chatHistory(): ChatHistoryEntry[] {
		return this.plugin.aiChatHistory as ChatHistoryEntry[];
	}

	private set chatHistory(value: ChatHistoryEntry[]) {
		this.plugin.aiChatHistory = value;
	}

	private async loadChatHistory(): Promise<void> {
		if (this.chatHistory.length > 0) return; // already in memory
		try {
			this.chatHistory = await loadChatHistoryFromDB<ChatHistoryEntry>();
		} catch {
			this.chatHistory = [];
		}
	}

	private async saveChatHistory(): Promise<void> {
		await saveChatHistoryToDB(this.chatHistory);
	}

	private async loadAndReplayHistory(): Promise<void> {
		await this.loadChatHistory();
		if (this.chatHistory.length === 0) {
			await this.renderMessage(
				"assistant",
				t(
					"Surfing AI Assistant Sidebar is ready. Ask anything about the current page.",
				),
			);
		} else {
			for (const entry of this.chatHistory) {
				await this.replayHistoryEntry(entry);
			}
		}
		this.historyLoaded = true;
	}

	private async replayHistoryEntry(entry: ChatHistoryEntry): Promise<void> {
		if (entry.role === "user") {
			await this.renderMessage("user", entry.content, entry.id);
			return;
		}
		// Assistant with structured events
		if (entry.events && entry.events.length > 0) {
			const container = this.createAssistantMessageContainer(entry.id);
			for (const event of entry.events) {
				this.appendEventBlock(container, event);
			}
			// If page actions exist, the text event may still contain raw JSON;
			// replace with the clean reply stored in entry.content
			const hasPageActions = entry.events.some(
				(e) =>
					e.eventType === "tool_use" &&
					e.toolName?.startsWith("page_action:"),
			);
			if (hasPageActions && entry.content) {
				this.replaceLastTextWithReply(container, entry.content);
			}
		} else {
			await this.renderMessage("assistant", entry.content, entry.id);
		}
	}

	private generateId(): string {
		return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	}

	/* ---------- header ---------- */

	private renderHeader() {
		const headerEl = this.rootEl.createDiv({ cls: "wb-ai-sidebar-header" });
		const titleWrapEl = headerEl.createDiv({
			cls: "wb-ai-sidebar-title-wrap",
		});
		const iconEl = titleWrapEl.createDiv({
			cls: "wb-ai-sidebar-title-icon",
		});
		setIcon(iconEl, "bot");
		titleWrapEl.createDiv({
			cls: "wb-ai-sidebar-title",
			text: t("Surfing AI"),
		});

		const actionEl = headerEl.createDiv({ cls: "wb-ai-sidebar-action" });

		const clearBtnEl = actionEl.createEl("button", {
			cls: "clickable-icon wb-ai-clear-button",
			attr: { "aria-label": t("Clear AI Conversation") },
		});
		setIcon(clearBtnEl, "trash-2");
		this.registerDomEvent(clearBtnEl, "click", async () => {
			this.listEl.empty();
			this.chatHistory = [];
			this.selectedItems.clear();
			this.sessionApprovedTools.clear();
			this.plugin.mcpBridge?.clearTodos();
			this.contextPages = [];
			await clearChatHistoryDB();
			await this.renderMessage(
				"assistant",
				t("Conversation cleared. You can continue with a new request."),
			);
		});
	}

	/* ---------- context strip (TODO / WEB / FILES above composer textarea) ---------- */

	private renderContextStrip(composerEl: HTMLElement) {
		this.contextStripEl = composerEl.createDiv({
			cls: "wb-ai-context-strip",
		});
		this.updateContextStrip();
	}

	private updateContextStrip() {
		if (!this.contextStripEl) return;
		this.contextStripEl.empty();
		this.renderTodoSection(this.contextStripEl);
		this.renderWebSection(this.contextStripEl);
		this.renderFileSection(this.contextStripEl);

		// Hide the whole strip if nothing to show
		const hasTodos =
			(this.plugin.mcpBridge?.getTodoItems().length ?? 0) > 0;
		const hasPages = this.contextPages.length > 0 || !!this.host;
		const hasFiles = this.attachedFiles.length > 0;
		this.contextStripEl.style.display =
			hasTodos || hasPages || hasFiles ? "" : "none";
	}

	private updateTodoSection() {
		this.updateContextStrip();
	}

	private renderTodoSection(stripEl: HTMLElement) {
		const todos = this.plugin.mcpBridge?.getTodoItems() ?? [];
		if (todos.length === 0) return;

		const section = stripEl.createDiv({
			cls: "wb-ai-context-section wb-ai-context-todo",
		});
		const pending = todos.filter((t) => !t.completed);
		const completed = todos.filter((t) => t.completed);
		const currentTodo = pending[0];

		const header = section.createDiv({
			cls: "wb-ai-context-section-header",
		});
		const iconSpan = header.createSpan({
			cls: "wb-ai-context-section-icon",
		});
		setIcon(iconSpan, "list-checks");
		const labelText = currentTodo
			? `${currentTodo.text} (${completed.length}/${todos.length})`
			: `${t("All done")} (${todos.length}/${todos.length})`;
		header.createSpan({
			cls: "wb-ai-context-section-label",
			text: labelText,
		});
		const toggle = header.createSpan({
			cls: "wb-ai-context-section-toggle",
		});
		setIcon(toggle, "chevron-right");

		const content = section.createDiv({
			cls: "wb-ai-context-section-content wb-ai-context-section-collapsed",
		});
		for (const todo of todos) {
			const item = content.createDiv({
				cls: `wb-ai-todo-item${todo.completed ? " wb-ai-todo-item-done" : ""}${!todo.completed && todo === currentTodo ? " wb-ai-todo-current" : ""}`,
			});
			const check = item.createSpan({ cls: "wb-ai-todo-check" });
			setIcon(check, todo.completed ? "check-square" : "square");
			item.createSpan({ cls: "wb-ai-todo-text", text: todo.text });
		}

		header.addEventListener("click", () => {
			const collapsed = content.hasClass(
				"wb-ai-context-section-collapsed",
			);
			content.toggleClass("wb-ai-context-section-collapsed", !collapsed);
			setIcon(toggle, collapsed ? "chevron-down" : "chevron-right");
		});
	}

	private renderWebSection(stripEl: HTMLElement) {
		// Build list of pages: current host page + accumulated context pages
		const pages = this.getWebPages();
		if (pages.length === 0) return;

		const section = stripEl.createDiv({
			cls: "wb-ai-context-section wb-ai-context-web",
		});
		const header = section.createDiv({
			cls: "wb-ai-context-section-header",
		});
		const iconSpan = header.createSpan({
			cls: "wb-ai-context-section-icon",
		});
		setIcon(iconSpan, "globe");

		if (pages.length <= 3) {
			// Show all inline as links
			const linksWrap = header.createSpan({
				cls: "wb-ai-web-links-inline",
			});
			for (let i = 0; i < pages.length; i++) {
				if (i > 0) linksWrap.appendText(", ");
				const link = linksWrap.createEl("a", {
					cls: "wb-ai-web-link",
					text:
						this.extractDomain(pages[i].url) ||
						pages[i].title ||
						pages[i].url,
				});
				link.setAttribute("title", pages[i].url);
				link.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					SurfingView.spawnWebBrowserView(this.plugin, false, {
						url: pages[i].url,
					});
				});
			}
		} else {
			// Collapsed: show count
			header.createSpan({
				cls: "wb-ai-context-section-label",
				text: `${pages.length} pages`,
			});
			const toggle = header.createSpan({
				cls: "wb-ai-context-section-toggle",
			});
			setIcon(toggle, "chevron-right");

			const content = section.createDiv({
				cls: "wb-ai-context-section-content wb-ai-context-section-collapsed",
			});
			for (const page of pages) {
				const link = content.createEl("a", {
					cls: "wb-ai-web-link",
					text: `${this.extractDomain(page.url) || page.title} — ${page.url}`,
				});
				link.setAttribute("title", page.url);
				link.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					SurfingView.spawnWebBrowserView(this.plugin, false, {
						url: page.url,
					});
				});
			}

			header.addEventListener("click", () => {
				const collapsed = content.hasClass(
					"wb-ai-context-section-collapsed",
				);
				content.toggleClass(
					"wb-ai-context-section-collapsed",
					!collapsed,
				);
				setIcon(toggle, collapsed ? "chevron-down" : "chevron-right");
			});
		}

		// Page reading toggle
		const toggleBtn = header.createEl("button", {
			cls: "clickable-icon wb-ai-page-toggle",
			attr: { "aria-label": t("Toggle Page Reading") },
		});
		setIcon(toggleBtn, this.pageReadEnabled ? "eye" : "eye-off");
		toggleBtn.toggleClass("wb-ai-context-blocked", !this.pageReadEnabled);
		toggleBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.pageReadEnabled = !this.pageReadEnabled;
			setIcon(toggleBtn, this.pageReadEnabled ? "eye" : "eye-off");
			toggleBtn.toggleClass(
				"wb-ai-context-blocked",
				!this.pageReadEnabled,
			);
		});
	}

	private renderFileSection(stripEl: HTMLElement) {
		if (this.attachedFiles.length === 0) return;
		const section = stripEl.createDiv({
			cls: "wb-ai-context-section wb-ai-context-files",
		});
		for (const file of this.attachedFiles) {
			const chip = section.createDiv({ cls: "wb-ai-file-chip" });
			const iconEl = chip.createSpan({ cls: "wb-ai-chip-icon" });
			setIcon(iconEl, "file-text");
			chip.createSpan({ cls: "wb-ai-chip-name", text: file.basename });
			const removeBtn = chip.createSpan({ cls: "wb-ai-chip-remove" });
			setIcon(removeBtn, "x");
			removeBtn.addEventListener("click", () => {
				this.attachedFiles = this.attachedFiles.filter(
					(f) => f.path !== file.path,
				);
				this.updateContextStrip();
			});
		}
	}

	private getWebPages(): { url: string; title: string }[] {
		const seen = new Set<string>();
		const pages: { url: string; title: string }[] = [];

		// Current host page first
		if (this.host) {
			const info = this.host.getCurrentPageInfo();
			if (info.url) {
				seen.add(info.url);
				pages.push({ url: info.url, title: info.title });
			}
		}

		// Accumulated context pages
		for (const p of this.contextPages) {
			if (p.url && !seen.has(p.url)) {
				seen.add(p.url);
				pages.push(p);
			}
		}
		return pages;
	}

	private addContextPage(url: string, title: string) {
		if (!url) return;
		if (this.contextPages.some((p) => p.url === url)) return;
		this.contextPages.push({ url, title });
		this.updateContextStrip();
	}

	refreshContextBar() {
		this.refreshWebContext();
	}

	private refreshWebContext() {
		if (this.host) {
			const info = this.host.getCurrentPageInfo();
			const domain = this.extractDomain(info.url);
			if (domain && this.isDomainBlocked(domain)) {
				this.pageReadEnabled = false;
			}
		}
		this.updateContextStrip();
	}

	private extractDomain(url: string): string {
		if (!url) return "";
		try {
			return new URL(url).hostname;
		} catch {
			return "";
		}
	}

	private isDomainBlocked(domain: string): boolean {
		const blocklist =
			this.plugin.settings.aiAssistant.pageReadBlocklist || [];
		return blocklist.some(
			(blocked) => domain === blocked || domain.endsWith("." + blocked),
		);
	}

	private isPageReadAllowed(): boolean {
		if (!this.host) return false;
		if (!this.pageReadEnabled) return false;
		const info = this.host.getCurrentPageInfo();
		const domain = this.extractDomain(info.url);
		return !this.isDomainBlocked(domain);
	}

	/* ---------- composer (Cursor-like) ---------- */

	private renderComposer() {
		const composerEl = this.rootEl.createDiv({
			cls: "wb-ai-chat-composer",
		});

		// Context strip: TODO / WEB / FILES
		this.renderContextStrip(composerEl);

		// Textarea
		this.inputEl = composerEl.createEl("textarea", {
			cls: "wb-ai-chat-input",
			placeholder: t("Ask anything..."),
		});

		this.statusEl = composerEl.createDiv({ cls: "wb-ai-chat-status" });

		// Toolbar row: [provider] [approval] ... [stop] [send]
		const toolbarEl = composerEl.createDiv({
			cls: "wb-ai-composer-toolbar",
		});

		// Left group: pills
		const leftGroup = toolbarEl.createDiv({
			cls: "wb-ai-toolbar-left",
		});

		// Provider pill
		this.providerPillEl = leftGroup.createDiv({
			cls: "wb-ai-pill wb-ai-provider-pill",
		});
		this.updateProviderPill();
		this.registerDomEvent(this.providerPillEl, "click", (e) => {
			this.showProviderMenu(e);
		});

		// Approval mode pill
		this.approvalPillEl = leftGroup.createDiv({
			cls: "wb-ai-pill wb-ai-approval-pill",
		});
		this.updateApprovalPill();
		this.registerDomEvent(this.approvalPillEl, "click", (e) => {
			this.showApprovalMenu(e);
		});

		// Attach button
		const attachBtn = leftGroup.createEl("button", {
			cls: "clickable-icon wb-ai-attach-btn",
			attr: { "aria-label": t("Attach context") },
		});
		setIcon(attachBtn, "paperclip");
		this.registerDomEvent(attachBtn, "click", () => {
			this.showFilePicker();
		});

		// Right group: send (doubles as stop when running)
		const rightGroup = toolbarEl.createDiv({
			cls: "wb-ai-toolbar-right",
		});

		this.sendButtonEl = rightGroup.createEl("button", {
			cls: "clickable-icon wb-ai-send-btn",
			attr: { "aria-label": t("Send") },
		});
		setIcon(this.sendButtonEl, "send-horizontal");

		// Keyboard & click handlers
		this.registerDomEvent(
			this.inputEl,
			"keydown",
			(event: KeyboardEvent) => {
				if (event.key === "Enter" && !event.shiftKey) {
					event.preventDefault();
					void this.handleSubmit();
				}
				// Trigger file picker with @ at start or after space
				if (event.key === "@") {
					const pos = this.inputEl.selectionStart;
					const before = this.inputEl.value.slice(0, pos);
					if (
						pos === 0 ||
						before.endsWith(" ") ||
						before.endsWith("\n")
					) {
						event.preventDefault();
						this.showFilePicker();
					}
				}
			},
		);
		this.registerDomEvent(this.sendButtonEl, "click", () => {
			if (this.isRunning) {
				this.stopCurrentProcess();
			} else {
				void this.handleSubmit();
			}
		});
	}

	/* ---------- provider pill ---------- */

	private getProviderLabel(p: AssistantProvider): string {
		if (p === "codex") return "Codex";
		if (p === "claude") return "Claude";
		return "Custom";
	}

	private getProviderIcon(p: AssistantProvider): string {
		if (p === "codex") return "terminal";
		if (p === "claude") return "bot";
		return "settings";
	}

	private updateProviderPill() {
		if (!this.providerPillEl) return;
		this.providerPillEl.empty();
		const provider = this.plugin.settings.aiAssistant.defaultProvider;
		const iconEl = this.providerPillEl.createSpan({
			cls: "wb-ai-pill-icon",
		});
		setIcon(iconEl, this.getProviderIcon(provider));
		this.providerPillEl.createSpan({
			cls: "wb-ai-pill-text",
			text: this.getProviderLabel(provider),
		});
		const chevron = this.providerPillEl.createSpan({
			cls: "wb-ai-pill-chevron",
		});
		setIcon(chevron, "chevron-down");
	}

	private showProviderMenu(e: MouseEvent) {
		const menu = new Menu();
		const availability = getCachedAvailability();
		const providers: {
			value: AssistantProvider;
			label: string;
			icon: string;
		}[] = [
			{ value: "codex", label: "Codex", icon: "terminal" },
			{ value: "claude", label: "Claude Code", icon: "bot" },
			{ value: "custom", label: "Custom", icon: "settings" },
		];
		for (const p of providers) {
			const available = availability[p.value];
			const label = available
				? p.label
				: `${p.label} (${t("not installed")})`;
			menu.addItem((item) => {
				item.setTitle(label)
					.setIcon(p.icon)
					.setChecked(
						this.plugin.settings.aiAssistant.defaultProvider ===
							p.value,
					)
					.setDisabled(!available)
					.onClick(() => {
						if (!available) return;
						this.plugin.settings.aiAssistant.defaultProvider =
							p.value;
						void this.plugin.saveSettings();
						this.updateProviderPill();
					});
			});
		}
		menu.showAtMouseEvent(e);
	}

	/* ---------- approval mode pill ---------- */

	private getApprovalLabel(mode: ApprovalMode): string {
		if (mode === "ask") return t("Ask");
		if (mode === "auto") return t("Auto");
		return t("Deny");
	}

	private getApprovalIcon(mode: ApprovalMode): string {
		if (mode === "ask") return "shield-question";
		if (mode === "auto") return "shield-check";
		return "shield-x";
	}

	private updateApprovalPill() {
		if (!this.approvalPillEl) return;
		this.approvalPillEl.empty();
		const iconEl = this.approvalPillEl.createSpan({
			cls: "wb-ai-pill-icon",
		});
		setIcon(iconEl, this.getApprovalIcon(this.approvalMode));
		this.approvalPillEl.createSpan({
			cls: "wb-ai-pill-text",
			text: this.getApprovalLabel(this.approvalMode),
		});
		const chevron = this.approvalPillEl.createSpan({
			cls: "wb-ai-pill-chevron",
		});
		setIcon(chevron, "chevron-down");
	}

	private showApprovalMenu(e: MouseEvent) {
		const menu = new Menu();
		const modes: {
			value: ApprovalMode;
			label: string;
			desc: string;
			icon: string;
		}[] = [
			{
				value: "ask",
				label: t("Ask"),
				desc: t("Ask before tool use"),
				icon: "shield-question",
			},
			{
				value: "auto",
				label: t("Auto"),
				desc: t("Auto-approve all tools"),
				icon: "shield-check",
			},
			{
				value: "deny",
				label: t("Deny"),
				desc: t("Deny all tool use"),
				icon: "shield-x",
			},
		];
		for (const m of modes) {
			menu.addItem((item) => {
				item.setTitle(`${m.label} — ${m.desc}`)
					.setIcon(m.icon)
					.setChecked(this.approvalMode === m.value)
					.onClick(() => {
						this.approvalMode = m.value;
						if (m.value === "auto") {
							// Auto mode = pre-approve everything for this session
							this.sessionApprovedTools.clear();
						}
						this.updateApprovalPill();
					});
			});
		}
		menu.showAtMouseEvent(e);
	}

	/* ---------- file picker ---------- */

	private showFilePicker() {
		const modal = new FilePickerModal(this.plugin.app, (file) => {
			if (this.attachedFiles.some((f) => f.path === file.path)) return;
			this.attachedFiles.push(file);
			this.updateContextStrip();
		});
		modal.open();
	}

	/* ---------- message rendering ---------- */

	private async renderMessage(
		role: "user" | "assistant",
		content: string,
		entryId?: string,
	) {
		const id = entryId || this.generateId();
		const itemEl = this.listEl.createDiv({
			cls: `wb-ai-chat-item wb-ai-chat-item-${role}`,
		});
		itemEl.dataset.entryId = id;
		itemEl.createDiv({
			cls: "wb-ai-chat-role",
			text: role === "user" ? t("You") : t("AI"),
		});
		const contentEl = itemEl.createDiv({ cls: "wb-ai-chat-content" });
		await MarkdownRenderer.render(
			this.plugin.app,
			content,
			contentEl,
			"",
			this,
		);
		this.setupItemInteraction(itemEl, id);
		this.listEl.scrollTop = this.listEl.scrollHeight;
	}

	private createAssistantMessageContainer(entryId?: string): HTMLElement {
		const id = entryId || this.generateId();
		const itemEl = this.listEl.createDiv({
			cls: "wb-ai-chat-item wb-ai-chat-item-assistant",
		});
		itemEl.dataset.entryId = id;
		itemEl.createDiv({
			cls: "wb-ai-chat-role",
			text: t("AI"),
		});
		this.setupItemInteraction(itemEl, id);
		this.listEl.scrollTop = this.listEl.scrollHeight;
		return itemEl;
	}

	private appendEventBlock(container: HTMLElement, event: AgentEvent): void {
		switch (event.eventType) {
			case "thinking": {
				const block = container.createDiv({
					cls: "wb-ai-event-block wb-ai-event-thinking",
				});
				const header = block.createDiv({ cls: "wb-ai-event-header" });
				const iconSpan = header.createSpan({ cls: "wb-ai-event-icon" });
				setIcon(iconSpan, "brain");
				header.createSpan({
					cls: "wb-ai-event-label",
					text: t("Thinking"),
				});
				const toggle = header.createSpan({ cls: "wb-ai-event-toggle" });
				setIcon(toggle, "chevron-right");
				const content = block.createDiv({
					cls: "wb-ai-event-content wb-ai-event-collapsed",
				});
				const textEl = content.createDiv();
				void MarkdownRenderer.render(
					this.plugin.app,
					event.content || "",
					textEl,
					"",
					this,
				);
				header.addEventListener("click", () => {
					const collapsed = content.hasClass("wb-ai-event-collapsed");
					content.toggleClass("wb-ai-event-collapsed", !collapsed);
					setIcon(
						toggle,
						collapsed ? "chevron-down" : "chevron-right",
					);
				});
				break;
			}
			case "tool_use": {
				// Render page actions differently from regular tool calls
				if (event.toolName?.startsWith("page_action:")) {
					const actionType = event.toolName.replace(
						"page_action:",
						"",
					);
					const action = (event.toolInput || {}) as AssistantAction;
					action.type = action.type || actionType;
					this.appendActionBlock(container, action);
					break;
				}
				const block = container.createDiv({
					cls: "wb-ai-event-block wb-ai-event-tool-use",
				});
				const header = block.createDiv({ cls: "wb-ai-event-header" });
				const iconSpan = header.createSpan({ cls: "wb-ai-event-icon" });
				setIcon(iconSpan, "wrench");
				header.createSpan({
					cls: "wb-ai-event-label",
					text: `${t("Tool")}: ${event.toolName || ""}`,
				});
				// Approval badge
				if (event.approvalStatus) {
					const badgeCls =
						event.approvalStatus === "approved"
							? "wb-ai-badge-approved"
							: event.approvalStatus === "denied"
								? "wb-ai-badge-denied"
								: event.approvalStatus === "auto-approved"
									? "wb-ai-badge-auto"
									: "wb-ai-badge-pending";
					const badgeText =
						event.approvalStatus === "approved"
							? t("Approved")
							: event.approvalStatus === "denied"
								? t("Denied")
								: event.approvalStatus === "auto-approved"
									? t("Auto-approved")
									: t("Pending approval");
					header.createSpan({
						cls: `wb-ai-tool-badge ${badgeCls}`,
						text: badgeText,
					});
				}
				const toggle = header.createSpan({ cls: "wb-ai-event-toggle" });
				setIcon(toggle, "chevron-right");
				const content = block.createDiv({
					cls: "wb-ai-event-content wb-ai-event-collapsed",
				});
				if (event.toolInput) {
					const inputStr =
						typeof event.toolInput === "string"
							? event.toolInput
							: JSON.stringify(event.toolInput, null, 2);
					void MarkdownRenderer.render(
						this.plugin.app,
						"```json\n" + inputStr + "\n```",
						content,
						"",
						this,
					);
				}
				header.addEventListener("click", () => {
					const collapsed = content.hasClass("wb-ai-event-collapsed");
					content.toggleClass("wb-ai-event-collapsed", !collapsed);
					setIcon(
						toggle,
						collapsed ? "chevron-down" : "chevron-right",
					);
				});
				break;
			}
			case "tool_result": {
				const block = container.createDiv({
					cls: "wb-ai-event-block wb-ai-event-tool-result",
				});
				const header = block.createDiv({ cls: "wb-ai-event-header" });
				const iconSpan = header.createSpan({ cls: "wb-ai-event-icon" });
				setIcon(iconSpan, "check-circle");
				header.createSpan({
					cls: "wb-ai-event-label",
					text: t("Result"),
				});
				const toggle = header.createSpan({ cls: "wb-ai-event-toggle" });
				setIcon(toggle, "chevron-right");
				const content = block.createDiv({
					cls: "wb-ai-event-content wb-ai-event-collapsed",
				});
				void MarkdownRenderer.render(
					this.plugin.app,
					"```\n" + (event.content || "") + "\n```",
					content,
					"",
					this,
				);
				header.addEventListener("click", () => {
					const collapsed = content.hasClass("wb-ai-event-collapsed");
					content.toggleClass("wb-ai-event-collapsed", !collapsed);
					setIcon(
						toggle,
						collapsed ? "chevron-down" : "chevron-right",
					);
				});
				break;
			}
			case "text": {
				const contentEl = container.createDiv({
					cls: "wb-ai-chat-content",
				});
				contentEl.dataset.aiText = "true";
				void MarkdownRenderer.render(
					this.plugin.app,
					event.content || "",
					contentEl,
					"",
					this,
				);
				break;
			}
			case "result": {
				if (event.cost !== undefined || event.numTurns !== undefined) {
					const block = container.createDiv({
						cls: "wb-ai-event-block wb-ai-event-result-meta",
					});
					const parts: string[] = [];
					if (event.numTurns !== undefined)
						parts.push(`${t("Turns")}: ${event.numTurns}`);
					if (event.cost !== undefined)
						parts.push(`${t("Cost")}: $${event.cost.toFixed(4)}`);
					block.createDiv({
						cls: "wb-ai-event-meta",
						text: parts.join(" | "),
					});
				}
				break;
			}
			case "status":
				break;
		}
		this.listEl.scrollTop = this.listEl.scrollHeight;
	}

	/* ---------- tool approval ---------- */

	private createToolApprovalUI(
		container: HTMLElement,
		toolName: string,
	): Promise<"allow" | "deny" | "session"> {
		return new Promise((resolve) => {
			const bar = container.createDiv({ cls: "wb-ai-tool-approval" });

			const allowBtn = bar.createEl("button", {
				cls: "wb-ai-approve-btn",
				text: t("Allow"),
			});
			const sessionBtn = bar.createEl("button", {
				cls: "wb-ai-session-btn",
				text: t("Allow for Session"),
			});
			const denyBtn = bar.createEl("button", {
				cls: "wb-ai-deny-btn",
				text: t("Deny"),
			});

			const cleanup = () => bar.remove();

			allowBtn.addEventListener("click", () => {
				cleanup();
				resolve("allow");
			});
			sessionBtn.addEventListener("click", () => {
				this.sessionApprovedTools.add(toolName);
				cleanup();
				resolve("session");
			});
			denyBtn.addEventListener("click", () => {
				cleanup();
				resolve("deny");
			});
		});
	}

	/* ---------- public consent gate for MCP bridge ---------- */

	getApprovalMode(): ApprovalMode {
		return this.approvalMode;
	}

	/**
	 * Called by the MCP bridge (via AIAssistantView) BEFORE a tool executes.
	 * Returns true if approved, false if denied.
	 */
	async requestMCPToolApproval(
		toolName: string,
		toolInput: Record<string, unknown>,
	): Promise<boolean> {
		if (this.approvalMode === "auto") return true;
		if (this.approvalMode === "deny") return false;

		// Check session approvals
		if (this.sessionApprovedTools.has(toolName)) return true;

		// Find or create an assistant message container
		const containers = this.listEl.querySelectorAll(
			".wb-ai-chat-item-assistant",
		);
		const container =
			containers.length > 0
				? (containers[containers.length - 1] as HTMLElement)
				: this.createAssistantMessageContainer();

		// Show a pending tool_use event block
		const event: AgentEvent = {
			eventType: "tool_use",
			toolName,
			toolInput,
			approvalStatus: "pending",
		};
		this.appendEventBlock(container, event);

		// Find the just-appended tool block
		const toolBlocks = container.querySelectorAll(".wb-ai-event-tool-use");
		const lastBlock =
			toolBlocks.length > 0
				? (toolBlocks[toolBlocks.length - 1] as HTMLElement)
				: null;
		if (!lastBlock) return true;

		// Wait indefinitely for user decision — no auto-timeout
		const decision = await this.createToolApprovalUI(lastBlock, toolName);

		// Update badge
		const badge = lastBlock.querySelector(".wb-ai-tool-badge");
		if (badge) {
			if (decision === "deny") {
				badge.className = "wb-ai-tool-badge wb-ai-badge-denied";
				badge.textContent = t("Denied");
			} else {
				badge.className = "wb-ai-tool-badge wb-ai-badge-approved";
				badge.textContent = t("Approved");
			}
		}

		return decision !== "deny";
	}

	/* ---------- selection & export ---------- */

	private setupItemInteraction(itemEl: HTMLElement, entryId: string): void {
		itemEl.addEventListener("click", (e) => {
			if (e.shiftKey) {
				e.preventDefault();
				e.stopPropagation();
				if (this.selectedItems.has(entryId)) {
					this.selectedItems.delete(entryId);
					itemEl.removeClass("wb-ai-chat-selected");
				} else {
					this.selectedItems.add(entryId);
					itemEl.addClass("wb-ai-chat-selected");
				}
			}
		});

		itemEl.addEventListener("contextmenu", (e) => {
			if (this.selectedItems.size > 0) {
				e.preventDefault();
				e.stopPropagation();
				this.showExportMenu(e);
			}
		});
	}

	private showExportMenu(event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle(t("Export Selected"))
				.setIcon("download")
				.onClick(() => this.exportSelected());
		});
		menu.addItem((item) => {
			item.setTitle(t("Clear Selection"))
				.setIcon("x")
				.onClick(() => this.clearSelection());
		});
		menu.showAtMouseEvent(event);
	}

	private clearSelection(): void {
		this.selectedItems.clear();
		this.listEl
			.querySelectorAll(".wb-ai-chat-selected")
			.forEach((el) => el.removeClass("wb-ai-chat-selected"));
	}

	private async exportSelected(): Promise<void> {
		const selectedEntries = this.chatHistory.filter((entry) =>
			this.selectedItems.has(entry.id),
		);
		if (selectedEntries.length === 0) return;

		const markdown = selectedEntries
			.map((entry) => this.formatEntryForExport(entry))
			.join("\n\n---\n\n");

		await navigator.clipboard.writeText(markdown);
		this.clearSelection();
		new Notice(t("Exported to clipboard"));
	}

	private formatEntryForExport(entry: ChatHistoryEntry): string {
		if (entry.role === "user") {
			return `## You\n\n${entry.content}`;
		}

		if (entry.events && entry.events.length > 0) {
			const parts: string[] = ["## Assistant\n"];
			for (const ev of entry.events) {
				switch (ev.eventType) {
					case "thinking":
						parts.push(
							`<thinking>\n${ev.content || ""}\n</thinking>\n`,
						);
						break;
					case "tool_use":
						parts.push(
							`**Tool Call: ${ev.toolName}**\n\`\`\`json\n${
								typeof ev.toolInput === "string"
									? ev.toolInput
									: JSON.stringify(ev.toolInput, null, 2)
							}\n\`\`\`\n`,
						);
						break;
					case "tool_result":
						parts.push(
							`**Result:**\n\`\`\`\n${ev.content || ""}\n\`\`\`\n`,
						);
						break;
					case "text":
						parts.push(`${ev.content || ""}\n`);
						break;
					case "result":
						if (
							ev.cost !== undefined ||
							ev.numTurns !== undefined
						) {
							const meta: string[] = [];
							if (ev.numTurns !== undefined)
								meta.push(`Turns: ${ev.numTurns}`);
							if (ev.cost !== undefined)
								meta.push(`Cost: $${ev.cost.toFixed(4)}`);
							parts.push(`*${meta.join(" | ")}*\n`);
						}
						break;
				}
			}
			return parts.join("\n");
		}

		return `## Assistant\n\n${entry.content}`;
	}

	/* ---------- submit handler ---------- */

	private async handleSubmit() {
		if (this.isRunning) return;
		const userInput = this.inputEl.value.trim();
		if (!userInput) return;

		// Save user message
		const userId = this.generateId();
		await this.renderMessage("user", userInput, userId);
		this.chatHistory.push({
			id: userId,
			role: "user",
			content: userInput,
			timestamp: Date.now(),
		});
		await this.saveChatHistory();

		this.inputEl.value = "";
		// Clear attached files after submission
		this.attachedFiles = [];
		this.updateContextStrip();
		this.setRunning(true);

		try {
			if (userInput.startsWith("/") && this.host) {
				const commandResult =
					await this.executeInlineCommand(userInput);
				const cmdId = this.generateId();
				await this.renderMessage("assistant", commandResult, cmdId);
				this.chatHistory.push({
					id: cmdId,
					role: "assistant",
					content: commandResult,
					timestamp: Date.now(),
				});
				await this.saveChatHistory();
				return;
			}

			const canRead = this.host && this.isPageReadAllowed();
			const maxPageTextLength = Math.max(
				400,
				Math.min(
					this.plugin.settings.aiAssistant.maxPageTextLength,
					12000,
				),
			);
			const pageContext = canRead
				? await this.host!.getAIAssistantPageContext(
						this.plugin.settings.aiAssistant.includePageText,
						maxPageTextLength,
					)
				: {
						url: "",
						title: "",
						selectionText: "",
						pageText: "",
						headings: [],
						links: [],
					};
			// Track page in web context strip
			if (pageContext.url) {
				this.addContextPage(pageContext.url, pageContext.title);
			}

			const payloadPrompt = await this.buildPrompt(
				userInput,
				pageContext,
			);

			const assistantId = this.generateId();
			const messageContainer =
				this.createAssistantMessageContainer(assistantId);
			let finalText = "";
			const collectedEvents: AgentEvent[] = [];

			try {
				await this.executeAICommandStreaming(
					this.getProvider(),
					payloadPrompt,
					pageContext,
					(event: AgentEvent) => {
						collectedEvents.push(event);
						this.appendEventBlock(messageContainer, event);
						if (event.eventType === "text") {
							finalText +=
								(finalText ? "\n" : "") + (event.content || "");
						}
					},
					messageContainer,
				);
			} catch (streamError) {
				const msg =
					streamError instanceof Error
						? streamError.message
						: String(streamError);
				const errorContent = `${t("AI request failed")}: ${msg}`;
				const errorEl = messageContainer.createDiv({
					cls: "wb-ai-chat-content wb-ai-chat-error",
				});
				await MarkdownRenderer.render(
					this.plugin.app,
					errorContent,
					errorEl,
					"",
					this,
				);
				collectedEvents.push({
					eventType: "text",
					content: errorContent,
				});
				this.chatHistory.push({
					id: assistantId,
					role: "assistant",
					content: errorContent,
					events: collectedEvents,
					timestamp: Date.now(),
				});
				await this.saveChatHistory();
				this.listEl.scrollTop = this.listEl.scrollHeight;
				return;
			}

			// Try to parse final text for page actions
			let handledAsAction = false;
			if (finalText) {
				const parsed = this.parseAssistantOutput(finalText);
				if (parsed.actions.length > 0) {
					handledAsAction = true;

					// 1. Always replace raw JSON with clean reply
					this.replaceLastTextWithReply(
						messageContainer,
						parsed.reply,
					);

					// Replace raw JSON in text events with clean reply
					// so history replay renders the reply, not raw JSON
					let textReplaced = false;
					for (let i = 0; i < collectedEvents.length; i++) {
						if (collectedEvents[i].eventType === "text") {
							if (!textReplaced) {
								collectedEvents[i] = {
									...collectedEvents[i],
									content: parsed.reply,
								};
								textReplaced = true;
							} else {
								collectedEvents.splice(i--, 1);
							}
						}
					}

					// 2. Execute actions only when host is available
					if (this.host) {
						// Show styled action blocks
						for (const action of parsed.actions) {
							this.appendActionBlock(messageContainer, action);
						}

						// Execute actions and show results
						const actionResults = await this.executeActions(
							parsed.actions,
						);
						this.appendActionResultsBlock(
							messageContainer,
							actionResults,
						);

						// Add synthetic events for history replay
						for (const action of parsed.actions) {
							collectedEvents.push({
								eventType: "tool_use",
								toolName: `page_action:${action.type}`,
								toolInput: action,
							});
						}
						if (actionResults.length > 0) {
							collectedEvents.push({
								eventType: "tool_result",
								content: actionResults.join("\n"),
							});
						}

						// Re-fetch page context
						const newPageContext =
							await this.host.getAIAssistantPageContext(
								this.plugin.settings.aiAssistant
									.includePageText,
								maxPageTextLength,
							);
						const pageChanged =
							newPageContext.url !== pageContext.url ||
							newPageContext.title !== pageContext.title;

						if (pageChanged) {
							this.appendPageUpdateBlock(
								messageContainer,
								newPageContext,
							);
						}

						// Save and auto-follow-up
						this.chatHistory.push({
							id: assistantId,
							role: "assistant",
							content: parsed.reply,
							events: collectedEvents,
							timestamp: Date.now(),
						});
						await this.saveChatHistory();

						await this.autoFollowUpAfterActions(
							userInput,
							newPageContext,
							actionResults,
						);
					} else {
						// No host — save entry with clean reply
						this.chatHistory.push({
							id: assistantId,
							role: "assistant",
							content: parsed.reply,
							events: collectedEvents,
							timestamp: Date.now(),
						});
						await this.saveChatHistory();
					}
				}
			}

			if (!handledAsAction) {
				// Save assistant entry
				this.chatHistory.push({
					id: assistantId,
					role: "assistant",
					content: finalText,
					events: collectedEvents,
					timestamp: Date.now(),
				});
				await this.saveChatHistory();
			}
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			const errId = this.generateId();
			const errContent = `${t("AI request failed")}: ${message}`;
			await this.renderMessage("assistant", errContent, errId);
			this.chatHistory.push({
				id: errId,
				role: "assistant",
				content: errContent,
				timestamp: Date.now(),
			});
			await this.saveChatHistory();
		} finally {
			this.setRunning(false);
		}
	}

	private getProvider(): AssistantProvider {
		return this.plugin.settings.aiAssistant.defaultProvider;
	}

	private setRunning(running: boolean) {
		this.isRunning = running;
		this.inputEl.disabled = running;
		this.statusEl.setText(running ? t("Thinking...") : "");
		if (running) {
			setIcon(this.sendButtonEl, "square");
			this.sendButtonEl.classList.add("wb-ai-send-btn--stop");
			this.sendButtonEl.setAttribute("aria-label", t("Stop"));
		} else {
			setIcon(this.sendButtonEl, "send-horizontal");
			this.sendButtonEl.classList.remove("wb-ai-send-btn--stop");
			this.sendButtonEl.setAttribute("aria-label", t("Send"));
		}
	}

	private stopCurrentProcess() {
		if (this.currentAbortController) {
			this.currentAbortController.abort();
			this.currentAbortController = null;
		}
		this.setRunning(false);
	}

	/* ---------- inline commands ---------- */

	private async executeInlineCommand(commandText: string): Promise<string> {
		const trimmed = commandText.trim();
		const parts = trimmed.slice(1).split(" ");
		const command = parts[0]?.toLowerCase();
		const payload = trimmed.slice(command.length + 2).trim();
		if (!command) return "";

		if (command === "help") {
			return [
				"/help",
				"/open <url>",
				"/newtab <url>",
				"/back",
				"/forward",
				"/reload",
				"/click <css-selector>",
				"/type <css-selector> | <text>",
				"/scroll <pixels>",
				"/extract [css-selector]",
			].join("\n");
		}
		const host = this.host;
		if (!host) return "";
		if (command === "open")
			return host.executeAIAssistantAction({
				type: "navigate",
				url: payload,
			});
		if (command === "newtab")
			return host.executeAIAssistantAction({
				type: "open_new_tab",
				url: payload,
			});
		if (command === "back" || command === "forward" || command === "reload")
			return host.executeAIAssistantAction({ type: command });
		if (command === "click")
			return host.executeAIAssistantAction({
				type: "click",
				selector: payload,
			});
		if (command === "type") {
			const [selector, text] = payload.split("|").map((s) => s.trim());
			return host.executeAIAssistantAction({
				type: "type",
				selector,
				text: text ?? "",
			});
		}
		if (command === "scroll") {
			const value = Number.parseInt(payload, 10);
			return host.executeAIAssistantAction({
				type: "scroll",
				y: Number.isNaN(value) ? 400 : value,
			});
		}
		if (command === "extract")
			return host.executeAIAssistantAction({
				type: "extract",
				selector: payload,
			});
		return t("Unknown command. Use /help to list supported commands.");
	}

	/* ---------- prompt building ---------- */

	private async buildPrompt(
		userPrompt: string,
		pageContext: AssistantPageContext,
	): Promise<string> {
		const customSystemPrompt =
			this.plugin.settings.aiAssistant.systemPrompt.trim();
		const systemPrompt =
			customSystemPrompt.length > 0
				? customSystemPrompt
				: [
						"You are an AI assistant for Obsidian Surfing.",
						"Answer the user question about the current web page.",
						"Only emit actions when page operation is needed.",
						"Supported actions: navigate, open_new_tab, back, forward, reload, click, type, scroll, extract.",
						"If actions are needed, reply in JSON:",
						'{"reply":"short answer","actions":[{"type":"click","selector":"button"}]}',
						"Otherwise, return plain text.",
					].join("\n");

		const contextParts = [
			`URL: ${pageContext.url || ""}`,
			`Title: ${pageContext.title || ""}`,
		];
		if (pageContext.selectionText) {
			contextParts.push(`Selection: ${pageContext.selectionText}`);
		}
		if (pageContext.headings?.length) {
			contextParts.push(`Headings:\n${pageContext.headings.join("\n")}`);
		}
		if (pageContext.links?.length) {
			contextParts.push(`Links:\n${pageContext.links.join("\n")}`);
		}
		if (pageContext.pageText) {
			contextParts.push(`PageText:\n${pageContext.pageText}`);
		}
		const contextBlock = contextParts.join("\n");

		const parts = [`[SYSTEM]\n${systemPrompt}`];

		// Inject MCP tool preference instructions when MCP bridge is active
		if (
			this.plugin.settings.aiAssistant.enableMCPServer &&
			this.plugin.mcpBridge
		) {
			parts.push(
				[
					"[TOOL_INSTRUCTIONS]",
					"You have access to Obsidian Surfing MCP tools (surfing_*) for web browsing inside Obsidian.",
					"ALWAYS prefer surfing_open_page / surfing_fetch_page_content / surfing_navigate over any built-in web search or web fetch tools.",
					"Use surfing_todo_manage to break complex tasks into steps: add_batch your todos first, then work through each one, calling complete after each step. Check the list until all_done is true before finishing.",
				].join("\n"),
			);
		}

		if (pageContext.url) {
			parts.push(`[PAGE_CONTEXT]\n${contextBlock}`);
		}

		// Attached file contents
		if (this.attachedFiles.length > 0) {
			const fileBlocks: string[] = [];
			for (const file of this.attachedFiles) {
				try {
					const content =
						await this.plugin.app.vault.cachedRead(file);
					const trimmed = content.slice(0, 8000);
					fileBlocks.push(`--- ${file.path} ---\n${trimmed}`);
				} catch {
					fileBlocks.push(`--- ${file.path} --- (unreadable)`);
				}
			}
			parts.push(`[ATTACHED_FILES]\n${fileBlocks.join("\n\n")}`);
		}

		parts.push(`[USER]\n${userPrompt}`);
		return parts.join("\n\n");
	}

	/* ---------- streaming execution via provider abstraction ---------- */

	private async executeAICommandStreaming(
		_provider: AssistantProvider,
		prompt: string,
		_context: AssistantPageContext,
		onEvent: (event: AgentEvent) => void,
		messageContainer?: HTMLElement,
	): Promise<void> {
		const aiProvider = createProvider(this.plugin.settings.aiAssistant);
		const abortController = new AbortController();
		this.currentAbortController = abortController;

		const adapter = this.plugin.app.vault.adapter;
		const vaultPath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
		const pluginDir = this.plugin.getAbsolutePluginDir();
		const mcpConfigPath = this.plugin.mcpBridge?.getMCPConfigPath() || "";
		const mcpServerUrl = this.plugin.mcpBridge?.getMCPServerUrl();

		// Queue for async tool approval processing
		let processingQueue: Promise<void> = Promise.resolve();

		try {
			await aiProvider.execute(
				prompt,
				{
					vaultPath,
					pluginDir,
					mcpEnabled:
						this.plugin.settings.aiAssistant.enableMCPServer,
					mcpConfigPath: mcpConfigPath || undefined,
					mcpServerUrl,
				},
				(event: AgentEvent) => {
					if (event.eventType === "tool_use" && messageContainer) {
						// Chain tool approval handling
						processingQueue = processingQueue.then(() =>
							this.handleToolUseApproval(
								event,
								onEvent,
								messageContainer,
								abortController,
							),
						);
					} else {
						onEvent(event);
					}
				},
				abortController.signal,
			);
			// Wait for any pending approval processing
			await processingQueue;
		} finally {
			this.currentAbortController = null;
		}
	}

	/* ---------- tool approval in streaming ---------- */

	private async handleToolUseApproval(
		event: AgentEvent,
		onEvent: (event: AgentEvent) => void,
		container: HTMLElement,
		abortController: AbortController,
	): Promise<void> {
		const toolName = event.toolName || "";

		// Deny mode — reject all tool calls
		if (this.approvalMode === "deny") {
			event.approvalStatus = "denied";
			onEvent(event);
			abortController.abort();
			onEvent({
				eventType: "text",
				content: t("Tool denied. Process stopped."),
			});
			throw new Error(t("Tool denied. Process stopped."));
		}

		// Auto mode — approve everything
		if (this.approvalMode === "auto") {
			event.approvalStatus = "auto-approved";
			onEvent(event);
			return;
		}

		// Auto-approve if already approved for session (Ask mode)
		if (this.sessionApprovedTools.has(toolName)) {
			event.approvalStatus = "auto-approved";
			onEvent(event);
			return;
		}

		// Show as pending and display approval buttons
		event.approvalStatus = "pending";
		onEvent(event);

		// Find the last tool-use block that was just appended
		const toolBlocks = container.querySelectorAll(".wb-ai-event-tool-use");
		const lastBlock =
			toolBlocks.length > 0 ? toolBlocks[toolBlocks.length - 1] : null;

		if (!lastBlock) return;

		const decision = await this.createToolApprovalUI(
			lastBlock as HTMLElement,
			toolName,
		);

		// Update the badge
		const badge = lastBlock.querySelector(".wb-ai-tool-badge");
		if (badge) {
			if (decision === "deny") {
				badge.className = "wb-ai-tool-badge wb-ai-badge-denied";
				badge.textContent = t("Denied");
			} else {
				badge.className = "wb-ai-tool-badge wb-ai-badge-approved";
				badge.textContent = t("Approved");
			}
		}

		if (decision === "deny") {
			abortController.abort();
			onEvent({
				eventType: "text",
				content: t("Tool denied. Process stopped."),
			});
			throw new Error(t("Tool denied. Process stopped."));
		}

		// Allow or session — tool already executed by the CLI, just continue
		event.approvalStatus = "approved";
	}

	/* ---------- action rendering helpers ---------- */

	private replaceLastTextWithReply(
		container: HTMLElement,
		reply: string,
	): void {
		// Target text elements specifically (tagged with data-ai-text)
		const textEls = container.querySelectorAll(
			'.wb-ai-chat-content[data-ai-text="true"]',
		);
		if (textEls.length === 0) return;
		// Keep the first text element for the clean reply, remove the rest
		const firstEl = textEls[0] as HTMLElement;
		firstEl.empty();
		void MarkdownRenderer.render(this.plugin.app, reply, firstEl, "", this);
		for (let i = 1; i < textEls.length; i++) {
			textEls[i].remove();
		}
	}

	private renderTextWithLinks(el: HTMLElement, text: string): void {
		const urlRegex = /(https?:\/\/[^\s<>"')\]]+)/g;
		let lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = urlRegex.exec(text)) !== null) {
			if (match.index > lastIndex) {
				el.appendText(text.slice(lastIndex, match.index));
			}
			const url = match[1];
			const link = el.createEl("a", {
				cls: "external-link",
				text: url,
				href: url,
			});
			link.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				SurfingView.spawnWebBrowserView(this.plugin, false, { url });
			});
			lastIndex = urlRegex.lastIndex;
		}
		if (lastIndex < text.length) {
			el.appendText(text.slice(lastIndex));
		}
	}

	private appendActionBlock(
		container: HTMLElement,
		action: AssistantAction,
	): void {
		const block = container.createDiv({
			cls: "wb-ai-event-block wb-ai-event-action",
		});
		const header = block.createDiv({ cls: "wb-ai-event-header" });
		const iconSpan = header.createSpan({ cls: "wb-ai-event-icon" });
		setIcon(iconSpan, this.getActionIcon(action.type));
		const labelEl = header.createSpan({ cls: "wb-ai-event-label" });
		this.renderTextWithLinks(labelEl, this.getActionLabel(action));
	}

	private getActionIcon(actionType: string): string {
		switch (actionType) {
			case "click":
				return "mouse-pointer";
			case "type":
				return "keyboard";
			case "navigate":
				return "globe";
			case "open_new_tab":
				return "plus-square";
			case "scroll":
				return "arrow-down";
			case "extract":
				return "copy";
			case "back":
				return "arrow-left";
			case "forward":
				return "arrow-right";
			case "reload":
				return "refresh-cw";
			default:
				return "play";
		}
	}

	private getActionLabel(action: AssistantAction): string {
		switch (action.type) {
			case "click":
				return `${t("Click")}: ${String(action.selector)}`;
			case "type":
				return `${t("Type")}: "${String(action.text)}" → ${String(action.selector)}`;
			case "navigate":
				return `${t("Navigate")}: ${String(action.url)}`;
			case "open_new_tab":
				return `${t("Open New Tab")}: ${String(action.url)}`;
			case "scroll":
				return `${t("Scroll")}: ${String(action.y)}px`;
			case "extract":
				return `${t("Extract")}: ${typeof action.selector === "string" && action.selector ? action.selector : "page"}`;
			case "back":
				return t("Go Back");
			case "forward":
				return t("Go Forward");
			case "reload":
				return t("Reload");
			default:
				return `${action.type}`;
		}
	}

	private appendActionResultsBlock(
		container: HTMLElement,
		results: string[],
	): void {
		if (results.length === 0) return;
		const block = container.createDiv({
			cls: "wb-ai-event-block wb-ai-event-action-result",
		});
		const header = block.createDiv({ cls: "wb-ai-event-header" });
		const iconSpan = header.createSpan({ cls: "wb-ai-event-icon" });
		setIcon(iconSpan, "check-circle-2");
		header.createSpan({
			cls: "wb-ai-event-label",
			text: `${t("Actions Completed")} (${results.length})`,
		});
		const toggle = header.createSpan({ cls: "wb-ai-event-toggle" });
		setIcon(toggle, "chevron-right");
		const content = block.createDiv({
			cls: "wb-ai-event-content wb-ai-event-collapsed",
		});
		const listEl = content.createEl("ul", { cls: "wb-ai-action-results" });
		for (const result of results) {
			listEl.createEl("li", { text: result });
		}
		header.addEventListener("click", () => {
			const collapsed = content.hasClass("wb-ai-event-collapsed");
			content.toggleClass("wb-ai-event-collapsed", !collapsed);
			setIcon(toggle, collapsed ? "chevron-down" : "chevron-right");
		});
	}

	private appendPageUpdateBlock(
		container: HTMLElement,
		context: AssistantPageContext,
	): void {
		const block = container.createDiv({
			cls: "wb-ai-event-block wb-ai-event-page-update",
		});
		const header = block.createDiv({ cls: "wb-ai-event-header" });
		const iconSpan = header.createSpan({ cls: "wb-ai-event-icon" });
		setIcon(iconSpan, "globe");
		const label = context.title || context.url;
		const labelEl = header.createSpan({ cls: "wb-ai-event-label" });
		this.renderTextWithLinks(labelEl, `${t("Page Updated")}: ${label}`);
	}

	/* ---------- auto-follow-up after page actions ---------- */

	private async autoFollowUpAfterActions(
		originalPrompt: string,
		newPageContext: AssistantPageContext,
		actionResults?: string[],
	): Promise<void> {
		const followUpPrompt = this.buildFollowUpPrompt(
			originalPrompt,
			newPageContext,
			actionResults,
		);

		const assistantId = this.generateId();
		const messageContainer =
			this.createAssistantMessageContainer(assistantId);
		let finalText = "";
		const collectedEvents: AgentEvent[] = [];

		try {
			await this.executeAICommandStreaming(
				this.getProvider(),
				followUpPrompt,
				newPageContext,
				(event: AgentEvent) => {
					collectedEvents.push(event);
					this.appendEventBlock(messageContainer, event);
					if (event.eventType === "text") {
						finalText +=
							(finalText ? "\n" : "") + (event.content || "");
					}
				},
				messageContainer,
			);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			const errorEl = messageContainer.createDiv({
				cls: "wb-ai-chat-content wb-ai-chat-error",
			});
			await MarkdownRenderer.render(
				this.plugin.app,
				`${t("AI request failed")}: ${msg}`,
				errorEl,
				"",
				this,
			);
		}

		this.chatHistory.push({
			id: assistantId,
			role: "assistant",
			content: finalText,
			events: collectedEvents,
			timestamp: Date.now(),
		});
		await this.saveChatHistory();
	}

	private buildFollowUpPrompt(
		originalPrompt: string,
		pageContext: AssistantPageContext,
		actionResults?: string[],
	): string {
		const contextBlock = [
			`URL: ${pageContext.url || ""}`,
			`Title: ${pageContext.title || ""}`,
			`Selection: ${pageContext.selectionText || ""}`,
			`Headings: ${(pageContext.headings || []).join(" | ")}`,
			`Links: ${(pageContext.links || []).join(" | ")}`,
			`PageText: ${pageContext.pageText || ""}`,
		].join("\n");

		const parts = [
			"[SYSTEM]",
			"You previously executed page actions in response to the user's request.",
			"The page has now updated. Here is the current page content.",
			"Analyze the new page and provide a helpful response based on the user's original request.",
			"Reply in plain text (not JSON). Do NOT emit any more actions.",
		];

		if (actionResults && actionResults.length > 0) {
			parts.push("", "[ACTION_RESULTS]", ...actionResults);
		}

		parts.push(
			"",
			"[PAGE_CONTEXT]",
			contextBlock,
			"",
			"[USER]",
			`Original request: ${originalPrompt}`,
			"The page actions have been executed successfully. Please provide information based on the current page content.",
		);

		return parts.join("\n");
	}

	/* ---------- utility ---------- */

	private parseAssistantOutput(rawOutput: string): AssistantResponse {
		const normalized = (rawOutput || "").trim();
		const parsed =
			this.tryParseObject(normalized) ||
			this.tryParseObjectFromCodeBlock(normalized) ||
			this.tryExtractJsonObject(normalized);
		if (parsed && typeof parsed === "object") {
			const payload = parsed as Record<string, unknown>;
			const actions = Array.isArray(payload.actions)
				? payload.actions
						.map((i) => this.normalizeAction(i))
						.filter((i): i is AssistantAction => !!i)
				: [];
			if (actions.length > 0) {
				return {
					reply: this.extractReply(payload, normalized, true),
					actions,
				};
			}
		}
		return {
			reply: normalized || t("AI returned empty output."),
			actions: [],
		};
	}

	private extractReply(
		payload: Record<string, unknown>,
		fallback: string,
		hasActions: boolean,
	): string {
		for (const key of ["reply", "message", "output", "content"]) {
			const v = payload[key];
			if (typeof v === "string" && v.trim()) return v.trim();
		}
		return hasActions
			? t("Executed requested page actions.")
			: fallback || t("AI returned empty output.");
	}

	private normalizeAction(raw: unknown): AssistantAction | null {
		if (!raw || typeof raw !== "object") return null;
		const a = raw as Record<string, unknown>;
		const type = (
			typeof a.type === "string"
				? a.type
				: typeof a.action === "string"
					? a.action
					: ""
		).trim();
		if (!type) return null;
		return { ...a, type: type.toLowerCase() };
	}

	private tryParseObject(text: string): unknown {
		if (!text) return null;
		try {
			return JSON.parse(text);
		} catch {
			return null;
		}
	}

	private tryParseObjectFromCodeBlock(text: string): unknown {
		const m = text.match(/```json\s*([\s\S]*?)```/i);
		return m?.[1] ? this.tryParseObject(m[1].trim()) : null;
	}

	/** Try to extract a JSON object containing "actions" from within a larger text */
	private tryExtractJsonObject(text: string): unknown {
		if (!text || !text.includes('"actions"')) return null;
		// Find the first '{' that could start the JSON object
		const start = text.indexOf("{");
		if (start === -1) return null;
		const end = text.lastIndexOf("}");
		if (end === -1 || end <= start) return null;
		const candidate = text.substring(start, end + 1);
		return this.tryParseObject(candidate);
	}

	private async executeActions(
		actions: AssistantAction[],
	): Promise<string[]> {
		if (!actions.length || !this.host) return [];
		const results: string[] = [];
		for (const action of actions) {
			try {
				const result = await this.host.executeAIAssistantAction(action);
				results.push(`${action.type}: ${result}`);
			} catch (error) {
				const msg =
					error instanceof Error ? error.message : String(error);
				results.push(`${action.type}: ${msg}`);
			}
		}
		return results;
	}
}

/* ---------- File Picker Modal ---------- */

class FilePickerModal extends FuzzySuggestModal<TFile> {
	private onChoose: (file: TFile) => void;

	constructor(app: App, onChoose: (file: TFile) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder("Type to search files...");
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile): void {
		this.onChoose(item);
	}
}
