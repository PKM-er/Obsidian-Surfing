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
import { CustomDragPreview } from "./CustomDragPreview";
import { ItemView } from "obsidian";
import { SurfingView, WEB_BROWSER_VIEW_ID } from "../../surfingView";

interface Props {
	plugin: SurfingPlugin;
}

export default function TabTree(props: Props) {
	const [treeData, setTreeData] = useState<NodeModel<CustomData>[]>([]);
	const handleDrop = (newTree: NodeModel<CustomData>[]) => setTreeData(newTree);

	const [selectedNode, setSelectedNode] = useState<NodeModel<CustomData> | null>(null);
	const handleSelect = (node: NodeModel) => {
		setSelectedNode(node as NodeModel<CustomData>);
	};

	React.useEffect(() => {
		const leaves = props.plugin.app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID);
		const nodes = leaves.map((leaf) => ({
			"id": leaf.id,
			"parent": 0,
			"droppable": true,
			"text": (leaf.view as SurfingView).currentTitle,
			"data": {
				"fileType": "site",
				"fileSize": "",
				"icon": (leaf.view as SurfingView).favicon,
			}
		}));
		setTreeData([...treeData, ...nodes]);

		return () => {
			leaves.forEach((leaf) => {
				if (checkExist(leaf.id)) {
					setTreeData([
						...treeData,
						{
							"id": leaf.id,
							"parent": 0,
							"droppable": true,
							"text": (leaf.view as SurfingView).currentTitle,
							"data": {
								"fileType": "site",
								"fileSize": "",
								"icon": (leaf.view as SurfingView).favicon,
							}
						}
					]);
					(leaf.view as SurfingView).webviewEl.addEventListener("dom-ready", () => {
						updateTabsData(leaf.view as SurfingView);
					});
				}
			});
		};
	}, []);

	const updateTabsData = React.useCallback((activeView: SurfingView) => {
		setTreeData((prevTreeData) => {
			const existingNodeIndex = prevTreeData.findIndex(node => node.id === activeView.leaf.id);
			if (existingNodeIndex !== -1) {
				// If the node already exists in the tree, update its text and icon
				const existingNode = prevTreeData[existingNodeIndex];
				return [
					...prevTreeData.slice(0, existingNodeIndex),
					{
						...existingNode,
						text: activeView.currentTitle,
						data: {
							...existingNode.data,
							icon: activeView.favicon,
						},
					},
					...prevTreeData.slice(existingNodeIndex + 1),
				];
			} else {
				// If the node does not exist in the tree, add it to the tree
				return [
					...prevTreeData,
					{
						"id": activeView.leaf.id,
						"parent": 0,
						"droppable": true,
						"text": activeView.currentTitle,
						"data": {
							"fileType": "site",
							"fileSize": "",
							"icon": activeView.favicon,
						},
					},
				];
			}
		});
	}, []);

	const checkExist = (leafID: string) => {
		return !treeData.some(obj => obj.id === leafID);
	};

	props.plugin.app.workspace.on("layout-change", () => {
		const activeView = props.plugin.app.workspace.getActiveViewOfType(ItemView);
		if (activeView?.getViewType() === WEB_BROWSER_VIEW_ID && checkExist(activeView.leaf.id)) {
			updateTabsData(activeView as SurfingView);
			(activeView as SurfingView).webviewEl.addEventListener("dom-ready", () => {
				updateTabsData(activeView as SurfingView);
			});
		}
	});


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
							isSelected={ node.id === selectedNode?.id }
							onSelect={ handleSelect }
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
