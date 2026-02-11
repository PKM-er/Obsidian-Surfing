export const WEB_BROWSER_VIEW_ID = "surfing-view";

export interface WebBrowserViewState extends Record<string, unknown> {
	url: string;
	active?: boolean;
}
