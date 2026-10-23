import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTypography, normalizeTypography } from "@praxity/grammar";
import AdmZip from "adm-zip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildScormPackage, type DesktopExportInput } from "../build.ts";
import { bundleViewer } from "../bundle-viewer.ts";
import { buildExportCssBundle, prepareDesktopCssAssets } from "../export-css.ts";

const CLEAR_FONT_BASELINE = {
	"atkinson-hyperlegible-next-latin-400-italic.woff2": {
		bytes: 14152,
		sha256: "59bc0e965694b9409ac2684c6c8d08994f4fee8a474bc63c4653714f8f441435",
	},
	"atkinson-hyperlegible-next-latin-400-normal.woff2": {
		bytes: 12096,
		sha256: "5cb240a4d99ab7e6fc3a4d4e6d11d89789fdffe9c86a8384000d662c53283f6f",
	},
	"atkinson-hyperlegible-next-latin-600-italic.woff2": {
		bytes: 14376,
		sha256: "fe939dd66a07071f0c39f76af3986a64cb8344b0dce2e3ae8c0897c1fbdb417f",
	},
	"atkinson-hyperlegible-next-latin-600-normal.woff2": {
		bytes: 12672,
		sha256: "828f4525c741b6864718e41aa23a4acbc049b35e6271317c0fd86e0702dd5d2e",
	},
	"atkinson-hyperlegible-next-latin-700-italic.woff2": {
		bytes: 14364,
		sha256: "a72f903d445907688cb6d06ad4dc993975b8f65b5126743ff70c75e09c6122b2",
	},
	"atkinson-hyperlegible-next-latin-700-normal.woff2": {
		bytes: 12732,
		sha256: "0dbe07ed7679407db9d90f747d5ca3bd1b2bb7ccbcbe41c8246cfc6d2c7bc3bc",
	},
	"atkinson-hyperlegible-next-latin-800-italic.woff2": {
		bytes: 13976,
		sha256: "7d50709db861620c82fdf382a7edecfa64fefcb69b8843b15ee004a861c1997d",
	},
	"atkinson-hyperlegible-next-latin-800-normal.woff2": {
		bytes: 12644,
		sha256: "377d6c32d80cdc2c257b48b4e02a6437ff1019c77e49c160ede8ebd6453be061",
	},
	"atkinson-hyperlegible-next-latin-ext-400-italic.woff2": {
		bytes: 7872,
		sha256: "d78c26d0c18f8d0f81efde4aa48a05d8e4d01c696a2683c1d1bdb8471ed0e827",
	},
	"atkinson-hyperlegible-next-latin-ext-400-normal.woff2": {
		bytes: 7376,
		sha256: "0f9e442184b58992113a9b26c0b85c380410a60e5f8f3ddc03c54fe80f81bbe8",
	},
	"atkinson-hyperlegible-next-latin-ext-600-italic.woff2": {
		bytes: 8100,
		sha256: "ba1d8e6b29907be2c7dde771c9b9a80250f28829f77f70af3631281f35c7ae76",
	},
	"atkinson-hyperlegible-next-latin-ext-600-normal.woff2": {
		bytes: 7544,
		sha256: "cf06258c78c0daa3e2aa904bcb3e3ffc403a0760ae92116eba5a8ea30cf20fcf",
	},
	"atkinson-hyperlegible-next-latin-ext-700-italic.woff2": {
		bytes: 8056,
		sha256: "5b341909f2746b4ee6c4f5e9bcbf02ad58303f0fdd9621e016c6d069e32f3073",
	},
	"atkinson-hyperlegible-next-latin-ext-700-normal.woff2": {
		bytes: 7556,
		sha256: "acd5d0771650ceddafa2beb172dc7ada45581f7641db03a70f4a13677ce799d1",
	},
	"atkinson-hyperlegible-next-latin-ext-800-italic.woff2": {
		bytes: 7912,
		sha256: "db70d45da3e014b0e6186cf2ccb7a932391894f17294bda24f7043e6fb0ae4bb",
	},
	"atkinson-hyperlegible-next-latin-ext-800-normal.woff2": {
		bytes: 7464,
		sha256: "c88ff1b0c5a48b7cd48157a8ef47c0d8a375ebd4aa66e574ad6655abdd2537bc",
	},
};

const GLOBAL_ONLY_SELECTORS = [
	"praxity-glossary-page",
	"praxity-glossary-term",
	"praxity-glossary-term-name",
	"praxity-glossary-term-definition",
	"praxity-ag-submit-btn",
	"praxity-ag-results",
	"praxity-ag-review-links",
	"praxity-ag-results-score",
	"praxity-math-block",
	"praxity-math-inline",
	"praxity-block-equation",
	"praxity-block-title",
	"praxity-course-footer",
	"praxity-doodle",
] as const;

function stylesheetEntry(zip: AdmZip, lite = false): string {
	const pattern = lite ? /^styles-lite\.[a-f0-9]{12}\.css$/ : /^styles\.[a-f0-9]{12}\.css$/;
	const entry = zip.getEntries().find((candidate) => pattern.test(candidate.entryName));
	expect(entry).toBeDefined();
	return entry?.entryName ?? "";
}

describe("desktop export CSS artifact", () => {
	it.each([
		["sans", ["source-sans-3-latin-400-normal.woff2", "source-sans-3-latin-600-normal.woff2"]],
		[
			"book",
			[
				"source-sans-3-latin-400-normal.woff2",
				"source-sans-3-latin-600-normal.woff2",
				"source-serif-4-latin-600-normal.woff2",
			],
		],
		[
			"clear",
			[
				"atkinson-hyperlegible-next-latin-400-normal.woff2",
				"atkinson-hyperlegible-next-latin-400-italic.woff2",
				"atkinson-hyperlegible-next-latin-600-normal.woff2",
				"atkinson-hyperlegible-next-latin-600-italic.woff2",
				"atkinson-hyperlegible-next-latin-700-normal.woff2",
				"atkinson-hyperlegible-next-latin-700-italic.woff2",
				"atkinson-hyperlegible-next-latin-800-normal.woff2",
				"atkinson-hyperlegible-next-latin-800-italic.woff2",
				"atkinson-hyperlegible-next-latin-ext-400-normal.woff2",
				"atkinson-hyperlegible-next-latin-ext-400-italic.woff2",
				"atkinson-hyperlegible-next-latin-ext-600-normal.woff2",
				"atkinson-hyperlegible-next-latin-ext-600-italic.woff2",
				"atkinson-hyperlegible-next-latin-ext-700-normal.woff2",
				"atkinson-hyperlegible-next-latin-ext-700-italic.woff2",
				"atkinson-hyperlegible-next-latin-ext-800-normal.woff2",
				"atkinson-hyperlegible-next-latin-ext-800-italic.woff2",
			],
		],
	] as const)("bundles the %s pairing's local fonts for offline export", async (pairing, files) => {
		for (const catalog of [undefined, prebuiltAssetsDir]) {
			const output = await mkdtemp(path.join(os.tmpdir(), "pairing-fonts-"));
			try {
				const preloads = await buildExportCssBundle(
					output,
					normalizeTypography({ pairing }),
					catalog,
				);
				if (pairing === "clear")
					expect(preloads.sort()).toEqual([
						"atkinson-hyperlegible-next-latin-400-normal.woff2",
						"atkinson-hyperlegible-next-latin-800-normal.woff2",
					]);
				const css = await readFile(path.join(output, "styles-lite.css"), "utf8");
				expect((await readdir(path.join(output, "fonts"))).sort()).toEqual([...files].sort());
				if (pairing === "clear") {
					const actual: Record<string, { bytes: number; sha256: string }> = {};
					for (const file of files) {
						const bytes = await readFile(path.join(output, "fonts", file));
						actual[file] = {
							bytes: bytes.byteLength,
							sha256: createHash("sha256").update(bytes).digest("hex"),
						};
					}
					expect(actual).toEqual(CLEAR_FONT_BASELINE);
					expect(
						await readFile(
							path.join(
								output,
								"third-party-notices/@fontsource-atkinson-hyperlegible-next@5.3.0.txt",
							),
							"utf8",
						),
					).toContain("SIL OPEN FONT LICENSE");
				}
				for (const file of files) {
					expect(css).toContain(`fonts/${file}`);
					expect((await readFile(path.join(output, "fonts", file))).byteLength).toBeGreaterThan(0);
				}
			} finally {
				await rm(output, { recursive: true, force: true });
			}
		}
	});
	let prebuiltAssetsDir: string;

	beforeAll(async () => {
		prebuiltAssetsDir = await mkdtemp(path.join(os.tmpdir(), "desktop-css-assets-"));
		await bundleViewer(prebuiltAssetsDir);
		await prepareDesktopCssAssets(prebuiltAssetsDir);
		await writeFile(path.join(prebuiltAssetsDir, "review-comments.js"), "");
		await writeFile(path.join(prebuiltAssetsDir, "review-comments.css"), "");
	}, 30_000);

	afterAll(async () => {
		await rm(prebuiltAssetsDir, { recursive: true, force: true });
	});

	it("prebuilds a Mantine-free stylesheet with the shared export CSS", async () => {
		const full = await readFile(path.join(prebuiltAssetsDir, "styles.css"), "utf-8");
		const lite = await readFile(path.join(prebuiltAssetsDir, "styles-lite.css"), "utf-8");

		expect(full).toContain(".mantine-active");
		expect(lite).not.toContain(".mantine-active");
		expect(lite).toContain(".praxity-brand-header");
		expect(lite).toContain(".praxity-course-footer");
		expect(lite.length).toBeLessThan(full.length);
	});

	it("ships generator styles and every configured local fallback face", {
		timeout: 30_000,
	}, async () => {
		const course: DesktopExportInput = {
			courseId: "desktop-css-course",
			blocks: [
				{
					id: "text",
					type: "text",
					data: {
						content:
							'<p><span class="inline-tooltip-trigger" data-tooltip-content="Personal Protective Equipment">PPE</span> <span class="praxity-doodle" data-doodle="underline">matters</span>.</p>',
					},
				},
				{ id: "equation", type: "equation", data: { latex: "x^2" } },
				{
					id: "assessment",
					type: "assessment",
					data: {
						assessmentType: "choice",
						stem: [],
						response: {
							type: "choice",
							selectionMode: "single",
							inputMethod: "click",
							options: [],
							display: "list",
							shuffle: false,
						},
						feedback: {},
					},
				},
				{
					id: "group",
					type: "assessmentGroup",
					data: {
						groupName: "Safety check",
						mode: "all",
						memberBlockIds: ["assessment"],
						requireAll: true,
						showResultsSummary: true,
					},
				},
			],
			frontmatter: {
				title: "Desktop CSS Artifact",
				lang: "en",
				design: {
					typography: {
						...createTypography("Poppins", "Inter"),
						pairing: "book",
						fontDisplay: "optional",
						code: { fontFamily: ["Fira Code", "monospace"] },
						body: {
							fontFamily: ["Poppins", "DM Sans", "Lexend", "sans-serif"],
							fontWeight: 500,
							fontStyle: "italic",
						},
					},
				} as NonNullable<DesktopExportInput["frontmatter"]["design"]>,
			},
			config: { completionThreshold: 0.8 },
			resolvedAssets: new Map(),
			viewerVersion: "test-viewer",
			locale: "en",
		};

		const result = await buildScormPackage(course, {
			mode: "desktop",
			format: "html",
			prebuiltAssetsDir,
			projectDir: "/tmp/project",
		});
		const zip = new AdmZip(result.zip);
		const styles = zip.readAsText(stylesheetEntry(zip));
		const liteStyles = zip.readAsText(stylesheetEntry(zip, true));
		const shippedCss = styles;
		expect(styles).toContain("Source Sans 3");
		expect(
			zip
				.getEntries()
				.some((entry) => /fonts\/source-sans-3.*400-normal.*\.woff2/.test(entry.entryName)),
		).toBe(true);
		expect(zip.getEntry("viewer.css")).toBeNull();
		expect(
			zip
				.getEntries()
				.map((entry) => entry.entryName)
				.filter((entry) => entry.startsWith("host-")),
		).toEqual([expect.stringMatching(/^host-standalone-[A-Z0-9]{8}\.js$/u)]);
		expect(liteStyles).toContain(".praxity-block-title");
		expect(liteStyles).not.toContain(".mantine-active");
		expect(styles, "Pages export excludes deck outline selectors").not.toContain("#deck-outline");
		expect(liteStyles, "Pages lite CSS excludes deck outline selectors").not.toContain(
			"#deck-outline",
		);

		for (const className of GLOBAL_ONLY_SELECTORS) {
			expect(shippedCss, `missing .${className}`).toContain(`.${className}`);
		}
		const globalCss = await readFile(
			path.resolve(import.meta.dirname, "../../template/src/styles/global.css"),
			"utf-8",
		);
		const globalSelectors = new Set(
			[...globalCss.matchAll(/\.praxity-[a-zA-Z0-9_-]+/g)].map(([selector]) => selector),
		);
		for (const selector of globalSelectors) {
			expect(shippedCss, `missing global selector ${selector}`).toContain(selector);
		}

		const html = zip
			.getEntries()
			.filter((entry) => entry.entryName.endsWith(".html"))
			.map((entry) => entry.getData().toString("utf-8"))
			.join("\n");
		expect(styles).not.toMatch(/--praxity-font-code:[^;]*Fira Code/);
		expect(liteStyles).not.toMatch(/--praxity-font-code:[^;]*Fira Code/);
		expect(html).toContain('class="praxity-glossary-page"');
		expect(html).toContain('"type":"assessmentGroup"');
		expect(html).toContain('class="praxity-math-block"');
		expect(html).toContain('role="math"');
		expect(html).toContain(
			'<link rel="preload" href="fonts/source-serif-4-latin-600-normal.woff2" as="font"',
		);

		expect(styles).toContain('font-family:"Source Sans 3"');
		expect(styles).toContain('font-family:"Source Serif 4"');
		expect(styles).toContain("font-display: optional");
		expect(
			zip
				.getEntries()
				.map((entry) => entry.entryName)
				.filter((name) => name.startsWith("fonts/") && name.endsWith(".woff2"))
				.sort(),
		).toEqual([
			"fonts/source-sans-3-latin-400-normal.woff2",
			"fonts/source-sans-3-latin-600-normal.woff2",
			"fonts/source-serif-4-latin-600-normal.woff2",
		]);
	});
});
