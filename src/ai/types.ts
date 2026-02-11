/**
 * Unified AI provider abstraction layer.
 * All providers (Codex SDK, Claude CLI, legacy CLI) implement the AIProvider interface.
 */

export type AIProviderEventType =
	| "thinking"
	| "tool_use"
	| "tool_result"
	| "text"
	| "status"
	| "result";

export interface AIProviderEvent {
	eventType: AIProviderEventType;
	content?: string;
	toolName?: string;
	toolInput?: Record<string, unknown>;
	toolId?: string;
	sessionId?: string;
	cost?: number;
	numTurns?: number;
	approvalStatus?: "pending" | "approved" | "denied" | "auto-approved";
}

export interface AIProviderContext {
	vaultPath: string;
	pluginDir: string;
	mcpEnabled: boolean;
	mcpConfigPath?: string;
	mcpServerUrl?: string;
}

export interface AIProvider {
	readonly name: string;
	execute(
		prompt: string,
		context: AIProviderContext,
		onEvent: (event: AIProviderEvent) => void,
		signal: AbortSignal,
	): Promise<void>;
}
