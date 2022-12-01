export const checkIfWebBrowserAvailable = (url: string) => {
	return url.startsWith("http://") || url.startsWith("https://") || (url.startsWith("file://") && /\.htm(l)?/g.test(url))
}

export const getFinalUrl = (url: string, value: string) => {
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
}
