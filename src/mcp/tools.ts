// The tools the MCP server offers: names, descriptions and input schemas.
// Pure data; the controller implements them.
import type { ToolDefinition } from "./server";

const tabId = {
	type: "integer",
	description: "Tab to act on (from tabs_list). Omit to use the tab the user was last on.",
};

const ref = {
	type: "string",
	description: "Element ref from read_page or find, like \"e12\".",
};

function tool(
	name: string,
	description: string,
	properties: Record<string, unknown> = {},
	required: string[] = [],
): ToolDefinition {
	return {
		name,
		description,
		inputSchema: {
			type: "object",
			properties,
			...(required.length ? { required } : {}),
			additionalProperties: false,
		},
	};
}

export const SCRIPT_TOOL = "javascript";

export const TOOLS: ToolDefinition[] = [
	tool("tabs_list", "List the web tabs open in Obsidian (Surfing and Web Viewer): tabId, title, url, which browser, and whether it is the active tab."),
	tool(
		"tabs_create",
		"Open a URL in a new tab (Web Viewer while that core plugin is on, otherwise Surfing). Returns the new tabId once the page has started loading.",
		{
			url: { type: "string", description: "http(s) URL to open." },
			active: { type: "boolean", description: "Bring the tab to the front. Default true." },
		},
		["url"],
	),
	tool("tabs_activate", "Bring a tab to the front.", { tabId }, ["tabId"]),
	tool("tabs_close", "Close a tab.", { tabId }, ["tabId"]),
	tool(
		"navigate",
		"Navigate a tab to a URL, or go \"back\", \"forward\" or \"reload\". Waits for the page to load and returns the final url and title.",
		{
			tabId,
			url: { type: "string", description: "http(s) URL, or one of \"back\", \"forward\", \"reload\"." },
		},
		["url"],
	),
	tool(
		"read_page",
		"Snapshot of the page: one line per element as [ref] role \"name\" (state) @x,y,w,h in document order, plus url, title, scroll position and viewport size. Use the refs with click, type, scroll, form_input, screenshot and wait_for. Refs stay valid until the next read_page of this tab or a navigation.",
		{
			tabId,
			filter: {
				type: "string",
				enum: ["interactive", "all"],
				description: "\"interactive\" (default): links, buttons, fields and the like. \"all\": also headings, text blocks, images and landmarks.",
			},
			maxElements: { type: "integer", description: "Maximum elements to list. Default 300." },
		},
	),
	tool(
		"find",
		"Find elements by words in their name, text, placeholder or role. Returns up to 20 matches as read_page lines, with usable refs.",
		{ tabId, query: { type: "string", description: "What to look for, e.g. \"search box\" or \"sign in button\"." } },
		["query"],
	),
	tool(
		"get_page_text",
		"The main content of the page as Markdown (articles, docs), falling back to the visible text.",
		{ tabId, maxLength: { type: "integer", description: "Truncate to this many characters. Default 20000." } },
	),
	tool(
		"click",
		"Click an element by ref, or a point by viewport coordinates, with real (trusted) mouse input.",
		{
			tabId,
			ref,
			x: { type: "number", description: "Viewport x in CSS pixels (when no ref)." },
			y: { type: "number", description: "Viewport y in CSS pixels (when no ref)." },
			button: { type: "string", enum: ["left", "right", "middle"], description: "Default left." },
			clickCount: { type: "integer", description: "2 for a double click. Default 1." },
			modifiers: {
				type: "array",
				items: { type: "string", enum: ["shift", "ctrl", "alt", "meta"] },
				description: "Keys held during the click.",
			},
		},
	),
	tool(
		"type",
		"Type text into the focused element, or into the element with the given ref (it is clicked first), with real input events.",
		{
			tabId,
			ref,
			text: { type: "string", description: "Text to insert." },
			submit: { type: "boolean", description: "Press Enter afterwards. Default false." },
		},
		["text"],
	),
	tool(
		"key",
		"Press keys. A space-separated sequence, e.g. \"Enter\", \"Escape\", \"Tab\", \"ctrl+a\", \"shift+Tab\", \"ArrowDown ArrowDown Enter\".",
		{ tabId, keys: { type: "string", description: "Key or keys to press." } },
		["keys"],
	),
	tool(
		"scroll",
		"Scroll an element into view (ref), or scroll the page with the mouse wheel. Returns the new scroll position.",
		{
			tabId,
			ref,
			direction: { type: "string", enum: ["up", "down", "left", "right"], description: "Default down." },
			amount: { type: "number", description: "Wheel ticks (about 100 px each). Default 3." },
		},
	),
	tool(
		"form_input",
		"Set the value of a form control by ref: text for inputs and textareas, a value or visible text for selects, true/false for checkboxes and radio buttons. Fires input and change events.",
		{
			tabId,
			ref,
			value: { type: ["string", "boolean", "number"], description: "The value to set." },
		},
		["ref", "value"],
	),
	tool(
		"screenshot",
		"Capture the page (or one element by ref) as an image, scaled so the longer side is at most 1280 px.",
		{
			tabId,
			ref,
			fullPage: { type: "boolean", description: "Capture the whole scrollable page. Default false." },
		},
	),
	tool(
		"wait_for",
		"Wait until text appears on the page, an element (ref) is attached and visible, or the URL contains a string.",
		{
			tabId,
			text: { type: "string", description: "Text to wait for." },
			ref,
			urlIncludes: { type: "string", description: "Substring the URL must contain." },
			timeoutMs: { type: "integer", description: "Default 10000, at most 60000." },
		},
	),
	tool(
		SCRIPT_TOOL,
		"Run JavaScript in the page and return the JSON of the result. Only available when the user has enabled \"Allow running JavaScript in pages\".",
		{ tabId, code: { type: "string", description: "Code to run; the value of the last expression is returned." } },
		["code"],
	),
	tool(
		"console_messages",
		"Console messages the page has logged (the last 200 per tab).",
		{
			tabId,
			level: {
				type: "string",
				enum: ["verbose", "info", "warning", "error"],
				description: "Only messages at this level or more severe.",
			},
			pattern: { type: "string", description: "Only messages containing this text (case-insensitive)." },
			clear: { type: "boolean", description: "Clear the buffer after reading." },
		},
	),
];

/** Tools that act on tabs themselves and need no site approval. */
export const TAB_MANAGEMENT_TOOLS = new Set(["tabs_list", "tabs_create", "tabs_activate", "tabs_close"]);
