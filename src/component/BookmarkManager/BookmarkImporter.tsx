import React from "react";
import { Button, Upload, UploadProps } from "antd";
import { Bookmark } from "src/types/bookmark";
import { hashCode } from "./utils";
import { loadJson, saveJson } from "../../utils/json";
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

					const regex = /<DT><A HREF="(.*?)"\s*ADD_DATE="(.*?)".*?>(.*)<\/A>/gm;
					let bookmarkData;

					const {bookmarks, categories} = await loadJson();

					while ((bookmarkData = regex.exec(result)) !== null) {
						// This is necessary to avoid infinite loops with zero-width matches
						if (bookmarkData.index === regex.lastIndex) {
							regex.lastIndex++;
						}

						const categories = this.plugin.settings.bookmarkManager.defaultCategory.split(",").map((c: any) => c.trim());

						const newBookmark: Bookmark = {
							id: String(hashCode(bookmarkData[1])),
							name: bookmarkData[3],
							url: bookmarkData[1],
							description: "",
							category: categories.length > 0 ? categories : [""],
							tags: "",
							created: moment(bookmarkData[2], "X").valueOf() ?? moment().valueOf(),
							modified: moment(bookmarkData[2], "X").valueOf() ?? moment().valueOf(),
						};
						try {
							await handleSaveBookmark(newBookmark, bookmarks);
						} catch (err) {
							console.log(
								"Failed to import this bookmark!",
								newBookmark.name
							);
							new Notice(`import ${newBookmark.name} faield`);
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
		<Upload {...uploadProps}>
			<Button>Import</Button>
		</Upload>
	);
};

export default BookmarkImporter;
