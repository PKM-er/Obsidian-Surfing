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
};

export const CustomNode: React.FC<Props> = (props) => {
	const { droppable, data } = props.node;
	const indent = props.depth * 24;

	const handleToggle = (e: React.MouseEvent) => {
		e.stopPropagation();
		props.onToggle(props.node.id);
	};

	return (
		<div
			className={ `tree-node ${ styles.root }` }
			style={ { paddingInlineStart: indent } }
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
				<Typography>{ `${ props.node.text }` }</Typography>
			</div>
		</div>
	);
};

