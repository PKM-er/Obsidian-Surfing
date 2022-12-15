import { moment, Notice } from "obsidian";
import {
	Button,
	Checkbox,
	Col,
	ConfigProvider,
	Input,
	Modal,
	Popconfirm,
	Row,
	Space,
	Table,
	Tag,
	theme,
} from "antd";
import React, { KeyboardEventHandler, useState } from "react";
import { generateColor, generateTagsOptions, parseList } from "./utils";
import type { Bookmark } from "../../types/bookmark";
import { ColumnsType } from "antd/es/table";
import { CheckboxValueType } from "antd/es/checkbox/Group";
import { BookmarkForm } from "./BookmarkForm";
import SurfingPlugin from "src/surfingIndex";
import { saveJson } from "src/utils/json";

const columnOptions = [
	"name",
	"description",
	"category",
	"tags",
	"created",
	"modified",
];

const emptyBookmark = {
	id: "",
	name: "",
	description: "",
	url: "",
	tags: "",
	category: [""],
	created: moment().valueOf(),
	modified: moment().valueOf(),
};

interface Props {
	bookmarks: Bookmark[];
	plugin: SurfingPlugin;
}

export default function BookmarkManager(props: Props) {
	const [bookmarks, setBookmarks] = useState(props.bookmarks);
	const options = generateTagsOptions(bookmarks);
	const [currentBookmark, setCurrentBookmark] = useState(emptyBookmark);
	const [searchWord, setSearchWord] = useState("");

	const defaultColumns: ColumnsType<Bookmark> = [
		{
			title: "name",
			dataIndex: "name",
			key: "name",
			render: (text, record) => {
				return <a href={record.url}>{text}</a>;
			},
			sorter: (a, b) => {
				return a.name.localeCompare(b.name);
			},
		},
		{
			title: "description",
			dataIndex: "description",
			key: "description",
			onFilter: (value, record) => {
				return record.description.indexOf(value as string) === 0;
			},
		},
		{
			title: "url",
			dataIndex: "url",
			key: "url",
		},
		{
			title: "category",
			dataIndex: "category",
			key: "category",
			render: (value) => {
				if (value[0] === "") {
					return <p></p>;
				}
				return <p>{value.join(">")}</p>;
			},
			filters: parseList(
				props.plugin.settings.bookmarkManager.category,
				0
			) as any,
			onFilter: (value, record) => {
				return record.category.includes(value as string);
			},
		},
		{
			title: "tags",
			dataIndex: "tags",
			key: "tags",
			render: (text: string) => {
				if (!text) return "";
				return text.split(" ").map((tag: string) => {
					const color = generateColor(tag);
					return (
						<Tag color={color} key={tag}>
							{tag.toUpperCase()}
						</Tag>
					);
				});
			},
			filters: options.tagsOptions,
			onFilter: (value, record) => {
				return record.tags.indexOf(value as string) === 0;
			},
		},
		{
			title: "created",
			dataIndex: "created",
			key: "created",
			render: (text: number) => {
				return <p>{moment(text).format("YYYY-MM-DD")}</p>;
			},
			sorter: (a, b) => a.created - b.created,
		},
		{
			title: "modified",
			dataIndex: "modified",
			key: "modified",
			render: (text: number) => {
				return <p>{moment(text).format("YYYY-MM-DD")}</p>;
			},
			sorter: (a, b) => a.modified - b.modified,
		},
		{
			title: "Action",
			dataIndex: "action",
			key: "action",
			render: (text, record) => (
				<Space size="middle">
					<a
						onClick={() => {
							setCurrentBookmark(record);
							setModalVisible(true);
						}}
					>
						Edit
					</a>
					<Popconfirm
						title="Are you sure to delete this task?"
						onConfirm={() => {
							handleDeleteBookmark(record);
						}}
						onCancel={() => {}}
						okText="Yes"
						cancelText="No"
					>
						<a href="#">Delete</a>
					</Popconfirm>
				</Space>
			),
		},
	];

	const [columns, setColumns] = useState(defaultColumns);
	const [checkedColumn, setCheckedColumn] = useState<CheckboxValueType[]>(
		props.plugin.settings.bookmarkManager.defaultColumnList
	);

	const CheckboxGroup = Checkbox.Group;
	const onColumnChange = async (list: CheckboxValueType[]) => {
		const newColumns = defaultColumns.filter((column) => {
			return list.includes(column.title as string);
		});
		setColumns(newColumns);
		setCheckedColumn(list);
		props.plugin.settings.bookmarkManager.defaultColumnList = list as any;
		await props.plugin.saveSettings();
	};
	const [modalVisible, setModalVisible] = useState(false);

	const handleSearch = () => {
		const value = searchWord;
		if (value === "") {
			setBookmarks(bookmarks);
		} else {
			const filteredBookmarks = bookmarks.filter((bookmark) => {
				return (
					bookmark.name
						.toLocaleLowerCase()
						.includes(value.toLocaleLowerCase()) ||
					bookmark.description
						.toLocaleLowerCase()
						.includes(value.toLocaleLowerCase())
				);
			});
			setBookmarks(filteredBookmarks);
		}
	};
	const handleCancelSearch: KeyboardEventHandler<HTMLInputElement> = (
		event
	) => {
		if (event.key === "Escape") {
			setBookmarks(bookmarks);
			setSearchWord("");
		}
	};

	const handleAddBookmark = () => {
		setCurrentBookmark(emptyBookmark);
		setModalVisible(true);
	};

	const handleDeleteBookmark = async (oldBookmark: Bookmark) => {
		let bookmarkIndex: number | null = null;
		const isBookmarkExist = bookmarks.some((bookmark, index) => {
			if (bookmark.id === oldBookmark.id) {
				bookmarkIndex = index;
				return true;
			} else {
				return false;
			}
		});
		if (isBookmarkExist && bookmarkIndex != null) {
			try {
                // console.log(bookmarkIndex, oldBookmark, bookmarks)
                const newBookmarks = [...bookmarks]
				newBookmarks.splice(bookmarkIndex, 1);
                // console.log("newBookmarks", newBookmarks)
				setBookmarks(newBookmarks);
                // console.log("modified:", bookmarks)
				await saveJson({ bookmarks: newBookmarks });
                new Notice("Delete success!")
			} catch (err) {
				new Notice("Bookmark save to Json error");
			}
		} else if(!isBookmarkExist){
			new Notice("Can't find this Bookmark! data seems error!");
			console.log("Can't find this Bookmark! data seems error!");
		}else{
            new Notice('Delete bookmark failed!')
        }
	};

	const handleModalOk = () => {
		setCurrentBookmark(emptyBookmark);
		setModalVisible(false);
	};
	const handleModalCancel = () => {
		setCurrentBookmark(emptyBookmark);
		setModalVisible(false);
	};
	const handleSaveBookmark = async (newBookmark: Bookmark) => {
		let newBookmarkIndex: null | number = null;
		const isBookmarkExist = bookmarks.some((bookmark, index) => {
			if (bookmark.id === newBookmark.id) {
				newBookmarkIndex = index;
				return true;
			} else {
				return false;
			}
		});

		if (isBookmarkExist && newBookmarkIndex != null) {
			bookmarks.splice(newBookmarkIndex, 1, newBookmark);
			setBookmarks(bookmarks);
			setModalVisible(false);
			setCurrentBookmark(emptyBookmark);
			await saveJson({ bookmarks });
		} else if (!isBookmarkExist) {
			bookmarks.unshift(newBookmark);
			setBookmarks(bookmarks);
			setModalVisible(false);
			await saveJson({ bookmarks });
		} else {
			console.log("Error! Cant't find the bookmark to save!");
		}
	};
	return (
		<div className="surfing-bookmark-manager">
			<ConfigProvider
				theme={{
					algorithm:
						app.getTheme() === "obsidian"
							? theme.darkAlgorithm
							: theme.defaultAlgorithm,
				}}
			>
				<div className="surfing-bookmark-manager-header-bar">
					<Row gutter={[16, 16]}>
						<Col span={12}>
							<div className="surfing-bookmark-manager-search-bar">
								<Input
									value={searchWord}
									onChange={(e) => {
										setSearchWord(e.target.value);
										handleSearch();
									}}
									defaultValue={searchWord}
									placeholder={`Search from ${bookmarks.length} bookmarks`}
									onPressEnter={handleSearch}
									onKeyDown={handleCancelSearch}
									allowClear
								/>
								<Button onClick={handleAddBookmark}>+</Button>
							</div>
						</Col>
						<Col span={6} style={{ marginTop: "5px" }}>
							<CheckboxGroup
								options={columnOptions}
								value={checkedColumn}
								onChange={onColumnChange}
							/>
						</Col>
					</Row>
				</div>
				<Table
					dataSource={bookmarks}
					key={new Date().toISOString()}
					rowKey={(record) => record.id}
					columns={columns}
					pagination={{
						defaultPageSize: Number(
							props.plugin.settings.bookmarkManager.pagination
						),
					}}
				></Table>
				<Modal
					title="Bookmark"
					key={currentBookmark.id}
					keyboard={true}
					open={modalVisible}
					onOk={handleModalOk}
					onCancel={handleModalCancel}
					footer={[null]}
				>
					<BookmarkForm
						bookmark={currentBookmark}
						options={options}
						handleSaveBookmark={handleSaveBookmark}
						categories={parseList(
							props.plugin.settings.bookmarkManager.category,
							0
						)}
					></BookmarkForm>
				</Modal>
			</ConfigProvider>
		</div>
	);
}
