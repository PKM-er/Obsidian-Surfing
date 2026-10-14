import type * as Electron from "electron";
import { App, Notice } from "obsidian";
import { remote } from "electron";
import SurfingPlugin from "../surfingIndex";
import { t } from "../translations/helper";

export class AdBlockManager {
	private plugin: SurfingPlugin;
	private blockedDomains: Set<string> = new Set();
	private session: Electron.Session | null = null;

	constructor(plugin: SurfingPlugin) {
		this.plugin = plugin;
	}

	async initialize(): Promise<void> {
		this.session = remote.session.fromPartition(
			`persist:surfing-vault-${(this.plugin.app as App & { appId: string }).appId}`
		);
		await this.loadAllFilterLists();
		this.registerRequestInterceptor();
	}

	async loadAllFilterLists(): Promise<void> {
		this.blockedDomains.clear();
		const filterLists = this.plugin.settings.adBlock?.filterLists ?? [];
		for (const list of filterLists) {
			if (!list.enabled) continue;
			try {
				const content = await this.fetchListContent(list.url);
				this.parseList(content);
			} catch (e) {
				console.error(`Failed to load filter list: ${list.name}`, e);
				new Notice(t("Filter list load failed: ") + list.name);
			}
		}
	}

	private async fetchListContent(url: string): Promise<string> {
		// Local vault file
		if (!url.startsWith("http://") && !url.startsWith("https://")) {
			return await this.plugin.app.vault.adapter.read(url);
		}
		// Remote URL
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		return await response.text();
	}

	private parseList(content: string): void {
		const lines = content.split("\n");
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!"))
				continue;

			let domain = trimmed;

			// Hosts file format: "0.0.0.0 domain" or "127.0.0.1 domain"
			if (domain.startsWith("0.0.0.0 "))
				domain = domain.substring(8).trim();
			else if (domain.startsWith("127.0.0.1 "))
				domain = domain.substring(10).trim();

			// ABP-style: "||domain^"
			if (domain.startsWith("||")) domain = domain.substring(2);
			if (domain.endsWith("^")) domain = domain.slice(0, -1);

			// Strip inline comments
			const commentIdx = domain.indexOf("#");
			if (commentIdx > 0) domain = domain.substring(0, commentIdx).trim();

			// Skip URL path patterns and wildcards
			if (domain.includes("/") || domain.includes("*")) continue;

			// Skip empty or localhost
			if (
				!domain ||
				domain === "localhost" ||
				domain === "0.0.0.0" ||
				domain === "127.0.0.1"
			)
				continue;

			this.blockedDomains.add(domain.toLowerCase());
		}
	}

	private registerRequestInterceptor(): void {
		if (!this.session) return;

		this.session.webRequest.onBeforeRequest(
			(
				details: Electron.OnBeforeRequestListenerDetails,
				callback: (response: Electron.CallbackResponse) => void
			) => {
				if (!this.plugin.settings.adBlock?.enabled) {
					callback({ cancel: false });
					return;
				}

				try {
					const url = new URL(details.url);
					const hostname = url.hostname.toLowerCase();
					if (this.isDomainBlocked(hostname)) {
						callback({ cancel: true });
						return;
					}
				} catch {
					// Invalid URL, let it through
				}

				callback({ cancel: false });
			}
		);
	}

	private isDomainBlocked(hostname: string): boolean {
		if (this.blockedDomains.has(hostname)) return true;

		// Check parent domains: "sub.ads.example.com" → "ads.example.com" → "example.com"
		const parts = hostname.split(".");
		for (let i = 1; i < parts.length - 1; i++) {
			const parent = parts.slice(i).join(".");
			if (this.blockedDomains.has(parent)) return true;
		}
		return false;
	}

	async reload(): Promise<void> {
		await this.loadAllFilterLists();
	}

	destroy(): void {
		if (this.session) {
			this.session.webRequest.onBeforeRequest(null);
		}
	}
}
