import {
    ItemView,
    WorkspaceLeaf,
} from "obsidian";
import { WebContentsView, WebContents } from "electron";
import SurfingPlugin from "./surfingIndex";

export const WEB_BROWSER_VIEW_ID = "surfing-view-next";

export class SurfingViewNext extends ItemView {
    plugin: SurfingPlugin;
    currentUrl = "https://obsidian.md"; // Set default URL
    currentTitle = "Surfing";
    webView: WebContentsView;
    webContents: WebContents;

    constructor(leaf: WorkspaceLeaf, plugin: SurfingPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return WEB_BROWSER_VIEW_ID;
    }

    getDisplayText(): string {
        return this.currentTitle;
    }

    async onOpen() {
        // Create the WebContentsView with security options
        this.webView = new WebContentsView({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                webSecurity: true,
                allowRunningInsecureContent: false
            }
        });

        this.webContents = this.webView.webContents;

        // Set up event handlers
        this.registerEventHandlers();

        // Add the WebContentsView to the Obsidian view
        const container = this.containerEl.children[1];
        container.empty();
        
        // Always navigate to obsidian.md first when opening
        this.navigate(this.currentUrl);
    }

    private registerEventHandlers() {
        // Handle page title updates
        this.webContents.on('page-title-updated', (event, title) => {
            this.currentTitle = title;
            this.leaf.tabHeaderInnerTitleEl.innerText = title;
        });

        // Handle page favicon updates
        this.webContents.on('page-favicon-updated', (event, favicons) => {
            if (favicons && favicons[0]) {
                const favicon = document.createElement('img');
                favicon.src = favicons[0];
                favicon.width = 16;
                favicon.height = 16;
                this.leaf.tabHeaderInnerIconEl.empty();
                this.leaf.tabHeaderInnerIconEl.appendChild(favicon);
            }
        });

        // Handle navigation events
        this.webContents.on('did-start-loading', () => {
            // Add loading indicator
            this.leaf.tabHeaderInnerTitleEl.addClass('loading');
        });

        this.webContents.on('did-stop-loading', () => {
            // Remove loading indicator
            this.leaf.tabHeaderInnerTitleEl.removeClass('loading');
        });

        // Handle errors
        this.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
            console.error('Page failed to load:', errorDescription);
            // Could show error in view
        });

        // Handle new window requests
        this.webContents.setWindowOpenHandler(({ url }) => {
            // Open URLs in new tabs
            this.navigate(url);
            return { action: 'deny' };
        });
    }

    async onClose() {
        if (this.webContents && !this.webContents.isDestroyed()) {
            this.webContents.close();
        }
    }

    navigate(url: string) {
        if (!url) return;

        // Basic URL validation and protocol addition
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        this.currentUrl = url;
        this.webContents.loadURL(url, {
            userAgent: undefined
        });
    }

    // Add zoom control methods
    zoomIn() {
        const currentZoom = this.webContents.getZoomLevel();
        this.webContents.setZoomLevel(currentZoom + 0.5);
    }

    zoomOut() {
        const currentZoom = this.webContents.getZoomLevel();
        this.webContents.setZoomLevel(currentZoom - 0.5);
    }

    resetZoom() {
        this.webContents.setZoomLevel(0);
    }

    // Add navigation methods
    goBack() {
        if (this.webContents.navigationHistory?.canGoBack()) {
            this.webContents.navigationHistory.goBack();
        }
    }

    goForward() {
        if (this.webContents.navigationHistory?.canGoForward()) {
            this.webContents.navigationHistory.goForward();
        }
    }

    reload() {
        this.webContents.reload();
    }

    // Add dev tools toggle
    toggleDevTools() {
        if (this.webContents.isDevToolsOpened()) {
            this.webContents.closeDevTools();
        } else {
            this.webContents.openDevTools();
        }
    }

    getState(): any {
        return {
            url: this.currentUrl
        };
    }

    async setState(state: any) {
        if (state.url) {
            this.navigate(state.url);
        }
    }
}
