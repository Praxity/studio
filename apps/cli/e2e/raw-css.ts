import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "esbuild";

export const rawCss: Plugin = {
	name: "raw-css",
	setup(build) {
		build.onResolve({ filter: /\.css\?raw$/ }, (args) => ({
			path: resolve(args.resolveDir, args.path.slice(0, -4)),
			namespace: "raw-css",
		}));
		build.onLoad({ filter: /./, namespace: "raw-css" }, async (args) => ({
			contents: await readFile(args.path, "utf8"),
			loader: "text",
		}));
	},
};
