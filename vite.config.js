import path from "path";
import { defineConfig } from "vite";
import terser from "@rollup/plugin-terser";
import replace from "@rollup/plugin-replace";
import resolve from "@rollup/plugin-node-resolve";
import {
	buildExtensionAssets,
	extensionSources,
} from "./scripts/build-extensions.mjs";

// Obsidian loads plugins via app:// protocol, which breaks
// fileURLToPath(import.meta.url) in bundled SDKs (codex-sdk, claude-agent-sdk).
// This plugin rewrites import.meta.url to a safe file:// URL at build time.
function obsidianImportMetaPlugin() {
	return {
		name: "obsidian-import-meta-url",
		resolveImportMeta(property, { moduleId }) {
			if (property === "url") {
				const fileUrl = `file:///${moduleId.replace(/\\/g, "/")}`;
				return JSON.stringify(fileUrl);
			}
			return null;
		},
	};
}

// Embeds the Chrome extension scripts (built with esbuild) into main.js as
// the virtual module `bridge-assets`; see scripts/build-extensions.mjs.
function bridgeAssetsPlugin() {
	const id = "bridge-assets";
	return {
		name: "bridge-assets",
		resolveId(source) {
			return source === id ? "\0" + id : null;
		},
		async load(resolved) {
			if (resolved !== "\0" + id) return null;
			for (const file of extensionSources()) this.addWatchFile(file);
			const files = await buildExtensionAssets();
			return `export default ${JSON.stringify(files)};`;
		},
	};
}

export default defineConfig(({ mode }) => {
	return {
		plugins: [],
		build: {
			sourcemap: mode === "development" ? "inline" : false,
			minify: mode === "development" ? false : true,
			// Use Vite lib mode https://vitejs.dev/guide/build.html#library-mode
			lib: {
				entry: path.resolve(__dirname, "./src/surfingIndex.ts"),
				formats: ["cjs"],
			},
			rollupOptions: {
				plugins: [
					obsidianImportMetaPlugin(),
					bridgeAssetsPlugin(),
					mode === "development"
						? ""
						: terser({
								compress: {
									defaults: false,
									drop_console: true,
								},
								mangle: {
									eval: true,
									module: true,
									toplevel: true,
									safari10: true,
									properties: false,
								},
								output: {
									comments: false,
									ecma: "2020",
								},
							}),
					resolve({
						browser: false,
					}),
					replace({
						preventAssignment: true,
						"process.env.NODE_ENV": JSON.stringify(
							process.env.NODE_ENV,
						),
					}),
				],
				treeshake: true,
				output: {
					// Overwrite default Vite output fileName
					entryFileNames: "main.js",
					assetFileNames: "styles.css",
				},
				external: [
					"obsidian",
					"electron",
					"child_process",
					"crypto",
					"events",
					"fs",
					"fs/promises",
					"http",
					"https",
					"net",
					"os",
					"path",
					"process",
					"readline",
					"stream",
					"tls",
					"url",
					"util",
					"zlib",
					"node:child_process",
					"node:crypto",
					"node:events",
					"node:fs",
					"node:fs/promises",
					"node:http",
					"node:https",
					"node:net",
					"node:os",
					"node:path",
					"node:process",
					"node:readline",
					"node:stream",
					"node:tls",
					"node:url",
					"node:util",
					"node:zlib",
					"@codemirror/autocomplete",
					"@codemirror/collab",
					"@codemirror/commands",
					"@codemirror/language",
					"@codemirror/lint",
					"@codemirror/search",
					"@codemirror/state",
					"@codemirror/view",
					"@lezer/common",
					"@lezer/highlight",
					"@lezer/lr",
				],
			},
			emptyOutDir: false,
			outDir: ".",
		},
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src"),
			},
		},
	};
});
