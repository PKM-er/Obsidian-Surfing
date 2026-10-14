// Owns the MCP server for the plugin: starts and stops it with the setting,
// wires the tool handlers to Obsidian, and offers the settings page its state.
import { Component, Notice } from "obsidian";
import type SurfingPlugin from "../surfingIndex";
import { t } from "../translations/helper";
import { askConsent } from "./consent";
import { ToolHandlers } from "./handlers";
import { AgentIndicator } from "./indicator";
import { SitePermissions } from "./permissions";
import { generateToken, McpHttpServer } from "./server";
import { normalizePattern } from "./sites";
import { sleep, TabRegistry } from "./tabs";

export type McpStatus = "off" | "listening" | "port-in-use" | "error";

export const MIN_PORT = 1024;
export const MAX_PORT = 65535;

/** The Node error code of a failure (EADDRINUSE, ...), if it has one. */
function errorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
	const code: unknown = error.code;
	return typeof code === "string" ? code : undefined;
}

export class McpController extends Component {
	status: McpStatus = "off";
	statusDetail = "";
	private server: McpHttpServer | null = null;
	private registry: TabRegistry;
	private indicator: AgentIndicator;
	private permissions: SitePermissions;
	private handlers: ToolHandlers;
	/** Serialises start/stop so quick toggles cannot overlap. */
	private chain: Promise<void> = Promise.resolve();

	constructor(private plugin: SurfingPlugin) {
		super();
		const app = plugin.app;
		this.registry = new TabRegistry(app);
		this.permissions = new SitePermissions({
			getRules: () => ({
				siteAccess: this.plugin.settings.mcp.siteAccess,
				approvedSites: this.plugin.settings.mcp.approvedSites,
				blockedSites: this.plugin.settings.mcp.blockedSites,
			}),
			approveForever: (host) => this.approveSite(host),
			ask: (host, client, signal) => askConsent(app, host, client, signal),
		});
		this.indicator = new AgentIndicator((host) => {
			this.permissions.revoke(host);
			new Notice(t("Revoked {host} for this session.").replace("{host}", host));
		});
		this.handlers = new ToolHandlers({
			registry: this.registry,
			permissions: this.permissions,
			indicator: this.indicator,
			getRules: () => ({
				siteAccess: this.plugin.settings.mcp.siteAccess,
				approvedSites: this.plugin.settings.mcp.approvedSites,
				blockedSites: this.plugin.settings.mcp.blockedSites,
			}),
			allowScripts: () => this.plugin.settings.mcp.allowScripts,
			sessionIsolation: () => this.plugin.settings.sessionIsolation,
		});
	}

	onload() {
		this.registerEvent(
			this.plugin.app.workspace.on("active-leaf-change", (leaf) => this.registry.noteActiveLeaf(leaf)),
		);
		this.plugin.app.workspace.onLayoutReady(() => {
			this.registry.noteActiveLeaf(this.plugin.app.workspace.getMostRecentLeaf());
			void this.sync();
		});
	}

	onunload() {
		this.indicator.clear();
		void this.stopServer();
	}

	/** The URL clients connect to. */
	get url(): string {
		return `http://127.0.0.1:${this.plugin.settings.mcp.port}/mcp`;
	}

	/** Bring the server in line with the settings (start, stop or restart). */
	sync(): Promise<void> {
		this.chain = this.chain.then(() => this.apply()).catch(() => undefined);
		return this.chain;
	}

	private async apply(): Promise<void> {
		const settings = this.plugin.settings.mcp;
		await this.stopServer();
		if (!settings.enabled) {
			this.status = "off";
			this.statusDetail = "";
			return;
		}
		if (!settings.token) {
			settings.token = generateToken();
			await this.plugin.saveSettings();
		}
		const port = Math.min(MAX_PORT, Math.max(MIN_PORT, Math.round(settings.port) || MIN_PORT));
		try {
			// After a reload the previous instance may still be letting go of the port.
			for (let attempt = 0; ; attempt += 1) {
				const server = new McpHttpServer({
					backend: this.handlers,
					getToken: () => this.plugin.settings.mcp.token,
					port,
					version: this.plugin.manifest.version,
				});
				try {
					await server.start();
					this.server = server;
					break;
				} catch (error) {
					if (errorCode(error) !== "EADDRINUSE" || attempt >= 6) throw error;
					await sleep(300);
				}
			}
			this.status = "listening";
			this.statusDetail = "";
		} catch (error) {
			if (errorCode(error) === "EADDRINUSE") {
				this.status = "port-in-use";
				new Notice(t("Surfing MCP: port {port} is already in use.").replace("{port}", String(port)));
			} else {
				this.status = "error";
				this.statusDetail = error instanceof Error ? error.message : String(error);
				new Notice(t("Surfing MCP server could not start: {error}").replace("{error}", this.statusDetail));
			}
		}
	}

	private async stopServer(): Promise<void> {
		const server = this.server;
		this.server = null;
		if (server) await server.stop();
		this.permissions.reset();
	}

	/** Turn the server on or off from the settings, generating the token the first time. */
	async setEnabled(enabled: boolean): Promise<void> {
		const settings = this.plugin.settings.mcp;
		settings.enabled = enabled;
		if (enabled && !settings.token) settings.token = generateToken();
		await this.plugin.saveSettings();
		await this.sync();
	}

	async setPort(port: number): Promise<void> {
		this.plugin.settings.mcp.port = Math.min(MAX_PORT, Math.max(MIN_PORT, Math.round(port) || MIN_PORT));
		await this.plugin.saveSettings();
		if (this.plugin.settings.mcp.enabled) await this.sync();
	}

	/** A new token; connected clients must be updated. */
	async regenerateToken(): Promise<void> {
		this.plugin.settings.mcp.token = generateToken();
		await this.plugin.saveSettings();
		// The server reads the token on each request, but restarting also drops open connections.
		if (this.plugin.settings.mcp.enabled) await this.sync();
	}

	private approveSite(host: string): void {
		const approved = this.plugin.settings.mcp.approvedSites;
		if (!approved.some((entry) => normalizePattern(entry) === host)) approved.push(host);
		void this.plugin.saveSettings();
		this.plugin.settingsTab?.refreshSettings();
	}

	statusText(): string {
		switch (this.status) {
			case "listening":
				return t("Listening on {url}").replace("{url}", this.url);
			case "port-in-use":
				return t("Port in use");
			case "error":
				return t("Error: {error}").replace("{error}", this.statusDetail);
			default:
				return t("Off");
		}
	}

	/** The connection snippets shown in the settings. */
	snippets(): { claudeCode: string; codex: string; json: string } {
		const { token } = this.plugin.settings.mcp;
		const url = this.url;
		return {
			claudeCode: `claude mcp add --transport http surfing ${url} --header "Authorization: Bearer ${token}"`,
			codex: `[mcp_servers.surfing]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${token}" }`,
			json: JSON.stringify(
				{ mcpServers: { surfing: { type: "http", url, headers: { Authorization: `Bearer ${token}` } } } },
				null,
				2,
			),
		};
	}
}
