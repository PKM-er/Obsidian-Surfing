import { Notice } from "obsidian";
import SurfingPlugin from "../surfingIndex";
import { createBookmarkFile, refreshBookmarkCache } from "./bookmarkStore";

interface OldBookmark {
	id: string;
	name: string;
	description: string;
	url: string;
	tags: string;
	category: string[];
	created: number;
	modified: number;
}

interface OldJsonOutput {
	bookmarks: OldBookmark[];
	categories: any[];
}

export async function migrateBookmarks(plugin: SurfingPlugin): Promise<void> {
	const jsonPath = `${plugin.app.vault.configDir}/surfing-bookmark.json`;

	const exists = await plugin.app.vault.adapter.exists(jsonPath);
	if (!exists) {
		plugin.settings.bookmarkManager.bookmarksMigrated = true;
		await plugin.saveSettings();
		return;
	}

	try {
		const raw = await plugin.app.vault.adapter.read(jsonPath);
		const data: OldJsonOutput = JSON.parse(raw);

		if (!data.bookmarks || data.bookmarks.length === 0) {
			plugin.settings.bookmarkManager.bookmarksMigrated = true;
			await plugin.saveSettings();
			return;
		}

		let migrated = 0;
		for (const bookmark of data.bookmarks) {
			const tags = bookmark.tags
				? bookmark.tags.split(" ").filter((t: string) => t.trim() !== "")
				: [];

			const file = await createBookmarkFile(plugin, {
				url: bookmark.url,
				name: bookmark.name || "Untitled",
				description: bookmark.description || "",
				tags,
				category: bookmark.category?.length > 0 ? bookmark.category : ["ROOT"],
			});

			if (file) migrated++;
		}

		// Rename old file to .bak
		const bakPath = jsonPath + ".bak";
		if (await plugin.app.vault.adapter.exists(bakPath)) {
			await plugin.app.vault.adapter.remove(bakPath);
		}
		await plugin.app.vault.adapter.rename(jsonPath, bakPath);

		plugin.settings.bookmarkManager.bookmarksMigrated = true;
		await plugin.saveSettings();

		await refreshBookmarkCache(plugin);

		new Notice(`Migrated ${migrated} bookmarks to markdown files.`);
	} catch (e) {
		console.error("Bookmark migration failed:", e);
		new Notice("Bookmark migration failed. Check console for details.");
	}
}
