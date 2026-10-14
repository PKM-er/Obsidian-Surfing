// Standalone bundles of the Electron-free MCP modules (src/mcp) in build/mcp/,
// which tests/mcp load.
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src", "mcp");
const out = path.join(root, "build", "mcp");

const modules = ["server", "keys", "sites", "permissions", "tools"];

fs.mkdirSync(out, { recursive: true });
await Promise.all(
	modules.map((name) =>
		esbuild.build({
			entryPoints: [path.join(src, `${name}.ts`)],
			outfile: path.join(out, `${name}.js`),
			bundle: true,
			platform: "node",
			format: "cjs",
			target: "es2022",
			legalComments: "none",
			logLevel: "warning",
		}),
	),
);
console.log(`Built ${modules.length} modules in build/mcp`);
