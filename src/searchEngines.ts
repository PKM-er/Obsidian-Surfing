// Search engines are their own module: the settings tab and the search
// suggester both need them, and importing the settings module from the
// suggester is circular.
export interface SearchEngine {
	name: string;
	url: string;
}

// Add search engines here for the future used.
export const SEARCH_ENGINES: SearchEngine[] = [
	{
		name: "Google",
		url: "https://www.google.com/search?q=",
	},
	{
		name: "Bing",
		url: "https://www.bing.com/search?q=",
	},
	{
		name: "Duckduckgo",
		url: "https://duckduckgo.com/?q=",
	},
	{
		name: "Yahoo",
		url: "https://search.yahoo.com/search?p=",
	},
	{
		name: "Baidu",
		url: "https://www.baidu.com/s?wd=",
	},
	{
		name: "Yandex",
		url: "https://yandex.com/search/?text=",
	},
	{
		name: "Wikipedia",
		url: "https://en.wikipedia.org/w/index.php?search=",
	},
];
