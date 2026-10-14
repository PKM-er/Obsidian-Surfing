import { moment } from "obsidian";

/** The part of a moment.js date Surfing uses. */
interface FormattableDate {
	format(format?: string): string;
}

/**
 * Obsidian's bundled moment.js. Obsidian types it as `typeof import("moment")`
 * through a namespace import, which TypeScript 7 (always esModuleInterop)
 * no longer treats as callable; at runtime it is the moment function.
 */
export const callMoment = moment as unknown as () => FormattableDate;
