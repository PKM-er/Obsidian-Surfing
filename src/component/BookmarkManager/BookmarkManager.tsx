import { moment, prepareFuzzySearch } from "obsidian";
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
	TableProps,
	Tag,
	theme,
} from "antd";
import React, { KeyboardEventHandler, useEffect, useState } from "react";
import useStateRef from "react-usestateref";
import { generateColor, generateTagsOptions, stringToCategory } from "./utils";
import type { Bookmark, CategoryType } from "../../types/bookmark";
import { ColumnsType } from "antd/es/table";
import { CheckboxValueType } from "antd/es/checkbox/Group";
import { BookmarkForm } from "./BookmarkForm";
import BookmarkImporter from "./BookmarkImporter";
import SurfingPlugin from "src/surfingIndex";
import { saveJson } from "../../utils/json";
import { SurfingView } from "../../surfingView";
import { t } from "../../translations/helper";
import { FilterValue, SorterResult } from "antd/es/table/interface";
import { updateBookmarkBar } from "../BookMarkBar/BookMarkBar";

const columnOptions = [
	"name",
	"description",
	"url",
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
	categories: CategoryType[];
	plugin: SurfingPlugin;
}

export default function BookmarkManager(props: Props) {
	const [bookmarks, setBookmarks, bookmarksRef] = useStateRef(props.bookmarks);
	const [categories, setCategories] = useState(props.categories);
	const options = generateTagsOptions(bookmarks);
	const [currentBookmark, setCurrentBookmark] = useState(emptyBookmark);
	const [searchWord, setSearchWord] = useState("");
	const [currentPage, setCurrentPage] = useState(1);
	const [tagFiltered, setTagFiltered, tagFilteredRef] = useStateRef<Record<string, FilterValue | null>>({
		tags: null,
	});
	const [categoryFiltered, setCategoryFiltered, categoryFilteredRef] = useStateRef<Record<string, FilterValue | null>>({
		category: null,
	});
	const [sortedInfo, setSortedInfo, sortedInfoRef] = useStateRef<SorterResult<Bookmark>>({
		order: 'descend',
	});

	const defaultColumns: ColumnsType<Bookmark> = [
		{
			title: t("Name"),
			dataIndex: "name",
			key: "name",
			render: (text, record) => {
				return (
					<a
						href={record.url}
						onClick={(e) => {
							e.preventDefault();
							if (e.ctrlKey || e.metaKey) {
								window.open(record.url, "_blank", "external");
								return;
							}
							SurfingView.spawnWebBrowserView(true, {
								url: record.url,
							});
						}}
					>
						{text}
					</a>
				);
			},
			showSorterTooltip: false,
			sorter: (a, b) => {
				return a.name.localeCompare(b.name);
			},
			sortOrder: sortedInfo.columnKey === 'name' ? sortedInfo.order : null,
		},
		{
			title: t("Description"),
			dataIndex: "description",
			key: "description",
			onFilter: (value, record) => {
				return record.description.indexOf(value as string) === 0;
			},
		},
		{
			title: t("Url"),
			dataIndex: "url",
			key: "url",
		},
		{
			title: t("Category"),
			dataIndex: "category",
			key: "category",
			render: (value) => {
				if (value[0] === "") {
					return <p></p>;
				}
				return <p>{value.join(">")}</p>;
			},
			filters: stringToCategory(
				props.plugin.settings.bookmarkManager.category
			) as any,
			filterMode: props.plugin.settings.bookmarkManager
				.defaultFilterType as any,
			filterSearch: true,
			onFilter: (value, record) => {
				return record.category.includes(value as string) || (value === "ROOT" && !props.plugin.settings.bookmarkManager.category.contains(record.category[0] ? record.category[0] : ""));
			},
		},
		{
			title: t("Tags"),
			dataIndex: "tags",
			key: "tags",
			render: (text: string) => {
				if (!text) return "";
				return text.split(" ").map((tag: string) => {
					const color = generateColor(tag);
					return (
						<Tag color={color} key={tag} onClick={() => {
							let originalTags = null;
							if (tagFilteredRef.current.tags) {
								originalTags = tagFilteredRef.current.tags.slice();
								if (!originalTags.contains(tag)) originalTags = [...originalTags, tag];
							} else {
								originalTags = [tag];
							}

							setTagFiltered({
								...tagFilteredRef.current,
								tags: originalTags,
							});
						}}>
							{tag.toUpperCase()}
						</Tag>
					);
				});
			},
			filters: options.tagsOptions,
			onFilter: (value, record) => {
				if (value === "") return record.tags === "";
				return record.tags.indexOf(value as string) === 0;
			},
		},
		{
			title: t("Created"),
			dataIndex: "created",
			key: "created",
			render: (text: number) => {
				return <p>{moment(text).format("YYYY-MM-DD")}</p>;
			},
			sorter: (a, b) => a.created - b.created,
			sortOrder: sortedInfo.columnKey === 'created' ? sortedInfo.order : null,
		},
		{
			title: t("Modified"),
			dataIndex: "modified",
			key: "modified",
			render: (text: number) => {
				return <p>{moment(text).format("YYYY-MM-DD")}</p>;
			},
			sorter: (a, b) => {
				return a.modified - b.modified;
			},
			sortOrder: sortedInfo.columnKey === 'modified' ? sortedInfo.order : null,
		},
		{
			title: t("Action"),
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
						title="Are you sure to delete this bookmark?"
						onConfirm={() => {
							handleDeleteBookmark(record);
						}}
						onCancel={() => {
						}}
						okText="Yes"
						cancelText="No"
					>
						<a href="#">Delete</a>
					</Popconfirm>
				</Space>
			),
		},
	];

	const [checkedColumn, setCheckedColumn] = useState<CheckboxValueType[]>(
		props.plugin.settings.bookmarkManager.defaultColumnList
	);
	const [columns, setColumns, columnsRef] = useStateRef(defaultColumns.filter((column) => {
		return checkedColumn.includes(column.key as string) || column.key === "action";
	}));

	const handleChange: TableProps<Bookmark>['onChange'] = (pagination, filters, sorter) => {
		setSortedInfo(sorter as SorterResult<Bookmark>);

		if (filters.tags !== undefined) setTagFiltered(filters);
		else if (filters.category !== undefined) setCategoryFiltered(filters);
	};

	useEffect(() => {
		return () => {
			setColumns(columnsRef.current.map(item => {
				if (item.key === sortedInfoRef.current.columnKey) {
					return {
						...item,
						sortOrder: sortedInfoRef.current.order,
					};
				}
				if (item.key == "tags") {
					return {
						...item,
						filteredValue: tagFilteredRef.current.tags,
					};
				}
				if (item.key == "category") {
					return {
						...item,
						filteredValue: tagFilteredRef.current.category,
					};
				}
				return item;
			}));
		};
	}, [tagFiltered, categoryFiltered, sortedInfo]);

	const CheckboxGroup = Checkbox.Group;
	const onColumnChange = async (list: CheckboxValueType[]) => {
		const newColumns = defaultColumns.filter((column) => {
			return list.includes(column.key as string) || column.key === "action";
		});

		setColumns(newColumns);
		setCheckedColumn(list);
		props.plugin.settings.bookmarkManager.defaultColumnList = list as any;
		await props.plugin.saveSettings();
	};
	const [modalVisible, setModalVisible] = useState(false);

	useEffect(() => {
		return () => {
			const tempCategories = stringToCategory(
				props.plugin.settings.bookmarkManager.category
			);
			setCategories(tempCategories);

			if (tempCategories) {
				saveJson({
					bookmarks: bookmarks,
					categories: tempCategories,
				});
			}
		};
	}, [props.categories]);

	const handleSearch = (value: string) => {
		if (value === undefined) value = searchWord;

		const query = prepareFuzzySearch(value);

		if (value === "") {
			setBookmarks(props.bookmarks);
		} else {
			const filteredBookmarks = props.bookmarks.filter((bookmark) => {
				return (
					query(bookmark.name.toLocaleLowerCase())?.score ||
					query(bookmark.description.toLocaleLowerCase())?.score
				);
			});
			setBookmarks(filteredBookmarks);
		}

		setSearchWord(value);
	};

	const handleCancelSearch: KeyboardEventHandler<HTMLInputElement> = (
		event
	) => {
		if (event.key === "Escape") {
			setBookmarks(props.bookmarks);
			setSearchWord("");
		}
	};

	const handleAddBookmark = () => {
		setCurrentBookmark(emptyBookmark);
		setModalVisible(true);
	};

	const handleDeleteBookmark = async (oldBookmark: Bookmark) => {
		const newBookmarks = [...bookmarksRef.current];

		setBookmarks(newBookmarks.filter((bookmark) => bookmark.id !== oldBookmark.id));

		await saveJson({
			bookmarks: bookmarksRef.current,
			categories: props.categories,
		});

		updateBookmarkBar(bookmarksRef.current, props.categories, false);
	};

	const handleImportFinished = async (importedBookmarks: Bookmark[]): Promise<void> => {
		setBookmarks([...importedBookmarks]);
	};

	const handleModalOk = () => {
		setCurrentBookmark(emptyBookmark);
		setModalVisible(false);
	};

	const handleModalCancel = () => {
		setCurrentBookmark(emptyBookmark);
		setModalVisible(false);
	};

	const handleSaveBookmark = async (newBookmark: Bookmark, previousId: string) => {
		const isBookmarkExist = props.bookmarks.some((bookmark, index) => {
			if (
				bookmark.url === newBookmark.url ||
				bookmark.id === previousId
			) {
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
			bookmarks.unshift(newBookmark);
			setBookmarks(bookmarks);
			setModalVisible(false);
		}

		await saveJson({
			bookmarks: bookmarks,
			categories: props.categories,
		});

		updateBookmarkBar(bookmarks, props.categories, false);
	};

	const importProps = {
		handleImportFinished: (importedBookmarks: Bookmark[]) => handleImportFinished(importedBookmarks),
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
										handleSearch(e.target.value);
									}}
									defaultValue={searchWord}
									placeholder={` ${t("Search from ")} ${
										bookmarks.length
									} ${t(" bookmarks")} `}
									onPressEnter={(e) => {
										handleSearch(e.currentTarget.value);
									}}
									onKeyDown={handleCancelSearch}
									allowClear
								/>
								<Button onClick={handleAddBookmark}>+</Button>
								<BookmarkImporter {...importProps} />
							</div>
						</Col>
						<Col span={7} style={{marginTop: "5px"}}>
							<CheckboxGroup
								options={columnOptions}
								value={checkedColumn}
								onChange={onColumnChange}
							/>
						</Col>
					</Row>
				</div>
				<Table
					dataSource={bookmarksRef.current}
					key={new Date().toISOString()}
					columns={columns}
					pagination={{
						defaultCurrent: 1,
						current: currentPage,
						defaultPageSize: Number(
							props.plugin.settings.bookmarkManager.pagination
						),
						position: ["bottomCenter"],
						onChange: (page, pageSize) => {
							setCurrentPage(page);
						}
					}}
					scroll={{
						y: "100%",
						x: "fit-content",
					}}
					sticky={true}
					rowKey="id"
					showSorterTooltip={false}
					onChange={handleChange}
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
						categories={categories}
					></BookmarkForm>
				</Modal>
			</ConfigProvider>
		</div>
	);
}
