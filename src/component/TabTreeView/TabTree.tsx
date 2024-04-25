import SurfingPlugin from "../../surfingIndex";
import React, { useEffect, useState } from "react";
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
import { ItemView, Menu } from "obsidian";
import { SurfingView, WEB_BROWSER_VIEW_ID } from "../../surfingView";
import { random, SaveWorkspaceModal } from "./workspace";
import { CrownTwoTone } from "@ant-design/icons";

interface Props {
	plugin: SurfingPlugin;
}

export const useDndProvider = () => {
	const [dndArea, setDndArea] = useState<Node | undefined>();
	const handleRef = React.useCallback((node: Node | undefined | null) => setDndArea(node as Node), []);

	useEffect(() => {
		const view = document.body.find(`div[data-type="surfing-tab-tree"]`);
		setDndArea(view);
	}, []);

	const html5Options = React.useMemo(
		() => ({rootElement: dndArea}),
		[dndArea]
	);
	return {dndArea, handleRef, html5Options};
};

export default function TabTree(props: Props) {
	const [treeData, setTreeData] = useState<NodeModel<CustomData>[]>(props.plugin.settings.treeData || []);
	const handleDrop = (newTree: NodeModel<CustomData>[]) => setTreeData(newTree);
	const {dndArea, handleRef, html5Options} = useDndProvider();

	const [selectedNode, setSelectedNode] = useState<NodeModel<CustomData> | null>(null);
	const handleSelect = (node: NodeModel) => {
		setSelectedNode(node as NodeModel<CustomData>);
	};


	const handleContextMenu = (e: React.MouseEvent) => {
		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle("New Group")
				.setIcon("folder")
				.onClick(() => {
					new SaveWorkspaceModal(props.plugin.app, props.plugin, (result) => {
						const newGroup = {
							"id": random(16),
							"parent": 0,
							"droppable": true,
							"text": result,
							"data": {
								"fileType": "workspace",
								"fileSize": "",
								"icon": "folder",
							}
						};
						setTreeData([...treeData, newGroup]);
					}).open();
				});
		});
		menu.showAtPosition({x: e.clientX, y: e.clientY});
	};


	React.useEffect(() => {
		const leafIndex = treeData.findIndex((node) => node.data?.fileType === "site");
		if (leafIndex === -1) return;
		const leafId = String(treeData[leafIndex].id);
		const leaf = app.workspace.getLeafById(leafId);
		if (!leaf) {
			setTreeData([]);
			props.plugin.settings.treeData = [];
			props.plugin.settingsTab.applySettingsUpdate();
			return;
		}
		if (!treeData) return;
		props.plugin.settings.treeData = treeData;
		props.plugin.settingsTab.applySettingsUpdate();
	}, [treeData]);

	React.useEffect(() => {
		if (treeData.length > 0) return;
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
						updateTabsData(leaf.view as SurfingView, '');
					});
				}
			});
		};
	}, []);

	const updateTabsData = React.useCallback((activeView: SurfingView, url: string) => {
		//@ts-ignore
		setTreeData((prevTreeData) => {
			const existingNodeIndex = prevTreeData.findIndex(node => node.id === activeView.leaf.id);
			if (existingNodeIndex !== -1) {
				// If the node already exists in the tree, update its text and icon
				const existingNode = prevTreeData[existingNodeIndex];
				return [
					...prevTreeData.slice(0, existingNodeIndex),
					{
						...existingNode,
						text: url || activeView.currentTitle,
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
						"text": url || activeView.currentTitle,
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

	useEffect(() => {
		props.plugin.app.workspace.on('surfing:page-change', (url: string, view: SurfingView) => {
			if (checkExist(view.leaf.id)) {
				updateTabsData(view, url);
			}
		});


		props.plugin.app.workspace.on("layout-change", () => {
			// const activeView = props.plugin.app.workspace.getActiveViewOfType(ItemView);
			// if (activeView?.getViewType() === WEB_BROWSER_VIEW_ID && checkExist(activeView.leaf.id)) {
			// 	updateTabsData(activeView as SurfingView);
			// 	(activeView as SurfingView).webviewEl.addEventListener("dom-ready", () => {
			// 		updateTabsData(activeView as SurfingView);
			// 	});
			// 	return;
			// }

			const leaves = props.plugin.app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID);
			if (leaves.length === 0) {
				setTreeData([]);
				return;
			}
		});
	}, []);

	return (
		treeData.length > 0 ? (
			<div ref={handleRef} className={styles.container}>
				<DndProvider backend={MultiBackend} options={getBackendOptions(
					{
						html5: {
							rootElement: dndArea
						}
					}
				)}>
					<div className={styles.app} onContextMenu={handleContextMenu}>
						<Tree
							tree={treeData}
							rootId={0}
							render={(node, {depth, isOpen, hasChild, onToggle}) => (
								<CustomNode
									node={node}
									depth={depth}
									isOpen={isOpen}
									onToggle={onToggle}
									hasChild={hasChild}
									isSelected={node.id === selectedNode?.id}
									onSelect={handleSelect}
								/>
							)}
							dragPreviewRender={(monitorProps) => (
								<CustomDragPreview monitorProps={monitorProps}/>
							)}
							onDrop={handleDrop}
							classes={{
								root: styles.treeRoot,
								draggingSource: styles.draggingSource,
								placeholder: styles.placeholderContainer
							}}
							sort={false}
							insertDroppableFirst={false}
							canDrop={(tree, {dragSource, dropTargetId}) => {
								if (dragSource?.parent === dropTargetId) {
									return true;
								}
							}}
							dropTargetOffset={10}
							placeholderRender={(node, {depth}) => (
								<Placeholder node={node} depth={depth}/>
							)}
						/>
					</div>
				</DndProvider>
			</div>

		) : (<div className={`${styles.app} tab-tree-empty-container`}>
			<div className={`tab-tree-empty-state`}>
				<CrownTwoTone size={64} width={64} height={64}/>
				<span>
				{"No surfing tabs open"}
			</span>
			</div>
		</div>)

	);
}
