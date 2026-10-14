// Per-site permission for the MCP tools: blocked sites, approved sites, and
// asking the user the first time an agent touches a host. The question itself
// (an Obsidian modal) is injected, so this class has no UI dependency.
import { decideAccess, SiteRules } from "./sites";

export type ConsentAnswer = "once" | "always" | "deny";

export interface PermissionHost {
	getRules(): SiteRules;
	/** Remember a host for good (saves the setting). */
	approveForever(host: string): void;
	/**
	 * Ask the user. Resolve with their answer; when `signal` aborts, close the
	 * question and resolve (the answer is then ignored).
	 */
	ask(host: string, clientName: string, signal: AbortSignal): Promise<ConsentAnswer>;
	now?: () => number;
}

export type AccessResult = { ok: true } | { ok: false; message: string };

const ASK_TIMEOUT_MS = 60_000;
const DENY_COOLDOWN_MS = 15_000;

export class SitePermissions {
	private approved = new Set<string>();
	private revoked = new Set<string>();
	private pending = new Map<string, Promise<boolean>>();
	private deniedUntil = new Map<string, number>();
	/** Modals show one at a time. */
	private queue: Promise<unknown> = Promise.resolve();

	constructor(
		private host: PermissionHost,
		private askTimeoutMs = ASK_TIMEOUT_MS,
	) {}

	private now(): number {
		return this.host.now ? this.host.now() : Date.now();
	}

	/** Can a tool read or act on a page of `host`? May show the consent question. */
	async ensure(host: string, clientName: string): Promise<AccessResult> {
		const decision = decideAccess(host, this.host.getRules(), {
			approved: this.approved,
			revoked: this.revoked,
		});
		if (decision === "allowed") return { ok: true };
		if (decision === "blocked") {
			return { ok: false, message: `${host} is on the blocked sites list in Surfing's MCP settings. Do not retry.` };
		}

		const denied = this.deniedUntil.get(host);
		if (denied !== undefined && denied > this.now()) {
			return { ok: false, message: `The user denied access to ${host}.` };
		}

		let answer = this.pending.get(host);
		if (!answer) {
			answer = this.enqueue(host, clientName).finally(() => this.pending.delete(host));
			this.pending.set(host, answer);
		}
		const granted = await answer;
		return granted
			? { ok: true }
			: { ok: false, message: `The user denied access to ${host}.` };
	}

	private enqueue(host: string, clientName: string): Promise<boolean> {
		const run = async (): Promise<boolean> => {
			// Settings may have changed while this waited in line.
			const decision = decideAccess(host, this.host.getRules(), {
				approved: this.approved,
				revoked: this.revoked,
			});
			if (decision === "allowed") return true;
			if (decision === "blocked") return false;

			const abort = new AbortController();
			const timer = setTimeout(() => abort.abort(), this.askTimeoutMs);
			let answer: ConsentAnswer;
			try {
				answer = await this.host.ask(host, clientName, abort.signal);
			} catch {
				answer = "deny";
			} finally {
				clearTimeout(timer);
			}
			if (abort.signal.aborted) answer = "deny";

			if (answer === "deny") {
				this.deniedUntil.set(host, this.now() + DENY_COOLDOWN_MS);
				return false;
			}
			this.approved.add(host);
			this.revoked.delete(host);
			this.deniedUntil.delete(host);
			if (answer === "always") this.host.approveForever(host);
			return true;
		};
		const result = this.queue.then(run, run);
		this.queue = result.catch(() => undefined);
		return result;
	}

	/** The user pressed Stop on a tab: the host asks again next time, whatever was approved. */
	revoke(host: string): void {
		if (!host) return;
		this.approved.delete(host);
		this.revoked.add(host);
	}

	/** Forget everything granted for this session. */
	reset(): void {
		this.approved.clear();
		this.revoked.clear();
		this.deniedUntil.clear();
	}
}
