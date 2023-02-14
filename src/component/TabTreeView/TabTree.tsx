import SurfingPlugin from "../../surfingIndex";
import React, { useState } from "react";
import { DndProvider } from "react-dnd";
import {
	Tree,
	NodeModel,
	MultiBackend,
	getBackendOptions
} from "@minoru/react-dnd-treeview";
import { CustomData } from "./types";
import { CustomNode } from "./CustomNode";
import { Placeholder } from "./Placeholder";
import styles from './TabTree.module.css';
import { SampleData } from "./sample_data";
import { CustomDragPreview } from "./CustomDragPreview";
import { ItemView } from "obsidian";
import { SurfingView, WEB_BROWSER_VIEW_ID } from "../../surfingView";

interface Props {
	plugin: SurfingPlugin;
}

export default function TabTree(props: Props) {
	const [treeData, setTreeData] = useState<NodeModel<CustomData>[]>([]);
	const handleDrop = (newTree: NodeModel<CustomData>[]) => setTreeData(newTree);

	React.useEffect(() => {
		return () => {
			props.plugin.app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID).forEach(
				(leaf) => {
					const surfingView = leaf.view as SurfingView;
					setTreeData([
						...treeData,
						{
							"id": treeData.length + 1,
							"parent": 0,
							"droppable": true,
							"text": surfingView.currentTitle,
							"data": {
								"fileType": "site",
								"fileSize": "",
								"leafID": surfingView.leaf.id,
								"icon": surfingView.favicon.src,
							}
						}
					]);
				}
			);
		};
	}, []);


	props.plugin.app.workspace.on("layout-change", () => {
		const activeView = this.app.workspace.getActiveViewOfType(ItemView);
		if (activeView?.getViewType() === WEB_BROWSER_VIEW_ID && checkExist(activeView.leaf.id)) {
			updateTabsData(activeView);
		}
	});

	const checkExist = (leafID: string) => {
		return !treeData.some(obj => obj.leafID === leafID);
	};

	const updateTabsData = (activeView: SurfingView) => {
		setTreeData([
			...treeData,
			{
				"id": treeData.length + 1,
				"parent": 0,
				"droppable": true,
				"text": activeView.currentTitle,
				"data": {
					"fileType": "site",
					"fileSize": "",
					"leafID": activeView.leaf.id,
					"icon": activeView.favicon.src,
				}
			}
		]);
	};


	return (
		<DndProvider backend={ MultiBackend } options={ getBackendOptions() }>
			<div className={ styles.app }>
				<Tree
					tree={ treeData }
					rootId={ 0 }
					render={ (node, { depth, isOpen, hasChild, onToggle }) => (
						<CustomNode
							node={ node }
							depth={ depth }
							isOpen={ isOpen }
							onToggle={ onToggle }
							hasChild={ hasChild }
						/>
					) }
					dragPreviewRender={ (monitorProps) => (
						<CustomDragPreview monitorProps={ monitorProps }/>
					) }
					onDrop={ handleDrop }
					classes={ {
						root: styles.treeRoot,
						draggingSource: styles.draggingSource,
						placeholder: styles.placeholderContainer
					} }
					sort={ false }
					insertDroppableFirst={ false }
					canDrop={ (tree, { dragSource, dropTargetId, dropTarget }) => {
						if (dragSource?.parent === dropTargetId) {
							return true;
						}
					} }
					dropTargetOffset={ 10 }
					placeholderRender={ (node, { depth }) => (
						<Placeholder node={ node } depth={ depth }/>
					) }
				/>
			</div>
		</DndProvider>
	);
}
