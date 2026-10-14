import * as http from "http";
import * as path from "path";
import {
	AssistantHost,
	AssistantPageContext,
} from "../component/AIAssistantSidebar";

/**
 * Host interface for MCPBridge — provides access to page operations,
 * vault operations, and the consent gate from the plugin layer.
 */
export interface MCPBridgeHost {
	getActiveHost(): AssistantHost | null;
	maxPageTextLength(): number;
	// Page operations
	openPage(url: string): Promise<{
		url: string;
		title: string;
		pageText: string;
		interactiveElements?: Array<Record<string, string>>;
	}>;
	executeAction(action: Record<string, unknown>): Promise<string>;
	// Consent gate
	getApprovalMode(): "ask" | "auto" | "deny";
	requestToolApproval(
		toolName: string,
		toolInput: Record<string, unknown>,
	): Promise<boolean>;
	// Vault operations
	createNote(path: string, content: string): Promise<string>;
	editNote(
		path: string,
		content: string,
		mode: "append" | "prepend" | "replace",
	): Promise<string>;
	readNote(path: string): Promise<string>;
}

export interface TodoItem {
	id: string;
	text: string;
	completed: boolean;
}

interface MCPToolResult {
	content: Array<{ type: string; text: string }>;
	isError?: boolean;
}

/** Stringify a tool argument; objects are JSON-encoded rather than "[object Object]". */
function argText(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === null || value === undefined) return "";
	if (typeof value === "object") return JSON.stringify(value);
	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		typeof value === "bigint"
	) {
		return String(value);
	}
	return JSON.stringify(value) ?? "";
}

/**
 * MCPBridge manages a local HTTP server that speaks MCP JSON-RPC protocol
 * directly at /mcp, so AI SDKs (Claude, Codex) can connect via HTTP transport
 * without needing a separate stdio proxy script.
 */
export class MCPBridge {
	private server: http.Server | null = null;
	private port = 0;
	private pluginDir: string; // vault-relative, for adapter.write
	private absolutePluginDir: string; // absolute, for fs/CLI usage
	private host: MCPBridgeHost;
	private todoItems: TodoItem[] = [];
	private todoIdCounter = 0;
	private todoChangeCallbacks: Set<(items: TodoItem[]) => void> = new Set();

	constructor(
		pluginDir: string,
		host: MCPBridgeHost,
		vaultBasePath?: string,
	) {
		this.pluginDir = pluginDir;
		this.absolutePluginDir = vaultBasePath
			? path.resolve(vaultBasePath, pluginDir)
			: path.resolve(pluginDir);
		this.host = host;
	}

	getTodoItems(): TodoItem[] {
		return [...this.todoItems];
	}

	clearTodos(): void {
		this.todoItems = [];
		this.todoIdCounter = 0;
		this.notifyTodoChange();
	}

	onTodoChange(cb: (items: TodoItem[]) => void): () => void {
		this.todoChangeCallbacks.add(cb);
		return () => this.todoChangeCallbacks.delete(cb);
	}

	private notifyTodoChange(): void {
		const snapshot = [...this.todoItems];
		for (const cb of this.todoChangeCallbacks) {
			cb(snapshot);
		}
	}

	async start(): Promise<number> {
		return new Promise((resolve, reject) => {
			this.server = http.createServer((req, res) => {
				void this.handleRequest(req, res);
			});
			this.server.on("error", reject);
			this.server.listen(0, "127.0.0.1", () => {
				const addr = this.server!.address();
				this.port = typeof addr === "object" && addr ? addr.port : 0;
				resolve(this.port);
			});
		});
	}

	stop() {
		this.server?.close();
		this.server = null;
	}

	getPort(): number {
		return this.port;
	}

	/** HTTP URL for the MCP Streamable HTTP endpoint. */
	getMCPServerUrl(): string {
		return `http://127.0.0.1:${this.port}/mcp`;
	}

	/** Absolute path — for legacy CLI --mcp-config. */
	getMCPConfigPath(): string {
		return path.join(this.absolutePluginDir, "surfing-mcp-config.json");
	}

	/**
	 * Write the MCP config file to the plugin directory.
	 * Called after start() so that the port is known.
	 * Uses vault-relative paths for adapter.write().
	 */
	async writeFiles(adapter: {
		write(path: string, data: string): Promise<void>;
	}): Promise<void> {
		const relConfig = path.join(this.pluginDir, "surfing-mcp-config.json");
		await adapter.write(relConfig, this.generateMCPConfig());
	}

	/* ================================================================
	 * MCP Tool Definitions
	 * ================================================================ */

	private getMCPTools(): Array<Record<string, unknown>> {
		return [
			{
				name: "surfing_get_page_info",
				description:
					"Get the current browser page URL, title, headings, links, and interactive elements (buttons, inputs, links with CSS selectors for click/type actions) from Obsidian Surfing.",
				inputSchema: { type: "object", properties: {}, required: [] },
			},
			{
				name: "surfing_read_page_content",
				description:
					"Read the full text content of the current browser page in Obsidian Surfing.",
				inputSchema: { type: "object", properties: {}, required: [] },
			},
			{
				name: "surfing_open_page",
				description:
					"Open a URL in a new Surfing browser tab in Obsidian and return its page content (title, text, etc).",
				inputSchema: {
					type: "object",
					properties: {
						url: {
							type: "string",
							description: "The URL to open",
						},
					},
					required: ["url"],
				},
			},
			{
				name: "surfing_fetch_page_content",
				description:
					"Fetch and read the content of a specific URL by opening it in Obsidian Surfing.",
				inputSchema: {
					type: "object",
					properties: {
						url: {
							type: "string",
							description: "The URL to fetch content from",
						},
					},
					required: ["url"],
				},
			},
			{
				name: "surfing_navigate",
				description:
					"Navigate the current active Surfing browser tab to a URL (replaces the current page).",
				inputSchema: {
					type: "object",
					properties: {
						url: {
							type: "string",
							description: "The URL to navigate to",
						},
					},
					required: ["url"],
				},
			},
			{
				name: "surfing_go_back",
				description:
					"Go back to the previous page in the current active Surfing browser tab.",
				inputSchema: { type: "object", properties: {}, required: [] },
			},
			{
				name: "surfing_go_forward",
				description:
					"Go forward to the next page in the current active Surfing browser tab.",
				inputSchema: { type: "object", properties: {}, required: [] },
			},
			{
				name: "surfing_create_note",
				description:
					"Create a new markdown note in the Obsidian vault.",
				inputSchema: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description:
								"The vault-relative path for the note (e.g. 'folder/note.md')",
						},
						content: {
							type: "string",
							description: "The markdown content of the note",
						},
					},
					required: ["path", "content"],
				},
			},
			{
				name: "surfing_edit_note",
				description:
					"Edit an existing markdown note in the Obsidian vault. Supports append, prepend, or replace modes.",
				inputSchema: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description: "The vault-relative path of the note",
						},
						content: {
							type: "string",
							description: "The content to add or replace",
						},
						mode: {
							type: "string",
							enum: ["append", "prepend", "replace"],
							description:
								"How to apply the edit (default: append)",
						},
					},
					required: ["path", "content"],
				},
			},
			{
				name: "surfing_read_note",
				description:
					"Read the content of an existing markdown note from the Obsidian vault.",
				inputSchema: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description: "The vault-relative path of the note",
						},
					},
					required: ["path"],
				},
			},
			{
				name: "surfing_todo_manage",
				description:
					'Manage a task/todo list to track multi-step work. Use this to break down complex tasks into steps, track progress, and ensure all steps are completed. IMPORTANT: After completing each task, call this tool with action="list" to check remaining todos and continue working until all_done is true. Actions: list (show all todos), add (add one todo), add_batch (add multiple todos), complete (mark done), update (modify text), remove (delete), clear (reset all).',
				inputSchema: {
					type: "object",
					properties: {
						action: {
							type: "string",
							enum: [
								"list",
								"add",
								"add_batch",
								"complete",
								"update",
								"remove",
								"clear",
							],
							description:
								"The action to perform on the todo list",
						},
						id: {
							type: "string",
							description:
								"Todo item ID (for complete/update/remove)",
						},
						text: {
							type: "string",
							description:
								"Text for the todo item (for add/update)",
						},
						items: {
							type: "array",
							items: {
								type: "object",
								properties: { text: { type: "string" } },
								required: ["text"],
							},
							description:
								"Array of items to add (for add_batch)",
						},
					},
					required: ["action"],
				},
			},
		];
	}

	/* ================================================================
	 * Native MCP Tool Call Handler
	 * ================================================================ */

	private async executeMCPToolCall(
		name: string,
		args: Record<string, unknown>,
	): Promise<MCPToolResult> {
		switch (name) {
			case "surfing_get_page_info": {
				const host = this.host.getActiveHost();
				if (!host) {
					return {
						isError: true,
						content: [
							{
								type: "text",
								text: "No active Surfing tab. Use surfing_open_page to open one first.",
							},
						],
					};
				}
				host.showReadingIndicator(true);
				try {
					const info = host.getCurrentPageInfo();
					const ctx: AssistantPageContext =
						await host.getAIAssistantPageContext(
							true,
							this.host.maxPageTextLength(),
						);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										url: ctx.url || info.url,
										title: ctx.title || info.title,
										headings: ctx.headings || [],
										links: ctx.links || [],
										interactive_elements:
											ctx.interactiveElements || [],
									},
									null,
									2,
								),
							},
						],
					};
				} finally {
					host.showReadingIndicator(false);
				}
			}

			case "surfing_read_page_content": {
				const host = this.host.getActiveHost();
				if (!host) {
					return {
						isError: true,
						content: [
							{
								type: "text",
								text: "No active Surfing tab. Use surfing_open_page to open one first.",
							},
						],
					};
				}
				host.showReadingIndicator(true);
				try {
					const ctx: AssistantPageContext =
						await host.getAIAssistantPageContext(
							true,
							this.host.maxPageTextLength(),
						);
					const parts: string[] = [];
					parts.push("URL: " + (ctx.url || ""));
					parts.push("Title: " + (ctx.title || ""));
					if (ctx.selectionText)
						parts.push("Selection: " + ctx.selectionText);
					if (ctx.pageText)
						parts.push("\nPage Text:\n" + ctx.pageText);
					if (
						ctx.interactiveElements &&
						ctx.interactiveElements.length > 0
					) {
						parts.push(
							"\nInteractive Elements:\n" +
								JSON.stringify(
									ctx.interactiveElements,
									null,
									2,
								),
						);
					}
					return {
						content: [{ type: "text", text: parts.join("\n") }],
					};
				} finally {
					host.showReadingIndicator(false);
				}
			}

			case "surfing_open_page": {
				const url = argText(args?.url || "").trim();
				if (!url) {
					return {
						isError: true,
						content: [
							{ type: "text", text: "Missing url parameter" },
						],
					};
				}
				const data = await this.host.openPage(url);
				// Show reading indicator on the newly opened page's host
				const newHost = this.host.getActiveHost();
				if (newHost) newHost.showReadingIndicator(true);
				try {
					const parts: string[] = [];
					parts.push("URL: " + (data.url || url));
					parts.push("Title: " + (data.title || ""));
					if (data.pageText)
						parts.push("\nPage Text:\n" + data.pageText);
					if (
						data.interactiveElements &&
						data.interactiveElements.length > 0
					) {
						parts.push(
							"\nInteractive Elements:\n" +
								JSON.stringify(
									data.interactiveElements,
									null,
									2,
								),
						);
					}
					return {
						content: [{ type: "text", text: parts.join("\n") }],
					};
				} finally {
					if (newHost) newHost.showReadingIndicator(false);
				}
			}

			case "surfing_fetch_page_content": {
				const url = argText(args?.url || "").trim();
				if (!url) {
					return {
						isError: true,
						content: [
							{ type: "text", text: "Missing url parameter" },
						],
					};
				}
				const data = await this.host.openPage(url);
				const newHost = this.host.getActiveHost();
				if (newHost) newHost.showReadingIndicator(true);
				try {
					const parts: string[] = [];
					parts.push("URL: " + (data.url || url));
					parts.push("Title: " + (data.title || ""));
					if (data.pageText)
						parts.push("\nPage Text:\n" + data.pageText);
					if (
						data.interactiveElements &&
						data.interactiveElements.length > 0
					) {
						parts.push(
							"\nInteractive Elements:\n" +
								JSON.stringify(
									data.interactiveElements,
									null,
									2,
								),
						);
					}
					return {
						content: [{ type: "text", text: parts.join("\n") }],
					};
				} finally {
					if (newHost) newHost.showReadingIndicator(false);
				}
			}

			case "surfing_navigate": {
				const url = argText(args?.url || "").trim();
				if (!url) {
					return {
						isError: true,
						content: [
							{ type: "text", text: "Missing url parameter" },
						],
					};
				}
				const result = await this.host.executeAction({
					type: "navigate",
					url,
				});
				return {
					content: [
						{
							type: "text",
							text: result || "Navigated to " + url,
						},
					],
				};
			}

			case "surfing_go_back": {
				const result = await this.host.executeAction({ type: "back" });
				return {
					content: [{ type: "text", text: result || "Moved back" }],
				};
			}

			case "surfing_go_forward": {
				const result = await this.host.executeAction({
					type: "forward",
				});
				return {
					content: [
						{ type: "text", text: result || "Moved forward" },
					],
				};
			}

			case "surfing_create_note": {
				const notePath = argText(args?.path || "").trim();
				const content = argText(args?.content ?? "");
				if (!notePath) {
					return {
						isError: true,
						content: [
							{ type: "text", text: "Missing path parameter" },
						],
					};
				}
				const result = await this.host.createNote(notePath, content);
				return {
					content: [{ type: "text", text: result }],
				};
			}

			case "surfing_edit_note": {
				const notePath = argText(args?.path || "").trim();
				const content = argText(args?.content ?? "");
				const mode = (
					args?.mode === "prepend"
						? "prepend"
						: args?.mode === "replace"
							? "replace"
							: "append"
				);
				if (!notePath) {
					return {
						isError: true,
						content: [
							{ type: "text", text: "Missing path parameter" },
						],
					};
				}
				const result = await this.host.editNote(
					notePath,
					content,
					mode,
				);
				return {
					content: [{ type: "text", text: result }],
				};
			}

			case "surfing_read_note": {
				const notePath = argText(args?.path || "").trim();
				if (!notePath) {
					return {
						isError: true,
						content: [
							{ type: "text", text: "Missing path parameter" },
						],
					};
				}
				const result = await this.host.readNote(notePath);
				return {
					content: [{ type: "text", text: result }],
				};
			}

			case "surfing_todo_manage": {
				const action = argText(args?.action || "list").toLowerCase();
				const todoResult = this.handleTodoAction(
					action,
					args,
				);
				if (todoResult.error) {
					return {
						isError: true,
						content: [
							{
								type: "text",
								text: argText(todoResult.error),
							},
						],
					};
				}
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(todoResult, null, 2),
						},
					],
				};
			}

			default:
				return {
					isError: true,
					content: [{ type: "text", text: "Unknown tool: " + name }],
				};
		}
	}

	/* ================================================================
	 * HTTP Request Handling
	 * ================================================================ */

	private readBody(req: http.IncomingMessage): Promise<string> {
		return new Promise((resolve) => {
			let data = "";
			req.on("data", (chunk: Buffer) => (data += chunk.toString()));
			req.on("end", () => resolve(data));
		});
	}

	private async handleRequest(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	) {
		res.setHeader("Access-Control-Allow-Origin", "127.0.0.1");

		// --- MCP Streamable HTTP endpoint ---
		if (req.url === "/mcp" && req.method === "POST") {
			await this.handleMCPRequest(req, res);
			return;
		}

		const toolName = (req.headers["x-tool-name"] as string) || "";

		// --- Consent gate for legacy /api/* endpoints ---
		const mode = this.host.getApprovalMode();
		if (mode === "deny" && toolName) {
			res.writeHead(403, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Tool denied by user policy" }));
			return;
		}

		// For ASK mode, parse body early so we can show it in the approval UI
		let parsedBody: Record<string, unknown> | null = null;
		if (req.method === "POST") {
			try {
				const raw = await this.readBody(req);
				parsedBody = JSON.parse(raw) as Record<string, unknown>;
			} catch {
				parsedBody = {};
			}
		}

		if (mode === "ask" && toolName) {
			const approved = await this.host.requestToolApproval(
				toolName,
				parsedBody || {},
			);
			if (!approved) {
				res.writeHead(403, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Tool denied by user" }));
				return;
			}
		}

		// --- Route legacy /api/* endpoints ---
		try {
			await this.routeRequest(req, res, parsedBody);
		} catch (err) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					error: err instanceof Error ? err.message : String(err),
				}),
			);
		}
	}

	/* ================================================================
	 * MCP Streamable HTTP Protocol Handler
	 * ================================================================ */

	private async handleMCPRequest(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	) {
		let body: string;
		try {
			body = await this.readBody(req);
		} catch {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					jsonrpc: "2.0",
					id: null,
					error: { code: -32700, message: "Parse error" },
				}),
			);
			return;
		}

		let request: {
			jsonrpc?: string;
			id?: unknown;
			method?: string;
			params?: Record<string, unknown>;
		};
		try {
			request = JSON.parse(body) as typeof request;
		} catch {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					jsonrpc: "2.0",
					id: null,
					error: { code: -32700, message: "Parse error" },
				}),
			);
			return;
		}

		const { id, method, params } = request;

		try {
			switch (method) {
				case "initialize": {
					const result = {
						protocolVersion: "2024-11-05",
						capabilities: { tools: {} },
						serverInfo: {
							name: "surfing-page",
							version: "1.0.0",
						},
					};
					this.sendJsonRpc(res, 200, { jsonrpc: "2.0", id, result });
					return;
				}

				case "notifications/initialized": {
					// Notification — no response body expected
					res.writeHead(202);
					res.end();
					return;
				}

				case "tools/list": {
					const result = { tools: this.getMCPTools() };
					this.sendJsonRpc(res, 200, { jsonrpc: "2.0", id, result });
					return;
				}

				case "tools/call": {
					const toolName = argText(params?.name || "");
					const toolArgs =
						(params?.arguments as Record<string, unknown>) || {};

					// --- Consent gate for tool calls ---
					const mode = this.host.getApprovalMode();
					if (mode === "deny") {
						this.sendJsonRpc(res, 200, {
							jsonrpc: "2.0",
							id,
							result: {
								isError: true,
								content: [
									{
										type: "text",
										text: "Tool denied by user policy",
									},
								],
							},
						});
						return;
					}

					if (mode === "ask") {
						const approved = await this.host.requestToolApproval(
							toolName,
							toolArgs,
						);
						if (!approved) {
							this.sendJsonRpc(res, 200, {
								jsonrpc: "2.0",
								id,
								result: {
									isError: true,
									content: [
										{
											type: "text",
											text: "Tool denied by user",
										},
									],
								},
							});
							return;
						}
					}

					const toolResult = await this.executeMCPToolCall(
						toolName,
						toolArgs,
					);
					this.sendJsonRpc(res, 200, {
						jsonrpc: "2.0",
						id,
						result: toolResult,
					});
					return;
				}

				default: {
					this.sendJsonRpc(res, 200, {
						jsonrpc: "2.0",
						id,
						error: {
							code: -32601,
							message: "Method not found: " + method,
						},
					});
					return;
				}
			}
		} catch (err) {
			this.sendJsonRpc(res, 200, {
				jsonrpc: "2.0",
				id,
				result: {
					isError: true,
					content: [
						{
							type: "text",
							text:
								err instanceof Error
									? err.message
									: String(err),
						},
					],
				},
			});
		}
	}

	private sendJsonRpc(
		res: http.ServerResponse,
		statusCode: number,
		body: Record<string, unknown>,
	) {
		res.writeHead(statusCode, { "Content-Type": "application/json" });
		res.end(JSON.stringify(body));
	}

	/* ================================================================
	 * Legacy /api/* Route Handler
	 * ================================================================ */

	private async routeRequest(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		parsedBody: Record<string, unknown> | null,
	) {
		if (req.url === "/api/page-info") {
			const host = this.host.getActiveHost();
			if (!host) {
				res.writeHead(404, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						error: "No active Surfing tab. Use surfing_open_page to open one first.",
					}),
				);
				return;
			}
			const info = host.getCurrentPageInfo();
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(info));
			return;
		}

		if (req.url === "/api/page-context") {
			const host = this.host.getActiveHost();
			if (!host) {
				res.writeHead(404, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						error: "No active Surfing tab. Use surfing_open_page to open one first.",
					}),
				);
				return;
			}
			const ctx: AssistantPageContext =
				await host.getAIAssistantPageContext(
					true,
					this.host.maxPageTextLength(),
				);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(ctx));
			return;
		}

		if (req.url === "/api/open-page" && req.method === "POST") {
			const url = argText(parsedBody?.url || "").trim();
			if (!url) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Missing url parameter" }));
				return;
			}
			const result = await this.host.openPage(url);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(result));
			return;
		}

		if (req.url === "/api/fetch-page-content" && req.method === "POST") {
			const url = argText(parsedBody?.url || "").trim();
			if (!url) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Missing url parameter" }));
				return;
			}
			const result = await this.host.openPage(url);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(result));
			return;
		}

		if (req.url === "/api/execute-action" && req.method === "POST") {
			const action = parsedBody as Record<string, unknown>;
			if (!action?.type) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Missing type parameter" }));
				return;
			}
			const result = await this.host.executeAction(action);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ result }));
			return;
		}

		if (req.url === "/api/create-note" && req.method === "POST") {
			const notePath = argText(parsedBody?.path || "").trim();
			const content = argText(parsedBody?.content ?? "");
			if (!notePath) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Missing path parameter" }));
				return;
			}
			const result = await this.host.createNote(notePath, content);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(result);
			return;
		}

		if (req.url === "/api/edit-note" && req.method === "POST") {
			const notePath = argText(parsedBody?.path || "").trim();
			const content = argText(parsedBody?.content ?? "");
			const mode =
				parsedBody?.mode === "prepend"
					? "prepend"
					: parsedBody?.mode === "replace"
						? "replace"
						: "append";
			if (!notePath) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Missing path parameter" }));
				return;
			}
			const result = await this.host.editNote(
				notePath,
				content,
				mode,
			);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(result);
			return;
		}

		if (req.url === "/api/read-note" && req.method === "POST") {
			const notePath = argText(parsedBody?.path || "").trim();
			if (!notePath) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Missing path parameter" }));
				return;
			}
			const result = await this.host.readNote(notePath);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(result);
			return;
		}

		if (req.url === "/api/todo" && req.method === "POST") {
			const action = argText(
				parsedBody?.action || "list",
			).toLowerCase();
			const result = this.handleTodoAction(
				action,
				parsedBody as Record<string, unknown>,
			);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(result));
			return;
		}

		res.writeHead(404, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "Not found" }));
	}

	/* ================================================================
	 * Todo Management
	 * ================================================================ */

	private handleTodoAction(
		action: string,
		params: Record<string, unknown>,
	): Record<string, unknown> {
		switch (action) {
			case "list": {
				const pending = this.todoItems.filter((t) => !t.completed);
				const completed = this.todoItems.filter((t) => t.completed);
				return {
					items: this.todoItems,
					summary: {
						total: this.todoItems.length,
						pending: pending.length,
						completed: completed.length,
					},
					all_done: pending.length === 0 && this.todoItems.length > 0,
				};
			}
			case "add": {
				const text = argText(params.text || "").trim();
				if (!text) return { error: "Missing text parameter" };
				const id = `todo-${++this.todoIdCounter}`;
				this.todoItems.push({ id, text, completed: false });
				this.notifyTodoChange();
				return {
					success: true,
					item: { id, text, completed: false },
					pending_count: this.todoItems.filter((t) => !t.completed)
						.length,
				};
			}
			case "add_batch": {
				const items = params.items as
					| Array<{ text: string }>
					| undefined;
				if (!items || !Array.isArray(items) || items.length === 0)
					return { error: "Missing items array" };
				const added: TodoItem[] = [];
				for (const item of items) {
					const text = String(item.text || "").trim();
					if (!text) continue;
					const id = `todo-${++this.todoIdCounter}`;
					const newItem: TodoItem = { id, text, completed: false };
					this.todoItems.push(newItem);
					added.push(newItem);
				}
				this.notifyTodoChange();
				return {
					success: true,
					added,
					pending_count: this.todoItems.filter((t) => !t.completed)
						.length,
				};
			}
			case "complete": {
				const id = argText(params.id || "").trim();
				const item = this.todoItems.find((t) => t.id === id);
				if (!item) return { error: `Todo not found: ${id}` };
				item.completed = true;
				this.notifyTodoChange();
				const pending = this.todoItems.filter((t) => !t.completed);
				return {
					success: true,
					item,
					pending_count: pending.length,
					all_done: pending.length === 0,
					next_pending: pending.length > 0 ? pending[0] : null,
				};
			}
			case "update": {
				const id = argText(params.id || "").trim();
				const text = argText(params.text || "").trim();
				const item = this.todoItems.find((t) => t.id === id);
				if (!item) return { error: `Todo not found: ${id}` };
				if (text) item.text = text;
				if (params.completed !== undefined)
					item.completed = Boolean(params.completed);
				this.notifyTodoChange();
				return { success: true, item };
			}
			case "remove": {
				const id = argText(params.id || "").trim();
				const idx = this.todoItems.findIndex((t) => t.id === id);
				if (idx === -1) return { error: `Todo not found: ${id}` };
				const [removed] = this.todoItems.splice(idx, 1);
				this.notifyTodoChange();
				return { success: true, removed };
			}
			case "clear": {
				const cleared = this.todoItems.length;
				this.todoItems = [];
				this.todoIdCounter = 0;
				this.notifyTodoChange();
				return { success: true, cleared };
			}
			default:
				return {
					error: `Unknown action: ${action}. Supported: list, add, add_batch, complete, update, remove, clear`,
				};
		}
	}

	/* ================================================================
	 * Config Generation (for legacy CLI --mcp-config)
	 * ================================================================ */

	private generateMCPConfig(): string {
		return JSON.stringify(
			{
				mcpServers: {
					"surfing-page": {
						type: "http",
						url: this.getMCPServerUrl(),
					},
				},
			},
			null,
			2,
		);
	}
}
