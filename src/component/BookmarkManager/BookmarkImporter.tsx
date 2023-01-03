import React from "react";
import { Button, Upload, UploadProps } from "antd";
import moment from "moment";
import { Bookmark } from "src/types/bookmark";
import { hashCode } from "./utils";
import { loadJson, saveJson } from "src/utils/json";
import { Notice } from "obsidian";

const handleSaveBookmark = async (newBookmark: Bookmark) => {
	const urlRegEx =
		/^(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._\+~#?&//=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/g;
	if (!urlRegEx.test(newBookmark.url)) {
		return;
	}

	try {
		const { bookmarks, categories } = await loadJson();
		const isBookmarkExist = bookmarks.some((bookmark) => {
			if (bookmark.url === newBookmark.url) {
				return true;
			} else {
				return false;
			}
		});

		if (!isBookmarkExist) {
			bookmarks.unshift(newBookmark);
			saveJson({
				bookmarks,
				categories,
			});
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
						await handleSaveBookmark(newBookmark);
					} catch (err) {
						console.log(
							"Failed to import this bookmark!",
							newBookmark.name
						);
						new Notice(`import ${newBookmark.name} faield`);
					}
				}
			};

			reader.onloadend = () => {
				new Notice("Import success!!!");
			};
		});
	},
};

const BookmarkImporter: React.FC = () => (
	<Upload {...uploadProps}>
		<Button>Import</Button>
	</Upload>
);

export default BookmarkImporter;
