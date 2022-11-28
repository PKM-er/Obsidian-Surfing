import { ItemView, ViewStateResult, WorkspaceLeaf } from "obsidian";
import SurfingPlugin from "./surfingIndex";
import { HeaderBar } from "./component/headerBar";
import { SEARCH_ENGINES } from "./surfingPluginSetting";
import { t } from "./translations/helper";

export const WEB_BROWSER_IFRAME_VIEW_ID = "surfing-iframe-view";

function genId(size: number): string {
	const chars = [];
	for (let n = 0; n < size; n++) chars.push(((16 * Math.random()) | 0).toString(16));
	return chars.join("");
}

export class SurfingIframeView extends ItemView {
	plugin: SurfingPlugin;
	private currentUrl: string;
	private currentTitle = t("Surfing Iframe");

	private headerBar: HeaderBar;
	private favicon: HTMLImageElement;
	private frame: HTMLIFrameElement;
	private currentID: string;

	constructor(leaf: WorkspaceLeaf, plugin: SurfingPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getDisplayText(): string {
		return this.currentTitle;
	}

	getIcon(): string {
		return 'surfing';
	}

	getViewType(): string {
		return WEB_BROWSER_IFRAME_VIEW_ID;
	}

	async onOpen() {
		// Allow views to replace this views.
		this.navigation = true;

		this.contentEl.empty();
		this.initHeaderButtons();

		// Create search bar in the header bar.
		this.headerBar = new HeaderBar(this.headerEl.children[2], this.plugin);

		// Create favicon image element.
		this.favicon = document.createElement("img") as HTMLImageElement;
		this.favicon.width = 16;
		this.favicon.height = 16;

		// Create main web view frame that displays the website.
		this.frame = document.createElement("iframe");
		this.frame.setAttribute("allowpopups", "");
		this.currentID = 'surfing-iframe-' + genId(8);
		this.frame.setAttribute('id', this.currentID);

		// CSS classes makes frame fill the entire tab's content space.
		this.frame.addClass("wb-frame");
		this.contentEl.createEl("div", {
			cls: "wb-frame-notice",
			text: t('Surfing is using iframe to prevent crashed when loading some websites.')
		});
		this.contentEl.addClass("wb-view-content");
		this.contentEl.appendChild(this.frame);

		this.headerBar.addOnSearchBarEnterListener((url: string) => {
			this.navigate(url);
		});
	}


	async setState(state: WebBrowserIframeViewState, result: ViewStateResult) {
		this.navigate(state.url, false);
	}

	getState(): WebBrowserIframeViewState {
		return { url: this.currentUrl };
	}

	navigate(url: string, addToHistory = true, updateWebView = true) {
		if (url === "") {
			return;
		}

		if (addToHistory) {
			if (this.leaf.history.backHistory.last()?.state?.state?.url !== this.currentUrl) {
				this.leaf.history.backHistory.push({
					state: {
						type: WEB_BROWSER_IFRAME_VIEW_ID,
						state: this.getState()
					},
					title: this.currentTitle,
					icon: "search"
				});
				// Enable the arrow highlight on the back arrow because there's now back history.
				this.headerEl.children[1].children[0].setAttribute("aria-disabled", "false");
			}
		}

		// Support both http:// and https://
		// TODO: ?Should we support Localhost?
		// And the before one is : /[-a-zA-Z0-9@:%_\+.~#?&//=]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_\+.~#?&//=]*)?/gi; which will only match `blabla.blabla`
		// Support 192.168.0.1 for some local software server, and localhost
		// eslint-disable-next-line no-useless-escape
		const urlRegEx = /^(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._\+~#?&//=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/g;
		// eslint-disable-next-line no-useless-escape
		const urlRegEx2 = /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=\+\$,\w]+@)?[A-Za-z0-9.-]+(:[0-9]+)?|(?:www.|[-;:&=\+\$,\w]+@)[A-Za-z0-9.-]+)((?:\/[\+~%\/.\w\-_]*)?\??(?:[-\+=&;%@.\w_]*)#?(?:[\w]*))?)/g;

		if (urlRegEx.test(url)) {
			const first7 = url.slice(0, 7).toLowerCase();
			const first8 = url.slice(0, 8).toLowerCase();
			if (!(first7 === "http://" || first7 === "file://" || first8 === "https://")) {
				url = "https://" + url;
			}
		} else if ((!(url.startsWith("file://") || (/\.htm(l)?/g.test(url))) && !urlRegEx2.test(encodeURI(url)))) {
			// If url is not a valid FILE url, search it with search engine.
			const allSearchEngine = [...SEARCH_ENGINES, ...this.plugin.settings.customSearchEngine];
			const currentSearchEngine = allSearchEngine.find((engine) => engine.name === this.plugin.settings.defaultSearchEngine);
			// @ts-ignore
			url = (currentSearchEngine ? currentSearchEngine.url : SEARCH_ENGINES[0].url) + url;
		}


		this.currentUrl = url;

		this.headerBar.setSearchBarUrl(url);
		if (updateWebView) {
			this.frame.setAttribute("src", url);
		}
		app.workspace.requestSaveLayout();
	}

	initHeaderButtons() {
		this.addAction("settings", t("settings"), () => {
			//@ts-expect-error, private method
			app.setting.open();
			//@ts-expect-error, private method
			app.setting.openTabById('surfing');
		})
	}
}

class WebBrowserIframeViewState {
	url: string;
}
