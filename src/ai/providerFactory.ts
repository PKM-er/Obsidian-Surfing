import { Platform } from "obsidian";
import type { AIProvider } from "./types";
import type {
	AIAssistantProvider,
	SurfingSettings,
} from "../surfingPluginSetting";
import { CodexSdkProvider } from "./providers/codexSdkProvider";
import { ClaudeSdkProvider } from "./providers/claudeSdkProvider";

export interface ProviderAvailability {
	codex: boolean;
	claude: boolean;
	custom: boolean;
}

// Cached availability — refreshed via checkProviderAvailability()
let cachedAvailability: ProviderAvailability = {
	codex: false,
	claude: false,
	custom: true,
};

/**
 * Check whether CLI tools are reachable on $PATH, at the configured path,
 * or via the vendored binary bundled with @openai/codex-sdk.
 */
export async function checkProviderAvailability(
	settings: SurfingSettings["aiAssistant"],
	pluginDir?: string,
): Promise<ProviderAvailability> {
	const [codex, claude] = await Promise.all([
		isCodexAvailable(settings.codexCommand || "codex", pluginDir),
		isCommandAvailable(settings.claudeCommand || "claude"),
	]);
	cachedAvailability = {
		codex,
		claude,
		custom: !!(settings.customCommand && settings.customCommand.trim()),
	};
	return cachedAvailability;
}

export function getCachedAvailability(): ProviderAvailability {
	return { ...cachedAvailability };
}

async function isCodexAvailable(
	command: string,
	pluginDir?: string,
): Promise<boolean> {
	// Check PATH first
	if (await isCommandAvailable(command)) return true;
	// Check vendored binary from @openai/codex-sdk
	if (pluginDir) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const fs = require("fs") as typeof import("fs");
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const path = require("path") as typeof import("path");
			const arch = process.arch;
			let triple: string;
			if (Platform.isWin) {
				triple =
					arch === "arm64"
						? "aarch64-pc-windows-msvc"
						: "x86_64-pc-windows-msvc";
			} else if (Platform.isMacOS) {
				triple =
					arch === "arm64"
						? "aarch64-apple-darwin"
						: "x86_64-apple-darwin";
			} else {
				triple =
					arch === "arm64"
						? "aarch64-unknown-linux-musl"
						: "x86_64-unknown-linux-musl";
			}
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
			if (fs.existsSync(vendored)) return true;
		} catch {
			// ignore
		}
	}
	return false;
}

async function isCommandAvailable(command: string): Promise<boolean> {
	try {
		/* eslint-disable @typescript-eslint/no-var-requires */
		const { execFile } =
			require("child_process") as typeof import("child_process");
		/* eslint-enable @typescript-eslint/no-var-requires */
		const whichCmd = Platform.isWin ? "where" : "which";
		return new Promise<boolean>((resolve) => {
			execFile(whichCmd, [command], { windowsHide: true }, (err) => {
				resolve(!err);
			});
		});
	} catch {
		return false;
	}
}

/**
 * Returns the first available provider from the user's preference,
 * falling back through the list. Returns null if nothing is available.
 */
export function pickAvailableProvider(
	preferred: AIAssistantProvider,
): AIAssistantProvider | null {
	if (cachedAvailability[preferred]) return preferred;
	const order: AIAssistantProvider[] = ["codex", "claude", "custom"];
	return order.find((p) => cachedAvailability[p]) ?? null;
}

/**
 * Creates the appropriate AI provider based on current settings.
 *
 * - codex  -> CodexSdkProvider  (@openai/codex-sdk)
 * - claude -> ClaudeSdkProvider (@anthropic-ai/claude-agent-sdk)
 */
export function createProvider(
	settings: SurfingSettings["aiAssistant"],
): AIProvider {
	switch (settings.defaultProvider) {
		case "codex":
			return new CodexSdkProvider(settings.codexCommand || undefined);
		case "claude":
			return new ClaudeSdkProvider(settings.claudeCommand || undefined);
	}
}
