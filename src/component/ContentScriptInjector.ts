import type * as Electron from "electron";
import SurfingPlugin from "../surfingIndex";

export class ContentScriptInjector {
	private plugin: SurfingPlugin;

	constructor(plugin: SurfingPlugin) {
		this.plugin = plugin;
	}

	async inject(webContents: Electron.WebContents): Promise<void> {
		await this.injectDarkMode(webContents);
		this.injectHoverLinkDetection(webContents);
	}

	private async injectDarkMode(webContents: Electron.WebContents): Promise<void> {
		try {
			if (this.plugin.settings.darkMode) {
				try {
					await webContents.executeJavaScript(`
						const element = document.createElement('script');

						fetch('https://cdn.jsdelivr.net/npm/darkreader/darkreader.min.js')
							.then((response) => {
								element.src = response.url;
								document.body.appendChild(element);
							})
							.catch((error) => {
								console.error('Error loading the script:', error);
							});

						element.onload = () => {
							try {
								DarkReader?.setFetchMethod(window.fetch);
								DarkReader?.enable({
									brightness: 100,
									contrast: 90,
									sepia: 10
								});
								console.log(DarkReader);
							} catch (err) {

								window.myPostPort?.postMessage('darkreader-failed');
								console.error('Failed to load dark reader: ', err);

							}
						};0
					`);
				} catch (e) {
					console.error(e);
				}
			}
		} catch (err) {
			console.error("Failed to get background color: ", err);
		}
	}

	private injectHoverLinkDetection(webContents: Electron.WebContents): void {
		// https://cdn.jsdelivr.net/npm/darkreader/darkreader.min.js
		void webContents.executeJavaScript(`
				window.addEventListener('mouseover', (e) => {
					if(!e.target) return;
					if(!e.ctrlKey && !e.metaKey) return;
					// Tag name is a tag
					if(e.target.tagName.toLowerCase() === 'a'){
						window.myPostPort?.postMessage('link ' + e.clientX + ' ' + e.clientY + ' ' + e.target.href);
					}
				});
			`);
	}
}
