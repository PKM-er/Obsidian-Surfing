// @ts-ignore
import { clipboard, remote } from "electron";
import { SurfingView } from "../surfingView";
import { t } from "../translations/helper";
import { FileSystemAdapter, moment } from "obsidian";

export class EmbededWebView {
	private contentEl: HTMLElement;
	private webviewEl: HTMLElement;
	private node: any;
	private file: any;
	private menu: any;

	private currentUrl: string;

	constructor(node: any, file: any) {
		this.contentEl = node.containerEl;
		this.node = node;
		this.file = file;
	}

	load() {
		// this.contentEl.empty();

		this.appendWebView();
		this.contentEl.addClass("wb-view-content-embeded");
	}

	unload() {
		this.contentEl.removeClass("wb-view-content-embeded");
		// this.contentEl.empty();
	}

	loadFile(file: any) {
		// this.file = file;
		this.load();
	}

	appendWebView() {
		const doc = this.contentEl.doc;
		this.webviewEl = doc.createElement('webview');
		this.webviewEl.setAttribute("allowpopups", "");
		this.webviewEl.addClass("wb-frame");

		const adapter = app.vault.adapter as FileSystemAdapter;
		this.currentUrl = "file:///" + (adapter.getBasePath() + "/" + this.file.path).toString().replace(/\s/g, "%20");

		if (this.currentUrl) this.webviewEl.setAttribute("src", this.currentUrl);
		else this.webviewEl.setAttribute("src", this.file.path);
		// this.node.placeholderEl.innerText = this.node.url;

		this.webviewEl.addEventListener("dom-ready", (event: any) => {
			// @ts-ignore
			const webContents = remote.webContents.fromId(this.webviewEl.getWebContentsId());

			// Open new browser tab if the web view requests it.
			webContents.setWindowOpenHandler((event: any) => {
				if (event.disposition !== "foreground-tab") {
					SurfingView.spawnWebBrowserView(true, { url: event.url });
					return {
						action: "allow",
					}
				}

				// if (this.canvas) {
				// 	const linkNode = this.canvas.createLinkNode(event.url, {
				// 		x: this.node.x + this.node.width + 20,
				// 		y: this.node.y
				// 	}, {
				// 		height: this.node.height,
				// 		width: this.node.width
				// 	});
				// 	this.canvas.deselectAll();
				// 	this.canvas.addNode(linkNode);
				//
				// 	this.canvas.select(linkNode);
				// 	this.canvas.zoomToSelection();
				// 	this.canvas.requestSave();
				//
				// 	return {
				// 		action: "allow",
				// 	}
				// }

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
						if(e.ctrlKey || e.metaKey) {
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
				this.menu = new Menu();
				// Basic Menu For Webview
				// TODO: Support adding different commands to the menu.
				// Possible to use Obsidian Default API?
				this.menu.append(
					new MenuItem(
						{
							label: t('Open Current URL In External Browser'),
							click: function () {
								window.open(params.pageURL, "_blank");
							}
						}
					)
				);

				this.menu.append(
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

					this.menu.append(new MenuItem({ type: 'separator' }));
					this.menu.append(new MenuItem({
						label: t('Search Text'), click: function () {
							try {
								SurfingView.spawnWebBrowserView(true, { url: params.selectionText });
								console.log('Page URL copied to clipboard');
							} catch (err) {
								console.error('Failed to copy: ', err);
							}
						}
					}));
					this.menu.append(new MenuItem({ type: 'separator' }));
					this.menu.append(new MenuItem({
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
					this.menu.append(new MenuItem({
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

					this.menu.popup(webContents);
				}

				if (params.pageURL?.contains("bilibili.com/")) {
					this.menu.append(new MenuItem({
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
					this.menu.popup(webContents);
					// Dirty workaround for showing the menu, when currentUrl is not the same as the url of the webview
					if (this.node.url !== params.pageURL && !params.selectionText) {
						this.menu.popup(webContents);
					}
				}, 0)
			}, false);
		});

		this.webviewEl.addEventListener("will-navigate", (event: any) => {
			this.currentUrl = event.url;
			// this.webviewEl.setAttribute("src", event.url);
		});

		this.webviewEl.addEventListener("did-navigate-in-page", (event: any) => {
			this.currentUrl = event.url;
			this.webviewEl.setAttribute("src", event.url);
		});

		this.webviewEl.addEventListener('destroyed', () => {
			if (doc !== this.contentEl.doc) {
				this.webviewEl.detach();
				this.appendWebView();
			}
		});

		doc.contains(this.contentEl) ? this.contentEl.appendChild(this.webviewEl) : this.contentEl.onNodeInserted(() => {
			this.contentEl.doc === doc ? this.contentEl.appendChild(this.webviewEl) : this.appendWebView()
		})


	}
}
