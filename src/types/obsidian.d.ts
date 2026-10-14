import type {
	EditorPosition,
	EventRef,
	HoverParent,
	MarkdownPreviewRenderer,
	Scope,
	TAbstractFile,
	TFile,
} from "obsidian";
import type SurfingPlugin from "../surfingIndex";
import type { SurfingView } from "../surfingView";

declare module "obsidian" {
	export interface ItemView {
		headerEl: HTMLDivElement;
		titleContainerEl: HTMLDivElement;
	}

	interface FileView {
		allowNoFile: boolean;
	}

	/** Obsidian's Hover Editor community plugin, the part Surfing uses. */
	interface HoverEditorPlugin extends Plugin {
		spawnPopover(initiatingEl?: HTMLElement): Promise<WorkspaceLeaf>;
	}

	/** An internal (core) plugin; `instance` depends on the plugin. */
	interface InternalPlugin<Instance = unknown> {
		enabled: boolean;
		enable(): void;
		disable(): void;
		instance: Instance;
	}

	/** The Page preview core plugin's instance. */
	interface PagePreviewInstance {
		onLinkHover(
			hoverParent: HoverParent,
			targetEl: HTMLElement | null,
			linktext: string,
			sourcePath: string,
			state?: unknown,
			...args: unknown[]
		): void;
	}

	/** Builds the component that renders an embed. */
	type EmbedCreator = (context: EmbedContext, file: TFile, subpath: string) => EmbedComponent;

	/** What the app needs of an embed: loaded and unloaded with the note that shows it. */
	interface EmbedComponent {
		load(): void;
		unload(): void;
	}

	interface EmbedContext {
		url?: string;
		containerEl: HTMLElement;
	}

	interface App {
		/** Id of this vault, which names its browser session partition. */
		appId: string;
		plugins: {
			getPlugin(name: "surfing"): SurfingPlugin;
			getPlugin(name: "obsidian-hover-editor"): HoverEditorPlugin | null;
			getPlugin(name: string): Plugin | null;
			enabledPlugins: Set<string>;
			getPluginFolder(): string;
		};
		internalPlugins: {
			plugins: {
				[name: string]: InternalPlugin;
				"page-preview": InternalPlugin<PagePreviewInstance>;
			};
			getPluginById?(id: string): InternalPlugin | null;
		};
		commands: {
			executeCommandById(id: string): boolean;
			removeCommand(id: string): void;
		};
		setting: {
			open(): void;
			openTabById(id: string): void;
		};
		/** Renders files by extension when they are embedded (`![[file.html]]`). */
		embedRegistry: {
			registerExtension(extension: string, embedCreator: EmbedCreator): void;
			unregisterExtension(extension: string): void;
		};
		getTheme: () => string;
	}

	interface Menu {
		close(): void;

		addSections(sections: string[]): Menu;
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

	/** One entry of a tab's back/forward history. */
	interface LeafHistoryEntry {
		state?: {
			type?: string;
			state?: Record<string, unknown>;
		};
		title?: string;
		icon?: string;
	}

	export interface WorkspaceLeaf {
		id: string

		history: {
			backHistory: Array<LeafHistoryEntry>,
			forwardHistory: Array<LeafHistoryEntry>,
			back(): void;
			forward(): void;
		},
		tabHeaderInnerIconEl: HTMLDivElement,
		tabHeaderInnerTitleEl: HTMLDivElement
		activeTime: number
		rebuildView: () => void;
		setDimension: (dimension: unknown) => void;
	}

	interface Workspace {
		on(name: 'surfing:page-change', callback: (url: string, view: SurfingView) => unknown, ctx?: unknown): EventRef;

		/** Adds the context-menu items of an external link. */
		handleExternalLinkContextMenu(menu: Menu, url: string): void;
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

		setConfig<T extends keyof VaultSettings>(setting: T, value: VaultSettings[T]): void;
	}

	class MarkdownPreviewRendererStatic extends MarkdownPreviewRenderer {
		static registerDomEvents(el: HTMLElement, handlerInstance: unknown, cb: (el: HTMLElement) => unknown): void;
	}

	/** The CodeMirror based edit view (source mode and Live Preview) of a Markdown view. */
	interface MarkdownEditMode {
		editor?: Editor;

		triggerClickableToken: (token: tokenType, newLeaf: boolean | string, ...args: unknown[]) => void;
	}

	/** The widget that renders one property of the Properties editor. */
	interface MetadataPropertyWidget {
		linkTextEl: HTMLElement;
		value: string;
		ctx: {
			app: App;
			sourcePath: string;
		};

		isWikilink(): boolean;

		getLinkText(): string;

		render(...args: unknown[]): unknown;
	}

	interface MetadataProperty {
		entry: {
			type: string;
		};
		rendered?: MetadataPropertyWidget;
	}

	interface MetadataEditor {
		rendered: MetadataProperty[];
	}

	interface CanvasNodeSavedData {
		url?: string;
		alwaysKeepLoaded?: boolean;

		[key: string]: unknown;
	}

	/** A node of a canvas; only link (web page) nodes have a `url`. */
	interface CanvasNodeLike {
		contentEl: HTMLElement;
		url?: string;
		x: number;
		y: number;
		width: number;
		height: number;
		canvas: CanvasLike;
		editor?: unknown;
		widget?: unknown;

		getData(): CanvasNodeSavedData;

		setData(data: CanvasNodeSavedData): void;

		render(): void;
	}

	/** The canvas of a Canvas view. */
	interface CanvasLike {
		isDragging?: boolean;
		nodes: Map<string, CanvasNodeLike>;

		createLinkNode(
			url: string,
			position: { x: number; y: number },
			size: { height: number; width: number },
		): unknown;

		deselectAll(): void;

		addNode(node: unknown): void;

		select(node: unknown): void;

		selectOnly(node: CanvasNodeLike): void;

		zoomToSelection(): void;

		requestSave(): void;
	}

	/** A link (web page) node of a canvas. */
	interface CanvasUrlNode extends CanvasNodeLike {
		url: string;
	}

	/** The part of the empty ("New tab") view's prototype that is patched. */
	interface EmptyViewPrototype {
		onOpen(...args: unknown[]): unknown;
	}

	export interface View {
		contentEl: HTMLElement,
		/** Only Markdown views have them. */
		editMode?: MarkdownEditMode,
		sourceMode?: MarkdownEditMode,
		/** Only Canvas views have it. */
		canvas?: CanvasLike,
		/** Only the file explorer has it. */
		revealInFolder?(file: TAbstractFile | null): void,
	}

	interface MarkdownFileInfo {
		editMode?: MarkdownEditMode;
		metadataEditor?: MetadataEditor;
		leaf?: WorkspaceLeaf;
	}

	export interface Editor {
		getClickableTokenAt: (editorPos: EditorPosition) => tokenType;
	}

	export interface MenuItem {
		setSubmenu: () => Menu;
	}

	export interface MarkdownView {
		triggerClickableToken: (token: tokenType, newLeaf: boolean | string, ...args: unknown[]) => void;
	}

	export interface MarkdownSourceView {
		triggerClickableToken: (token: tokenType, newLeaf: boolean | string, ...args: unknown[]) => void;
	}

	export interface MarkdownRenderer {
		constructor: (t: unknown, e: unknown, c: unknown) => unknown;
	}

	enum PopoverState {
		Hidden,
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
