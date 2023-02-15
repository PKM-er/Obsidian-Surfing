import React from "react";
import { Typography } from 'antd';
import { ArrowRightOutlined } from "@ant-design/icons";
import { NodeModel } from "@minoru/react-dnd-treeview";
import { CustomData } from "./types";
import { TypeIcon } from "./TypeIcon";
import styles from './CustomNode.module.css';

type Props = {
	node: NodeModel<CustomData>;
	depth: number;
	isOpen: boolean;
	hasChild: boolean;
	onToggle: (id: NodeModel["id"]) => void;
	onSelect: (node: NodeModel) => void;
	isSelected: boolean;
};

export const CustomNode: React.FC<Props> = (props) => {
	const { droppable, data } = props.node;
	const indent = props.depth * 24;

	const { Paragraph } = Typography;

	const handleToggle = (e: React.MouseEvent) => {
		e.stopPropagation();
		props.onToggle(props.node.id);
	};

	const handleSelect = () => props.onSelect(props.node);

	const handleClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		const leafId = String(props.node.id);
		const leaf = app.workspace.getLeafById(leafId);
		app.workspace.setActiveLeaf(leaf);
		handleSelect();
		// app.workspace.revealLeaf(leaf);
	}


	return (
		<div
			className={ `tree-node ${ styles.root } ${
				props.isSelected ? styles.isSelected : ""
			}` }
			style={ { paddingInlineStart: indent } }
			onClick={ handleClick }
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
					tooltip: true,
				} }
						   style={ { marginBottom: 0 } }
				>{ `${ props.node.text }` }</Paragraph>
			</div>
		</div>
	);
};

