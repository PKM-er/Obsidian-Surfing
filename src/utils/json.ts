import { Bookmark, CategoryType } from "../types/bookmark";
import SurfingPlugin from "../surfingIndex";

interface jsonOutput {
    "bookmarks": Bookmark[],
    "categories": CategoryType[],
}

const bookmarkSavePath = `${app.vault.configDir}/surfing-bookmark.json`

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
        JSON.stringify(data)
    );
}

export const initializeJson = async () => {
    await app.vault.adapter.write(
        bookmarkSavePath,
        JSON.stringify({
            "bookmarks": [
                {
                    "id": "-1986065712",
                    "name": "Recycled Steel Mouse",
                    "description": "New ABC 13 9370, 13.3, 5th Gen CoreA5-8250U, 8GB RAM, 256GB SSD, power UHD Graphics, OS 10 Home, OS Office A & J 2016",
                    "url": "https://unhappy-bratwurst.com",
                    "tags": "awesome great bad good soso",
                    "category": [
                        "计算机",
                        "算法"
                    ],
                    "created": 1698820965571,
                    "modified": 1694518168351
                },
                {
                    "id": "-350896611",
                    "name": "Handcrafted Fresh Chicken",
                    "description": "The Football Is Good For Training And Recreational Purposes",
                    "url": "https://incomparable-wink.net",
                    "tags": "soso good great",
                    "category": [
                        "计算机",
                        "算法"
                    ],
                    "created": 1675093236862,
                    "modified": 1694767879657
                },
                {
                    "id": "1127823550",
                    "name": "Recycled Steel Tuna",
                    "description": "The Apollotech B340 is an affordable wireless mouse with reliable connectivity, 12 months battery life and modern design",
                    "url": "https://usable-colonization.com",
                    "tags": "soso great awesome",
                    "category": [
                        "计算机",
                        "算法"
                    ],
                    "created": 1698614943536,
                    "modified": 1693028657538
                },
                {
                    "id": "617707055",
                    "name": "Gorgeous Plastic Soap",
                    "description": "The slim & simple Maple Gaming Keyboard from Dev Byte comes with a sleek body and 7- Color RGB LED Back-lighting for smart functionality",
                    "url": "http://classic-hyacinth.org",
                    "tags": "awesome bad",
                    "category": [
                        "计算机",
                        "算法"
                    ],
                    "created": 1680028680814,
                    "modified": 1678004275787
                },
                {
                    "id": "-486466370",
                    "name": "Sleek Concrete Towels",
                    "description": "New range of formal shirts are designed keeping you in mind. With fits and styling that will make you stand apart",
                    "url": "https://average-bog.name",
                    "tags": "great awesome good bad soso",
                    "category": [
                        "计算机",
                        "算法"
                    ],
                    "created": 1671726260410,
                    "modified": 1701146954600
                },
                {
                    "id": "562058444",
                    "name": "Recycled Granite Chair",
                    "description": "Ergonomic executive chair upholstered in bonded black leather and PVC padded seat and back for all-day comfort and support",
                    "url": "http://metallic-carport.com",
                    "tags": "soso bad good great",
                    "category": [
                        "计算机",
                        "算法"
                    ],
                    "created": 1677129626448,
                    "modified": 1671945779127
                },
                {
                    "id": "1039892883",
                    "name": "Rustic Plastic Shoes",
                    "description": "The beautiful range of Apple Naturalé that has an exciting mix of natural ingredients. With the Goodness of 100% Natural Ingredients",
                    "url": "http://able-similarity.net",
                    "tags": "awesome great bad good soso",
                    "category": [
                        "计算机",
                        "算法"
                    ],
                    "created": 1695048094893,
                    "modified": 1684107148328
                },
                {
                    "id": "1242469051",
                    "name": "Generic Bronze Table",
                    "description": "The beautiful range of Apple Naturalé that has an exciting mix of natural ingredients. With the Goodness of 100% Natural Ingredients",
                    "url": "https://flamboyant-pillbox.info",
                    "tags": "good great bad soso awesome",
                    "category": [
                        "计算机",
                        "算法"
                    ],
                    "created": 1690734802362,
                    "modified": 1677401690780
                },
                {
                    "id": "-1291428680",
                    "name": "Awesome Frozen Chips",
                    "description": "The automobile layout consists of a front-engine design, with transaxle-type transmissions mounted at the rear of the engine and four wheel drive",
                    "url": "https://squiggly-chaos.name",
                    "tags": "awesome soso great",
                    "category": [
                        "计算机",
                        "算法"
                    ],
                    "created": 1686546248961,
                    "modified": 1675689666498
                },
                {
                    "id": "-1913352840",
                    "name": "Modern Concrete Soap",
                    "description": "The Apollotech B340 is an affordable wireless mouse with reliable connectivity, 12 months battery life and modern design",
                    "url": "https://teeming-shred.net",
                    "tags": "soso bad",
                    "category": [
                        "计算机",
                        "算法"
                    ],
                    "created": 1688607537878,
                    "modified": 1701903702189
                },
                {
                    "id": "-1913352110",
                    "name": "Modern Concrete Soap",
                    "description": "The Apollotech B340 is an affordable wireless mouse with reliable connectivity, 12 months battery life and modern design",
                    "url": "https://teeming-shred.net",
                    "tags": "soso bad",
                    "category": [
                        "ROOT"
                    ],
                    "created": 1688607537878,
                    "modified": 1701903702189
                },
                {
                    "id": "-1913352220",
                    "name": "Modern Concrete Soap",
                    "description": "The Apollotech B340 is an affordable wireless mouse with reliable connectivity, 12 months battery life and modern design",
                    "url": "https://teeming-shred.net",
                    "tags": "soso bad",
                    "category": [
                        "Computer",
                        "Algorithm"
                    ],
                    "created": 1688607537878,
                    "modified": 1701903702189
                }
            ]
        }
        )
    );
}

export const exportJsonToClipboard = async (plugin: SurfingPlugin) => {
    const data = JSON.parse(
        await app.vault.adapter.read(
            bookmarkSavePath
        )
    );
    navigator.clipboard.writeText(JSON.stringify(data));
}

export const exportJsonToMarkdown = async () => {
    const data = JSON.parse(
        await app.vault.adapter.read(
            bookmarkSavePath
        )
    );
    let result = `# Surfing Bookmarks`;
    for (const item of data) {
        result += `- [${item.title}](${item.url})`;
    }
    return result;
}
