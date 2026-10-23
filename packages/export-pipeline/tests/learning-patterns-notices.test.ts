import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { collectRuntimeNotices, writePackageNotice } from "../src/third-party-notices.ts";

it("emits the pinned learning-patterns MIT text and version through the viewer notice collector", async () => {
	const entry = path.resolve(
		import.meta.dirname,
		"../../shared-blocks/src/__tests__/fixtures/learning-patterns-entry.ts",
	);
	const require = createRequire(entry);
	const license = await readFile(require.resolve("learning-patterns/LICENSE"), "utf8");
	// SHA-256 of the upstream LICENSE at the reviewed pin, independent of collector output.
	expect(createHash("sha256").update(license).digest("hex")).toBe(
		"d817c04f10efaffd1ab6dba0792a6567dce98f8ab41e86c64833a7b9cff7ecc5",
	);
	const directory = await mkdtemp(path.join(os.tmpdir(), "learning-patterns-notices-"));
	try {
		const result = await build({
			entryPoints: [entry],
			outfile: path.join(directory, "self-check.js"),
			bundle: true,
			platform: "browser",
			format: "esm",
			target: "es2020",
			minify: true,
			treeShaking: true,
			external: [],
			metafile: true,
			legalComments: "none",
		});
		expect(
			Object.keys(result.metafile.inputs)
				.filter((input) => input.includes("node_modules/"))
				.map((input) => input.slice(input.lastIndexOf("/learning-patterns/") + 1))
				.sort(),
		).toEqual([
			"learning-patterns/lib/text-limits.js",
			"learning-patterns/patterns/self-check/content.schema.json",
			"learning-patterns/patterns/self-check/logic.js",
			"learning-patterns/patterns/self-check/strings.js",
		]);
		// bundleViewer uses this collector on its esbuild metafiles before writing its manifest.
		const notices = await collectRuntimeNotices([result.metafile], directory);
		expect(notices.outputs["self-check.js"]).toEqual(["learning-patterns@0.1.0"]);
		const notice = notices.packages["learning-patterns@0.1.0"];
		expect(notice).toEqual({
			name: "learning-patterns",
			version: "0.1.0",
			texts: { LICENSE: license },
		});
		await writePackageNotice(directory, notice);
		expect(
			await readFile(
				path.join(directory, "third-party-notices/learning-patterns@0.1.0.txt"),
				"utf8",
			),
		).toBe(`learning-patterns@0.1.0\n\n===== LICENSE =====\n${license}`);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
