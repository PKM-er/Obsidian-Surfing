interface Bookmark {
    id: string;
    name: string;
    description: string;
    url: string;
    tags: string;
    category: string[];
    created: number;
    modified: number;
}

interface FilterType {
    text: string
    value: string
}



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

export async function fetchWebTitleAndDescription(url: string) {
    // 使用fetch()方法获取给定URL所对应的HTML源代码
    const response = await fetch(url, {
        method: "GET", // POST，PUT，DELETE，等。
        headers: {
            "Content-Type": "text/plain;charset=UTF-8"
        }
    })
    const html = await response.text()

    // 创建一个文档对象，并将HTML源代码加载到文档中
    const doc = new DOMParser().parseFromString(html, "text/html")

    // 从文档中查找<title>标签，并获取其内容
    const title = doc.querySelector("title")?.innerText

    // 从文档中查找<meta>标签，并获取其name和description属性的值
    const nameTag = doc.querySelector("meta[name=name]")
    const name = nameTag ? nameTag.getAttribute("content") : null
    const descriptionTag = doc.querySelector("meta[name=description]")
    const description = descriptionTag
        ? descriptionTag.getAttribute("content")
        : null

    // 返回title和description信息
    return {
        title,
        name,
        description
    }
}

export function isValidURL(str: string): boolean {
    // 定义一个正则表达式，用于匹配合法的URL
    const regexp =
        /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()!@:%_\+.~#?&\/\/=]*)/
    return regexp.test(str)
}