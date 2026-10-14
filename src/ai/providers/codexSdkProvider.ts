import * as fs from "fs";
import * as path from "path";
import { Notice, Platform } from "obsidian";
import type { AIProvider, AIProviderContext, AIProviderEvent } from "../types";
import { Codex, type ThreadEvent, type ThreadItem } from "@openai/codex-sdk";

export class CodexSdkProvider implements AIProvider {
	readonly name = "codex-sdk";
	private codexCommand: string;

	constructor(codexCommand?: string) {
		this.codexCommand = codexCommand || "codex";
	}

	/**
	 * Resolve the codex binary path.  After Vite bundling the SDK's own
	 * `findCodexPath()` breaks because `import.meta.url` points at the
	 * plugin bundle, not at the SDK source.  We locate the vendored binary
	 * ourselves and fall back to the user-configured command.
	 */
	private resolveCodexBinary(pluginDir: string): string {
		// 1) If user gave an explicit .exe path that exists, use it directly
		if (this.codexCommand.endsWith(".exe")) {
			if (fs.existsSync(this.codexCommand)) return this.codexCommand;
		}

		// 2) Try the vendored binary shipped with @openai/codex-sdk
		const triple = this.getPlatformTriple();
		if (triple) {
			const binaryName = Platform.isWin ? "codex.exe" : "codex";
			const vendored = path.join(
				pluginDir,
				"node_modules",
				"@openai",
				"codex-sdk",
				"vendor",
				triple,
				"codex",
				binaryName,
			);
			if (fs.existsSync(vendored)) return vendored;
		}

		// 3) If user gave a .js/.cmd path, look for codex.exe alongside it
		if (
			Platform.isWin &&
			(this.codexCommand.endsWith(".js") ||
				this.codexCommand.endsWith(".cmd"))
		) {
			const dir = path.dirname(this.codexCommand);
			const exePath = path.join(dir, "codex.exe");
			if (fs.existsSync(exePath)) return exePath;
		}

		// 4) Fallback — let the SDK try its own resolution
		return this.codexCommand;
	}

	private getPlatformTriple(): string | null {
		const arch = process.arch;
		if (Platform.isWin) {
			return arch === "arm64"
				? "aarch64-pc-windows-msvc"
				: "x86_64-pc-windows-msvc";
		}
		if (Platform.isMacOS) {
			return arch === "arm64"
				? "aarch64-apple-darwin"
				: "x86_64-apple-darwin";
		}
		// Linux / Android
		return arch === "arm64"
			? "aarch64-unknown-linux-musl"
			: "x86_64-unknown-linux-musl";
	}

	async execute(
		prompt: string,
		context: AIProviderContext,
		onEvent: (event: AIProviderEvent) => void,
		signal: AbortSignal,
	): Promise<void> {
		const resolvedPath = this.resolveCodexBinary(context.pluginDir);

		const codex = new Codex({
			codexPathOverride: resolvedPath,
			config:
				context.mcpEnabled && context.mcpServerUrl
					? ({
							mcp_servers: {
								"surfing-page": {
									type: "http",
									url: context.mcpServerUrl,
								},
							},
						})
					: undefined,
		});

		const thread = codex.startThread({
			workingDirectory: context.vaultPath,
			skipGitRepoCheck: true,
			// Disable built-in web search when MCP Surfing tools are available
			...(context.mcpEnabled ? { webSearchEnabled: false } : {}),
		});

		try {
			const { events } = await thread.runStreamed(prompt, { signal });
			for await (const event of events) {
				const mapped = this.mapEvent(event);
				for (const ev of mapped) {
					onEvent(ev);
				}
			}
		} catch (err: unknown) {
			if (signal.aborted) return;
			const msg = err instanceof Error ? err.message : String(err);
			if (
				msg.includes("ENOENT") ||
				msg.includes("EFTYPE") ||
				msg.includes("not found")
			) {
				new Notice(
					`Codex CLI not found at "${resolvedPath}". Please install Codex or update the command in settings.`,
				);
			}
			throw err;
		}
	}

	private mapEvent(event: ThreadEvent): AIProviderEvent[] {
		const events: AIProviderEvent[] = [];

		switch (event.type) {
			case "thread.started":
				events.push({
					eventType: "status",
					content: "Session initialized",
					sessionId: event.thread_id,
				});
				break;

			case "turn.started":
				events.push({
					eventType: "status",
					content: "Turn started",
				});
				break;

			case "turn.completed":
				events.push({
					eventType: "result",
					numTurns: 1,
					cost: event.usage
						? (event.usage.input_tokens +
								event.usage.output_tokens) *
							0.000001
						: undefined,
				});
				break;

			case "turn.failed":
				events.push({
					eventType: "text",
					content: `Error: ${event.error.message}`,
				});
				break;

			case "item.started":
			case "item.updated":
			case "item.completed":
				events.push(...this.mapItemEvent(event.type, event.item));
				break;

			case "error":
				events.push({
					eventType: "text",
					content: `Error: ${event.message}`,
				});
				break;
		}

		return events;
	}

	private mapItemEvent(
		eventType: "item.started" | "item.updated" | "item.completed",
		item: ThreadItem,
	): AIProviderEvent[] {
		const events: AIProviderEvent[] = [];

		switch (item.type) {
			case "reasoning":
				if (item.text?.trim()) {
					events.push({
						eventType: "thinking",
						content: item.text,
					});
				}
				break;

			case "agent_message":
				if (eventType === "item.completed" && item.text?.trim()) {
					events.push({
						eventType: "text",
						content: item.text,
					});
				}
				break;

			case "command_execution":
				if (eventType === "item.started") {
					events.push({
						eventType: "tool_use",
						toolName: "command_execution",
						toolInput: { command: item.command },
						toolId: item.id,
					});
				} else if (eventType === "item.completed") {
					events.push({
						eventType: "tool_result",
						toolId: item.id,
						content:
							item.aggregated_output ||
							`exit code: ${item.exit_code ?? "?"}`,
					});
				}
				break;

			case "file_change":
				if (eventType === "item.started") {
					events.push({
						eventType: "tool_use",
						toolName: "file_change",
						toolInput: { changes: item.changes },
						toolId: item.id,
					});
				} else if (eventType === "item.completed") {
					events.push({
						eventType: "tool_result",
						toolId: item.id,
						content: `File changes ${item.status}`,
					});
				}
				break;

			case "mcp_tool_call":
				if (eventType === "item.started") {
					events.push({
						eventType: "tool_use",
						toolName: `${item.server}/${item.tool}`,
						toolInput:
							(item.arguments as Record<string, unknown>) || {},
						toolId: item.id,
					});
				} else if (eventType === "item.completed") {
					let content = "";
					if (item.error) {
						content = `Error: ${item.error.message}`;
					} else if (item.result?.content) {
						const blocks = item.result.content as { text?: string }[];
						content = blocks
							.map((block) => block.text || JSON.stringify(block))
							.join("\n");
					}
					events.push({
						eventType: "tool_result",
						toolId: item.id,
						content,
					});
				}
				break;

			case "web_search":
				if (eventType === "item.started") {
					events.push({
						eventType: "tool_use",
						toolName: "web_search",
						toolInput: { query: item.query },
						toolId: item.id,
					});
				} else if (eventType === "item.completed") {
					events.push({
						eventType: "tool_result",
						toolId: item.id,
						content: `Web search completed: ${item.query}`,
					});
				}
				break;

			case "todo_list":
				// Show as status update
				if (eventType === "item.completed") {
					const summary = item.items
						.map((t) => `${t.completed ? "[x]" : "[ ]"} ${t.text}`)
						.join("\n");
					events.push({
						eventType: "status",
						content: summary,
					});
				}
				break;

			case "error":
				events.push({
					eventType: "text",
					content: `Error: ${item.message}`,
				});
				break;
		}

		return events;
	}
}
