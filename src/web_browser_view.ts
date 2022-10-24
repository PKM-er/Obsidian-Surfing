import { ItemView, ViewStateResult } from "obsidian";
import { HeaderBar } from "./header_bar";
import { remote } from "electron";

export const WEB_BROWSER_VIEW_ID = "web-browser-view";

export class WebBrowserView extends ItemView {
    private currentUrl: string;
    private currentTitle: string = "New tab";

    private headerBar: HeaderBar;
    private favicon: HTMLImageElement;
    private frame: HTMLIFrameElement;

    static spawnWebBrowserView(newLeaf: boolean, state: WebBrowserViewState) {
        app.workspace.getLeaf(newLeaf).setViewState({ type: WEB_BROWSER_VIEW_ID, active: true, state });
    }

    getDisplayText(): string {
        return this.currentTitle;
    }

    getViewType(): string {
        return WEB_BROWSER_VIEW_ID;
    }

    async onOpen() {
        // Allow views to replace this views.
        this.navigation = true;

        this.contentEl.empty();

        // Create search bar in the header bar.
        this.headerBar = new HeaderBar(this.headerEl.children[2]);

        // Create favicon image element.
        this.favicon = document.createElement("img") as HTMLImageElement;
        this.favicon.width = 16;
        this.favicon.height = 16;

        // Create main web view frame that displays the website.
        this.frame = document.createElement("webview") as HTMLIFrameElement;
        this.frame.setAttribute("allowpopups", "");
        // CSS classes makes frame fill the entire tab's content space.
        this.frame.addClass("web-browser-frame");
        this.contentEl.addClass("web-browser-view-content");
        this.contentEl.appendChild(this.frame);

        this.headerBar.addOnSearchBarEnterListener((url: string) => {
            this.navigate(url);
        });

        this.frame.addEventListener("dom-ready", (event: any) => {
            const { remote } = require('electron')
            // @ts-ignore
            remote.webContents.fromId(this.frame.getWebContentsId()).setWindowOpenHandler((event: any) => {
                WebBrowserView.spawnWebBrowserView(true, { url: event.url });
            });

			// For getting keyboard event from webview
            // @ts-ignore
			remote.webContents.fromId(this.frame.getWebContentsId()).on('before-input-event', (event, input) => {
				if (input.type !== 'keyDown') {
					return;
				}

				// Create a fake KeyboardEvent from the data provided
				const emulatedKeyboardEvent = new KeyboardEvent('keydown', {
					code: input.code,
					key: input.key,
					shiftKey: input.shift,
					altKey: input.alt,
					ctrlKey: input.control,
					metaKey: input.meta,
					repeat: input.isAutoRepeat
				});

				// TODO Detect pressed hotkeys if exists in default hotkeys list
				// If so, prevent default and execute the hotkey
				// If not, send the event to the webview
				activeDocument.body.dispatchEvent(emulatedKeyboardEvent)
			});
        });

        this.frame.addEventListener("page-favicon-updated", (event: any) => {
            this.favicon.src = event.favicons[0];
            this.leaf.tabHeaderInnerIconEl.empty();
            this.leaf.tabHeaderInnerIconEl.appendChild(this.favicon);
        });

        this.frame.addEventListener("page-title-updated", (event: any) => {
            this.leaf.tabHeaderInnerTitleEl.innerText = event.title;
            this.currentTitle = event.title;
        });

        this.frame.addEventListener("will-navigate", (event: any) => {
            this.navigate(event.url, true, false);
        });

        this.frame.addEventListener("did-navigate-in-page", (event: any) => {
            this.navigate(event.url, true, false);
        });

        this.frame.addEventListener("new-window", (event: any) => {
            console.log("Trying to open new window at url: " + event.url);
            event.preventDefault();
        });
    }

    async setState(state: WebBrowserViewState, result: ViewStateResult) {
        this.navigate(state.url, false);
    }

    getState(): WebBrowserViewState {
        return { url: this.currentUrl };
    }

    navigate(url: string, addToHistory: boolean = true, updateWebView: boolean = true) {
        if (url === "") { return; }

        if (addToHistory) {
            if (this.leaf.history.backHistory.last()?.state?.state?.url !== this.currentUrl) {
                this.leaf.history.backHistory.push({
                    state: {
                        type: WEB_BROWSER_VIEW_ID,
                        state: this.getState()
                    },
                    title: this.currentTitle,
                    icon: "search"
                });
                // Enable the arrow highlight on the back arrow because there's now back history.
                this.headerEl.children[1].children[0].setAttribute("aria-disabled", "false");
            }
        }

        var urlRegEx = /[-a-zA-Z0-9@:%_\+.~#?&//=]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_\+.~#?&//=]*)?/gi;
        if (urlRegEx.test(url)) {
            let first7 = url.slice(0, 7).toLowerCase();
            let first8 = url.slice(0, 8).toLowerCase();
            if (!(first7 === "http://" || first7 === "file://" || first8 === "https://")) {
                url = "https://" + url;
            }
        } else {
            // TODO: Support other search engines.
            url = "https://duckduckgo.com/?q=" + url;
        }

        this.currentUrl = url;
        this.headerBar.setSearchBarUrl(url);
        if (updateWebView) {
            this.frame.setAttribute("src", url);
        }
        app.workspace.requestSaveLayout();
    }
}

class WebBrowserViewState {
    url: string;
}
