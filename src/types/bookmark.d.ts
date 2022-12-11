export interface Bookmark {
	title: string;
	url: string;
	created?: string;
	star?: boolean | number;
	parent?: BookmarkFolder;
}

export interface BookmarkFolder {
	title: string;
	children: (Bookmark | BookmarkFolder)[];
	root: boolean;
	parent?: BookmarkFolder | undefined;
}
