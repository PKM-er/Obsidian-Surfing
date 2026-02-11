import { Notice } from "obsidian";
import type { AIProvider, AIProviderContext, AIProviderEvent } from "../types";
import type {
	Options,
	SDKMessage,
	SDKAssistantMessage,
	SDKResultMessage,
	SDKSystemMessage,
	SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

/**
 * Claude SDK provider. Uses @anthropic-ai/claude-agent-sdk to run Claude Code
 * with typed streaming messages, built-in MCP support, and proper abort handling.
 */
export class ClaudeSdkProvider implements AIProvider {
	readonly name = "claude-sdk";
	private claudeCommand: string;

	constructor(claudeCommand?: string) {
		this.claudeCommand = claudeCommand || "claude";
	}

	async execute(
		prompt: string,
		context: AIProviderContext,
		onEvent: (event: AIProviderEvent) => void,
		signal: AbortSignal,
	): Promise<void> {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { query } = require("@anthropic-ai/claude-agent-sdk") as {
			query: (typeof import("@anthropic-ai/claude-agent-sdk"))["query"];
		};
		const abortController = new AbortController();
		const onAbort = () => abortController.abort();
		signal.addEventListener("abort", onAbort, { once: true });

		const options: Options = {
			abortController,
			cwd: context.vaultPath,
			systemPrompt: {
				type: "preset",
				preset: "claude_code",
				...(context.mcpEnabled
					? {
							append: [
								"IMPORTANT: You have access to Obsidian Surfing MCP tools (surfing_*) for web browsing.",
								"ALWAYS use surfing_open_page / surfing_fetch_page_content / surfing_navigate instead of WebFetch or WebSearch for any web browsing, searching, or page reading tasks.",
								"Use surfing_todo_manage to track multi-step tasks: add todos first, then complete each one and check the list until all_done is true.",
							].join("\n"),
						}
					: {}),
			},
			tools: {
				type: "preset",
				preset: "claude_code",
			},
			permissionMode: "bypassPermissions",
			allowDangerouslySkipPermissions: true,
		};

		if (this.claudeCommand && this.claudeCommand !== "claude") {
			options.pathToClaudeCodeExecutable = this.claudeCommand;
		}

		// Connect to MCP server via HTTP transport
		if (context.mcpEnabled && context.mcpServerUrl) {
			options.mcpServers = {
				"surfing-page": {
					type: "http" as const,
					url: context.mcpServerUrl,
				},
			};
			options.allowedTools = ["mcp__surfing-page__*"];
		}

		try {
			for await (const message of query({ prompt, options })) {
				if (signal.aborted) break;
				const events = this.mapMessage(message);
				for (const ev of events) {
					onEvent(ev);
				}
			}
		} catch (err: unknown) {
			if (signal.aborted) return;
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes("ENOENT") || msg.includes("not found")) {
				new Notice(
					`Claude Code not found at "${this.claudeCommand}". Please install Claude Code or update the command in settings.`,
				);
			}
			throw err;
		} finally {
			signal.removeEventListener("abort", onAbort);
		}
	}

	private mapMessage(message: SDKMessage): AIProviderEvent[] {
		const events: AIProviderEvent[] = [];

		switch (message.type) {
			case "system": {
				const sysMsg = message as SDKSystemMessage;
				if (sysMsg.subtype === "init") {
					events.push({
						eventType: "status",
						content: "Session initialized",
						sessionId: sysMsg.session_id,
					});
				}
				break;
			}

			case "assistant": {
				const assistMsg = message as SDKAssistantMessage;
				const blocks = assistMsg.message?.content;
				if (Array.isArray(blocks)) {
					for (const block of blocks) {
						if (block.type === "thinking") {
							events.push({
								eventType: "thinking",
								content: String((block as any).thinking || ""),
							});
						} else if (block.type === "text") {
							events.push({
								eventType: "text",
								content: String((block as any).text || ""),
							});
						} else if (block.type === "tool_use") {
							events.push({
								eventType: "tool_use",
								toolName: String((block as any).name || ""),
								toolInput: (block as any).input || {},
								toolId: String((block as any).id || ""),
							});
						}
					}
				}
				break;
			}

			case "user": {
				const userMsg = message as SDKUserMessage;
				const content = userMsg.message?.content;
				if (Array.isArray(content)) {
					for (const block of content) {
						if (
							typeof block === "object" &&
							block !== null &&
							(block as any).type === "tool_result"
						) {
							const resultBlock = block as any;
							events.push({
								eventType: "tool_result",
								toolId: String(resultBlock.tool_use_id || ""),
								content:
									typeof resultBlock.content === "string"
										? resultBlock.content
										: JSON.stringify(resultBlock.content),
							});
						}
					}
				}
				break;
			}

			case "result": {
				const resultMsg = message as SDKResultMessage;
				if (
					resultMsg.subtype === "success" &&
					"result" in resultMsg &&
					typeof resultMsg.result === "string" &&
					resultMsg.result.trim()
				) {
					events.push({
						eventType: "text",
						content: resultMsg.result,
					});
				}
				events.push({
					eventType: "result",
					sessionId: resultMsg.session_id,
					cost:
						typeof resultMsg.total_cost_usd === "number"
							? resultMsg.total_cost_usd
							: undefined,
					numTurns:
						typeof resultMsg.num_turns === "number"
							? resultMsg.num_turns
							: undefined,
				});
				break;
			}
		}

		return events;
	}
}
