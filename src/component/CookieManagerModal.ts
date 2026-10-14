import type * as Electron from "electron";
import { App, Modal, Notice, Setting, setIcon } from "obsidian";
import { remote } from "electron";
import SurfingPlugin from "../surfingIndex";
import { t } from "../translations/helper";

export class CookieManagerModal extends Modal {
	private plugin: SurfingPlugin;
	private domain: string;
	private cookies: Electron.Cookie[] = [];

	constructor(app: App, plugin: SurfingPlugin, domain: string) {
		super(app);
		this.plugin = plugin;
		this.domain = domain;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.parentElement?.classList.add("surfing-cookie-modal");

		contentEl.createEl("h2", {
			text: t("Cookies for ") + this.domain,
		});

		// Fetch cookies
		const session = remote.session.fromPartition(
			`persist:surfing-vault-${(this.app as App & { appId: string }).appId}`,
		);
		this.cookies = await session.cookies.get({ domain: this.domain });

		if (this.cookies.length === 0) {
			contentEl.createEl("p", {
				text: t("No cookies found for this site."),
			});
			return;
		}

		// "Delete All" button at top
		new Setting(contentEl)
			.setName(t("Delete all cookies for this site"))
			.addButton((btn) =>
				btn
					.setButtonText(t("Delete All"))
					.setWarning()
					.onClick(async () => {
						await this.deleteAllCookies();
						void this.onOpen();
					}),
			);

		// Cookie list
		const listEl = contentEl.createDiv({ cls: "surfing-cookie-list" });

		for (const cookie of this.cookies) {
			const cookieEl = listEl.createDiv({ cls: "surfing-cookie-item" });

			const infoEl = cookieEl.createDiv({ cls: "surfing-cookie-info" });
			infoEl.createSpan({
				text: cookie.name,
				cls: "surfing-cookie-name",
			});
			infoEl.createSpan({
				text: this.truncate(cookie.value, 50),
				cls: "surfing-cookie-value",
			});

			const deleteBtn = cookieEl.createEl("button", {
				cls: "surfing-cookie-delete-btn",
			});
			setIcon(deleteBtn, "trash-2");
			deleteBtn.addEventListener("click", () => {
				void (async () => {
					await this.deleteCookie(cookie);
					cookieEl.remove();
					new Notice(t("Cookie deleted: ") + cookie.name);
				})();
			});
		}

		contentEl.createEl("p", {
			text: `${this.cookies.length} cookie(s)`,
			cls: "surfing-cookie-count",
		});
	}

	private async deleteCookie(cookie: Electron.Cookie): Promise<void> {
		const session = remote.session.fromPartition(
			`persist:surfing-vault-${(this.app as App & { appId: string }).appId}`,
		);
		const protocol = cookie.secure ? "https" : "http";
		const cookieUrl = `${protocol}://${cookie.domain?.replace(/^\./, "")}${cookie.path}`;
		await session.cookies.remove(cookieUrl, cookie.name);
	}

	private async deleteAllCookies(): Promise<void> {
		for (const cookie of this.cookies) {
			await this.deleteCookie(cookie);
		}
		new Notice(t("All cookies deleted for ") + this.domain);
	}

	private truncate(str: string, max: number): string {
		return str.length > max ? str.substring(0, max) + "..." : str;
	}

	onClose() {
		this.contentEl.empty();
	}
}
