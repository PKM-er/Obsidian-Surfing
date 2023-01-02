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

	console.log(result);
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
				"bookmarks": [],
				"categories": []
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
