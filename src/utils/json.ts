import { Bookmark, CategoryType } from "../types/bookmark";
import SurfingPlugin from "../surfingIndex";

interface jsonOutput {
	"bookmarks": Bookmark[],
	"categories": CategoryType[],
}

const bookmarkSavePath = `${ app.vault.configDir }/surfing-bookmark.json`

export const loadJson = async (): Promise<jsonOutput> => {
	const result = JSON.parse(
		await app.vault.adapter.read(
			bookmarkSavePath
		)
	);

	return result;
}

export const saveJson = async (data: any) => {
	await app.vault.adapter.write(
		bookmarkSavePath,
		JSON.stringify(data, null, 2)
	);
}

export const initializeJson = async () => {
	await app.vault.adapter.write(
		bookmarkSavePath,
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
		await app.vault.adapter.read(
			bookmarkSavePath
		)
	);
	navigator.clipboard.writeText(JSON.stringify(data, null, 2));
}

export const exportJsonToMarkdown = async () => {
	const data = JSON.parse(
		await app.vault.adapter.read(
			bookmarkSavePath
		)
	);
	let result = `# Surfing Bookmarks`;
	for (const item of data) {
		result += `- [${ item.title }](${ item.url })`;
	}
	return result;
}
