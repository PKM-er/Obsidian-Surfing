// The MCP server: Streamable HTTP, JSON responses only. It speaks JSON-RPC to
// MCP clients and hands tool calls to a backend. Nothing here touches Obsidian
// or Electron, so tests can run it with a fake backend.
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

export const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL = "2025-06-18";
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_SESSIONS = 100;

export interface JsonSchema {
	type: "object";
	properties: Record<string, unknown>;
	required?: string[];
	additionalProperties?: boolean;
}

export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: JsonSchema;
}

export type ToolContent =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string };

export interface ToolResult {
	content: ToolContent[];
	isError?: boolean;
}

export interface ClientInfo {
	name: string;
	version?: string;
}

export interface McpBackend {
	tools(): ToolDefinition[];
	callTool(
		name: string,
		args: Record<string, unknown>,
		client: ClientInfo,
	): Promise<ToolResult>;
}

export interface McpServerOptions {
	backend: McpBackend;
	/** The bearer token clients must send; read on every request. */
	getToken: () => string;
	/** 0 picks a free port (tests). */
	port: number;
	version: string;
}

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: JsonRpcId;
	method: string;
	params?: unknown;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: JsonRpcId;
	result?: unknown;
	error?: { code: number; message: string };
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const INSTRUCTIONS =
	"Controls the web pages open in Obsidian (Surfing and the core Web Viewer). " +
	"Call tabs_list to see the open tabs; every page tool takes a tabId (omit it to use the tab the user was last on). " +
	"Call read_page to get the interactive elements as refs like [e12], then pass a ref to click, type, scroll, form_input, screenshot or wait_for. " +
	"Refs stay valid until the next read_page of that tab or a navigation. " +
	"Use get_page_text to read an article. Sites may need the user's approval; if access is denied, do not retry.";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequest(value: unknown): value is JsonRpcRequest {
	return (
		isRecord(value) &&
		value.jsonrpc === "2.0" &&
		typeof value.method === "string" &&
		(value.id === undefined ||
			value.id === null ||
			typeof value.id === "string" ||
			typeof value.id === "number")
	);
}

/** Constant-time comparison of a presented token with the real one. */
export function tokenMatches(presented: string, expected: string): boolean {
	if (!expected) return false;
	const a = Buffer.from(presented);
	const b = Buffer.from(expected);
	// timingSafeEqual needs equal lengths; compare against a same-length
	// buffer first so a wrong length costs the same as a wrong value.
	if (a.length !== b.length) {
		timingSafeEqual(b, b);
		return false;
	}
	return timingSafeEqual(a, b);
}

/** "Bearer <token>" -> token, or "". */
export function bearerToken(header: string | undefined): string {
	if (!header) return "";
	const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim());
	return match ? match[1].trim() : "";
}

export function generateToken(): string {
	return randomBytes(24).toString("hex");
}

export class McpHttpServer {
	private server: Server | null = null;
	private actualPort = 0;
	private sessions = new Map<string, ClientInfo>();

	constructor(private options: McpServerOptions) {}

	get port(): number {
		return this.actualPort;
	}

	get listening(): boolean {
		return this.server?.listening ?? false;
	}

	/** Start listening on 127.0.0.1. Rejects with the listen error (EADDRINUSE, ...). */
	start(): Promise<void> {
		return new Promise((resolve, reject) => {
			const server = createServer((req, res) => {
				void this.handle(req, res).catch(() => {
					if (!res.headersSent) this.sendJson(res, 500, { error: "Internal error" });
					else res.end();
				});
			});
			server.once("error", reject);
			server.listen(this.options.port, "127.0.0.1", () => {
				server.off("error", reject);
				const address = server.address();
				this.actualPort = typeof address === "object" && address ? address.port : this.options.port;
				this.server = server;
				resolve();
			});
		});
	}

	stop(): Promise<void> {
		const server = this.server;
		this.server = null;
		this.sessions.clear();
		if (!server) return Promise.resolve();
		return new Promise((resolve) => {
			server.close(() => resolve());
			server.closeAllConnections();
		});
	}

	private sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
		const payload = JSON.stringify(body);
		res.writeHead(status, {
			"Content-Type": "application/json",
			"Content-Length": Buffer.byteLength(payload),
			"Cache-Control": "no-store",
			...headers,
		});
		res.end(payload);
	}

	private hostAllowed(host: string | undefined): boolean {
		if (!host) return false;
		const lower = host.toLowerCase();
		const port = this.actualPort;
		return lower === `127.0.0.1:${port}` || lower === `localhost:${port}`;
	}

	private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		// DNS rebinding: the Host must be the loopback address we listen on.
		if (!this.hostAllowed(req.headers.host)) {
			this.sendJson(res, 421, { error: "Misdirected request: unexpected Host" });
			return;
		}
		// Browsers always send Origin on cross-origin requests; MCP CLI clients
		// do not. Refusing any Origin keeps web pages from using this server.
		if (req.headers.origin !== undefined) {
			this.sendJson(res, 403, { error: "Requests with an Origin header are not allowed" });
			return;
		}
		const path = (req.url ?? "").split("?")[0];
		if (path !== "/mcp") {
			this.sendJson(res, 404, { error: "Not found" });
			return;
		}
		if (!tokenMatches(bearerToken(req.headers.authorization), this.options.getToken())) {
			this.sendJson(res, 401, { error: "Missing or invalid bearer token" }, {
				"WWW-Authenticate": "Bearer",
			});
			return;
		}
		if (req.method !== "POST") {
			this.sendJson(res, 405, { error: "Use POST" }, { Allow: "POST" });
			return;
		}

		const body = await this.readBody(req, res);
		if (body === null) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(body);
		} catch {
			this.sendJson(res, 400, this.error(null, PARSE_ERROR, "Parse error"));
			return;
		}

		const sessionId = headerValue(req.headers["mcp-session-id"]);
		const client = (sessionId && this.sessions.get(sessionId)) || { name: "An MCP client" };
		const extraHeaders: Record<string, string> = {};

		if (Array.isArray(parsed)) {
			if (parsed.length === 0) {
				this.sendJson(res, 400, this.error(null, INVALID_REQUEST, "Empty batch"));
				return;
			}
			const responses: JsonRpcResponse[] = [];
			for (const item of parsed) {
				const response = await this.handleMessage(item, client, extraHeaders);
				if (response) responses.push(response);
			}
			if (responses.length === 0) {
				res.writeHead(202).end();
				return;
			}
			this.sendJson(res, 200, responses, extraHeaders);
			return;
		}

		const response = await this.handleMessage(parsed, client, extraHeaders);
		if (!response) {
			res.writeHead(202).end();
			return;
		}
		this.sendJson(res, 200, response, extraHeaders);
	}

	private readBody(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
		return new Promise((resolve) => {
			const chunks: Buffer[] = [];
			let size = 0;
			let done = false;
			const finish = (value: string | null) => {
				if (done) return;
				done = true;
				resolve(value);
			};
			req.on("data", (chunk: Buffer) => {
				size += chunk.length;
				if (size > MAX_BODY_BYTES) {
					this.sendJson(res, 413, { error: "Request body too large" }, { Connection: "close" });
					req.destroy();
					finish(null);
					return;
				}
				chunks.push(chunk);
			});
			req.on("end", () => finish(Buffer.concat(chunks).toString("utf8")));
			req.on("error", () => finish(null));
		});
	}

	private error(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
		return { jsonrpc: "2.0", id, error: { code, message } };
	}

	/** One JSON-RPC message; undefined for notifications. */
	private async handleMessage(
		message: unknown,
		client: ClientInfo,
		responseHeaders: Record<string, string>,
	): Promise<JsonRpcResponse | undefined> {
		if (!isRequest(message)) {
			return this.error(null, INVALID_REQUEST, "Invalid request");
		}
		const isNotification = message.id === undefined;
		const id = message.id ?? null;
		const params = isRecord(message.params) ? message.params : {};

		try {
			switch (message.method) {
				case "initialize": {
					const requested = params.protocolVersion;
					const protocolVersion =
						typeof requested === "string" && SUPPORTED_PROTOCOLS.includes(requested)
							? requested
							: DEFAULT_PROTOCOL;
					const info = isRecord(params.clientInfo) ? params.clientInfo : {};
					const sessionId = randomBytes(16).toString("hex");
					if (this.sessions.size >= MAX_SESSIONS) {
						for (const oldest of this.sessions.keys()) {
							this.sessions.delete(oldest);
							break;
						}
					}
					this.sessions.set(sessionId, {
						name: typeof info.name === "string" && info.name ? info.name.slice(0, 80) : "An MCP client",
						version: typeof info.version === "string" ? info.version.slice(0, 40) : undefined,
					});
					responseHeaders["Mcp-Session-Id"] = sessionId;
					return {
						jsonrpc: "2.0",
						id,
						result: {
							protocolVersion,
							capabilities: { tools: {} },
							serverInfo: { name: "surfing", version: this.options.version },
							instructions: INSTRUCTIONS,
						},
					};
				}
				case "ping":
					return isNotification ? undefined : { jsonrpc: "2.0", id, result: {} };
				case "tools/list":
					return { jsonrpc: "2.0", id, result: { tools: this.options.backend.tools() } };
				case "tools/call": {
					if (typeof params.name !== "string") {
						return this.error(id, INVALID_PARAMS, "tools/call needs a tool name");
					}
					const args = isRecord(params.arguments) ? params.arguments : {};
					if (!this.options.backend.tools().some((tool) => tool.name === params.name)) {
						return this.error(id, INVALID_PARAMS, `Unknown tool: ${params.name}`);
					}
					let result: ToolResult;
					try {
						result = await this.options.backend.callTool(params.name, args, client);
					} catch (error) {
						result = {
							isError: true,
							content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
						};
					}
					return { jsonrpc: "2.0", id, result };
				}
				default:
					if (message.method.startsWith("notifications/") || isNotification) return undefined;
					return this.error(id, METHOD_NOT_FOUND, `Method not found: ${message.method}`);
			}
		} catch (error) {
			if (isNotification) return undefined;
			return this.error(id, INTERNAL_ERROR, error instanceof Error ? error.message : "Internal error");
		}
	}
}

function headerValue(value: string | string[] | undefined): string {
	return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
