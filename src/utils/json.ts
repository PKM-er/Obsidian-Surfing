import { Bookmark, CategoryType } from "../types/bookmark";
import SurfingPlugin from "../surfingIndex";

interface jsonOutput {
	"bookmarks": Bookmark[],
	"categories": CategoryType[],
}

const bookmarkSavePath = (plugin: SurfingPlugin) => `${ plugin.app.vault.configDir }/surfing-bookmark.json`

export const loadJson = async (plugin: SurfingPlugin): Promise<jsonOutput> => {
	const result = JSON.parse(
		await plugin.app.vault.adapter.read(
			bookmarkSavePath(plugin)
		)
	);

	return result;
}

export const saveJson = async (plugin: SurfingPlugin, data: any) => {
	await plugin.app.vault.adapter.write(
		bookmarkSavePath(plugin),
		JSON.stringify(data, null, 2)
	);
}

export const initializeJson = async (plugin: SurfingPlugin) => {
	await plugin.app.vault.adapter.write(
		bookmarkSavePath(plugin),
		JSON.stringify({
				"bookmarks": [
					{
						"id": "2014068036",
						"name": "Obsidian",
						"url": "https://obsidian.md/",
						"description": "A awesome note-taking tool",
						"category": [
							"ROOT"
						],
						"tags": "",
						"created": 1672840861051,
						"modified": 1672840861052
					}
				],
				"categories": [
					{
						"value": "ROOT",
						"text": "ROOT",
						"label": "ROOT",
						"children": []
					},
				]
			}, null, 2
		)
	);
}

export const exportJsonToClipboard = async (plugin: SurfingPlugin) => {
	const data = JSON.parse(
		await plugin.app.vault.adapter.read(
			bookmarkSavePath(plugin)
		)
	);
	navigator.clipboard.writeText(JSON.stringify(data, null, 2));
}

export const exportJsonToMarkdown = async (plugin: SurfingPlugin) => {
	const data = JSON.parse(
		await plugin.app.vault.adapter.read(
			bookmarkSavePath(plugin)
		)
	);
	let result = `# Surfing Bookmarks`;
	for (const item of data) {
		result += `- [${ item.title }](${ item.url })`;
	}
	return result;
}
