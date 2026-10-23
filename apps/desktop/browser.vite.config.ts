import { resolve } from "node:path";
import { defineConfig } from "vite";
import { canvasBundlePlugin } from "./scripts/standalone-cli-packaging.mjs";

export default defineConfig({
	root: resolve(import.meta.dirname, "src/renderer/browser"),
	publicDir: false,
	// Browser builds must never load launch-time secrets from the desktop .env.
	envDir: false,
	envPrefix: [],
	plugins: [
		canvasBundlePlugin(resolve(import.meta.dirname, "src/renderer/browser/canvas-entry.ts")),
		{
			name: "canvas-assets-only",
			generateBundle(_options, bundle) {
				// The author document inlines the nonce-bearing IIFE. No browser shell or module entry ships.
				for (const [name, output] of Object.entries(bundle))
					if (output.type === "chunk") delete bundle[name];
			},
		},
	],
	build: {
		target: "esnext",
		sourcemap: false,
		rollupOptions: { input: resolve(import.meta.dirname, "src/renderer/browser/canvas-entry.ts") },
	},
});
