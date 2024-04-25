// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as obsidian from 'obsidian';
import { EditorPosition, EventRef, MarkdownPreviewRenderer, Scope } from "obsidian";
import { SurfingView } from "../surfingView";

declare module "obsidian" {
	export interface ItemView {
		headerEl: HTMLDivElement;
		titleContainerEl: HTMLDivElement;
	}

	interface FileView {
		allowNoFile: boolean;
	}

	interface FileView {
		allowNoFile: boolean;
	}

	interface App {
		plugins: {
			getPlugin(name: string): any;
			enabledPlugins: Set<string>;
			getPluginFolder(): string;
		};
		internalPlugins: {
			plugins: {
				[name: string]: {
					enabled: boolean;
					enable(): void;
					disable(): void;
					instance: any;
				};
			};
		};
		commands: any;
		getTheme: () => string;
	}

	interface Menu {
		close(): void;

		addSections(sections: any[]): Menu;
	}

	interface ItemView {
		scope: Scope;
	}

	interface HoverPopover {
		targetEl: HTMLElement;

		hide(): void;

		position({x, y, doc}: {
			x: number;
			y: number;
			doc: Document;
		}): void;
	}

	interface settings {
		applySettingsUpdate: () => void;
	}

	export interface WorkspaceLeaf {
		id: string

		history: {
			backHistory: Array<any>,
			forwardHistory: Array<any>
		},
		tabHeaderInnerIconEl: HTMLDivElement,
		tabHeaderInnerTitleEl: HTMLDivElement
		activeTime: number
		rebuildView: () => void;
		setDimension: (dimension: any) => void;
	}

	interface Workspace {
		on(name: 'surfing:page-change', callback: (url: string, view: SurfingView) => any, ctx?: any): EventRef;
	}

	export interface WorkspaceItem {
		type: string;
	}

	interface VaultSettings {
		showViewHeader: boolean;
	}

	export interface Vault {
		config: Record<string, unknown>;

		getConfig<T extends keyof VaultSettings>(setting: T): VaultSettings[T];

		setConfig<T extends keyof VaultSettings>(setting: T, value: any): void;
	}

	class MarkdownPreviewRendererStatic extends MarkdownPreviewRenderer {
		static registerDomEvents(el: HTMLElement, handlerInstance: unknown, cb: (el: HTMLElement) => unknown): void;
	}

	export interface View {
		contentEl: HTMLElement,
		editMode: any,
		sourceMode: any,
		canvas?: any,
	}

	export interface Editor {
		getClickableTokenAt: (editorPos: EditorPosition) => tokenType;
	}

	export interface MenuItem {
		setSubmenu: () => Menu;
	}

	export interface MarkdownView {
		triggerClickableToken: (token: tokenType, t: boolean | string) => void;
	}

	export interface MarkdownSourceView {
		triggerClickableToken: (token: tokenType, t: boolean | string) => void;
	}

	export interface MarkdownRenderer {
		constructor: (t: any, e: any, c: any) => any;
	}
}

export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface CanvasData {
	nodes: (CanvasFileData | CanvasTextData | CanvasLinkData)[];
	edges: CanvasEdgeData[];
}

export interface CanvasNodeData {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	color: string;
}

export interface CanvasEdgeData {
	id: string;
	fromNode: string;
	fromSide: Side;
	toNode: string;
	toSide: Side;
	color: string;
	label: string;
}

export interface CanvasFileData extends CanvasNodeData {
	type: 'file';
	file: string;
}

export interface CanvasTextData extends CanvasNodeData {
	type: 'text';
	text: string;
}

export interface CanvasLinkData extends CanvasNodeData {
	type: 'link';
	url: string;
}

export interface ISuggestOwner<T> {
	renderSuggestion(value: T, el: HTMLElement, index?: number): void;
}


interface tokenType {
	end: {
		line: number,
		ch: number
	};
	start: {
		line: number,
		ch: number
	};
	text: string;
	type: string;
}
