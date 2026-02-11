export type CustomData = {
	fileType: string;
	fileSize: string;
	icon: HTMLImageElement | string;
};

export interface TreeNode {
	id: string;
	parent: number;
	droppable: boolean;
	text: string;
	data: CustomData;
}
