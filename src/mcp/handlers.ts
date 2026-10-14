// The tool implementations: resolve the tab, check the site permission, run
// the action, and describe the outcome as text (or an image).
import type * as Electron from "electron";
import type { ClientInfo, McpBackend, ToolDefinition, ToolResult } from "./server";
import type { AgentIndicator } from "./indicator";
import type { SitePermissions } from "./permissions";
import { isBlockedHost, hostOf, toWebUrl } from "./sites";
import type { SiteRules } from "./sites";
import { SCRIPT_TOOL, TAB_MANAGEMENT_TOOLS, TOOLS } from "./tools";
import { sleep, Tab, TabRegistry, watchLoad } from "./tabs";
import {
	callAgent,
	capture,
	captureFullPage,
	clickAt,
	formatSnapshot,
	insertText,
	pageContent,
	pressKeys,
	snapshot,
	targetOf,
	toMarkdown,
	toModifiers,
	wheelScroll,
} from "./page";
import type { ScrollState } from "./pageAgent";

export interface HandlerDeps {
	registry: TabRegistry;
	permissions: SitePermissions;
	indicator: AgentIndicator;
	getRules(): SiteRules;
	allowScripts(): boolean;
	sessionIsolation(): boolean;
}

interface PageContext {
	tab: Tab;
	contents: Electron.WebContents;
	host: string;
}

const DEFAULT_MAX_ELEMENTS = 300;
const DEFAULT_TEXT_LENGTH = 20_000;
const MAX_SCRIPT_RESULT = 20_000;

function text(value: string): ToolResult {
	return { content: [{ type: "text", text: value }] };
}

function failure(message: string): ToolResult {
	return { isError: true, content: [{ type: "text", text: message }] };
}

function json(value: unknown): ToolResult {
	return text(JSON.stringify(value, null, 2));
}

type Args = Record<string, unknown>;

function optString(args: Args, key: string): string | undefined {
	const value = args[key];
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new Error(`"${key}" must be a string.`);
	return value;
}

function reqString(args: Args, key: string): string {
	const value = optString(args, key);
	if (value === undefined || value === "") throw new Error(`"${key}" is required.`);
	return value;
}

function optNumber(args: Args, key: string): number | undefined {
	const value = args[key];
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`"${key}" must be a number.`);
	return value;
}

function optInt(args: Args, key: string, min: number, max: number, fallback: number): number {
	const value = optNumber(args, key);
	if (value === undefined) return fallback;
	return Math.min(max, Math.max(min, Math.round(value)));
}

function optBool(args: Args, key: string, fallback: boolean): boolean {
	const value = args[key];
	if (value === undefined || value === null) return fallback;
	if (typeof value !== "boolean") throw new Error(`"${key}" must be true or false.`);
	return value;
}

function truncate(value: string, max: number): string {
	return value.length > max
		? value.slice(0, max) + `\n\n[truncated: ${value.length - max} more characters]`
		: value;
}

function formatScroll(state: ScrollState): string {
	return `scroll ${state.x},${state.y} of ${state.width}x${state.height} (viewport ${state.viewportWidth}x${state.viewportHeight})`;
}

export class ToolHandlers implements McpBackend {
	constructor(private deps: HandlerDeps) {}

	tools(): ToolDefinition[] {
		return TOOLS;
	}

	async callTool(name: string, args: Args, client: ClientInfo): Promise<ToolResult> {
		try {
			if (name === SCRIPT_TOOL && !this.deps.allowScripts()) {
				return failure(
					"Running JavaScript in pages is turned off. The user can enable \"Allow running JavaScript in pages\" in Surfing's MCP settings.",
				);
			}
			switch (name) {
				case "tabs_list":
					return this.tabsList();
				case "tabs_create":
					return await this.tabsCreate(args);
				case "tabs_activate":
					return await this.tabsActivate(args);
				case "tabs_close":
					return this.tabsClose(args);
				case "navigate":
					return await this.navigate(args, client);
				default:
					return await this.onPage(name, args, client);
			}
		} catch (error) {
			return failure(error instanceof Error ? error.message : String(error));
		}
	}

	// Tab management

	private tabsList(): ToolResult {
		const registry = this.deps.registry;
		const blocked = this.deps.getRules().blockedSites;
		const tabs = registry.list().map((tab) => {
			let url = "";
			let title = "";
			try {
				const contents = registry.webContents(tab);
				url = contents.getURL();
				title = contents.getTitle();
			} catch {
				// A page that is going away has no details.
			}
			const hidden = isBlockedHost(hostOf(url), blocked);
			return {
				tabId: tab.id,
				title: hidden ? "(blocked)" : title,
				url: hidden ? "(blocked)" : url,
				browser: tab.kind,
				active: registry.isActive(tab),
			};
		});
		return tabs.length ? json(tabs) : text("No web tabs are open.");
	}

	private async tabsCreate(args: Args): Promise<ToolResult> {
		const raw = reqString(args, "url");
		const url = toWebUrl(raw);
		if (!url) return failure(`"${raw}" is not an http(s) URL.`);
		if (isBlockedHost(hostOf(url), this.deps.getRules().blockedSites)) {
			return failure(`${hostOf(url)} is on the blocked sites list in Surfing's MCP settings. Do not retry.`);
		}
		const active = optBool(args, "active", true);
		const tab = await this.deps.registry.open(url, active, this.deps.sessionIsolation());
		const current = this.deps.registry.webContents(tab).getURL();
		const shown = isBlockedHost(hostOf(current), this.deps.getRules().blockedSites) ? "(blocked)" : current;
		return json({ tabId: tab.id, url: shown, browser: tab.kind });
	}

	private async tabsActivate(args: Args): Promise<ToolResult> {
		const tab = this.deps.registry.resolve(this.tabIdArg(args, true));
		await this.deps.registry.activate(tab);
		return text(`Activated tab ${tab.id}.`);
	}

	private tabsClose(args: Args): ToolResult {
		const tab = this.deps.registry.resolve(this.tabIdArg(args, true));
		this.deps.indicator.unmark(tab.leaf);
		tab.leaf.detach();
		return text(`Closed tab ${tab.id}.`);
	}

	private tabIdArg(args: Args, required: boolean): number | undefined {
		const id = optNumber(args, "tabId");
		if (id === undefined && required) throw new Error("\"tabId\" is required.");
		return id;
	}

	// Navigation

	private async navigate(args: Args, client: ClientInfo): Promise<ToolResult> {
		const target = reqString(args, "url");
		const { registry } = this.deps;
		const tab = registry.resolve(this.tabIdArg(args, false));
		const contents = registry.webContents(tab);
		const history = contents.navigationHistory;

		let go: () => void | Promise<void>;
		const word = target.trim().toLowerCase();
		if (word === "back" || word === "forward" || word === "reload") {
			// These act on the page that is open now.
			const access = await this.deps.permissions.ensure(hostOf(contents.getURL()), client.name);
			if (!access.ok) return failure(access.message);
			if (word === "back") {
				if (!history.canGoBack()) return failure("There is no earlier page in this tab's history.");
				go = () => history.goBack();
			} else if (word === "forward") {
				if (!history.canGoForward()) return failure("There is no later page in this tab's history.");
				go = () => history.goForward();
			} else {
				go = () => contents.reload();
			}
		} else {
			const url = toWebUrl(target);
			if (!url) return failure(`"${target}" is not an http(s) URL (or back, forward, reload).`);
			const access = await this.deps.permissions.ensure(hostOf(url), client.name);
			if (!access.ok) return failure(access.message);
			go = () => tab.webview.loadURL(url).catch(() => undefined);
		}

		this.deps.indicator.mark(tab.leaf, hostOf(contents.getURL()));
		const loaded = watchLoad(tab.webview, contents, 15_000);
		await go();
		await loaded;
		return text(await this.locationOf(tab, contents, client));
	}

	/** "url / title" of the page now, asking for approval when it ended up on another host. */
	private async locationOf(tab: Tab, contents: Electron.WebContents, client: ClientInfo): Promise<string> {
		const url = contents.getURL();
		const host = hostOf(url);
		const access = await this.deps.permissions.ensure(host, client.name);
		if (!access.ok) return `Now at a page on ${host}: ${access.message}`;
		this.deps.indicator.mark(tab.leaf, host);
		return `url: ${url}\ntitle: ${contents.getTitle()}`;
	}

	// Tools that read or act on a page

	/** Resolve the tab and make sure the user allows this client on its site. */
	private async pageContext(args: Args, client: ClientInfo): Promise<PageContext | ToolResult> {
		const { registry, permissions, indicator } = this.deps;
		const tab = registry.resolve(this.tabIdArg(args, false));
		const contents = registry.webContents(tab);
		let host = hostOf(contents.getURL());
		// The page may navigate while the user decides: ask again for the host it ends on.
		for (let attempt = 0; attempt < 3; attempt += 1) {
			const access = await permissions.ensure(host, client.name);
			if (!access.ok) return failure(access.message);
			const now = hostOf(registry.webContents(tab).getURL());
			if (now === host) break;
			host = now;
			if (attempt === 2) return failure("The page keeps navigating; try again once it has settled.");
		}
		indicator.mark(tab.leaf, host);
		return { tab, contents, host };
	}

	/** Refuse to return data from a page that is no longer on the host that was checked. */
	private async stillOn(ctx: PageContext, url: string, client: ClientInfo): Promise<ToolResult | null> {
		const host = hostOf(url);
		if (host === ctx.host) return null;
		const access = await this.deps.permissions.ensure(host, client.name);
		return access.ok ? null : failure(access.message);
	}

	private async onPage(name: string, args: Args, client: ClientInfo): Promise<ToolResult> {
		if (TAB_MANAGEMENT_TOOLS.has(name) || !TOOLS.some((tool) => tool.name === name)) {
			return failure(`Unknown tool: ${name}`);
		}
		const resolved = await this.pageContext(args, client);
		if ("content" in resolved) return resolved;
		const ctx = resolved;

		switch (name) {
			case "read_page":
				return this.readPage(ctx, args, client);
			case "find":
				return this.find(ctx, args, client);
			case "get_page_text":
				return this.pageText(ctx, args, client);
			case "click":
				return this.click(ctx, args, client);
			case "type":
				return this.type(ctx, args, client);
			case "key":
				return this.key(ctx, args, client);
			case "scroll":
				return this.scroll(ctx, args);
			case "form_input":
				return this.formInput(ctx, args);
			case "screenshot":
				return this.screenshot(ctx, args);
			case "wait_for":
				return this.waitFor(ctx, args);
			case SCRIPT_TOOL:
				return this.script(ctx, args);
			case "console_messages":
				return this.consoleMessages(ctx, args);
			default:
				return failure(`Unknown tool: ${name}`);
		}
	}

	private async readPage(ctx: PageContext, args: Args, client: ClientInfo): Promise<ToolResult> {
		const filter = optString(args, "filter") ?? "interactive";
		if (filter !== "interactive" && filter !== "all") throw new Error("\"filter\" must be \"interactive\" or \"all\".");
		const max = optInt(args, "maxElements", 1, 2000, DEFAULT_MAX_ELEMENTS);
		const result = await snapshot(ctx.contents, filter, max);
		const denied = await this.stillOn(ctx, result.url, client);
		if (denied) return denied;
		return text(formatSnapshot(result, max));
	}

	private async find(ctx: PageContext, args: Args, client: ClientInfo): Promise<ToolResult> {
		const query = reqString(args, "query");
		const result = await callAgent(ctx.contents, "find", { query });
		const denied = await this.stillOn(ctx, result.url, client);
		if (denied) return denied;
		if (result.lines.length === 0) return text(`No elements match "${query}". Try read_page.`);
		return text(result.lines.join("\n"));
	}

	private async pageText(ctx: PageContext, args: Args, client: ClientInfo): Promise<ToolResult> {
		const max = optInt(args, "maxLength", 100, 500_000, DEFAULT_TEXT_LENGTH);
		const content = await pageContent(ctx.contents);
		const denied = await this.stillOn(ctx, content.url, client);
		if (denied) return denied;
		const body = toMarkdown(content);
		return text(`url: ${content.url}\ntitle: ${content.title}\n\n${truncate(body, max)}`);
	}

	/** What changed in the tab since `before`, as a sentence for the result. */
	private async changes(ctx: PageContext, before: string, client: ClientInfo): Promise<string> {
		await sleep(300);
		if (ctx.contents.isLoading()) await watchLoad(ctx.tab.webview, ctx.contents, 8000);
		const url = ctx.contents.getURL();
		if (url === before) return "";
		const denied = await this.stillOn(ctx, url, client);
		if (denied) return ` The page moved to another site: ${denied.content[0].type === "text" ? denied.content[0].text : ""}`;
		return ` The page is now at ${url} ("${ctx.contents.getTitle()}").`;
	}

	private async click(ctx: PageContext, args: Args, client: ClientInfo): Promise<ToolResult> {
		const ref = optString(args, "ref");
		const button = optString(args, "button") ?? "left";
		if (button !== "left" && button !== "right" && button !== "middle") {
			throw new Error("\"button\" must be left, right or middle.");
		}
		const clickCount = optInt(args, "clickCount", 1, 3, 1);
		const modifiers = toModifiers(args.modifiers);
		await this.deps.registry.ensureVisible(ctx.tab);

		let x: number;
		let y: number;
		let label: string;
		let warning = "";
		if (ref) {
			const target = await targetOf(ctx.contents, ref);
			if (target.error || target.cx === undefined || target.cy === undefined) {
				return failure(target.error ?? "The element cannot be clicked.");
			}
			x = target.cx;
			y = target.cy;
			label = ref;
			if (target.covered) warning = ` Warning: ${target.covered} was on top of the element at that point, so the click may have hit it instead.`;
		} else {
			const px = optNumber(args, "x");
			const py = optNumber(args, "y");
			if (px === undefined || py === undefined) throw new Error("Give a ref, or both x and y.");
			x = px;
			y = py;
			label = "the point";
		}
		const before = ctx.contents.getURL();
		await clickAt(ctx.contents, x, y, { button, clickCount, modifiers });
		const changed = await this.changes(ctx, before, client);
		return text(`Clicked ${label} at ${Math.round(x)},${Math.round(y)}.${warning}${changed}`);
	}

	private async type(ctx: PageContext, args: Args, client: ClientInfo): Promise<ToolResult> {
		const value = optString(args, "text");
		if (value === undefined) throw new Error("\"text\" is required.");
		const ref = optString(args, "ref");
		const submit = optBool(args, "submit", false);
		await this.deps.registry.ensureVisible(ctx.tab);

		if (ref) {
			const target = await targetOf(ctx.contents, ref);
			if (target.error || target.cx === undefined || target.cy === undefined) {
				return failure(target.error ?? "The element cannot be focused.");
			}
			if (!target.editable) {
				return failure(
					`${ref} is ${target.described ?? "not a text field"}, not a text field. Pass the ref of an input, textarea or editable element (nothing was clicked).`,
				);
			}
			await clickAt(ctx.contents, target.cx, target.cy, { button: "left", clickCount: 1, modifiers: [] });
		}
		let focus = await callAgent(ctx.contents, "focus", ref ? { ref } : {});
		if (focus.error) return failure(focus.error);
		if (!focus.editable && ref) focus = await callAgent(ctx.contents, "focus", { ref });
		if (!focus.editable) {
			return failure(
				`Nothing editable has focus (${focus.described}). Pass the ref of a text field, or click one first.`,
			);
		}
		const before = ctx.contents.getURL();
		await insertText(ctx.contents, value);
		if (submit) {
			await pressKeys(ctx.contents, "Enter");
		}
		const changed = submit ? await this.changes(ctx, before, client) : "";
		return text(`Typed ${value.length} character(s) into ${focus.described}.${submit ? " Pressed Enter." : ""}${changed}`);
	}

	private async key(ctx: PageContext, args: Args, client: ClientInfo): Promise<ToolResult> {
		const keys = reqString(args, "keys");
		await this.deps.registry.ensureVisible(ctx.tab);
		const before = ctx.contents.getURL();
		const count = await pressKeys(ctx.contents, keys);
		const changed = await this.changes(ctx, before, client);
		return text(`Pressed ${count} key(s): ${keys}.${changed}`);
	}

	private async scroll(ctx: PageContext, args: Args): Promise<ToolResult> {
		const ref = optString(args, "ref");
		if (ref) {
			const result = await callAgent(ctx.contents, "scrollRef", { ref });
			if (result.error || !result.state) return failure(result.error ?? "Could not scroll.");
			return text(`Scrolled ${ref} into view; ${formatScroll(result.state)}.`);
		}
		const direction = optString(args, "direction") ?? "down";
		if (direction !== "up" && direction !== "down" && direction !== "left" && direction !== "right") {
			throw new Error("\"direction\" must be up, down, left or right.");
		}
		const amount = optNumber(args, "amount") ?? 3;
		await this.deps.registry.ensureVisible(ctx.tab);
		const state = await wheelScroll(ctx.contents, direction, amount);
		return text(`Scrolled ${direction}; ${formatScroll(state)}.`);
	}

	private async formInput(ctx: PageContext, args: Args): Promise<ToolResult> {
		const ref = reqString(args, "ref");
		const value = args.value;
		if (typeof value !== "string" && typeof value !== "boolean" && typeof value !== "number") {
			throw new Error("\"value\" must be a string, number or boolean.");
		}
		const result = await callAgent(ctx.contents, "setValue", { ref, value });
		if (result.error) return failure(result.error);
		return text(`${ref}: ${result.described ?? "done"}.`);
	}

	private async screenshot(ctx: PageContext, args: Args): Promise<ToolResult> {
		const ref = optString(args, "ref");
		const fullPage = optBool(args, "fullPage", false);
		await this.deps.registry.ensureVisible(ctx.tab);
		let shot;
		if (ref) {
			const target = await targetOf(ctx.contents, ref);
			if (target.error || !target.box) return failure(target.error ?? "The element cannot be captured.");
			await sleep(100);
			shot = await capture(ctx.contents, target.box);
		} else if (fullPage) {
			try {
				shot = await captureFullPage(ctx.contents);
			} catch {
				shot = await capture(ctx.contents, null);
				shot.note = "Full-page capture is not available for this tab; captured the viewport instead.";
			}
		} else {
			shot = await capture(ctx.contents, null);
		}
		return {
			content: [
				{ type: "image", data: shot.data, mimeType: shot.mimeType },
				{ type: "text", text: `Screenshot ${shot.width}x${shot.height}${shot.note ? ". " + shot.note : ""}` },
			],
		};
	}

	private async waitFor(ctx: PageContext, args: Args): Promise<ToolResult> {
		const wantedText = optString(args, "text");
		const ref = optString(args, "ref");
		const urlIncludes = optString(args, "urlIncludes");
		if (wantedText === undefined && ref === undefined && urlIncludes === undefined) {
			throw new Error("Give text, ref or urlIncludes to wait for.");
		}
		const timeout = optInt(args, "timeoutMs", 100, 60_000, 10_000);
		const start = Date.now();
		while (Date.now() - start < timeout) {
			let met = true;
			if (urlIncludes !== undefined && !ctx.contents.getURL().includes(urlIncludes)) met = false;
			if (met && hostOf(ctx.contents.getURL()) !== ctx.host) {
				return failure("The page moved to another site while waiting; call read_page.");
			}
			if (met && wantedText !== undefined) met = await callAgent(ctx.contents, "check", { text: wantedText });
			if (met && ref !== undefined) met = await callAgent(ctx.contents, "check", { ref });
			if (met) return text(`Condition met after ${Date.now() - start} ms.`);
			await sleep(250);
		}
		return failure(`Timed out after ${timeout} ms.`);
	}

	private async script(ctx: PageContext, args: Args): Promise<ToolResult> {
		const code = reqString(args, "code");
		const result: unknown = await ctx.contents.executeJavaScript(code, true);
		let out: string;
		try {
			out = JSON.stringify(result) ?? "undefined";
		} catch {
			out = String(result);
		}
		return text(truncate(out, MAX_SCRIPT_RESULT));
	}

	private consoleMessages(ctx: PageContext, args: Args): ToolResult {
		const levels = ["verbose", "info", "warning", "error"];
		const level = optString(args, "level");
		if (level !== undefined && !levels.includes(level)) throw new Error("\"level\" must be verbose, info, warning or error.");
		const pattern = optString(args, "pattern")?.toLowerCase();
		const clear = optBool(args, "clear", false);
		const buffer = this.deps.registry.consoleOf(ctx.tab);
		const minimum = level ? levels.indexOf(level) : 0;
		const lines = buffer
			.filter((entry) => levels.indexOf(entry.level) >= minimum)
			.filter((entry) => !pattern || entry.text.toLowerCase().includes(pattern))
			.map((entry) => `[${entry.level}] ${entry.text}${entry.source ? "  (" + entry.source + ")" : ""}`);
		if (clear) buffer.length = 0;
		return text(lines.length ? lines.join("\n") : "No console messages.");
	}
}
