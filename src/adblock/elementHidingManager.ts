import SurfingPlugin from "../surfingIndex";
import { ElementHidingRules, ElementHidingRule } from "../types/adblock";

export class ElementHidingManager {
	private plugin: SurfingPlugin;
	private rules: ElementHidingRules = {};

	constructor(plugin: SurfingPlugin) {
		this.plugin = plugin;
	}

	private get savePath(): string {
		return `${this.plugin.app.vault.configDir}/surfing-element-hiding.json`;
	}

	async initialize(): Promise<void> {
		await this.loadRules();
	}

	async loadRules(): Promise<void> {
		try {
			const exists =
				await this.plugin.app.vault.adapter.exists(this.savePath);
			if (exists) {
				const data =
					await this.plugin.app.vault.adapter.read(this.savePath);
				this.rules = JSON.parse(data);
			}
		} catch {
			this.rules = {};
		}
	}

	async saveRules(): Promise<void> {
		await this.plugin.app.vault.adapter.write(
			this.savePath,
			JSON.stringify(this.rules, null, 2),
		);
	}

	async addRule(domain: string, selector: string): Promise<void> {
		if (!this.rules[domain]) this.rules[domain] = [];
		// Avoid duplicate selectors for the same domain
		if (this.rules[domain].some((r) => r.selector === selector)) return;
		this.rules[domain].push({
			id: String(Date.now()),
			selector,
			created: Date.now(),
		});
		await this.saveRules();
	}

	async removeRule(domain: string, ruleId: string): Promise<void> {
		if (!this.rules[domain]) return;
		this.rules[domain] = this.rules[domain].filter((r) => r.id !== ruleId);
		if (this.rules[domain].length === 0) delete this.rules[domain];
		await this.saveRules();
	}

	getCssForUrl(url: string): string {
		try {
			const hostname = new URL(url).hostname;
			const domainRules = this.rules[hostname];
			if (!domainRules || domainRules.length === 0) return "";
			return domainRules
				.map((r) => `${r.selector} { display: none !important; }`)
				.join("\n");
		} catch {
			return "";
		}
	}

	getRulesForDomain(domain: string): ElementHidingRule[] {
		return this.rules[domain] || [];
	}
}
