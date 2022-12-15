import { request } from "obsidian";
import { Bookmark, FilterType, CategoryType } from "../../types/bookmark";

export function hashCode(str: string) {
	let hash = 0
	for (let i = 0; i < str.length; i++) {
		hash = (hash << 5) - hash + str.charCodeAt(i)
		hash = hash & hash // Convert to 32bit integer
	}
	return hash
}

export function generateColor(str: string) {
	// 计算字符串的哈希值
	const hash = hashCode(str)

	// 生成颜色值
	let color = "#"
	for (let i = 0; i < 3; i++) {
		const value = (hash >> (i * 8)) & 0xff
		color += ("00" + value.toString(16)).substr(-2)
	}
	return color
}

export function generateTagsOptions(bookmarks: Bookmark[]) {
	const tagsOptions: FilterType[] = []
	const tags: Set<string> = new Set()
	for (let i = 0; i < bookmarks.length; i++) {
		bookmarks[i].tags.split(" ").forEach((tag: string) => {
			tags.add(tag)
		})
	}

	for (const tag of tags) {
		tagsOptions.push({
			text: tag,
			value: tag
		})
	}

	return {
		tagsOptions
	}
}

export function isValidURL(str: string): boolean {
	// 定义一个正则表达式，用于匹配合法的URL
	const regexp =
		/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()!@:%_\+.~#?&\/\/=]*)/
	return regexp.test(str)
}

async function nonElectronGetPageTitle(url: string): Promise<{ title: string | null, name: string | null, description: string | null }> {
	try {
		const html = await request({ url });

		const doc = new DOMParser().parseFromString(html, "text/html");
		const title = doc.querySelector("title")?.innerText

		// 从文档中查找<meta>标签，并获取其name和description属性的值
		const nameTag = doc.querySelector("meta[name=name]")
		const name = nameTag ? nameTag.getAttribute("content") : null
		const descriptionTag = doc.querySelector("meta[name=description]")
		const description = descriptionTag
			? descriptionTag.getAttribute("content")
			: null

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

export async function fetchWebTitleAndDescription(url: string): Promise<{ title: string | null, name: string | null, description: string | null }> {
	// If we're on Desktop use the Electron scraper
	if (!(url.startsWith("http") || url.startsWith("https"))) {
		url = "https://" + url;
	}

	return nonElectronGetPageTitle(url);
}

export function parseList(listStr: string, level: number): CategoryType[]{
    // 定义一个数组来存储解析后的列表项
    const items: any[] = [];

    // 使用正则表达式匹配所有列表项
    const regex = /^(\s*)-\s(.+)/gm;
    let match;
    while ((match = regex.exec(listStr)) !== null) {
        // 获取列表项前面的缩进空格
        const indent = match[1];
        // 获取列表项文本
        const label = match[2];

        // 计算列表项的缩进层级
        const itemLevel = indent.length / 2;

        // 如果列表项的缩进层级比当前层级更高，则表示该列表项是当前列表项的子项
        if (itemLevel > level) {
            // 将列表项添加到当前列表项的 children 属性中
            const item = items[items.length - 1];
            if (!item.children) {
                item.children = [];
            }
            item.children.push({ label, value: label, text: label });
        } else {
            // 如果列表项的缩进层级和当前层级相同，则表示该列表项与当前列表项并列，应该将它添加到当前列表项的同级
            if (itemLevel === level) {
                items.push({ label, value: label, text: label });
            } else {
                // 如果列表项的缩进层级比当前层级更低，则表示该列表项属于上一级列表，应该将它添加到上一级列表中
                const parentLevel = itemLevel - 1;
                // 递归调用 parseList 函数，并将列表项的子项作为参数传入
                const subItems = parseList(listStr.slice(match.index), parentLevel);
                items.push(...subItems);
            }
        }
    }
    return items;
}