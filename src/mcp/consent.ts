// The question shown the first time an agent wants to use a site.
import { App, Modal } from "obsidian";
import { t } from "../translations/helper";
import type { ConsentAnswer } from "./permissions";

class ConsentModal extends Modal {
	private answered = false;

	constructor(
		app: App,
		private host: string,
		private clientName: string,
		private onAnswer: (answer: ConsentAnswer) => void,
	) {
		super(app);
	}

	private answer(answer: ConsentAnswer) {
		if (this.answered) return;
		this.answered = true;
		this.onAnswer(answer);
		this.close();
	}

	onOpen() {
		this.setTitle(t("An AI agent wants to use a site"));
		this.contentEl.createEl("p", {
			text: t("{client} wants to read and control {host} in Surfing.")
				.replace("{client}", this.clientName)
				.replace("{host}", this.host),
		});
		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		const once = buttons.createEl("button", { text: t("Allow this time"), cls: "mod-cta" });
		once.addEventListener("click", () => this.answer("once"));
		const always = buttons.createEl("button", {
			text: t("Always allow {host}").replace("{host}", this.host),
		});
		always.addEventListener("click", () => this.answer("always"));
		const deny = buttons.createEl("button", { text: t("Deny"), cls: "mod-warning" });
		deny.addEventListener("click", () => this.answer("deny"));
		once.focus();
	}

	onClose() {
		this.contentEl.empty();
		this.answer("deny");
	}
}

/** Show the consent question; resolves with the answer (deny when dismissed or aborted). */
export function askConsent(
	app: App,
	host: string,
	clientName: string,
	signal: AbortSignal,
): Promise<ConsentAnswer> {
	return new Promise((resolve) => {
		const modal = new ConsentModal(app, host, clientName, resolve);
		signal.addEventListener("abort", () => modal.close(), { once: true });
		modal.open();
	});
}
