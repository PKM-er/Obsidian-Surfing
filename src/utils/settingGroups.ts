/**
 * Lay a settings page out like Obsidian's own pages: consecutive settings
 * share one panel, and each heading starts a new panel. This builds the DOM
 * of Obsidian's SettingGroup (1.11+), which styles it natively; older
 * versions show the settings as a plain list.
 *
 * Only direct children are grouped. Anything that is not a setting (a note,
 * a custom block) ends the current panel and stays where it is.
 */
export function groupSettings(containerEl: HTMLElement): void {
	let items: HTMLElement | null = null;
	const startGroup = (before: HTMLElement): HTMLElement => {
		const group = containerEl.createDiv("setting-group");
		containerEl.insertBefore(group, before);
		return group;
	};
	for (const child of Array.from(containerEl.children)) {
		if (!child.instanceOf(HTMLElement)) continue;
		if (child.hasClass("setting-item-heading")) {
			const group = startGroup(child);
			group.appendChild(child);
			items = group.createDiv("setting-items");
		} else if (child.hasClass("setting-item")) {
			items ??= startGroup(child).createDiv("setting-items");
			items.appendChild(child);
		} else {
			items = null;
		}
	}
}
