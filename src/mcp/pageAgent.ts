// The code the MCP server runs inside web pages.
//
// `installAgent` is serialised with Function.prototype.toString and executed
// in an isolated world of the page (see page.ts), so it must be entirely
// self-contained: nothing from this module's scope may be referenced inside
// it. The page's own scripts cannot see an isolated world's globals, so they
// cannot read or tamper with the ref -> element map kept here; the DOM itself
// is shared, so events dispatched from here reach the page.

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface SnapshotResult {
	url: string;
	title: string;
	scroll: { x: number; y: number; width: number; height: number };
	viewport: { width: number; height: number };
	lines: string[];
	total: number;
	crossOriginFrames: number;
}

export interface TargetResult {
	error?: string;
	box?: Box;
	/** Centre of the visible part of the element, in viewport coordinates. */
	cx?: number;
	cy?: number;
	/** What sits on top of the element's centre when it is not the element. */
	covered?: string;
	/** Can text be typed into the element (or something inside it)? */
	editable?: boolean;
	/** The element as a short tag description, for messages. */
	described?: string;
}

export interface ScrollState {
	x: number;
	y: number;
	width: number;
	height: number;
	viewportWidth: number;
	viewportHeight: number;
}

export interface ContentResult {
	url: string;
	title: string;
	html: string;
	text: string;
}

export interface SetValueResult {
	error?: string;
	described?: string;
}

export interface FocusResult {
	error?: string;
	/** Is an editable element focused now? */
	editable: boolean;
	described: string;
}

/** The methods the page-side agent offers; arguments and results are JSON. */
export interface PageAgent {
	snapshot(args: { filter: "interactive" | "all"; max: number }): SnapshotResult;
	find(args: { query: string }): { lines: string[]; url: string; title: string };
	target(args: { ref: string }): TargetResult;
	focus(args: { ref?: string }): FocusResult;
	setValue(args: { ref: string; value: string | boolean | number }): SetValueResult;
	check(args: { text?: string; ref?: string }): boolean;
	scrollState(): ScrollState;
	scrollRef(args: { ref: string }): { error?: string; state?: ScrollState };
	scrollBy(args: { dx: number; dy: number }): ScrollState;
	content(): ContentResult;
}

export const AGENT_GLOBAL = "__surfingMcp";

export function installAgent(): void {
	const holder = globalThis as unknown as Record<string, PageAgent | undefined>;
	if (holder.__surfingMcp) return;

	let refs = new Map<string, WeakRef<Element>>();
	let reverse = new WeakMap<Element, string>();
	let counter = 0;

	const SKIPPED = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "TITLE", "BASE"]);
	const INTERACTIVE_ROLES = new Set([
		"button", "link", "checkbox", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "option",
		"switch", "textbox", "combobox", "searchbox", "radio", "slider", "spinbutton", "treeitem",
	]);
	const STRUCTURAL = new Set([
		"NAV", "MAIN", "HEADER", "FOOTER", "ASIDE", "FORM", "TABLE", "UL", "OL", "SECTION", "ARTICLE", "FIGURE", "DIALOG",
	]);
	const TEXTUAL = new Set([
		"H1", "H2", "H3", "H4", "H5", "H6", "P", "LI", "TD", "TH", "LABEL", "LEGEND", "CAPTION", "FIGCAPTION",
		"BLOCKQUOTE", "DT", "DD", "SUMMARY", "PRE", "IMG",
	]);
	const TAG_ROLES: Record<string, string> = {
		A: "link", BUTTON: "button", TEXTAREA: "textbox", IMG: "img", NAV: "navigation", MAIN: "main",
		HEADER: "banner", FOOTER: "contentinfo", ASIDE: "complementary", FORM: "form", TABLE: "table",
		UL: "list", OL: "list", LI: "listitem", P: "paragraph", TD: "cell", TH: "columnheader",
		SECTION: "region", ARTICLE: "article", SUMMARY: "button", LABEL: "label", BLOCKQUOTE: "blockquote",
		PRE: "code", DT: "term", DD: "definition", FIGURE: "figure", FIGCAPTION: "caption", LEGEND: "legend",
		CAPTION: "caption", DIALOG: "dialog", H1: "heading", H2: "heading", H3: "heading", H4: "heading",
		H5: "heading", H6: "heading", VIDEO: "video", AUDIO: "audio",
	};

	const clip = (text: string, max: number): string => {
		const flat = text.replace(/\s+/g, " ").trim();
		return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
	};

	const quote = (text: string): string => JSON.stringify(text);

	const roleOf = (el: Element): string => {
		const explicit = el.getAttribute("role");
		if (explicit) return explicit.trim().split(/\s+/)[0];
		const tag = el.tagName;
		if (tag === "INPUT") {
			const type = ((el as HTMLInputElement).type || "text").toLowerCase();
			if (type === "checkbox" || type === "radio") return type;
			if (type === "button" || type === "submit" || type === "reset" || type === "image") return "button";
			if (type === "range") return "slider";
			if (type === "number") return "spinbutton";
			if (type === "search") return "searchbox";
			if (type === "file") return "file input";
			return "textbox";
		}
		if (tag === "SELECT") {
			const select = el as HTMLSelectElement;
			return select.multiple || select.size > 1 ? "listbox" : "combobox";
		}
		if (tag === "A") return el.hasAttribute("href") ? "link" : "generic";
		if ((el as HTMLElement).isContentEditable === true) return "textbox";
		return TAG_ROLES[tag] ?? "generic";
	};

	const isVisible = (el: Element): boolean => {
		const view = el.ownerDocument.defaultView;
		if (!view) return false;
		const style = view.getComputedStyle(el);
		if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
		const rect = el.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return false;
		if (el.closest("[aria-hidden=\"true\"]")) return false;
		return true;
	};

	/** The box of an element in the top window's viewport, through iframes. */
	const boxOf = (el: Element): Box => {
		const rect = el.getBoundingClientRect();
		let x = rect.left;
		let y = rect.top;
		let view: Window | null = el.ownerDocument.defaultView;
		while (view && view.frameElement) {
			const frame = view.frameElement;
			const frameRect = frame.getBoundingClientRect();
			x += frameRect.left + frame.clientLeft;
			y += frameRect.top + frame.clientTop;
			view = view.parent;
		}
		return { x: Math.round(x), y: Math.round(y), w: Math.round(rect.width), h: Math.round(rect.height) };
	};

	const ownText = (el: Element): string => {
		let out = "";
		for (const node of Array.from(el.childNodes)) {
			if (node.nodeType === 3) out += node.textContent ?? "";
		}
		return out;
	};

	const textOf = (el: Element): string => {
		const inner = (el as HTMLElement).innerText;
		return inner || el.textContent || "";
	};

	const labelledBy = (el: Element): string => {
		const ids = el.getAttribute("aria-labelledby");
		if (!ids) return "";
		const doc = el.ownerDocument;
		return ids
			.split(/\s+/)
			.map((id) => {
				const target = doc.getElementById(id);
				return target ? textOf(target) : "";
			})
			.join(" ");
	};

	const nameOf = (el: Element, role: string): string => {
		const aria = el.getAttribute("aria-label");
		if (aria && aria.trim()) return clip(aria, 80);
		const labelled = labelledBy(el);
		if (labelled.trim()) return clip(labelled, 80);
		const tag = el.tagName;
		if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
			const field = el as HTMLInputElement;
			const type = (field.type || "").toLowerCase();
			if (tag === "INPUT" && (type === "button" || type === "submit" || type === "reset")) {
				return clip(field.value || (type === "submit" ? "Submit" : type === "reset" ? "Reset" : ""), 80);
			}
			if (tag === "INPUT" && type === "image") return clip(field.alt || field.value || "", 80);
			const labels = field.labels ? Array.from(field.labels).map((label) => textOf(label)).join(" ") : "";
			if (labels.trim()) return clip(labels, 80);
			if (field.title) return clip(field.title, 80);
			return clip(field.placeholder || field.name || "", 80);
		}
		if (tag === "IMG") return clip((el as HTMLImageElement).alt || el.getAttribute("title") || "", 80);
		if (STRUCTURAL.has(tag)) return "";
		if (role === "generic") return clip(ownText(el), 80);
		const text = textOf(el);
		if (text.trim()) return clip(text, 80);
		const title = el.getAttribute("title");
		if (title) return clip(title, 80);
		// An icon-only link or button: look for an image inside.
		const img = el.querySelector("img[alt], svg title");
		return img ? clip(img.getAttribute("alt") || img.textContent || "", 80) : "";
	};

	const stateOf = (el: Element, role: string): string[] => {
		const state: string[] = [];
		const tag = el.tagName;
		if (/^H[1-6]$/.test(tag)) state.push("level " + tag[1]);
		if (tag === "A") {
			const href = (el as HTMLAnchorElement).href;
			if (href) state.push("href=" + clip(href, 100));
		}
		if (tag === "INPUT" || tag === "TEXTAREA") {
			const field = el as HTMLInputElement;
			const type = (field.type || "").toLowerCase();
			if (type === "checkbox" || type === "radio") {
				state.push(field.checked ? "checked" : "unchecked");
			} else if (type !== "button" && type !== "submit" && type !== "reset" && type !== "image" && type !== "file") {
				const value = type === "password" ? (field.value ? "••••" : "") : field.value;
				if (value) state.push("value=" + quote(clip(value, 60)));
				if (tag === "INPUT" && type && type !== "text" && type !== "textarea") state.push("type=" + type);
			}
			if (field.required) state.push("required");
			if (field.readOnly) state.push("readonly");
		} else if (tag === "SELECT") {
			const select = el as HTMLSelectElement;
			const chosen = Array.from(select.selectedOptions).map((option) => option.text.trim());
			if (chosen.length) state.push("value=" + quote(clip(chosen.join(", "), 60)));
			if (select.required) state.push("required");
		} else if ((el as HTMLElement).isContentEditable === true) {
			const value = clip((el as HTMLElement).innerText || "", 60);
			if (value) state.push("value=" + quote(value));
		}
		if (role === "checkbox" || role === "switch" || role === "radio") {
			const checked = el.getAttribute("aria-checked");
			if (checked) state.push(checked === "true" ? "checked" : checked === "mixed" ? "mixed" : "unchecked");
		}
		const expanded = el.getAttribute("aria-expanded");
		if (expanded) state.push(expanded === "true" ? "expanded" : "collapsed");
		const pressed = el.getAttribute("aria-pressed");
		if (pressed === "true") state.push("pressed");
		const selected = el.getAttribute("aria-selected");
		if (selected === "true") state.push("selected");
		if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") state.push("disabled");
		if (el.ownerDocument.activeElement === el) state.push("focused");
		return state;
	};

	const isInteractive = (el: Element): boolean => {
		const tag = el.tagName;
		if (tag === "A" || tag === "AREA") return el.hasAttribute("href");
		if (tag === "BUTTON" || tag === "SELECT" || tag === "TEXTAREA" || tag === "SUMMARY") return true;
		if (tag === "INPUT") return (el as HTMLInputElement).type !== "hidden";
		if ((tag === "VIDEO" || tag === "AUDIO") && el.hasAttribute("controls")) return true;
		const role = el.getAttribute("role");
		if (role && INTERACTIVE_ROLES.has(role.trim().split(/\s+/)[0])) return true;
		const editable = el.getAttribute("contenteditable");
		if (editable !== null && editable !== "false") return true;
		if (el.hasAttribute("onclick")) return true;
		const tabindex = el.getAttribute("tabindex");
		return tabindex !== null && parseInt(tabindex, 10) >= 0;
	};

	const isDescriptive = (el: Element): boolean => {
		const tag = el.tagName;
		if (STRUCTURAL.has(tag) || TEXTUAL.has(tag)) return true;
		if (el.hasAttribute("role")) return true;
		return ownText(el).trim().length > 0;
	};

	let crossOrigin = 0;

	/** Visit candidate elements in document order, through shadow roots and same-origin frames. */
	const walk = (parent: ParentNode, visit: (el: Element) => boolean): boolean => {
		for (const el of Array.from(parent.children)) {
			if (SKIPPED.has(el.tagName)) continue;
			if (!visit(el)) return false;
			if (el.shadowRoot && !walk(el.shadowRoot, visit)) return false;
			if (el.tagName === "IFRAME" || el.tagName === "FRAME") {
				let inner: Document | null = null;
				try {
					inner = (el as HTMLIFrameElement).contentDocument;
				} catch {
					inner = null;
				}
				if (inner && inner.documentElement) {
					if (!walk(inner, visit)) return false;
				} else {
					crossOrigin += 1;
				}
			} else if (!walk(el, visit)) {
				return false;
			}
		}
		return true;
	};

	const register = (el: Element): string => {
		let ref = reverse.get(el);
		if (!ref) {
			counter += 1;
			ref = "e" + counter;
			reverse.set(el, ref);
			refs.set(ref, new WeakRef(el));
		}
		return ref;
	};

	const lookup = (ref: string): Element | null => {
		const el = refs.get(ref)?.deref();
		return el && el.isConnected ? el : null;
	};

	const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

	const describeLine = (el: Element, role: string): string => {
		const box = boxOf(el);
		const name = nameOf(el, role);
		const state = stateOf(el, role);
		const view = viewport();
		if (box.x + box.w <= 0 || box.y + box.h <= 0 || box.x >= view.width || box.y >= view.height) {
			state.push("offscreen");
		}
		const parts = ["[" + register(el) + "]", role];
		if (name) parts.push(quote(name));
		if (state.length) parts.push("(" + state.join(", ") + ")");
		parts.push("@" + box.x + "," + box.y + "," + box.w + "," + box.h);
		return parts.join(" ");
	};

	const describeNode = (el: Element): string => {
		const tag = el.tagName.toLowerCase();
		const id = el.id ? "#" + el.id : "";
		const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/)[0] : "";
		return "<" + tag + id + cls + ">";
	};

	const NON_TEXT_INPUTS = ["button", "submit", "reset", "checkbox", "radio", "image", "file", "range", "color", "hidden"];

	const isTextField = (el: Element): boolean => {
		const tag = el.tagName;
		if (tag === "TEXTAREA") return true;
		if (tag === "INPUT") return !NON_TEXT_INPUTS.includes((el as HTMLInputElement).type);
		return (el as HTMLElement).isContentEditable === true;
	};

	/** Is this a text field, or does it hold one (a styled wrapper around an input)? */
	const isEditable = (el: Element): boolean => {
		if (isTextField(el)) return true;
		const role = el.getAttribute("role");
		if (role === "textbox" || role === "searchbox" || role === "combobox") return true;
		return Array.from(el.querySelectorAll("input, textarea, [contenteditable]")).some(isTextField);
	};

	const scrollState = (): ScrollState => {
		const root = document.documentElement;
		return {
			x: Math.round(window.scrollX),
			y: Math.round(window.scrollY),
			width: root.scrollWidth,
			height: root.scrollHeight,
			viewportWidth: window.innerWidth,
			viewportHeight: window.innerHeight,
		};
	};

	const agent: PageAgent = {
		snapshot({ filter, max }) {
			// A new snapshot invalidates the previous refs.
			refs = new Map();
			reverse = new WeakMap();
			counter = 0;
			crossOrigin = 0;
			const lines: string[] = [];
			let total = 0;
			walk(document, (el) => {
				const interactive = isInteractive(el);
				if (!interactive && (filter !== "all" || !isDescriptive(el))) return true;
				if (!isVisible(el)) return true;
				const role = roleOf(el);
				if (!interactive && role === "generic" && !ownText(el).trim()) return true;
				total += 1;
				if (lines.length < max) lines.push(describeLine(el, role));
				return total < max + 2000;
			});
			const state = scrollState();
			return {
				url: location.href,
				title: document.title,
				scroll: { x: state.x, y: state.y, width: state.width, height: state.height },
				viewport: viewport(),
				lines,
				total,
				crossOriginFrames: crossOrigin,
			};
		},

		find({ query }) {
			const words = query.toLowerCase().split(/\s+/).filter(Boolean);
			const scored: { score: number; el: Element; role: string }[] = [];
			if (words.length) {
				walk(document, (el) => {
					const interactive = isInteractive(el);
					if (!interactive && !isDescriptive(el)) return true;
					const role = roleOf(el);
					const name = nameOf(el, role);
					const field = el as HTMLInputElement;
					const hay = [name, role, field.placeholder || "", field.name || "", el.getAttribute("title") || "", el.id || ""]
						.join(" ")
						.toLowerCase();
					let score = 0;
					for (const word of words) if (hay.includes(word)) score += 1;
					if (score === 0) return true;
					if (!isVisible(el)) return true;
					if (name.toLowerCase().includes(query.toLowerCase())) score += 2;
					if (interactive) score += 1;
					score -= Math.min(name.length, 200) / 1000;
					scored.push({ score, el, role });
					return scored.length < 3000;
				});
			}
			scored.sort((a, b) => b.score - a.score);
			return {
				url: location.href,
				title: document.title,
				lines: scored.slice(0, 20).map((entry) => describeLine(entry.el, entry.role)),
			};
		},

		target({ ref }) {
			const el = lookup(ref);
			if (!el) return { error: "Unknown or stale ref \"" + ref + "\". Call read_page again." };
			el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
			const box = boxOf(el);
			const view = viewport();
			const left = Math.max(0, box.x);
			const top = Math.max(0, box.y);
			const right = Math.min(view.width, box.x + box.w);
			const bottom = Math.min(view.height, box.y + box.h);
			if (right <= left || bottom <= top || box.w <= 0 || box.h <= 0) {
				return { error: "The element is not visible in the viewport (hidden, or zero size)." };
			}
			const cx = Math.round((left + right) / 2);
			const cy = Math.round((top + bottom) / 2);
			const result: TargetResult = { box, cx, cy, editable: isEditable(el), described: describeNode(el) };
			if (el.ownerDocument === document) {
				const hit = document.elementFromPoint(cx, cy);
				if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
					result.covered = describeNode(hit);
				}
			}
			return result;
		},

		focus({ ref }) {
			let el: Element | null = null;
			if (ref) {
				el = lookup(ref);
				if (!el) return { error: "Unknown or stale ref \"" + ref + "\". Call read_page again.", editable: false, described: "" };
				const active = el.ownerDocument.activeElement;
				if (active !== el && !el.contains(active)) {
					(el as HTMLElement).focus({ preventScroll: true });
				}
			}
			let active: Element | null = document.activeElement;
			// Descend into frames and shadow roots to the element that really has focus.
			for (let depth = 0; depth < 8 && active; depth += 1) {
				const frameDoc = active.tagName === "IFRAME" ? (active as HTMLIFrameElement).contentDocument : null;
				if (frameDoc?.activeElement) {
					active = frameDoc.activeElement;
				} else if (active.shadowRoot?.activeElement) {
					active = active.shadowRoot.activeElement;
				} else break;
			}
			const tag = active ? active.tagName : "";
			const editable =
				!!active &&
				(tag === "TEXTAREA" ||
					(tag === "INPUT" && !["button", "submit", "reset", "checkbox", "radio", "image", "file", "range", "color"].includes((active as HTMLInputElement).type)) ||
					(active as HTMLElement).isContentEditable === true);
			return { editable, described: active ? describeNode(active) : "nothing" };
		},

		setValue({ ref, value }) {
			const el = lookup(ref);
			if (!el) return { error: "Unknown or stale ref \"" + ref + "\". Call read_page again." };
			const view = el.ownerDocument.defaultView;
			if (!view) return { error: "The element is not in a page." };
			const fire = (type: string) => el.dispatchEvent(new view.Event(type, { bubbles: true }));
			if (el instanceof view.HTMLSelectElement) {
				const wanted = String(value);
				const options = Array.from(el.options);
				const match =
					options.find((option) => option.value === wanted) ??
					options.find((option) => option.text.trim() === wanted.trim()) ??
					options.find((option) => option.text.trim().toLowerCase() === wanted.trim().toLowerCase());
				if (!match) {
					return { error: "No option \"" + wanted + "\". Options: " + options.map((o) => quote(o.text.trim())).join(", ") };
				}
				el.value = match.value;
				fire("input");
				fire("change");
				return { described: "selected " + quote(match.text.trim()) };
			}
			if (el instanceof view.HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
				const wanted = value === true || value === "true";
				if (el.checked !== wanted) el.click();
				return { described: el.type + " is now " + (el.checked ? "checked" : "unchecked") };
			}
			if (el instanceof view.HTMLInputElement || el instanceof view.HTMLTextAreaElement) {
				// The native setter, so frameworks that track the value notice the change.
				const proto = el instanceof view.HTMLInputElement ? view.HTMLInputElement.prototype : view.HTMLTextAreaElement.prototype;
				// (Reflect.set with the element as receiver runs the prototype's setter on it.)
				if (!Reflect.set(proto, "value", String(value), el)) el.value = String(value);
				fire("input");
				fire("change");
				return { described: "value set" };
			}
			if (el instanceof view.HTMLElement && el.isContentEditable) {
				el.textContent = String(value);
				fire("input");
				return { described: "text set" };
			}
			return { error: "The element is not a form control (" + describeNode(el) + ")." };
		},

		check({ text, ref }) {
			if (ref) {
				const el = lookup(ref);
				return !!el && isVisible(el);
			}
			if (text) {
				const body = document.body;
				const hay = body ? body.innerText || body.textContent || "" : "";
				return hay.toLowerCase().includes(text.toLowerCase());
			}
			return false;
		},

		scrollState,

		scrollRef({ ref }) {
			const el = lookup(ref);
			if (!el) return { error: "Unknown or stale ref \"" + ref + "\". Call read_page again." };
			el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
			return { state: scrollState() };
		},

		scrollBy({ dx, dy }) {
			window.scrollBy({ left: dx, top: dy, behavior: "instant" });
			return scrollState();
		},

		content() {
			const body = document.body;
			return {
				url: location.href,
				title: document.title,
				html: document.documentElement.outerHTML,
				text: body ? body.innerText || body.textContent || "" : "",
			};
		},
	};

	holder.__surfingMcp = agent;
}
