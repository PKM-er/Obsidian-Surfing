import {
	debounce,
	Editor,
	htmlToMarkdown,
	ItemView,
	MarkdownView,
	moment,
	ViewStateResult,
	WorkspaceLeaf
} from "obsidian";
import { HeaderBar } from "./component/headerBar";
// @ts-ignore
import { clipboard, remote } from "electron";
import SurfingPlugin from "./surfingIndex";
import { t } from "./translations/helper";
import searchBox from "./component/searchBox";
import { SEARCH_ENGINES } from "./surfingPluginSetting";

export const WEB_BROWSER_VIEW_ID = "surfing-view";

export class SurfingView extends ItemView {
	plugin: SurfingPlugin;
	searchBox: searchBox;
	private currentUrl: string;
	private currentTitle = "New tab";

	private headerBar: HeaderBar;
	private favicon: HTMLImageElement;
	private frame: HTMLIFrameElement;

	constructor(leaf: WorkspaceLeaf, plugin: SurfingPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	static spawnWebBrowserView(newLeaf: boolean, state: WebBrowserViewState) {
		const isOpenInSameTab = app.plugins.getPlugin("surfing").settings.openInSameTab;
		if (!isOpenInSameTab) {
			if (state.url.contains("bilibili")) {
				for (let i = 0; i < app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID).length; i++) {
					if (app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID)[i].getViewState().state.url.split('?t=')[0] === state.url.split('?t=')[0]) {
						// @ts-ignore
						app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID)[i].view.navigate(state.url, false, true);
						(app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID)[i]).rebuildView();
						return;
					}
				}
			}
			app.workspace.getLeaf(newLeaf).setViewState({ type: WEB_BROWSER_VIEW_ID, active: true, state });
			return;
		}

		const leafId = app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID).length ? localStorage.getItem("web-browser-leaf-id") : app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID)[0]?.id;
		if (!leafId) {
			// Check if current leaf is empty view or markdown view.
			let activeViewLeaf: WorkspaceLeaf | undefined;
			activeViewLeaf = app.workspace.getActiveViewOfType(MarkdownView)?.leaf
			if (!activeViewLeaf) activeViewLeaf = app.workspace.getActiveViewOfType(ItemView)?.getViewType() === "empty" ? app.workspace.getActiveViewOfType(ItemView)?.leaf : undefined
			if (!activeViewLeaf) return;

			const leaf = app.workspace.getActiveViewOfType(ItemView)?.getViewType() === "empty" ? activeViewLeaf : app.workspace.createLeafBySplit(activeViewLeaf) as WorkspaceLeaf;
			localStorage.setItem("web-browser-leaf-id", leaf.id);

			leaf.setViewState({ type: WEB_BROWSER_VIEW_ID, active: true, state });

			if (!(leaf.view.getViewType() === "empty")) {
				leaf.rebuildView();
			}

			leaf.setPinned(true);
			leaf.tabHeaderInnerTitleEl.parentElement?.parentElement?.addClass("same-tab");
			return;
		} else {

			if (!app.workspace.getLeafById(leafId)) {
				const newLeafID = app.workspace.getLeavesOfType(WEB_BROWSER_VIEW_ID)[0]?.id;
				if (newLeafID) {
					localStorage.setItem("web-browser-leaf-id", newLeafID);
					(app.workspace.getLeafById(newLeafID)?.view as SurfingView).navigate(state.url, true);
					app.workspace.getLeafById(newLeafID)?.rebuildView();
					return;
				}
			}

			if (app.workspace.getLeafById(leafId)?.view.getViewType() === WEB_BROWSER_VIEW_ID) {
				// @ts-ignore
				(app.workspace.getLeafById(leafId)?.view as SurfingView).navigate(state.url, true);
				app.workspace.getLeafById(leafId).rebuildView();
				return;
			}
		}

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
		this.headerBar = new HeaderBar(this.headerEl.children[2], this.plugin);

		// Create favicon image element.
		this.favicon = document.createElement("img") as HTMLImageElement;
		this.favicon.width = 16;
		this.favicon.height = 16;

		// Create main web view frame that displays the website.
		this.frame = document.createElement("webview") as unknown as HTMLIFrameElement;
		this.frame.setAttribute("allowpopups", "");

		// CSS classes makes frame fill the entire tab's content space.
		this.frame.addClass("wb-frame");
		this.contentEl.addClass("wb-view-content");
		this.contentEl.appendChild(this.frame);

		this.headerBar.addOnSearchBarEnterListener((url: string) => {
			this.navigate(url);
		});


		this.frame.addEventListener("dom-ready", (event: any) => {
			// @ts-ignore
			const webContents = remote.webContents.fromId(this.frame.getWebContentsId());

			// Open new browser tab if the web view requests it.
			webContents.setWindowOpenHandler((event: any) => {
				SurfingView.spawnWebBrowserView(true, { url: event.url });
				return {
					action: "allow",
				}
			});


			// TODO: Try to improve this dark mode.
			try {
				webContents.executeJavaScript(`
										window.getComputedStyle( document.body ,null).getPropertyValue('background-color');
				`, true).then((result: any) => {
					const colorArr = result.slice(
						result.indexOf("(") + 1,
						result.indexOf(")")
					).split(", ");

					const brightness = Math.sqrt(colorArr[0] ** 2 * 0.241 + colorArr[1] ** 2 * 0.691 + colorArr[2] ** 2 * 0.068);

					// If the background color is dark, set the theme to dark.
					if (brightness > 120 && app.getTheme() === "obsidian") {
						webContents.insertCSS(`
							html {
								filter: invert(90%) hue-rotate(180deg);
							}

							img, svg, div[class*="language-"] {
								filter: invert(110%) hue-rotate(180deg);
								opacity: .8;
							}
							
							video{
								filter: invert(110%) hue-rotate(180deg);
								opacity: 1;
							}
						`)
					}
				});
			} catch (err) {
				console.error('Failed to get background color: ', err);
			}

			webContents.on("context-menu", (event: any, params: any) => {
				event.preventDefault();

				run(params);
			}, false);

			const run = debounce((params: any) => {
				const { Menu, MenuItem } = remote;
				const menu = new Menu();
				// Basic Menu For Webview
				// TODO: Support adding different commands to the menu.
				// Possible to use Obsidian Default API?
				menu.append(
					new MenuItem(
						{
							label: t('Open Current URL In External Browser'),
							click: function () {
								window.open(params.pageURL, "_blank");
							}
						}
					)
				);

				menu.append(
					new MenuItem(
						{
							label: t('Save Current Page As Markdown'),
							click: async function () {
								try {
									webContents.executeJavaScript(`
											document.body.outerHTML
										`, true).then(async (result: any) => {
										const url = params.pageURL.replace(/\?(.*)/g, "");
										const parseContent = result.replaceAll(/src="([^"]*)"/g, "src=\"" + url + "$1\"");
										const content = htmlToMarkdown(parseContent);
										// @ts-ignore
										const currentTitle = webContents.getTitle().replace(/[/\\?%*:|"<>]/g, '-');
										const file = await app.vault.create((app.plugins.getPlugin("surfing").settings.markdownPath ? app.plugins.getPlugin("surfing").settings.markdownPath + "/" : "/") + currentTitle + ".md", content);
										await app.workspace.openLinkText(file.path, "", true);
									});
									console.log('Page Title copied to clipboard');
								} catch (err) {
									console.error('Failed to copy: ', err);
								}

							}
						}
					)
				);

				// TODO: Support customize menu items.
				// TODO: Support cut, paste, select All.
				// Only works when something is selected.
				if (params.selectionText) {
					menu.append(new MenuItem({ type: 'separator' }));
					menu.append(new MenuItem({
						label: t('Search Text'), click: function () {
							try {
								SurfingView.spawnWebBrowserView(true, { url: params.selectionText });
								console.log('Page URL copied to clipboard');
							} catch (err) {
								console.error('Failed to copy: ', err);
							}
						}
					}));
					menu.append(new MenuItem({ type: 'separator' }));
					menu.append(new MenuItem({
						label: t('Copy Plain Text'), click: function () {
							try {
								webContents.copy();
								console.log('Page URL copied to clipboard');
							} catch (err) {
								console.error('Failed to copy: ', err);
							}
						}
					}));
					const highlightFormat = this.plugin.settings.highlightFormat;
					menu.append(new MenuItem({
						label: t('Copy Link to Highlight'), click: function () {
							try {
								// eslint-disable-next-line no-useless-escape
								const linkToHighlight = params.pageURL.replace(/\#\:\~\:text\=(.*)/g, "") + "#:~:text=" + encodeURIComponent(params.selectionText);
								const selectionText = params.selectionText;
								let link = "";
								if (highlightFormat.contains("{TIME")) {
									// eslint-disable-next-line no-useless-escape
									const timeString = highlightFormat.match(/\{TIME\:[^\{\}\[\]]*\}/g)?.[0];
									if (timeString) {
										// eslint-disable-next-line no-useless-escape
										const momentTime = moment().format(timeString.replace(/{TIME:([^\}]*)}/g, "$1"));
										link = highlightFormat.replace(timeString, momentTime);
									}
								}
								link = (link != "" ? link : highlightFormat).replace(/\{URL\}/g, linkToHighlight).replace(/\{CONTENT\}/g, selectionText);
								clipboard.writeText(link);
								console.log('Link URL copied to clipboard');
							} catch (err) {
								console.error('Failed to copy: ', err);
							}
						}
					}));

					menu.popup(webContents);
				}

				if (params.pageURL?.contains("bilibili")) {
					menu.append(new MenuItem({
						label: t('Copy Video Timestamp'), click: function () {
							try {
								webContents.executeJavaScript(`
											var time = document.querySelectorAll('.bpx-player-ctrl-time-current')[0].innerHTML;
											var timeYMSArr=time.split(':');
											var joinTimeStr='00h00m00s';
											if(timeYMSArr.length===3){
												 joinTimeStr=timeYMSArr[0]+'h'+timeYMSArr[1]+'m'+timeYMSArr[2]+'s';
											}else if(timeYMSArr.length===2){
												 joinTimeStr=timeYMSArr[0]+'m'+timeYMSArr[1]+'s';
											}
											var timeStr= "";
											timeStr = window.location.href.split('?')[0]+'?t=' + joinTimeStr;
										`, true).then((result: any) => {
									clipboard.writeText("[" + result.split('?t=')[1] + "](" + result + ")"); // Will be the JSON object from the fetch call
								});
								console.log('Page URL copied to clipboard');
							} catch (err) {
								console.error('Failed to copy: ', err);
							}
						}
					}));
				}

				// Should use this method to prevent default copy+c
				// The default context menu is related to the shadow root that in the webview tag
				// So it is not possible to preventDefault because it cannot be accessed.
				// I tried to use this.frame.shadowRoot.childNodes to locate the iframe HTML element
				// It doesn't work.
				setTimeout(() => {
					menu.popup(webContents);
				}, 0)
			}, 10, true)

			// webContents.on('found-in-page', (event: any, result: any) => {
			// 	if (result.finalUpdate) webContents.stopFindInPage('clearSelection')
			// })

			// For getting keyboard event from webview
			webContents.on('before-input-event', (event: any, input: any) => {
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

				// TODO: Allow set hotkey in webview;
				if (emulatedKeyboardEvent.key === '/') {
					webContents.executeJavaScript(`
											document.activeElement instanceof HTMLInputElement
										`, true).then((result: any) => {
						if (!result) this.headerBar.focus();
					});
					return;
				}

				// TODO Detect pressed hotkeys if exists in default hotkeys list
				// If so, prevent default and execute the hotkey
				// If not, send the event to the webview
				activeDocument.body.dispatchEvent(emulatedKeyboardEvent);

				if (emulatedKeyboardEvent.ctrlKey && emulatedKeyboardEvent.key === 'f') {
					this.searchBox = new searchBox(this.leaf, webContents, this.plugin);
				}


			});

			// TODO: Do we need to show a link that cursor hovering?
			// webContents.on("update-target-url", (event: Event, url: string) => {
			// 	console.log("update-target-url", url);
			// })

		});

		// When focus set current leaf active;
		this.frame.addEventListener("focus", (event: any) => {
			app.workspace.setActiveLeaf(this.leaf);
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

		this.frame.addEventListener("did-attach-webview", (event: any) => {
			console.log("Webview attached");
		})

		this.initHeaderButtons();
	}

	initHeaderButtons() {
		this.addAction("settings", t("settings"), () => {
			//@ts-expect-error, private method
			app.setting.open();
			//@ts-expect-error, private method
			app.setting.openTabById('obsidian-memos');
		})
	}

	async setState(state: WebBrowserViewState, result: ViewStateResult) {
		this.navigate(state.url, false);
	}

	clearHistory(): void {
		// @ts-ignore
		const webContents = remote.webContents.fromId(this.frame.getWebContentsId());
		if (!webContents) return;

		webContents.clearHistory();
		webContents.executeJavaScript("history.pushState({}, '', location.href)");

		this.leaf.history.backHistory.splice(0);
		this.leaf.history.forwardHistory.splice(0);
	}

	getState(): WebBrowserViewState {
		return { url: this.currentUrl };
	}

	getCurrentTitle(): string {
		return this.currentTitle;
	}

	navigate(url: string, addToHistory = true, updateWebView = true) {
		if (url === "") {
			return;
		}

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
		this.searchBox?.unload();
		app.workspace.requestSaveLayout();
	}

	// TODO: Combine this with context menu method.
	getCurrentTimestamp(editor?: Editor) {
		// @ts-ignore
		const webContents = remote.webContents.fromId(this.frame.getWebContentsId());
		webContents.executeJavaScript(`
					var time = document.querySelectorAll('.bpx-player-ctrl-time-current')[0].innerHTML;
					var timeYMSArr=time.split(':');
					var joinTimeStr='00h00m00s';
					if(timeYMSArr.length===3){
						 joinTimeStr=timeYMSArr[0]+'h'+timeYMSArr[1]+'m'+timeYMSArr[2]+'s';
					}else if(timeYMSArr.length===2){
						 joinTimeStr=timeYMSArr[0]+'m'+timeYMSArr[1]+'s';
					}
					var timeStr= "";
					timeStr = window.location.href.split('?')[0]+'?t=' + joinTimeStr;
				`, true).then((result: any) => {
			const timestamp = "[" + result.split('?t=')[1] + "](" + result + ") ";
			const originalCursor = editor?.posToOffset(editor?.getCursor());
			editor?.replaceRange(timestamp, editor?.getCursor());
			if (originalCursor) editor?.setCursor(editor?.offsetToPos(originalCursor + timestamp.length));
		});
	}

	// TODO: Refresh the page.
	refresh() {
		// @ts-ignore
		const webContents = remote.webContents.fromId(this.frame.getWebContentsId());
		webContents.reload();
	}
}

class WebBrowserViewState {
	url: string;
}
