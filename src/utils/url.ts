import { SEARCH_ENGINES } from "../surfingPluginSetting";

export const checkIfWebBrowserAvailable = (url: string) => {
	return url.startsWith("http://") || url.startsWith("https://") || (url.startsWith("file://") && /\.htm(l)?/g.test(url));
};

export const getComposedUrl = (url: string, value: string) => {
	// Support both http:// and https://
	// TODO: ?Should we support Localhost?
	// And the before one is : /[-a-zA-Z0-9@:%_\+.~#?&//=]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_\+.~#?&//=]*)?/gi; which will only match `blabla.blabla`
	// Support 192.168.0.1 for some local software server, and localhost
	// eslint-disable-next-line no-useless-escape
	const urlRegEx = /^(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._\+~#?&//=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/g;
	// eslint-disable-next-line no-useless-escape
	const urlRegEx2 = /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=\+\$,\w]+@)?[A-Za-z0-9.-]+(:[0-9]+)?|(?:www.|[-;:&=\+\$,\w]+@)[A-Za-z0-9.-]+)((?:\/[\+~%\/.\w\-_]*)?\??(?:[-\+=&;%@.\w_]*)#?(?:[\w]*))?)/g;

	let tempValue = value;

	if (urlRegEx.test(tempValue)) {
		const first7 = tempValue.slice(0, 7).toLowerCase();
		const first8 = tempValue.slice(0, 8).toLowerCase();
		if (!(first7 === "http://" || first7 === "file://" || first8 === "https://")) {
			tempValue = "https://" + tempValue;
		}
	} else if ((!(tempValue.startsWith("file://") || (/\.htm(l)?/g.test(tempValue))) && !urlRegEx2.test(encodeURI(tempValue)))) {
		// If url is not a valid FILE url, search it with search engine.
		// @ts-ignore
		tempValue = url + tempValue;
	}

	if (!(/^(https?|file):\/\//g.test(tempValue))) tempValue = url + tempValue;

	return tempValue;
};

export const getUrl = (urlString: string) => {
	let url = urlString;

	if (!url) return;

	const pluginSettings = app.plugins.getPlugin("surfing").settings;

	const urlRegEx = /^(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._\+~#?&//=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/g;
	// eslint-disable-next-line no-useless-escape
	const urlRegEx2 = /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=\+\$,\w]+@)?[A-Za-z0-9.-]+(:[0-9]+)?|(?:www.|[-;:&=\+\$,\w]+@)[A-Za-z0-9.-]+)((?:\/[\+~%\/.\w\-_]*)?\??(?:[-\+=&;%@.\w_]*)#?(?:[\w]*))?)/g;

	if (urlRegEx.test(url)) {
		const first7 = url.slice(0, 7).toLowerCase();
		const first8 = url.slice(0, 8).toLowerCase();
		if (!(first7 === "http://" || first7 === "file://" || first8 === "https://")) {
			url = "https://" + url;
		}
	} else if ((!(url.startsWith("file://") || (/\.htm(l)?/g.test(url))) && !urlRegEx2.test(encodeURI(url))) || !(/^(https?|file):\/\//g.test(url))) {
		// If url is not a valid FILE url, search it with search engine.
		const allSearchEngine = [...SEARCH_ENGINES, ...pluginSettings.customSearchEngine];
		const currentSearchEngine = allSearchEngine.find((engine) => engine.name === pluginSettings.defaultSearchEngine);
		// @ts-ignore
		url = (currentSearchEngine ? currentSearchEngine.url : SEARCH_ENGINES[0].url) + url;
	}

	if (url) return url;
	else return urlString;

};


export function isNormalLink(e: string) {
	if (!e || e.contains(" "))
		return false;
	try {
		new URL(e);
	} catch (e) {
		return false;
	}
	return true;
}

const isEmail = /^(([^<>()[\]\\.,;:\s@\"`]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))\b/;

export function isEmailLink(e: string) {
	return isEmail.test(e);
}
