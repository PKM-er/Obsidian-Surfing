import { ItemView, setIcon, WorkspaceLeaf } from "obsidian";

export const WEB_BROWSER_VIEW_ID = "web-browser-view";

export class WebBrowserView extends ItemView {
    private frame: HTMLIFrameElement;
    private searchBar: HTMLInputElement;
    private favicon: HTMLImageElement;
    private currentUrl: string = "https://duckduckgo.com"; // TODO: Allow customizing home page.
    private backHistory: Array<string> = [];
    private forwardHistory: Array<string> = [];

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType(): string {
        return WEB_BROWSER_VIEW_ID;
    }

    getDisplayText(): string {
        return "Web Browser";
    }

    async onOpen() {
        this.contentEl.empty();
        this.contentEl.addClass("web-browser-view-content");

        // Create main web view frame that displays the website.
        this.frame = document.createElement("webview") as HTMLIFrameElement;
        this.contentEl.appendChild(this.frame);
        this.frame.setAttribute("src", "https://duckduckgo.com"); // TODO: Allow customizing home page.
        this.frame.setAttribute("allowpopups", "");
        this.frame.addClass("web-browser-frame"); // Used to make the frame fill the entire tab's content space.

        // Create search bar in the header bar.
        this.searchBar = document.createElement("input") as HTMLInputElement;
        // @ts-ignore
        this.headerEl.children[2].appendChild(this.searchBar);
        this.searchBar.type = "text";
        this.searchBar.value = "https://duckduckgo.com"; // TODO: Automatically fill this value based on what homepage is loaded.
        this.searchBar.addClass("web-browser-search-bar");
        // @ts-ignore
        this.headerEl.children[2].addClass("web-browser-header-bar"); // Used to remove gradient at left of header bar.
        // @ts-ignore
        this.headerEl.children[2].removeChild(this.headerEl.children[2].children[1]); // Remove default title from header bar.

        // Create favicon image element
        this.favicon = document.createElement("img") as HTMLImageElement;
        this.favicon.width = 16;
        this.favicon.height = 16;

        // @ts-ignore Back button
        this.headerEl.children[1].children[0].addEventListener("click", (event: any) => {
            this.forwardHistory.push(this.currentUrl);
            this.frame.setAttribute("src", this.backHistory.pop() || "https://duckduckgo.com");
        });

        // @ts-ignore Forward button
        this.headerEl.children[1].children[1].addEventListener("click", (event: any) => {
            this.backHistory.push(this.currentUrl);
            this.frame.setAttribute("src", this.forwardHistory.pop() || "https://duckduckgo.com");
        });

        // Event to change the view's title to the web page's title.
        this.frame.addEventListener("page-title-updated", (event: any) => {
            // @ts-ignore
            this.leaf.tabHeaderInnerTitleEl.innerText = event.title;
            // TODO: Change title on popup when hovering over the title.
        });

        // Event to set tab's icon to the web page's favicon
        this.frame.addEventListener("page-favicon-updated", (event: any) => {
            // @ts-ignore
            this.favicon.src = event.favicons[0];
            // @ts-ignore
            this.leaf.tabHeaderInnerIconEl.empty();
            // @ts-ignore
            this.leaf.tabHeaderInnerIconEl.appendChild(this.favicon);
        });

        // Event to change the search bar's url when the user navigates to another page.
        this.frame.addEventListener("will-navigate", (event: any) => {
            this.searchBar.value = event.url;
            this.backHistory.push(this.currentUrl);
            this.currentUrl = event.url;
            this.forwardHistory = [];
        });

        // Event to change the frame's webpage when the enter key is pressed within the search bar.
        this.searchBar.addEventListener("keydown", (event: any) => {
            if (!event) { var event: any = window.event; }
            if (event.keyCode == 13) {
                this.frame.setAttribute("src", this.searchBar.value);
                this.backHistory.push(this.currentUrl);
                this.currentUrl = this.searchBar.value;
                this.forwardHistory = [];
            }
        }, false);
    }

    async onClose() {
    }
}
