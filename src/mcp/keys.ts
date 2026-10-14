// Parsing of the `key` tool's key strings ("Enter", "ctrl+a", "shift+Tab
// ArrowDown") into the events webContents.sendInputEvent takes. Pure.

export type KeyModifier = "shift" | "control" | "alt" | "meta";

export interface KeyEvent {
	type: "keyDown" | "char" | "keyUp";
	/** An Electron accelerator key code: "Enter", "Up", "a", ... */
	keyCode: string;
	modifiers: KeyModifier[];
}

export interface KeyPress {
	/** The key as written, for messages. */
	label: string;
	events: KeyEvent[];
}

const MODIFIER_ALIASES: Record<string, KeyModifier> = {
	shift: "shift",
	ctrl: "control",
	control: "control",
	alt: "alt",
	option: "alt",
	opt: "alt",
	meta: "meta",
	cmd: "meta",
	command: "meta",
	super: "meta",
	win: "meta",
};

/** Key names (lowercase) to Electron key codes. */
const KEY_ALIASES: Record<string, string> = {
	enter: "Enter",
	return: "Enter",
	escape: "Escape",
	esc: "Escape",
	tab: "Tab",
	backspace: "Backspace",
	delete: "Delete",
	del: "Delete",
	insert: "Insert",
	space: "Space",
	spacebar: "Space",
	up: "Up",
	arrowup: "Up",
	down: "Down",
	arrowdown: "Down",
	left: "Left",
	arrowleft: "Left",
	right: "Right",
	arrowright: "Right",
	home: "Home",
	end: "End",
	pageup: "PageUp",
	pagedown: "PageDown",
	plus: "Plus",
};

/** What the `char` event carries for keys that insert text on their own. */
const CHAR_FOR_KEY: Record<string, string> = {
	Enter: "\r",
	Tab: "\t",
	Space: " ",
};

function resolveKey(name: string): string | null {
	const lower = name.toLowerCase();
	const alias = KEY_ALIASES[lower];
	if (alias) return alias;
	if (/^f([1-9]|1\d|2[0-4])$/.test(lower)) return lower.toUpperCase();
	// A single character: a letter, digit or punctuation mark.
	if ([...name].length === 1) return name;
	return null;
}

/** "ctrl+a" -> one key press, or throws a message for the agent. */
export function parseKeyPress(token: string): KeyPress {
	let keyName: string;
	let modifierNames: string[];
	if (token === "+") {
		keyName = "+";
		modifierNames = [];
	} else if (token.endsWith("++")) {
		keyName = "+";
		modifierNames = token.slice(0, -2).split("+");
	} else {
		const parts = token.split("+");
		keyName = parts.pop() ?? "";
		modifierNames = parts;
	}
	if (!keyName) throw new Error(`Empty key in "${token}".`);

	const modifiers: KeyModifier[] = [];
	for (const part of modifierNames) {
		const modifier = MODIFIER_ALIASES[part.toLowerCase()];
		if (!modifier) throw new Error(`Unknown modifier "${part}" in "${token}".`);
		if (!modifiers.includes(modifier)) modifiers.push(modifier);
	}

	const keyCode = resolveKey(keyName);
	if (!keyCode) throw new Error(`Unknown key "${keyName}" in "${token}".`);

	const events: KeyEvent[] = [{ type: "keyDown", keyCode, modifiers }];
	// Only keys without ctrl/alt/meta produce text.
	const typesText = !modifiers.some((m) => m === "control" || m === "alt" || m === "meta");
	if (typesText) {
		let text = CHAR_FOR_KEY[keyCode] ?? ([...keyCode].length === 1 ? keyCode : null);
		if (text !== null && modifiers.includes("shift")) text = text.toUpperCase();
		if (text !== null) events.push({ type: "char", keyCode: text, modifiers });
	}
	events.push({ type: "keyUp", keyCode, modifiers });
	return { label: token, events };
}

/** A space-separated sequence of key presses. */
export function parseKeys(keys: string): KeyPress[] {
	const tokens = keys.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) throw new Error("No keys given.");
	if (tokens.length > 100) throw new Error("Too many keys in one call (limit 100).");
	return tokens.map(parseKeyPress);
}
