import { TFile, TFolder, normalizePath } from "obsidian";
import { callMoment } from "./moment";
import SurfingPlugin from "../surfingIndex";

export interface BookmarkFileItem {
	file: TFile;
	name: string;
	url: string;
	description: string;
	tags: string[];
	category: string[];
	created: number;
	modified: number;
}

function toStringArray(value: unknown): string[] | null {
	if (Array.isArray(value)) return value as string[];
	if (typeof value === "string") return [value];
	return null;
}

function toTimestamp(value: unknown, fallback: number): number {
	if (!value) return fallback;
	return new Date(value as string | number | Date).getTime();
}

function sanitizeFileName(name: string): string {
	return name
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 200);
}

function getBookmarkFolder(plugin: SurfingPlugin): string {
	return normalizePath(plugin.settings.bookmarkManager.bookmarkFolder || "surfing-bookmarks");
}

export async function ensureBookmarkFolder(plugin: SurfingPlugin): Promise<void> {
	const folderPath = getBookmarkFolder(plugin);
	const folder = plugin.app.vault.getAbstractFileByPath(folderPath);
	if (!folder) {
		await plugin.app.vault.createFolder(folderPath);
	}
}

export async function scanBookmarkFolder(plugin: SurfingPlugin): Promise<BookmarkFileItem[]> {
	const folderPath = getBookmarkFolder(plugin);
	const folder = plugin.app.vault.getAbstractFileByPath(folderPath);
	if (!folder || !(folder instanceof TFolder)) return [];

	const items: BookmarkFileItem[] = [];
	for (const child of folder.children) {
		if (child instanceof TFile && child.extension === "md") {
			const item = await parseBookmarkFile(plugin, child);
			if (item) items.push(item);
		}
	}
	return items;
}

async function parseBookmarkFile(plugin: SurfingPlugin, file: TFile): Promise<BookmarkFileItem | null> {
	const cache = plugin.app.metadataCache.getFileCache(file);
	const fm: Record<string, unknown> | undefined = cache?.frontmatter;
	if (!fm || !fm.url) return null;

	return {
		file,
		name: file.basename,
		url: typeof fm.url === "string" ? fm.url : "",
		description: typeof fm.description === "string" ? fm.description : "",
		tags: toStringArray(fm.tags) ?? [],
		category: toStringArray(fm.category) ?? ["ROOT"],
		created: toTimestamp(fm.created, file.stat.ctime),
		modified: toTimestamp(fm.modified, file.stat.mtime),
	};
}

export async function createBookmarkFile(
	plugin: SurfingPlugin,
	data: { url: string; name: string; description?: string; tags?: string[]; category?: string[] }
): Promise<TFile | null> {
	await ensureBookmarkFolder(plugin);

	if (isUrlBookmarked(plugin, data.url)) return null;

	const folderPath = getBookmarkFolder(plugin);
	let fileName = sanitizeFileName(data.name || "Untitled");
	if (!fileName) fileName = "Untitled";

	let filePath = normalizePath(`${folderPath}/${fileName}.md`);
	let counter = 1;
	while (plugin.app.vault.getAbstractFileByPath(filePath)) {
		filePath = normalizePath(`${folderPath}/${fileName} ${counter}.md`);
		counter++;
	}

	const now = callMoment().format("YYYY-MM-DDTHH:mm:ss");
	const tags = data.tags || [];
	const category = data.category || ["ROOT"];

	const tagsYaml = tags.length > 0
		? `\ntags:\n${tags.map(t => `  - ${t}`).join("\n")}`
		: "\ntags: []";
	const categoryYaml = `\ncategory:\n${category.map(c => `  - ${c}`).join("\n")}`;

	const content = `---
url: "${data.url.replace(/"/g, '\\"')}"
description: "${(data.description || "").replace(/"/g, '\\"')}"${tagsYaml}${categoryYaml}
created: ${now}
modified: ${now}
---
`;

	const file = await plugin.app.vault.create(filePath, content);
	return file;
}

export async function deleteBookmarkFile(plugin: SurfingPlugin, file: TFile): Promise<void> {
	await plugin.app.vault.trash(file, true);
}

export function isUrlBookmarked(plugin: SurfingPlugin, url: string): boolean {
	return plugin.bookmarkCache.some(b => b.url === url);
}

export function getBookmarkByUrl(plugin: SurfingPlugin, url: string): BookmarkFileItem | null {
	return plugin.bookmarkCache.find(b => b.url === url) || null;
}

export function isInBookmarkFolder(plugin: SurfingPlugin, filePath: string): boolean {
	const folderPath = getBookmarkFolder(plugin);
	return filePath.startsWith(folderPath + "/");
}

export async function refreshBookmarkCache(plugin: SurfingPlugin): Promise<void> {
	plugin.bookmarkCache = await scanBookmarkFolder(plugin);
}

export function updateBookmarkBar(plugin: SurfingPlugin): void {
	const emptyLeaves = plugin.app.workspace.getLeavesOfType("empty");
	if (emptyLeaves.length > 0) {
		emptyLeaves.forEach((leaf) => {
			leaf.rebuildView();
		});
	}

	const surfingLeaves = plugin.app.workspace.getLeavesOfType("surfing-view");
	if (surfingLeaves.length > 0) {
		surfingLeaves.forEach((leaf) => {
			(leaf.view as { bookmarkBar?: { onload(): void } } | undefined)?.bookmarkBar?.onload();
		});
	}
}
