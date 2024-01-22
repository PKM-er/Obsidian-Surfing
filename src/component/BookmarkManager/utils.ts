import { request } from "obsidian";
import { Bookmark, CategoryType, FilterType } from "../../types/bookmark";

export function hashCode(str: string) {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = (hash << 5) - hash + str.charCodeAt(i);
		hash = hash & hash; // Convert to 32bit integer
	}
	return hash;
}

export function generateColor(str: string) {
	// 计算字符串的哈希值
	const hash = hashCode(str);

	// 生成颜色值
	let color = "#";
	for (let i = 0; i < 3; i++) {
		const value = (hash >> (i * 8)) & 0xff;
		color += ("00" + value.toString(16)).substr(-2);
	}
	return color;
}

export function generateTagsOptions(bookmarks: Bookmark[]) {
	const tagsOptions: FilterType[] = [];
	const tags: Set<string> = new Set();
	for (let i = 0; i < bookmarks?.length; i++) {
		bookmarks[i].tags.split(" ").forEach((tag: string) => {
			tags.add(tag);
		});
	}

	for (const tag of tags) {
		tagsOptions.push({
			text: tag,
			value: tag
		});
	}

	return {
		tagsOptions
	};
}

export function isValidURL(str: string): boolean {
	// 定义一个正则表达式，用于匹配合法的URL
	const regexp =
		/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()!@:%_\+.~#?&\/\/=]*)/;
	return regexp.test(str);
}

export async function nonElectronGetPageTitle(url: string): Promise<{
	title: string | null,
	name: string | null,
	description: string | null
}> {
	try {
		const html = await request({url});

		const doc = new DOMParser().parseFromString(html, "text/html");
		const title = doc.querySelector("title")?.innerText;

		// 从文档中查找<meta>标签，并获取其name和description属性的值
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
	// If we're on Desktop use the Electron scraper
	if (!(url.startsWith("http") || url.startsWith("https"))) {
		url = "https://" + url;
	}

	return nonElectronGetPageTitle(url);
}

export function stringToCategory(categoryString: string): CategoryType[] {
	const categoryOptions: CategoryType[] = doParse(categoryString);

	categoryOptions.unshift({
		"value": "ROOT",
		"text": "ROOT",
		"label": "ROOT",
		"children": []
	});

	return categoryOptions;
}

export function doParse(categoryString: string): CategoryType[] {
	const categoryOptions: CategoryType[] = [];
	const lines = categoryString.split('\n');
	const regex = /^(\s*)-\s(.*)/;

	lines.forEach(function (line, i) {
		const matches = line.match(regex);
		if (matches) {
			let level;
			const blank = matches[1];

			if (new RegExp(/^\t+/g).test(blank)) level = blank.length;
			else level = blank.length / 4;

			const title = matches[2];
			const node = Node(title);

			if (level === 0) {
				categoryOptions.push(node);
			} else {
				const p = getParentNode(level, categoryOptions);
				// For menu mode of el-select
				p?.children?.push(node);
			}
		}
	});
	return categoryOptions;
}

function getParentNode(level: number, categoryOptions: CategoryType[]) {
	let i = 0;
	let node = categoryOptions[categoryOptions.length - 1];
	while (i < level - 1) {
		const childNodes = node.children;
		if (childNodes) node = childNodes[childNodes.length - 1];
		i++;
	}

	if (!node?.children && node) {
		node.children = [];
	}
	return node;
}

function Node(title: string) {
	return {
		"value": title,
		"text": title,
		"label": title,
	};
}
