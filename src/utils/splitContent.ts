export class SplitContent {
	private content: string;
	private sContent: string[];

	constructor(content: string) {
		this.content = content;

		this.sContent = content.split("\n");
	}

	searchLines(s: string, i: number) {
		return s.substring(s.substring(0, i).lastIndexOf("\n") + 1, i + s.substring(i).indexOf("\n"));
	}

	search(offset: number, context: boolean) {
		let content = "";
		if (!context) content = this.searchLines(this.content, offset);
		else {
			content = this.searchLines(this.content, offset);
			const matchLine = this.sContent.findIndex((item) => item.startsWith(content));
			if (matchLine === 0) {
				content = this.sContent.slice(0, 2).filter(i => i && i.trim()).join("<br>");
			} else {
				content = this.sContent.slice(matchLine - 1, matchLine + 1).filter(i => i && i.trim()).join("<br>");
			}
		}
		return content;
	}

}
