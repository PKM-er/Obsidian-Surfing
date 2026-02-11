import { ElementHidingManager } from "./elementHidingManager";
import {
	getElementPickerScript,
	getElementPickerScriptWithPromise,
} from "./elementPickerScript";

export function injectElementHidingCss(
	webContents: Electron.WebContents,
	manager: ElementHidingManager,
	url: string,
): void {
	const css = manager.getCssForUrl(url);
	if (css) {
		webContents.insertCSS(css);
	}
}

export function startElementPicker(webContents: Electron.WebContents): void {
	webContents.executeJavaScript(getElementPickerScript(), true);
}

export async function startElementPickerWithPromise(
	webContents: Electron.WebContents,
): Promise<string | null> {
	return await webContents.executeJavaScript(
		getElementPickerScriptWithPromise(),
		true,
	);
}
