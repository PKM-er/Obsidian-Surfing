import type {
	AssistantAction,
	AssistantPageContext,
	AssistantHost,
} from "./AIAssistantSidebar";
import { t } from "../translations/helper";
import { WEB_BROWSER_VIEW_ID } from "../surfingViewTypes";

export interface WebContentsProvider {
	getWebContents(): any;
	getCurrentUrl(): string;
	getCurrentTitle(): string;
	navigate(url: string): void;
	waitForPageLoad(timeout?: number): Promise<void>;
	refresh(): void;
	getLeaf(): any;
	getContentEl(): HTMLElement;
	getApp(): any;
}

export class AIPageBridge implements AssistantHost {
	private provider: WebContentsProvider;

	constructor(provider: WebContentsProvider) {
		this.provider = provider;
	}

	async getAIAssistantPageContext(
		includePageText: boolean,
		maxPageTextLength: number,
	): Promise<AssistantPageContext> {
		const fallback: AssistantPageContext = {
			url: this.provider.getCurrentUrl() || "",
			title: this.provider.getCurrentTitle() || "",
			selectionText: "",
			pageText: "",
			headings: [],
			links: [],
		};
		const webContents = this.provider.getWebContents();
		if (!webContents) return fallback;

		// No hard 12000 cap — let callers (MCP vs sidebar) control the limit
		const safeMaxLen = Math.max(400, maxPageTextLength);
		try {
			// Wait for dynamic content (React/Vue/SPA) to stabilize before extraction
			await AIPageBridge.waitForDOMStability(webContents);

			const context = await webContents.executeJavaScript(
				`
					(() => {
						const normalizeText = (text) => (text || "").toString().trim();
						const selectedText = normalizeText(window.getSelection()?.toString());

						// Headings with level info
						const allHeadings = Array.from(document.querySelectorAll("h1, h2, h3, h4"))
							.map((h) => {
								const level = "#".repeat(parseInt(h.tagName[1]));
								return level + " " + normalizeText(h.textContent);
							})
							.filter((s) => s.length > 2)
							.slice(0, 50);

						// Links with text and href
						const links = Array.from(document.querySelectorAll("a[href]"))
							.map((a) => {
								const text = normalizeText(a.textContent);
								const href = a.href;
								if (!href) return null;
								return text ? "[" + text.slice(0, 60) + "](" + href + ")" : href;
							})
							.filter(Boolean)
							.filter((v, i, arr) => arr.indexOf(v) === i)
							.slice(0, 50);

						let pageText = "";
						if (${includePageText}) {
							const maxLen = ${safeMaxLen};

							// Primary: structured DOM-to-text serialization
							let out = "";
							function walk(node) {
								if (out.length >= maxLen) return;
								if (node.nodeType === 3) {
									const t = node.textContent.replace(/[\\t ]+/g, " ");
									if (t.trim()) out += t;
									return;
								}
								if (node.nodeType !== 1) return;
								const el = node;
								const tag = el.tagName;
								const style = window.getComputedStyle(el);
								if (style.display === "none" || style.visibility === "hidden") return;
								if (/^(SCRIPT|STYLE|NOSCRIPT|SVG|IFRAME)$/.test(tag)) return;

								const prefix = {
									H1: "\\n# ", H2: "\\n## ", H3: "\\n### ", H4: "\\n#### ",
									P: "\\n", DIV: "\\n", BLOCKQUOTE: "\\n> ",
									BR: "\\n", HR: "\\n---\\n",
								}[tag] || "";
								if (prefix) out += prefix;

								if (tag === "A" && el.href) {
									const text = normalizeText(el.textContent).slice(0, 80);
									if (text) { out += "[" + text + "](" + el.href + ")"; return; }
								}
								if (tag === "IMG") {
									const alt = el.alt || el.title || "";
									if (alt) out += "[img: " + alt.slice(0, 40) + "]";
									return;
								}
								if (tag === "LI") {
									const parent = el.parentElement;
									if (parent && parent.tagName === "OL") {
										const idx = Array.from(parent.children).indexOf(el) + 1;
										out += "\\n" + idx + ". ";
									} else {
										out += "\\n- ";
									}
								}
								if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
									const label = el.placeholder || el.getAttribute("aria-label") || el.name || "";
									out += "[" + tag.toLowerCase() + (label ? ": " + label.slice(0, 30) : "") + "]";
									return;
								}
								if (tag === "BUTTON") {
									out += "[btn: " + normalizeText(el.textContent).slice(0, 30) + "]";
									return;
								}
								for (const child of el.childNodes) walk(child);
								if (/^(P|DIV|LI|TR|BLOCKQUOTE|SECTION|ARTICLE|HEADER|FOOTER)$/.test(tag)) {
									if (!out.endsWith("\\n")) out += "\\n";
								}
							}
							walk(document.body);
							pageText = out.replace(/\\n{3,}/g, "\\n\\n").trim().slice(0, maxLen);

							// Fallback: if DOM walker got very little text, use innerText
							// This handles React/Vue/SPA apps where content is in virtual DOM
							if (pageText.length < 200) {
								const innerText = (document.body.innerText || "")
									.replace(/\\n{3,}/g, "\\n\\n")
									.trim()
									.slice(0, maxLen);
								if (innerText.length > pageText.length) {
									pageText = innerText;
								}
							}
						}

						// Interactive elements with CSS selectors for AI click/type actions
						function getSelector(el) {
							if (el.id) return "#" + CSS.escape(el.id);
							// Try aria-label
							const aria = el.getAttribute("aria-label");
							if (aria) {
								const tag = el.tagName.toLowerCase();
								const sel = tag + '[aria-label="' + aria.replace(/"/g, '\\\\"') + '"]';
								if (document.querySelectorAll(sel).length === 1) return sel;
							}
							// Try name attribute
							const name = el.getAttribute("name");
							if (name) {
								const tag = el.tagName.toLowerCase();
								const sel = tag + '[name="' + name.replace(/"/g, '\\\\"') + '"]';
								if (document.querySelectorAll(sel).length === 1) return sel;
							}
							// Try data-testid
							const testId = el.getAttribute("data-testid");
							if (testId) return '[data-testid="' + testId.replace(/"/g, '\\\\"') + '"]';
							// Try unique class combination
							if (el.className && typeof el.className === "string") {
								const classes = el.className.trim().split(/\\s+/).slice(0, 3);
								if (classes.length > 0) {
									const sel = el.tagName.toLowerCase() + "." + classes.map(c => CSS.escape(c)).join(".");
									try { if (document.querySelectorAll(sel).length === 1) return sel; } catch(e) { /* invalid selector */ }
								}
							}
							// Fallback: nth-of-type path
							const tag = el.tagName.toLowerCase();
							const parent = el.parentElement;
							if (!parent) return tag;
							const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
							if (siblings.length === 1) {
								const parentSel = getSelector(parent);
								return parentSel + " > " + tag;
							}
							const idx = siblings.indexOf(el) + 1;
							const parentSel = getSelector(parent);
							return parentSel + " > " + tag + ":nth-of-type(" + idx + ")";
						}

						const interactiveElements = [];
						const seenSelectors = new Set();
						// Buttons
						document.querySelectorAll("button, [role=button], input[type=button], input[type=submit]").forEach((el) => {
							const style = window.getComputedStyle(el);
							if (style.display === "none" || style.visibility === "hidden") return;
							const text = normalizeText(el.textContent || el.value || el.getAttribute("aria-label") || "").slice(0, 60);
							if (!text) return;
							const selector = getSelector(el);
							if (seenSelectors.has(selector)) return;
							seenSelectors.add(selector);
							interactiveElements.push({ type: "button", text, selector });
						});
						// Inputs & Textareas
						document.querySelectorAll("input:not([type=hidden]):not([type=button]):not([type=submit]), textarea, select").forEach((el) => {
							const style = window.getComputedStyle(el);
							if (style.display === "none" || style.visibility === "hidden") return;
							const selector = getSelector(el);
							if (seenSelectors.has(selector)) return;
							seenSelectors.add(selector);
							const tag = el.tagName.toLowerCase();
							const entry = {
								type: tag === "select" ? "select" : (tag === "textarea" ? "textarea" : "input"),
								text: el.placeholder || el.getAttribute("aria-label") || el.name || "",
								selector,
							};
							if (el.type) entry.inputType = el.type;
							if (el.placeholder) entry.placeholder = el.placeholder;
							if (el.name) entry.name = el.name;
							interactiveElements.push(entry);
						});
						// Key links (nav, main actions)
						document.querySelectorAll("a[href]").forEach((el) => {
							if (interactiveElements.length >= 100) return;
							const style = window.getComputedStyle(el);
							if (style.display === "none" || style.visibility === "hidden") return;
							const text = normalizeText(el.textContent).slice(0, 60);
							if (!text || text.length < 2) return;
							const href = el.href;
							if (!href || href.startsWith("javascript:")) return;
							const selector = getSelector(el);
							if (seenSelectors.has(selector)) return;
							seenSelectors.add(selector);
							interactiveElements.push({ type: "link", text, selector, href });
						});

						return {
							url: location.href || "",
							title: document.title || "",
							selectionText: selectedText.slice(0, 1500),
							pageText,
							headings: allHeadings,
							links,
							interactiveElements: interactiveElements.slice(0, 100),
						};
					})()
					`,
				true,
			);

			return {
				url: context?.url || fallback.url,
				title: context?.title || fallback.title,
				selectionText: context?.selectionText || "",
				pageText: context?.pageText || "",
				headings: Array.isArray(context?.headings)
					? context.headings
					: [],
				links: Array.isArray(context?.links) ? context.links : [],
				interactiveElements: Array.isArray(context?.interactiveElements)
					? context.interactiveElements
					: [],
			};
		} catch (error) {
			console.error("Failed to collect AI page context: ", error);
			return fallback;
		}
	}

	/**
	 * Wait for DOM to stabilize after initial load — handles React/Vue/SPA hydration.
	 * Uses MutationObserver to detect when DOM mutations stop for a quiet period.
	 */
	static async waitForDOMStability(
		webContents: any,
		quietMs = 800,
		timeoutMs = 5000,
	): Promise<void> {
		try {
			await webContents.executeJavaScript(
				`
				new Promise((resolve) => {
					if (document.readyState !== 'complete') {
						window.addEventListener('load', () => startObserving(), { once: true });
					} else {
						startObserving();
					}
					function startObserving() {
						let timer = null;
						const observer = new MutationObserver(() => {
							if (timer) clearTimeout(timer);
							timer = setTimeout(() => {
								observer.disconnect();
								resolve();
							}, ${quietMs});
						});
						observer.observe(document.body, {
							childList: true, subtree: true, characterData: true
						});
						// If no mutations happen within quietMs, resolve immediately
						timer = setTimeout(() => {
							observer.disconnect();
							resolve();
						}, ${quietMs});
						// Hard timeout
						setTimeout(() => {
							observer.disconnect();
							resolve();
						}, ${timeoutMs});
					}
				})
				`,
				true,
			);
		} catch {
			// Non-critical — continue with extraction even if stability wait fails
		}
	}

	private async executeActionScript(script: string): Promise<string> {
		const webContents = this.provider.getWebContents();
		if (!webContents) return t("Webview is not ready.");
		try {
			const result = await webContents.executeJavaScript(script, true);
			if (typeof result === "string") return result;
			if (result === undefined || result === null) return "";
			return JSON.stringify(result);
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
	}

	async executeAIAssistantAction(action: AssistantAction): Promise<string> {
		const actionType = String(action.type || "")
			.toLowerCase()
			.trim();
		if (!actionType) return t("Action type is required.");

		if (actionType === "navigate" || actionType === "open") {
			const targetUrl = String(action.url || "").trim();
			if (!targetUrl) return t("Missing url in navigate action.");
			this.provider.navigate(targetUrl);
			await this.provider.waitForPageLoad();
			return `${t("Opened")}: ${targetUrl}`;
		}
		if (actionType === "open_new_tab") {
			const targetUrl = String(action.url || "").trim();
			if (!targetUrl) return t("Missing url in open_new_tab action.");
			// Create leaf directly to avoid same-tab reuse and listener conflicts
			this.provider
				.getApp()
				.workspace.getLeaf(true)
				.setViewState({
					type: WEB_BROWSER_VIEW_ID,
					active: true,
					state: { url: targetUrl },
				});
			return `${t("Opened in new tab")}: ${targetUrl}`;
		}
		if (actionType === "back") {
			// @ts-ignore
			this.provider.getLeaf()?.history.back();
			await this.provider.waitForPageLoad();
			return t("Moved back in history.");
		}
		if (actionType === "forward") {
			// @ts-ignore
			this.provider.getLeaf()?.history.forward();
			await this.provider.waitForPageLoad();
			return t("Moved forward in history.");
		}
		if (actionType === "reload" || actionType === "refresh") {
			this.provider.refresh();
			await this.provider.waitForPageLoad();
			return t("Reloaded current page.");
		}
		if (actionType === "click") {
			const selector = String(action.selector || "").trim();
			if (!selector) return t("Missing selector in click action.");
			return this.executeActionScript(`
					(() => {
						const selector = ${JSON.stringify(selector)};
						const element = document.querySelector(selector);
						if (!element) return "Selector not found: " + selector;
						element.dispatchEvent(new MouseEvent("click", {
							bubbles: true,
							cancelable: true,
							view: window
						}));
						if (typeof element.click === "function") {
							element.click();
						}
						return "Clicked " + selector;
					})()
				`);
		}
		if (actionType === "type" || actionType === "input") {
			const selector = String(action.selector || "").trim();
			if (!selector) return t("Missing selector in type action.");
			const value = String(action.text || "");
			const shouldEnter = Boolean(action.enter);
			return this.executeActionScript(`
					(() => {
						const selector = ${JSON.stringify(selector)};
						const value = ${JSON.stringify(value)};
						const shouldEnter = ${shouldEnter};
						const element = document.querySelector(selector);
						if (!element) return "Selector not found: " + selector;
						if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
							return "Element is not an input: " + selector;
						}
						element.focus();
						element.value = value;
						element.dispatchEvent(new Event("input", { bubbles: true }));
						element.dispatchEvent(new Event("change", { bubbles: true }));
						if (shouldEnter) {
							element.dispatchEvent(new KeyboardEvent("keydown", {
								key: "Enter",
								code: "Enter",
								bubbles: true,
							}));
						}
						return "Typed into " + selector;
					})()
				`);
		}
		if (actionType === "scroll") {
			const offset = Number(action.y || action.amount || 400);
			const safeOffset = Number.isNaN(offset) ? 400 : offset;
			return this.executeActionScript(`
					(() => {
						const offset = ${safeOffset};
						window.scrollBy({
							top: offset,
							behavior: "smooth",
						});
						return "Scrolled by " + offset + "px";
					})()
				`);
		}
		if (actionType === "extract") {
			const selector = String(action.selector || "").trim();
			if (!selector) {
				return this.executeActionScript(`
						(() => {
							const selection = window.getSelection()?.toString().trim();
							if (selection) return selection;
							return (document.body?.innerText || "").trim().slice(0, 1200);
						})()
					`);
			}
			return this.executeActionScript(`
					(() => {
						const selector = ${JSON.stringify(selector)};
						const element = document.querySelector(selector);
						if (!element) return "Selector not found: " + selector;
						return (element.textContent || "").trim();
					})()
				`);
		}
		if (actionType === "script" || actionType === "evaluate") {
			const script = String(action.script || "").trim();
			if (!script) return t("Missing script in evaluate action.");
			return this.executeActionScript(script);
		}

		return `${t("Unsupported action type")}: ${actionType}`;
	}

	getCurrentPageInfo(): { url: string; title: string } {
		return {
			url: this.provider.getCurrentUrl() || "",
			title: this.provider.getCurrentTitle() || "",
		};
	}

	showReadingIndicator(show: boolean): void {
		const webContents = this.provider.getWebContents();
		if (!webContents) return;
		try {
			if (show) {
				webContents.executeJavaScript(
					`
					(() => {
						if (document.getElementById('__surfing_ai_reading')) return;
						const overlay = document.createElement('div');
						overlay.id = '__surfing_ai_reading';
						overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:2147483647;border:2px solid rgba(124,58,237,0.5);animation:__surfing_pulse 2s ease-in-out infinite;';
						const badge = document.createElement('div');
						badge.style.cssText = 'position:fixed;top:8px;right:8px;background:rgba(124,58,237,0.9);color:#fff;padding:4px 12px;border-radius:12px;font-size:12px;font-family:system-ui,sans-serif;z-index:2147483647;pointer-events:none;display:flex;align-items:center;gap:6px;';
						badge.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> AI Reading...';
						overlay.appendChild(badge);
						const style = document.createElement('style');
						style.id = '__surfing_ai_reading_style';
						style.textContent = '@keyframes __surfing_pulse{0%,100%{border-color:rgba(124,58,237,0.5)}50%{border-color:rgba(124,58,237,0.15)}}';
						document.head.appendChild(style);
						document.body.appendChild(overlay);
					})()
					`,
					true,
				);
			} else {
				webContents.executeJavaScript(
					`
					(() => {
						const el = document.getElementById('__surfing_ai_reading');
						if (el) el.remove();
						const st = document.getElementById('__surfing_ai_reading_style');
						if (st) st.remove();
					})()
					`,
					true,
				);
			}
		} catch {
			// Non-critical
		}
	}
}
