import type * as Electron from "electron";

/**
 * Wait for the DOM to stabilize after the initial load (React/Vue/SPA
 * hydration): resolves once mutations stop for a quiet period.
 */
export async function waitForDOMStability(
	webContents: Electron.WebContents,
	quietMs = 800,
	timeoutMs = 5000,
): Promise<void> {
	try {
		await webContents.executeJavaScript(
			`
			new Promise((resolve) => {
				if (document.readyState !== 'complete') {
					window.addEventListener('load', () => startObserving(), { once: true });
				} else {
					startObserving();
				}
				function startObserving() {
					let timer = null;
					const observer = new MutationObserver(() => {
						if (timer) clearTimeout(timer);
						timer = setTimeout(() => {
							observer.disconnect();
							resolve();
						}, ${quietMs});
					});
					observer.observe(document.body, {
						childList: true, subtree: true, characterData: true
					});
					// If no mutations happen within quietMs, resolve immediately
					timer = setTimeout(() => {
						observer.disconnect();
						resolve();
					}, ${quietMs});
					// Hard timeout
					setTimeout(() => {
						observer.disconnect();
						resolve();
					}, ${timeoutMs});
				}
			})
			`,
			true,
		);
	} catch {
		// Non-critical — continue with extraction even if stability wait fails
	}
}
