import type * as Remote from "@electron/remote";

// Obsidian's renderer exposes @electron/remote as `electron.remote`, which
// Electron's own typings dropped when the module moved out of Electron.
declare module "electron" {
	export const remote: typeof Remote;
}
