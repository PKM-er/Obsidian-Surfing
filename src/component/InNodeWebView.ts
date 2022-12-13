import { InPageHeaderBar } from "./InPageHeaderBar";
// @ts-ignore
import { clipboard, remote } from "electron";
import { SurfingView } from "../surfingView";
import { t } from "../translations/helper";
import { moment } from "obsidian";

export class InNodeWebView {
	private contentEl: HTMLElement;
	private iframeEl: HTMLElement;
	private node: any;

	constructor(node: any) {
		this.contentEl = node.contentEl;
		this.node = node;
	}

	onload() {
		this.contentEl.empty();

		const searchBarEl = new InPageHeaderBar(this.node, this.node.url);
		searchBarEl.onload();
		searchBarEl.addOnSearchBarEnterListener((url: string) => {
			this.iframeEl.setAttribute("src", url);
			searchBarEl.setSearchBarUrl(url);

			const oldData = this.node.getData();
			if (oldData.url === url) return;
			oldData.url = url;
			this.node.setData(oldData);
			this.node.canvas.requestSave();

			this.node.render();
		});
		searchBarEl.setSearchBarUrl(this.node.url);

		// Create main web view frame that displays the website.
		this.iframeEl = document.createElement("webview") as unknown as HTMLIFrameElement;
		this.iframeEl.setAttribute("allowpopups", "");

		// CSS classes makes frame fill the entire tab's content space.
		this.iframeEl.addClass("wb-frame");
		this.contentEl.addClass("wb-view-content");
		this.contentEl.appendChild(this.iframeEl);

		this.iframeEl.setAttribute("src", this.node.url);
		this.node.placeholderEl.innerText = this.node.url;

		this.iframeEl.addEventListener("dom-ready", (event: any) => {
			// @ts-ignore
			const webContents = remote.webContents.fromId(this.iframeEl.getWebContentsId());

			// Open new browser tab if the web view requests it.
			webContents.setWindowOpenHandler((event: any) => {
				SurfingView.spawnWebBrowserView(true, { url: event.url });
				return {
					action: "allow",
				}
			});

			try {
				const pluginSettings = app.plugins.getPlugin("surfing").settings;
				const highlightFormat = pluginSettings.highlightFormat;
				const getCurrentTime = () => {
					let link = "";
					// eslint-disable-next-line no-useless-escape
					const timeString = highlightFormat.match(/\{TIME\:[^\{\}\[\]]*\}/g)?.[0];
					if (timeString) {
						// eslint-disable-next-line no-useless-escape
						const momentTime = moment().format(timeString.replace(/{TIME:([^\}]*)}/g, "$1"));
						link = highlightFormat.replace(timeString, momentTime);
						return link;
					}
					return link;
				}
				webContents.executeJavaScript(`
					window.addEventListener('dragstart', (e) => {
						if(e.ctrlKey) {
							e.dataTransfer.clearData();
							const selectionText = document.getSelection().toString();
							const linkToHighlight = e.srcElement.baseURI.replace(/\#\:\~\:text\=(.*)/g, "") + "#:~:text=" + encodeURIComponent(selectionText);
							let link = "";
							if ("${ highlightFormat }".includes("{TIME")) {
								link = "${ getCurrentTime() }";
								// // eslint-disable-next-line no-useless-escape
								// const timeString = "${ highlightFormat }".match(/\{TIME\:[^\{\}\[\]]*\}/g)?.[0];
								// if (timeString) {
								// 	// eslint-disable-next-line no-useless-escape
								// 	const momentTime = moment().format(timeString.replace(/{TIME:([^\}]*)}/g, "$1"));
								// 	link = "${ highlightFormat }".replace(timeString, momentTime);
								// }
							}
							link = (link != "" ? link : "${ highlightFormat }").replace(/\{URL\}/g, linkToHighlight).replace(/\{CONTENT\}/g, selectionText.replace(/\\n/g, " "));
						
							e.dataTransfer.setData('text/plain', link);
							console.log(e);
						}
					});
					`, true).then((result: any) => {
				});
			} catch (err) {
				console.error('Failed to add event: ', err);
			}


			webContents.on("context-menu", (event: any, params: any) => {
				event.preventDefault();

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
							label: 'Open Current URL In Surfing',
							click: function () {
								window.open(params.pageURL);
							}
						}
					)
				);

				if (params.selectionText) {
					const pluginSettings = app.plugins.getPlugin("surfing").settings;

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
					const highlightFormat = pluginSettings.highlightFormat;
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

				if (params.pageURL?.contains("bilibili.com/")) {
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
											var pageStrMatch = window.location.href.match(/(p=[1-9]{1,})/g);
											var pageStr = "";
											if(typeof pageStrMatch === "object" && pageStrMatch?.length > 0){
											    pageStr = '&' + pageStrMatch[0];
											}else if(typeof pageStrMatch === "string") {
											    pageStr = '&' + pageStrMatch;
											}
											timeStr = window.location.href.split('?')[0]+'?t=' + joinTimeStr + pageStr;
										`, true).then((result: any) => {
									clipboard.writeText("[" + result.split('?t=')[1].replace(/&p=[1-9]{1,}/g, "") + "](" + result + ")"); // Will be the JSON object from the fetch call
								});
								console.log('Page URL copied to clipboard');
							} catch (err) {
								console.error('Failed to copy: ', err);
							}
						}
					}));
				}

				setTimeout(() => {
					menu.popup(webContents);
					// Dirty workaround for showing the menu, when currentUrl is not the same as the url of the webview
					if (this.node.url !== params.pageURL && !params.selectionText) {
						menu.popup(webContents);
					}
				}, 0)
			}, false);
		});

		this.iframeEl.addEventListener("will-navigate", (event: any) => {
			const oldData = this.node.getData();
			oldData.url = event.url;
			this.node.setData(oldData);
			this.node.canvas.requestSave();
		});

		this.iframeEl.addEventListener("did-navigate-in-page", (event: any) => {
			const oldData = this.node.getData();
			if (event.url.contains("contacts.google.com/widget") || (this.node.canvas.isDragging && oldData.url === event.url)) {
				// @ts-ignore
				const webContents = remote.webContents.fromId(this.iframeEl.getWebContentsId());
				webContents.stop();
				return;
			}
			if (oldData.url === event.url) return;
			oldData.url = event.url;
			this.node.setData(oldData);
			this.node.canvas.requestSave();
		});
	}
}
