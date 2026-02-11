import { request } from "obsidian";

export async function nonElectronGetPageTitle(url: string): Promise<{
	title: string | null,
	name: string | null,
	description: string | null
}> {
	try {
		const html = await request({url});

		const doc = new DOMParser().parseFromString(html, "text/html");
		const title = doc.querySelector("title")?.innerText;

		const nameTag = doc.querySelector("meta[name=name]");
		const name = nameTag ? nameTag.getAttribute("content") : null;
		const descriptionTag = doc.querySelector("meta[name=description]");

		const description = descriptionTag
			? descriptionTag.getAttribute("content")
			: null;

		return {
			title: title ? title : "",
			name,
			description
		};
	} catch (ex) {
		console.error(ex);
		return {
			title: "",
			name: "",
			description: ""
		};
	}
}

export async function fetchWebTitleAndDescription(url: string): Promise<{
	title: string | null,
	name: string | null,
	description: string | null
}> {
	if (!(url.startsWith("http") || url.startsWith("https"))) {
		url = "https://" + url;
	}

	return nonElectronGetPageTitle(url);
}
