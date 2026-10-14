// Page automation for one tab: run the page-side agent in an isolated world,
// send trusted input with sendInputEvent / insertText, capture screenshots.
import { nativeImage } from "electron";
import type * as Electron from "electron";
import Defuddle from "defuddle";
import { KeyModifier, parseKeys } from "./keys";
import {
	AGENT_GLOBAL,
	ContentResult,
	installAgent,
	PageAgent,
	ScrollState,
	SnapshotResult,
	TargetResult,
} from "./pageAgent";
import { sleep } from "./tabs";

/** The isolated world the page agent lives in; page scripts cannot reach it. */
export const WORLD_ID = 1013;

const SCREENSHOT_MAX_SIDE = 1280;
const FULL_PAGE_MAX_HEIGHT = 2600;
const SMALL_SCREENSHOT_PIXELS = 300 * 300;

type AgentMethod = keyof PageAgent;
type AgentArgs<M extends AgentMethod> = Parameters<PageAgent[M]>[0];
type AgentResult<M extends AgentMethod> = ReturnType<PageAgent[M]>;

/** Call a method of the page-side agent and get its (JSON) result. */
export async function callAgent<M extends AgentMethod>(
	contents: Electron.WebContents,
	method: M,
	args?: AgentArgs<M>,
): Promise<AgentResult<M>> {
	const code =
		`(${installAgent.toString()})();` +
		`JSON.stringify(globalThis.${AGENT_GLOBAL}.${method}(${JSON.stringify(args ?? {})}))`;
	const raw: unknown = await contents.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code }]);
	if (typeof raw !== "string") throw new Error("The page did not answer. It may still be loading.");
	const parsed: unknown = JSON.parse(raw);
	return parsed as AgentResult<M>;
}

export function snapshot(
	contents: Electron.WebContents,
	filter: "interactive" | "all",
	max: number,
): Promise<SnapshotResult> {
	return callAgent(contents, "snapshot", { filter, max });
}

/** read_page's text from a snapshot. */
export function formatSnapshot(result: SnapshotResult, max: number): string {
	const header = [
		`url: ${result.url}`,
		`title: ${result.title}`,
		`scroll: ${result.scroll.x},${result.scroll.y} of ${result.scroll.width}x${result.scroll.height}`,
		`viewport: ${result.viewport.width}x${result.viewport.height}`,
	];
	if (result.crossOriginFrames > 0) {
		header.push(`note: ${result.crossOriginFrames} cross-origin frame(s) are not readable`);
	}
	const body = result.lines.length ? result.lines : ["(no matching elements)"];
	const more = result.total - result.lines.length;
	if (more > 0) {
		body.push(`... ${more} more element(s) not shown (maxElements=${max}); scroll or use find to narrow down.`);
	}
	return header.join("\n") + "\n\n" + body.join("\n");
}

export function pageContent(contents: Electron.WebContents): Promise<ContentResult> {
	return callAgent(contents, "content");
}

/** The main content as Markdown through Defuddle; falls back to the visible text. */
export function toMarkdown(content: ContentResult): string {
	try {
		const doc = new DOMParser().parseFromString(content.html, "text/html");
		const base = doc.createElement("base");
		base.href = content.url;
		doc.head.prepend(base);
		const result = new Defuddle(doc, { url: content.url, markdown: true }).parse();
		const markdown = (result.content || "").trim();
		// Defuddle hands back raw HTML when it finds no article to convert.
		if (markdown.length > 80 && !markdown.startsWith("<")) return markdown;
	} catch {
		// Fall through to the plain text.
	}
	return content.text.trim();
}

function zoomOf(contents: Electron.WebContents): number {
	const zoom = contents.getZoomFactor();
	return zoom > 0 ? zoom : 1;
}

const MODIFIER_NAMES: Record<string, KeyModifier> = {
	shift: "shift",
	ctrl: "control",
	control: "control",
	alt: "alt",
	meta: "meta",
	cmd: "meta",
};

export function toModifiers(names: unknown): KeyModifier[] {
	if (!Array.isArray(names)) return [];
	const out: KeyModifier[] = [];
	for (const name of names) {
		const modifier = typeof name === "string" ? MODIFIER_NAMES[name.toLowerCase()] : undefined;
		if (!modifier) throw new Error(`Unknown modifier ${JSON.stringify(name)}. Use shift, ctrl, alt or meta.`);
		if (!out.includes(modifier)) out.push(modifier);
	}
	return out;
}

/** A real mouse click at viewport coordinates (CSS pixels). */
export async function clickAt(
	contents: Electron.WebContents,
	cssX: number,
	cssY: number,
	options: { button: "left" | "right" | "middle"; clickCount: number; modifiers: KeyModifier[] },
): Promise<void> {
	const zoom = zoomOf(contents);
	const x = Math.round(cssX * zoom);
	const y = Math.round(cssY * zoom);
	const { button, modifiers } = options;
	contents.sendInputEvent({ type: "mouseMove", x, y, modifiers });
	await sleep(15);
	for (let count = 1; count <= options.clickCount; count += 1) {
		contents.sendInputEvent({ type: "mouseDown", x, y, button, clickCount: count, modifiers });
		await sleep(15);
		contents.sendInputEvent({ type: "mouseUp", x, y, button, clickCount: count, modifiers });
		await sleep(15);
	}
}

export async function pressKeys(contents: Electron.WebContents, keys: string): Promise<number> {
	const presses = parseKeys(keys);
	for (const press of presses) {
		for (const event of press.events) {
			contents.sendInputEvent(event);
		}
		await sleep(20);
	}
	return presses.length;
}

export async function insertText(contents: Electron.WebContents, text: string): Promise<void> {
	await contents.insertText(text);
}

/** Scroll with the mouse wheel at the viewport centre; falls back to scrollBy. */
export async function wheelScroll(
	contents: Electron.WebContents,
	direction: "up" | "down" | "left" | "right",
	ticks: number,
): Promise<ScrollState> {
	const before = await callAgent(contents, "scrollState");
	const pixels = Math.round(Math.max(0.1, Math.min(ticks, 100)) * 100);
	const dx = direction === "left" ? -pixels : direction === "right" ? pixels : 0;
	const dy = direction === "up" ? -pixels : direction === "down" ? pixels : 0;
	const zoom = zoomOf(contents);
	const x = Math.round((before.viewportWidth / 2) * zoom);
	const y = Math.round((before.viewportHeight / 2) * zoom);
	// Electron's wheel deltas point the way the content moves: scrolling down is negative.
	contents.sendInputEvent({
		type: "mouseWheel",
		x,
		y,
		deltaX: -dx,
		deltaY: -dy,
		wheelTicksX: -dx / 100,
		wheelTicksY: -dy / 100,
		canScroll: true,
	});
	await sleep(250);
	let after = await callAgent(contents, "scrollState");
	if (after.x === before.x && after.y === before.y) {
		// Nothing moved (a scroller the wheel did not reach, or smooth scrolling is off):
		// scroll the document directly.
		after = await callAgent(contents, "scrollBy", { dx, dy });
	}
	return after;
}

export interface Shot {
	data: string;
	mimeType: string;
	width: number;
	height: number;
	note?: string;
}

/** Capture the viewport (or a rectangle in it), scaled to at most 1280 px on the long side. */
export async function capture(
	contents: Electron.WebContents,
	rect: { x: number; y: number; w: number; h: number } | null,
): Promise<Shot> {
	const zoom = zoomOf(contents);
	const area = rect
		? {
				x: Math.max(0, Math.round(rect.x * zoom)),
				y: Math.max(0, Math.round(rect.y * zoom)),
				width: Math.max(1, Math.round(rect.w * zoom)),
				height: Math.max(1, Math.round(rect.h * zoom)),
			}
		: undefined;
	const image = await contents.capturePage(area);
	if (image.isEmpty()) throw new Error("The capture came back empty (is the tab visible?).");
	return encode(image);
}

function encode(image: Electron.NativeImage): Shot {
	const size = image.getSize();
	const longest = Math.max(size.width, size.height);
	let scaled = image;
	if (longest > SCREENSHOT_MAX_SIDE) {
		const factor = SCREENSHOT_MAX_SIDE / longest;
		scaled = image.resize({
			width: Math.max(1, Math.round(size.width * factor)),
			height: Math.max(1, Math.round(size.height * factor)),
			quality: "good",
		});
	}
	const out = scaled.getSize();
	const small = out.width * out.height <= SMALL_SCREENSHOT_PIXELS;
	const bytes = small ? scaled.toPNG() : scaled.toJPEG(80);
	return {
		data: Buffer.from(bytes).toString("base64"),
		mimeType: small ? "image/png" : "image/jpeg",
		width: out.width,
		height: out.height,
	};
}

/** Capture the whole scrollable page through the DevTools protocol. */
export async function captureFullPage(contents: Electron.WebContents): Promise<Shot> {
	const state = await callAgent(contents, "scrollState");
	// A very tall page would shrink to an unreadable strip at 1280 px: take the top of it.
	const height = Math.min(Math.max(state.height, state.viewportHeight), FULL_PAGE_MAX_HEIGHT);
	const width = Math.max(state.viewportWidth, Math.min(state.width, 2 * state.viewportWidth));
	const attachedByUs = !contents.debugger.isAttached();
	if (attachedByUs) contents.debugger.attach("1.3");
	try {
		const result: unknown = await contents.debugger.sendCommand("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: true,
			clip: { x: 0, y: 0, width, height, scale: 1 },
		});
		const data = isRecord(result) && typeof result.data === "string" ? result.data : "";
		if (!data) throw new Error("The full-page capture returned nothing.");
		const shot = encode(nativeImage.createFromBuffer(Buffer.from(data, "base64")));
		if (state.height > height) {
			shot.note = `The page is ${state.height} px tall; captured the first ${height} px. Scroll and take another screenshot for the rest.`;
		}
		return shot;
	} finally {
		if (attachedByUs && contents.debugger.isAttached()) contents.debugger.detach();
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export async function targetOf(contents: Electron.WebContents, ref: string): Promise<TargetResult> {
	return callAgent(contents, "target", { ref });
}
