import { WebBrowserView } from "./web_browser_view";

export class FunctionHooks {
    private static ogWindow$Open: (url?: string | URL, target?: string, features?: string) => WindowProxy | null;

    static onload() {
        FunctionHooks.ogWindow$Open = window.open;
        window.open = (url?: string | URL, target?: string, features?: string): WindowProxy | null => {
            // TODO: Create setting for whether to open external links outside of Obsidian or not.
            // return FunctionHooks.ogWindow$Open.call(window, url, target, features);

            let urlString: string = "";
            if (typeof url === "string") {
                urlString = url;
            } else if (url instanceof URL) {
                urlString = url.toString();
            }

            // TODO: Open external link in current leaf when meta key isn't being held down.
            WebBrowserView.spawnWebBrowserView(true, { url: urlString });
            return null;
        }
    }

    static onunload() {
        // Clean up our hackiness when the plugin is disabled.
        window.open = FunctionHooks.ogWindow$Open;
    }
}
