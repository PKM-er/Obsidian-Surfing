export const checkIfWebBrowserAvailable = (url: string) => {
	return url.startsWith("http://") || url.startsWith("https://") || (url.startsWith("file://") && /\.htm(l)?/g.test(url))
}
