import moment from "moment";
import {
	Button,
	Checkbox,
	Col,
	ConfigProvider,
	Input,
	Modal,
	Row,
	Space,
	Table,
	Tag,
	theme,
} from "antd";
import React, { KeyboardEventHandler, useState } from "react";
import { generateColor, generateTagsOptions } from "./utils";
import type { Bookmark } from "./types";
import { ColumnsType } from "antd/es/table";
import { CheckboxValueType } from "antd/es/checkbox/Group";
import { BookmarkForm } from "./BookmarkForm";



const defaultCategories = [
	{
		value: "计算机",
		text: "计算机",
		children: [
			{
				value: "算法",
				text: "算法",
			},
			{
				value: "数据结构",
				text: "数据结构",
			},
		],
	},
	{
		value: "政治学",
		text: "政治学",
		children: [
			{
				value: "比较政治",
				text: "比较政治",
			},
			{
				value: "地缘政治",
				text: "地缘政治",
			},
		],
	},
];

const columnOptions = [
	"name",
	"description",
	"category",
	"tags",
	"created",
	"modified",
];

const defaultColumnList = [
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
			filters: defaultCategories,
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
					<a
						onClick={() => {
							handleDeleteBookmark(record);
						}}
					>
						Delete
					</a>
				</Space>
			),
		},
	];

	const [columns, setColumns] = useState(defaultColumns);
	const [checkedColumn, setCheckedColumn] =
		useState<CheckboxValueType[]>(defaultColumnList);

	const CheckboxGroup = Checkbox.Group;
	const onColumnChange = (list: CheckboxValueType[]) => {
		const newColumns = defaultColumns.filter((column) => {
			return list.includes(column.title as string);
		});
		setColumns(newColumns);
		setCheckedColumn(list);
	};
	const [modalVisible, setModalVisible] = useState(false);

	const handleSearch = () => {
		const value = searchWord;
		if (!value) {
			setBookmarks(props.bookmarks);
		} else {
			const filteredBookmarks = bookmarks.filter((bookmark) => {
				return Object.values(bookmark)
					.join(" ")
					.toLowerCase()
					.includes(value.toLowerCase());
			});
			setBookmarks(filteredBookmarks);
		}
	};
	const handleCancelSearch: KeyboardEventHandler<HTMLInputElement> = (
		event
	) => {
		event.preventDefault();
		if (event.key === "Escape") {
			setBookmarks(props.bookmarks);
			setSearchWord("");
		}
	};

	const handleAddBookmark = () => {
		setCurrentBookmark(emptyBookmark);
		setModalVisible(true);
	};

	const handleDeleteBookmark = (oldBookmark: Bookmark) => {
		bookmarks.some((bookmark, index) => {
			if (bookmark.id === oldBookmark.id) {
				const newBookmarks = JSON.parse(JSON.stringify(bookmarks));
				newBookmarks.splice(index, 1);
				setBookmarks(newBookmarks);
			} else {
				console.log("Can't find this bookmark! data seems error!");
			}
		});
	};

	const handleModalOk = () => {
		setCurrentBookmark(emptyBookmark);
		setModalVisible(false);
	};
	const handleModalCancel = () => {
		setCurrentBookmark(emptyBookmark);
		setModalVisible(false);
	};
	const handleSaveBookmark = (newBookmark: Bookmark) => {
		console.log(newBookmark);
		const isBookmarkExist = props.bookmarks.some((bookmark, index) => {
			if (bookmark.url === newBookmark.url) {
				bookmarks[index] = newBookmark;
				setBookmarks(bookmarks);
				setModalVisible(false);
				setCurrentBookmark(emptyBookmark);
				return true;
			} else {
				return false;
			}
		});

		if (!isBookmarkExist) {
			console.log(newBookmark);
			bookmarks.push(newBookmark);
			setBookmarks(bookmarks);
			setModalVisible(false);
		}
	};
	return (
		<div className="App">
			<ConfigProvider
				theme={{
					algorithm: theme.darkAlgorithm,
				}}
			>
				<div className="header-bar">
					<Row gutter={[16, 16]}>
						<Col span={12}>
							<div className="search-bar">
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
								<Button
									onClick={handleAddBookmark}
									type="primary"
								>
									+
								</Button>
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
					columns={columns}
					pagination={{
						defaultPageSize: 14,
					}}
					rowKey="id"
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
					></BookmarkForm>
				</Modal>
			</ConfigProvider>
		</div>
	);
}
