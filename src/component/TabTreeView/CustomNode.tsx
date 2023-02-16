import React from "react";
import { Typography } from 'antd';
import { ArrowRightOutlined } from "@ant-design/icons";
import { NodeModel } from "@minoru/react-dnd-treeview";
import { CustomData } from "./types";
import { TypeIcon } from "./TypeIcon";
import styles from './CustomNode.module.css';
import { Menu, Notice } from "obsidian";
import { random, SaveWorkspaceModal } from "./workspace";

type Props = {
	node: NodeModel<CustomData>;
	depth: number;
	isOpen: boolean;
	hasChild: boolean;
	onToggle: (id: NodeModel["id"]) => void;
	onSelect: (node: NodeModel) => void;
	isSelected: boolean;
};

const TREE_X_OFFSET = 24;

export const CustomNode: React.FC<Props> = (props) => {
	const { droppable, data } = props.node;
	const indent = props.depth * TREE_X_OFFSET;

	const { Paragraph } = Typography;

	const handleToggle = (e: React.MouseEvent) => {
		e.stopPropagation();
		props.onToggle(props.node.id);
	};

	const handleSelect = () => props.onSelect(props.node);

	const handleClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		const leaf = app.workspace.getLeafById(String(props.node.id));
		if (!leaf) return;

		app.workspace.setActiveLeaf(leaf);
		handleSelect();
		// app.workspace.revealLeaf(leaf);
	}

	const handleContextMenu = (e: React.MouseEvent) => {
		e.stopPropagation();
		e.preventDefault();

		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle("Not Ready Yet")
				.setIcon("surfing")
				.onClick(() => {
					new Notice("Not Ready Yet");
				});
		});
		menu.showAtPosition({ x: e.clientX, y: e.clientY });
	}


	return (
		<div
			className={ `tree-node ${ styles.root } ${
				props.isSelected ? styles.isSelected : ""
			}` }
			style={ { paddingInlineStart: indent } }
			onClick={ handleClick }
			onContextMenu={ handleContextMenu }
		>
			<div
				className={ `${ styles.expandIconWrapper } ${
					props.isOpen ? styles.isOpen : ""
				}` }
			>
				{ props.hasChild && (
					<ArrowRightOutlined onClick={ handleToggle } size={ 24 }/>
				) }
			</div>
			<div>
				<TypeIcon droppable={ droppable || false } fileType={ data?.fileType }/>
			</div>
			<div className={ styles.labelGridItem }>
				<Paragraph ellipsis={ {
					rows: 1,
					expandable: false,
					tooltip: false,
				} }
						   style={ { marginBottom: 0 } }
				>{ `${ props.node.text }` }</Paragraph>
			</div>
		</div>
	);
};

