export interface BookmarkFolder {
	name: string;
	children: (Bookmark | BookmarkFolder)[];
	root: boolean;
	parent?: BookmarkFolder | undefined;
}

export interface Bookmark {
	id: string,
	name: string,
	description: string,
	url: string,
	tags: string,
	category: string[],
	created: number,
	modified: number,
}

export interface FilterType {
	text: string
	value: string
}

export interface CategoryType {
	value: string
	label: string
	text: string
	children?: CategoryType[]
}
