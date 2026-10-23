import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTypography, normalizeTypography } from "@praxity/grammar";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleViewer, computeViewerSourceHash } from "../bundle-viewer.ts";
import { prepareDesktopExportInputs, verifyPreparedExportAssets } from "../export-assets.ts";
import { buildExportCssBundle } from "../export-css.ts";

describe("prepared export inputs", () => {
	let directory: string;
	beforeAll(async () => {
		directory = await mkdtemp(path.join(os.tmpdir(), "export-inputs-"));
		await bundleViewer(directory);
		await prepareDesktopExportInputs(directory);
		await writeFile(
			path.join(directory, "viewer.version.json"),
			JSON.stringify({
				appVersion: "test",
				viewerSourceHash: (await computeViewerSourceHash()).slice(0, 12),
			}),
		);
	}, 60_000);

	afterAll(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	it("packages font bytes and normal/italic CSS through export preparation", async () => {
		const catalog = path.join(directory, "css-sources/fontsource/atkinson-hyperlegible-next");
		const bytes = await readFile(
			path.join(catalog, "files/atkinson-hyperlegible-next-latin-400-italic.woff2"),
		);
		expect(bytes.subarray(0, 4).toString()).toBe("wOF2");
		for (const style of ["normal", "italic"]) {
			const css = await readFile(path.join(catalog, `400-${style}.css`), "utf8");
			expect(css).toMatch(/@font-face/);
			expect(css).toMatch(new RegExp(`font-style:\\s*${style}`));
			expect(css).toContain(`./files/atkinson-hyperlegible-next-latin-400-${style}.woff2`);
		}
	});

	it("accepts the complete prepared directory", async () => {
		await expect(verifyPreparedExportAssets(directory, "test")).resolves.toBeUndefined();
	});

	it.each([
		"css-sources/mantine.css",
		"css-sources/global.css",
		"css-sources/print.css",
		"css-sources/fontsource/source-sans-3",
		"css-sources/fontsource/source-sans-3/600-italic.css",
		"css-sources/fontsource/source-sans-3/files/source-sans-3-latin-600-italic.woff2",
		"css-sources/fontsource/atkinson-hyperlegible-next/800-normal.css",
		"css-sources/fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-800-normal.woff2",
		"css-sources/fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-800-normal.woff2",
		"fonts/source-sans-3-latin-400-normal.woff2",
		"tabler-nodes-outline.json",
		"tabler-nodes-filled.json",
		"schemas/scorm12/adlcp_rootv1p2.xsd",
		"schemas/scorm2004/common/elementNames.xsd",
		"image-codecs/notices/jsquash-webp-LICENSE",
		"image-codecs/notices/Rust-dependency-notices.txt",
	])("rejects missing %s with its path", async (relative) => {
		const file = path.join(directory, relative);
		await rename(file, `${file}.held`);
		try {
			await expect(verifyPreparedExportAssets(directory, "test")).rejects.toThrow(relative);
		} finally {
			await rename(`${file}.held`, file);
		}
	});

	it.each([
		"courseRuntimeLicense",
		"thirdPartyNotices",
		"thirdPartyNotices.packages",
		"thirdPartyNotices.outputs",
		"thirdPartyNotices.packages.@fontsource/source-sans-3",
		"thirdPartyNotices.packages.@tabler/icons",
		"thirdPartyNotices.packages.@mantine/core.texts",
	])("rejects missing viewer-manifest.json#%s", async (field) => {
		const file = path.join(directory, "viewer-manifest.json");
		const bytes = await readFile(file);
		const manifest = JSON.parse(bytes.toString());
		const keys = field.split(".");
		const last = keys.pop() as string;
		let parent = manifest;
		for (const key of keys) parent = parent[key];
		delete parent[last];
		await writeFile(file, JSON.stringify(manifest));
		try {
			await expect(verifyPreparedExportAssets(directory, "test")).rejects.toThrow(
				`viewer-manifest.json#${field}`,
			);
		} finally {
			await writeFile(file, bytes);
		}
	});

	it("rejects a missing runtime notice mapping with its manifest path", async () => {
		const file = path.join(directory, "viewer-manifest.json");
		const bytes = await readFile(file);
		const manifest = JSON.parse(bytes.toString());
		delete manifest.thirdPartyNotices.outputs[manifest.shell];
		await writeFile(file, JSON.stringify(manifest));
		try {
			await expect(verifyPreparedExportAssets(directory, "test")).rejects.toThrow(
				`viewer-manifest.json#thirdPartyNotices.outputs.${manifest.shell}`,
			);
		} finally {
			await writeFile(file, bytes);
		}
	});

	it("fails CSS export when selected Source Sans 3 font bytes are absent", async () => {
		const relative =
			"css-sources/fontsource/source-sans-3/files/source-sans-3-latin-400-normal.woff2";
		const file = path.join(directory, relative);
		await rename(file, `${file}.held`);
		try {
			await expect(
				buildExportCssBundle(
					path.join(directory, "selected"),
					createTypography("Source Sans 3", "Source Serif 4"),
					directory,
				),
			).rejects.toThrow(relative);
		} finally {
			await rename(`${file}.held`, file);
		}
	});

	it("fails CSS export when a selected catalog is absent", async () => {
		const relative = "css-sources/fontsource/source-sans-3";
		const file = path.join(directory, relative);
		await rename(file, `${file}.held`);
		try {
			await expect(
				buildExportCssBundle(
					path.join(directory, "selected-catalog"),
					createTypography("Source Sans 3", "Source Serif 4"),
					directory,
				),
			).rejects.toThrow(relative);
		} finally {
			await rename(`${file}.held`, file);
		}
	});

	it("normalizes an authored italic body to the Clear pairing roles", async () => {
		const typography = createTypography("Atkinson Hyperlegible Next", "Atkinson Hyperlegible Next");
		typography.body.fontStyle = "italic";
		const output = path.join(directory, "fallback");
		await buildExportCssBundle(output, typography, directory);
		expect(
			await readFile(path.join(output, "fonts/atkinson-hyperlegible-next-latin-400-normal.woff2")),
		).not.toHaveLength(0);
	});

	it("refuses a missing Clear ExtraBold face instead of substituting another weight", async () => {
		const file = path.join(
			directory,
			"css-sources/fontsource/atkinson-hyperlegible-next/800-normal.css",
		);
		await rename(file, `${file}.held`);
		try {
			await expect(
				buildExportCssBundle(
					path.join(directory, "missing-extrabold"),
					normalizeTypography({ pairing: "clear" }),
					directory,
				),
			).rejects.toThrow("Missing selected font catalog");
		} finally {
			await rename(`${file}.held`, file);
		}
	});

	it("exports selected fonts when an unselected font is absent", async () => {
		const file = path.join(
			directory,
			"css-sources/fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-400-normal.woff2",
		);
		await rename(file, `${file}.held`);
		try {
			const output = path.join(directory, "unselected");
			await buildExportCssBundle(
				output,
				createTypography("Source Sans 3", "Source Serif 4"),
				directory,
			);
			expect(
				await readFile(path.join(output, "fonts/source-sans-3-latin-400-normal.woff2")),
			).not.toHaveLength(0);
		} finally {
			await rename(`${file}.held`, file);
		}
	});
});
