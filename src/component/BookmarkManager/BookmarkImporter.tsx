import React from "react";
import { Button, Upload, UploadProps } from "antd";
import { Bookmark, CategoryType, FilterType } from "src/types/bookmark";
import { hashCode } from "./utils";
import { loadJson, saveJson } from "src/utils/json";
import { moment, Notice } from "obsidian";

interface Props {
	handleImportFinished: (importedBookmarks: Bookmark[]) => Promise<void>;
}

const BookmarkImporter: any = (Props: Props): any => {

	const handleSaveBookmark = async (newBookmark: Bookmark, bookmarks: Bookmark[]) => {
		const urlRegEx =
			/^(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._\+~#?&//=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/g;
		if (!urlRegEx.test(newBookmark.url)) {
			return;
		}

		try {
			const isBookmarkExist = bookmarks.some((bookmark) => {
				if (bookmark.url === newBookmark.url) {
					return true;
				} else {
					return false;
				}
			});

			if (!isBookmarkExist) {
				bookmarks.unshift(newBookmark);
			}
		} catch (err) {
			console.log(err);
		}
	};

	const uploadProps: UploadProps = {
		action: "",
		listType: "text",
		beforeUpload(file) {
			return new Promise((resolve) => {
				const reader = new FileReader();
				reader.readAsText(file, "utf-8");
				reader.onload = async () => {
					const result = reader.result as string;
					if (!result) return;

					const regex = /<DT><A HREF="(.*?)".*?>(.*)<\/A>/gm;
					let m;

					const { bookmarks, categories } = await loadJson();

					while ((m = regex.exec(result)) !== null) {
						// This is necessary to avoid infinite loops with zero-width matches
						if (m.index === regex.lastIndex) {
							regex.lastIndex++;
						}

						const newBookmark: Bookmark = {
							id: String(hashCode(m[1])),
							name: m[2],
							url: m[1],
							description: "",
							category: [],
							tags: "",
							created: moment().valueOf(),
							modified: moment().valueOf(),
						};
						try {
							await handleSaveBookmark(newBookmark, bookmarks);
						} catch (err) {
							console.log(
								"Failed to import this bookmark!",
								newBookmark.name
							);
							new Notice(`import ${ newBookmark.name } faield`);
						}
					}

					await saveJson({
						bookmarks,
						categories,
					});
					await Props.handleImportFinished(bookmarks);
				};

				reader.onloadend = async () => {
					new Notice("Import successfully!!!");
				};
			});
		},
	};

	return (
		<Upload { ...uploadProps }>
			<Button>Import</Button>
		</Upload>
	);
}

export default BookmarkImporter;
