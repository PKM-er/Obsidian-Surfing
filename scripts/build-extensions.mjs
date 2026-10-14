// Builds the Chrome-extension side of src/extensions with esbuild.
//
// A community-plugin release ships only main.js, manifest.json and
// styles.css. The scripts extensions load (compat-api.js, bridge-host.js) and
// the compat probe extension are therefore embedded into main.js as the
// virtual module `bridge-assets` (see vite.config.js), which the plugin
// writes out on start.
//
// `node scripts/build-extensions.mjs` also writes standalone bundles of the
// Node-side modules to build/extensions/, which tests/extensions load.
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src", "extensions");
const out = path.join(root, "build", "extensions");
const banner = { js: "/* Generated from src/extensions by esbuild. Do not edit. */" };

// Scripts copied into extension packages run inside Chromium extension
// contexts (service worker or page) as classic scripts or side-effect imports.
const extensionScripts = {
	"compat-api.js": "compat/compat-api.ts",
	"bridge-host.js": "compat/bridge-host.ts",
};

/** Source files the embedded scripts are built from, for watch mode. */
export function extensionSources() {
	const files = [];
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else files.push(full);
		}
	};
	for (const dir of ["compat", "shared", "compat-probe"]) walk(path.join(src, dir));
	return files;
}

/** Files main.js carries for the plugin folder, by their path under chrome-extensions/. */
export async function buildExtensionAssets() {
	const files = {};
	for (const [name, entry] of Object.entries(extensionScripts)) {
		const result = await esbuild.build({
			entryPoints: [path.join(src, entry)],
			bundle: true,
			platform: "browser",
			format: "iife",
			target: "chrome120",
			banner,
			legalComments: "none",
			logLevel: "warning",
			write: false,
		});
		files[name] = result.outputFiles[0].text;
	}
	const probe = path.join(src, "compat-probe");
	for (const name of fs.readdirSync(probe)) {
		files[`compat-probe/${name}`] = fs.readFileSync(path.join(probe, name), "utf8");
	}
	return files;
}

// Standalone copies of bundled modules, used by the tests.
const nodeBundles = {
	"extension-wrapper.js": "extension/wrapper.ts",
	"compat-runtime.js": "extension/compat-runtime.ts",
	"archive.js": "install/archive.ts",
	"extension-i18n.js": "i18n/extension-i18n.ts",
};

async function buildForTests() {
	fs.mkdirSync(out, { recursive: true });
	const assets = await buildExtensionAssets();
	for (const [name, text] of Object.entries(assets)) {
		const file = path.join(out, ...name.split("/"));
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, text);
	}
	// The bridge itself, with its embedded assets, as Surfing's main.js carries it.
	const embedAssets = {
		name: "bridge-assets",
		setup(build) {
			build.onResolve({ filter: /^bridge-assets$/ }, () => ({ path: "bridge-assets", namespace: "bridge-assets" }));
			build.onLoad({ filter: /.*/, namespace: "bridge-assets" }, () => ({
				contents: `export default ${JSON.stringify(assets)};`,
				loader: "js",
			}));
		},
	};
	const bundles = { ...nodeBundles, "bridge.js": "bridge.ts" };
	await Promise.all(
		Object.entries(bundles).map(([name, entry]) =>
			esbuild.build({
				entryPoints: [path.join(src, entry)],
				outfile: path.join(out, name),
				bundle: true,
				platform: "node",
				format: "cjs",
				target: "es2022",
				external: ["obsidian", "electron", "@electron/remote"],
				plugins: [embedAssets],
				banner,
				legalComments: "none",
				logLevel: "warning",
			}),
		),
	);
	console.log(`Built ${[...Object.keys(assets), ...Object.keys(bundles)].length} files in build/extensions`);
}

// Vite bundles this file into its CommonJS config: no top-level await.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	buildForTests().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
