import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, expect, it, vi } from "vitest";
import type { ViewerBundleManifest } from "../bundle-viewer.ts";
import { cacheViewerBundle, readCachedViewer } from "../viewer-cache.ts";

const directories: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
	const root = await mkdtemp(path.join(tmpdir(), "viewer-cache-test-"));
	directories.push(root);
	const manifest: ViewerBundleManifest = {
		css: "viewer.css",
		deckCss: "deck-shell.css",
		retrievalSheetCss: "retrieval-sheet.css",
		highlightCss: "highlight.css",
		shell: "shell.js",
		resume: "resume.js",
		hosts: {
			standalone: "host.js",
			electronPreview: "host.js",
			scorm12: "host.js",
			scorm2004: "host.js",
			xapi: "host.js",
		},
		islands: {} as ViewerBundleManifest["islands"],
		islandDependencies: {} as ViewerBundleManifest["islandDependencies"],
		islandFiles: ["chunk.js"],
		thirdPartyNotices: { packages: {}, outputs: {} },
	};
	const files = [
		"viewer.css",
		"deck-shell.css",
		"retrieval-sheet.css",
		"highlight.css",
		"shell.js",
		"resume.js",
		"host.js",
		"islands/chunk.js",
	];
	async function source(name: string, content: string) {
		const dir = path.join(root, name);
		for (const file of files) await fs.outputFile(path.join(dir, file), content);
		await fs.writeJson(path.join(dir, "viewer-manifest.json"), manifest);
		return dir;
	}
	const cache = await source("prebuilt", "old");
	await fs.writeFile(path.join(cache, "viewer.hash"), "old-hash");
	return { root, cache, manifest, files, source };
}

function pauseCopy() {
	const original = fs.copy.bind(fs);
	let enter: () => void = () => {};
	let release: () => void = () => {};
	const entered = new Promise<void>((resolve) => {
		enter = resolve;
	});
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let calls = 0;
	vi.spyOn(fs, "copy").mockImplementation(async (source, destination) => {
		await original(source, destination);
		if (++calls === 2) {
			enter();
			await held;
		}
	});
	return { entered, release };
}

it("keeps admitted assets intact and hides a partially copied generation from concurrent readers", async () => {
	const { cache, manifest, files, source } = await fixture();
	const admitted = await readCachedViewer(cache, "old-hash");
	expect(admitted?.directory).toBe(cache);
	const input = await source("new", "new");
	const pause = pauseCopy();
	const publishing = cacheViewerBundle(cache, input, manifest, "new-hash");
	await pause.entered;
	try {
		expect(await readCachedViewer(cache, "new-hash")).toBeNull();
		for (const file of files) expect(await fs.readFile(path.join(cache, file), "utf8")).toBe("old");
	} finally {
		pause.release();
		await publishing;
	}
	const installed = await publishing;
	expect((await readCachedViewer(cache, "new-hash"))?.directory).toBe(installed);
	for (const file of files)
		expect(await fs.readFile(path.join(installed, file), "utf8")).toBe("new");
	expect((await readCachedViewer(cache, "old-hash"))?.directory).toBe(cache);
});

it("lets competing publishers install one complete generation without leaving staging folders", async () => {
	const { cache, manifest, files, source } = await fixture();
	const input = await source("new", "new");
	const pause = pauseCopy();
	const first = cacheViewerBundle(cache, input, manifest, "new-hash");
	await pause.entered;
	let second: string;
	try {
		second = await cacheViewerBundle(cache, input, manifest, "new-hash");
	} finally {
		pause.release();
		await first;
	}
	expect(await first).toBe(second);
	for (const file of files) expect(await fs.readFile(path.join(second, file), "utf8")).toBe("new");
	expect(await readdir(path.join(cache, "viewer-cache"))).toEqual(["new-hash"]);
});

it("reports a failed copy, removes its stage and preserves the previous readable bundle", async () => {
	const { cache, manifest, source } = await fixture();
	const input = await source("new", "new");
	vi.spyOn(fs, "copy").mockRejectedValueOnce(new Error("copy refused"));
	await expect(cacheViewerBundle(cache, input, manifest, "new-hash")).rejects.toThrow(
		"copy refused",
	);
	expect(await readdir(path.join(cache, "viewer-cache"))).toEqual([]);
	expect(await readCachedViewer(cache, "new-hash")).toBeNull();
	expect((await readCachedViewer(cache, "old-hash"))?.directory).toBe(cache);
});

it("refuses an incomplete generation instead of returning missing chunks", async () => {
	const { cache, manifest, source } = await fixture();
	const input = await source("new", "new");
	const installed = await cacheViewerBundle(cache, input, manifest, "new-hash");
	await fs.remove(path.join(installed, "islands/chunk.js"));
	expect(await readCachedViewer(cache, "new-hash")).toBeNull();
});

it("admits a cold cache without requiring legacy root assets", async () => {
	const { root, manifest, files, source } = await fixture();
	const cache = path.join(root, "cold-cache");
	const input = await source("new", "new");
	await cacheViewerBundle(cache, input, manifest, "new-hash");
	expect(await fs.pathExists(path.join(cache, "islands"))).toBe(false);
	expect(await fs.pathExists(path.join(cache, "viewer.hash"))).toBe(false);
	const admitted = await readCachedViewer(cache, "new-hash");
	expect(admitted).not.toBeNull();
	if (!admitted) throw new Error("Expected a complete cold cache");
	for (const file of files)
		expect(await fs.readFile(path.join(admitted.directory, file), "utf8")).toBe("new");
});
