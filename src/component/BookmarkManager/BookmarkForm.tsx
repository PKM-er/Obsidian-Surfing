import { Form, Input, Select, Button, Cascader } from "antd";
import { DefaultOptionType } from "antd/es/select";
import moment from "moment";
import React, { ReactNode } from "react";
import { Bookmark, FilterType } from "./types";
import { fetchWebTitleAndDescription, hashCode, isValidURL } from "./utils";
const { Option } = Select;

interface Props {
	bookmark?: Bookmark;
	options: {
		tagsOptions: FilterType[];
	};
	handleSaveBookmark: (bookmark: Bookmark) => void;
}

interface FieldData {
	name: string | number | (string | number)[];
	value?: any;
	touched?: boolean;
	validating?: boolean;
	errors?: string[];
}

const defaultCategory = [
	{
		value: "计算机",
		text: "计算机",
		label: "计算机",
		children: [
			{
				value: "算法",
				text: "算法",
				label: "算法",
			},
			{
				value: "数据结构",
				text: "数据结构",
				label: "数据结构",
			},
		],
	},
	{
		value: "政治学",
		text: "政治学",
		label: "政治学",
		children: [
			{
				value: "比较政治",
				text: "比较政治",
				label: "比较政治",
			},
			{
				value: "地缘政治",
				text: "地缘政治",
				label: "地缘政治",
			},
		],
	},
];

export function BookmarkForm(props: Props) {
	const [form] = Form.useForm();
	// const inputRef = useRef<InputRef>(null)
	// const [name, setName] = useState("")
	// let index = 0
	if (!props.bookmark) return <></>;

	const { tagsOptions: tagsList } = props.options;

	// const [items, setItems] = useState(
	//     categoriesList.map((category) => {
	//         return category.value
	//     })
	// )

	// const handleAreaClick = (
	//     e: React.MouseEvent<HTMLAnchorElement>,
	//     label: string,
	//     option: DefaultOptionType
	// ) => {
	//     e.stopPropagation()
	//     console.log("clicked", label, option)
	// }

	const categoryDisplayRender = (
		texts: string[],
		selectedOptions?: DefaultOptionType[]
	): ReactNode => {
		console.log(texts);
		if (!selectedOptions || !texts[0]) return null;
		return texts.map((text, i) => {
			const option = selectedOptions[i];
			if (i === texts.length - 1) {
				return <span key={option.value}>{text}</span>;
			}
			return <span key={option.value}>{text} / </span>;
		});
	};

	if (props.bookmark && props.bookmark.id) {
		props.bookmark.modified = Date.now();
	}

	// const onNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
	//     setName(event.target.value)
	// }

	// const addItem = (e: React.MouseEvent<HTMLAnchorElement>) => {
	//     e.preventDefault()
	//     setItems([...items, name || `New item ${index++}`])
	//     setName("")
	//     setTimeout(() => {
	//         inputRef.current?.focus()
	//     }, 0)
	// }

	const onFieldsChange = async (
		changedFields: FieldData[],
		allFields: FieldData[]
	) => {
		console.log(changedFields, allFields);
		// 获取当前表单中的url字段
		const urlField = allFields.find((f: any) => f.name[0] === "url");

		if (urlField && isValidURL(urlField.value)) {
			const { name, description } = await fetchWebTitleAndDescription(
				urlField.value
			);
			form.setFieldValue("name", name);
			form.setFieldValue("description", description);
		}
	};
	// 定义表单提交的处理函数
	const onFinish = (values: {
		id: string;
		name: string;
		url: string;
		description: string;
		tags: string[];
		category: string[];
		created: number;
		modified: number;
	}) => {
		// 这里可以根据你的需要处理表单提交的数据
		const bookmark: Bookmark = {
			id: String(hashCode(values.url)),
			name: values.name,
			url: values.url,
			description: values.description,
			category: values.category,
			tags: values.tags.join(" "),
			created: values.created,
			modified: values.modified,
		};
		props.handleSaveBookmark(bookmark);
		form.resetFields();
	};

	const onReset = () => {
		form.resetFields();
	};

	return (
		<Form
			form={form}
			onFinish={onFinish}
			onFieldsChange={onFieldsChange}
			name="bookmark"
		>
			<Form.Item
				label="Name"
				name="name"
				rules={[
					{ required: true, message: "Please input bookmark name!" },
				]}
				initialValue={props.bookmark.name}
				shouldUpdate
			>
				<Input></Input>
			</Form.Item>
			<Form.Item
				label="URL"
				name="url"
				initialValue={props.bookmark.url}
				rules={[
					{ required: true, message: "Please input bookmark url!" },
				]}
				shouldUpdate
			>
				<Input></Input>
			</Form.Item>
			<Form.Item
				label="Description"
				name="description"
				initialValue={props.bookmark.description}
				rules={[
					{
						required: false,
						message: "Please input the description!",
					},
				]}
				shouldUpdate
			>
				<Input.TextArea />
			</Form.Item>
			<Form.Item
				label="Tags"
				name="tags"
				initialValue={
					props.bookmark.tags ? props.bookmark.tags?.split(" ") : []
				}
				rules={[{ required: false, message: "Please input the tags!" }]}
				shouldUpdate
			>
				<Select mode="tags" placeholder="Please select tags" allowClear>
					{tagsList.map((tag: FilterType, index: number) => {
						return (
							<Option
								value={tag.value}
								key={`${tag.value}-${index}`}
							>
								{tag.value}
							</Option>
						);
					})}
				</Select>
			</Form.Item>
			<Form.Item
				label="Category"
				name="category"
				initialValue={
					props.bookmark.category ? props.bookmark.category : ""
				}
				rules={[
					{ required: false, message: "Please select the category!" },
				]}
				shouldUpdate
			>
				<Cascader
					displayRender={categoryDisplayRender}
					options={defaultCategory}
				/>
			</Form.Item>
			<Form.Item
				label="Created Time"
				name="created"
				initialValue={moment(props.bookmark.created).format(
					"YYYY-MM-DD hh:ss"
				)}
				rules={[
					{
						required: true,
						message: "Please select the created time!",
					},
				]}
				shouldUpdate
			>
				<Input></Input>
			</Form.Item>
			<Form.Item
				label="Modified Time"
				name="modified"
				initialValue={moment(props.bookmark.modified).format(
					"YYYY-MM-DD hh:ss"
				)}
				rules={[
					{
						required: true,
						message: "Please select the modified time!",
					},
				]}
				shouldUpdate
			>
				<Input></Input>
			</Form.Item>
			<Form.Item>
				<div className="submit-bar" style={{ textAlign: "end" }}>
					<Button htmlType="button" onClick={onReset}>
						Reset
					</Button>
					<Button type="primary" htmlType="submit">
						Submit
					</Button>
				</div>
			</Form.Item>
		</Form>
	);
}
