import { Button, Cascader, Form, Input, Select } from "antd";
import { DefaultOptionType } from "antd/es/select";
import { moment } from "obsidian";
import React, { ReactNode } from "react";
import { Bookmark, CategoryType, FilterType } from "../../types/bookmark";
import { fetchWebTitleAndDescription, hashCode, isValidURL } from "./utils";

const {Option} = Select;

interface Props {
	bookmark?: Bookmark;
	options: {
		tagsOptions: FilterType[];
	};
	categories: CategoryType[];
	handleSaveBookmark: (bookmark: Bookmark, previousID: string) => void;
}

interface FieldData {
	name: string | number | (string | number)[];
	value?: any;
	touched?: boolean;
	validating?: boolean;
	errors?: string[];
}

export function BookmarkForm(props: Props) {
	const [form] = Form.useForm();
	// const inputRef = useRef<InputRef>(null)
	// const [id, setID] = useState(props.bookmark?.id);
	// let index = 0
	if (!props.bookmark) return <></>;

	const {tagsOptions: tagsList} = props.options;

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
		if (!selectedOptions || !texts[0]) return null;
		return texts.map((text, i) => {
			const option = selectedOptions[i];
			if (!option?.value) return <span key={"ROOT"}>{text}</span>;
			if (i === texts.length - 1) {
				return <span key={option?.value}>{text}</span>;
			}
			return <span key={option?.value}>{text} / </span>;
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
		// 获取当前表单中的url字段
		const urlField = allFields.find((f: any) => f.name[0] === "url");
		const nameField = allFields.find((f: any) => f.name[0] === "name");

		if (!nameField?.value && urlField && isValidURL(urlField.value)) {
			try {
				const {title, description} =
					await fetchWebTitleAndDescription(urlField.value);

				if (title && description) {
					form.setFieldValue("name", title);
					form.setFieldValue("description", description);
				}
			} catch (err) {
				console.log(err);
			}
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
			created: moment(values.created, "YYYY-MM-DD HH:mm").valueOf(),
			modified: moment(values.modified, "YYYY-MM-DD HH:mm").valueOf(),
		};

		if (props.bookmark?.id) props.handleSaveBookmark(bookmark, props.bookmark?.id);
		else props.handleSaveBookmark(bookmark, "");
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
					{
						required: true,
						message: "Please input BookMarkBar name!",
					},
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
					{
						type: "url",
						required: true,
						message: "Please input BookMarkBar url!",
					},
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
				<Input.TextArea/>
			</Form.Item>
			<Form.Item
				label="Tags"
				name="tags"
				initialValue={
					props.bookmark.tags ? props.bookmark.tags?.split(" ") : []
				}
				rules={[{required: false, message: "Please input the tags!"}]}
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
					{required: false, message: "Please select the category!"},
				]}
				shouldUpdate
			>
				<Cascader
					displayRender={categoryDisplayRender}
					options={props.categories}
					changeOnSelect
				/>
			</Form.Item>
			<Form.Item
				label="Created Time"
				name="created"
				initialValue={moment(props.bookmark.created).format(
					"YYYY-MM-DD HH:mm"
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
					"YYYY-MM-DD HH:mm"
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
				<div className="submit-bar" style={{textAlign: "end"}}>
					<Button className="wb-reset-button" htmlType="button" onClick={onReset}>
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
