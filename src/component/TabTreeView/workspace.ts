import { App, Modal, Setting } from "obsidian";
import SurfingPlugin from "../../surfingIndex";

export class SaveWorkspaceModal extends Modal {
	private plugin: SurfingPlugin;

	private result: string;
	private onSubmit: (result: string) => void;

	constructor(app: App, plugin: SurfingPlugin, onSubmit: (result: string) => void) {
		super(app);

		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.parentElement?.classList.add("wb-workspace-modal");

		contentEl.createEl("h2", { text: "Workspace Name" });

		new Setting(contentEl)
			.setName("Name")
			.addText((text) =>
				text.onChange((value) => {
					this.result = value
				}));

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Submit")
					.setCta()
					.onClick(() => {
						this.close();
						this.onSubmit(this.result);
					}));
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

export const random = (size: number) => {
	const chars = [];
	for (let n = 0; n < size; n++) chars.push(((16 * Math.random()) | 0).toString(16));
	return chars.join("");
}
