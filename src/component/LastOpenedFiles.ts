import { Component, setIcon } from "obsidian";
import SurfingPlugin from "../surfingIndex";

export class LastOpenedFiles extends Component {
	private plugin: SurfingPlugin;
	private parent: HTMLElement;

	private listEl: HTMLElement;

	constructor(plugin: SurfingPlugin, parent: HTMLElement) {
		super();

		this.plugin = plugin;
		this.parent = parent;
	}

	onload() {
		this.listEl = this.parent.createEl('div', {
			cls: 'wb-last-opened-files'
		});

		const lastOpenFiles = this.plugin.app.workspace.getLastOpenFiles().slice(0, 8);
		for (const file of lastOpenFiles) {
			const fileEl = this.listEl.createEl('button', {
				cls: 'wb-last-opened-file'
			});
			const iconEl = fileEl.createEl('span', {
				cls: 'wb-last-opened-file-icon',
			});
			setIcon(iconEl, 'file-text');

			fileEl.createEl('span', {
				cls: 'wb-last-opened-file-name',
				text: file
			});

			fileEl.onclick = async () => {
				await this.plugin.app.workspace.openLinkText(file, file, false);
			};
		}
	}

	onunload() {
		super.onunload();
		this.listEl.empty();
		this.listEl.detach();
	}
}
