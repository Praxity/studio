import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildScormPackage, type CourseExportInput, type DesktopExportInput } from "../build.ts";
import { bundleViewer } from "../bundle-viewer.ts";
import { prepareDesktopCssAssets } from "../export-css.ts";
import { readPackageNotice } from "../third-party-notices.ts";

const require = createRequire(import.meta.url);

it("finds owning package notices beyond a nested module-scope manifest", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "notice-module-scope-"));
	try {
		await mkdir(path.join(directory, "v4", "core"), { recursive: true });
		await writeFile(
			path.join(directory, "package.json"),
			JSON.stringify({ name: "fixture", version: "1.0.0" }),
		);
		await writeFile(path.join(directory, "LICENSE"), "Exact upstream fixture license\n");
		await writeFile(path.join(directory, "v4", "package.json"), '{"type":"module"}');
		const input = path.join(directory, "v4", "core", "index.js");
		expect(await readPackageNotice(input)).toEqual({
			name: "fixture",
			version: "1.0.0",
			texts: { LICENSE: "Exact upstream fixture license\n" },
		});
		await writeFile(path.join(directory, "v4", "package.json"), '{"name":"broken"}');
		await expect(readPackageNotice(input)).rejects.toThrow("Invalid package metadata");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
const source: CourseExportInput = {
	id: "notice-course",
	title: "Notices",
	sourceLocale: "en",
	navToggles: { navTopBar: false, showA11yPill: false },
	content: [
		{ id: "p1", title: "Page", blocks: [{ id: "text", type: "text", data: { content: "Hello" } }] },
	],
};
let assets: string;
beforeAll(async () => {
	assets = await mkdtemp(path.join(os.tmpdir(), "course-notices-"));
	await bundleViewer(assets);
	await prepareDesktopCssAssets(assets);
	await cp(
		path.resolve(import.meta.dirname, "../../node_modules/@tabler/icons/tabler-nodes-outline.json"),
		path.join(assets, "tabler-nodes-outline.json"),
	);
	await cp(
		path.resolve(import.meta.dirname, "../../node_modules/@tabler/icons/tabler-nodes-filled.json"),
		path.join(assets, "tabler-nodes-filled.json"),
	);
});
afterAll(async () => {
	await rm(assets, { recursive: true, force: true });
});

function notice(zip: AdmZip, name: string): string {
	return zip
		.getEntries()
		.filter((entry) => entry.entryName.startsWith(`third-party-notices/${name}@`))
		.map((entry) => entry.getData().toString("utf8"))
		.join("\n");
}

it("preserves selected font terms in source HTML and SCORM archives without compiler licences", async () => {
	const fontLicense = await readFile(require.resolve("@fontsource/source-sans-3/LICENSE"), "utf8");
	const cursorLicense = await readFile(
		path.resolve(
			import.meta.dirname,
			"../../../../apps/desktop/resources/third-party-notices/feather-icons@4.29.2/LICENSE",
		),
		"utf8",
	);
	for (const format of ["html", "scorm12", "scorm2004"] as const) {
		const zip = new AdmZip((await buildScormPackage(source, { format })).zip);
		expect(notice(zip, "feather-icons")).toContain(cursorLicense);
		expect(notice(zip, "@fontsource-source-sans-3")).toContain(fontLicense);
		expect(notice(zip, "@mantine-core")).toContain("Permission is hereby granted");
		expect(notice(zip, "react")).toBe("");
		expect(notice(zip, "@tabler-icons")).toBe("");
		expect(notice(zip, "@fontsource-poppins")).toBe("");
		expect(
			zip
				.getEntries()
				.map((entry) => entry.entryName)
				.join("\n"),
		).not.toMatch(/esbuild|archiver|EULA|ETHICAL|legal-drafts|CLAUDE/);
	}
});

it("includes React and Tabler terms when their emitted runtime or icon artwork is present", async () => {
	const course = {
		...source,
		navToggles: undefined,
		content: [
			{
				...source.content[0],
				blocks: [
					{ id: "note", type: "note" as const, data: { content: "Remember", color: "warning" } },
					{
						id: "code",
						type: "code" as const,
						data: { code: "const a = 1", language: "javascript" },
					},
					{ id: "equation", type: "equation" as const, data: { latex: "x^2" } },
					{
						id: "check",
						type: "assessment" as const,
						data: {
							assessmentType: "choice",
							stem: [],
							response: {
								type: "choice",
								selectionMode: "single",
								inputMethod: "click",
								options: [{ id: "yes", text: "Yes", correct: true }],
							},
							feedback: {},
						},
					},
				],
			},
		],
	};
	const zip = new AdmZip((await buildScormPackage(course, { format: "html" })).zip);
	expect(notice(zip, "react")).toContain(
		await readFile(
			require.resolve("react/package.json").replace("package.json", "LICENSE"),
			"utf8",
		),
	);
	expect(notice(zip, "@tabler-icons")).toContain("Paweł Kuna");
	expect(notice(zip, "prism-react-renderer")).toContain("Permission is hereby granted");
	expect(notice(zip, "katex")).toContain("Permission is hereby granted");
});

it("exports prebuilt notices and fails closed when selected font or runtime notices are missing", async () => {
	const desktop: DesktopExportInput = {
		courseId: source.id,
		blocks: source.content[0].blocks,
		frontmatter: { title: source.title },
		config: { completionThreshold: 0.8 },
		resolvedAssets: new Map(),
		viewerVersion: "test",
		locale: "en",
	};
	const options = {
		mode: "desktop" as const,
		format: "html" as const,
		prebuiltAssetsDir: assets,
		projectDir: assets,
	};
	const zip = new AdmZip((await buildScormPackage(desktop, options)).zip);
	expect(notice(zip, "feather-icons")).toContain("Copyright (c) 2013-2023 Cole Bemis");
	expect(notice(zip, "@fontsource-source-sans-3")).toContain("SIL OPEN FONT LICENSE");
	const manifestPath = path.join(assets, "viewer-manifest.json");
	const original = await readFile(manifestPath, "utf8");
	try {
		const missingCursor = JSON.parse(original);
		delete missingCursor.thirdPartyNotices.packages["feather-icons@4.29.2"];
		await writeFile(manifestPath, JSON.stringify(missingCursor));
		await expect(buildScormPackage(desktop, options)).rejects.toThrow(
			"Missing required third-party notices",
		);
		const manifest = JSON.parse(original);
		delete manifest.thirdPartyNotices.packages["@fontsource/source-sans-3"];
		await writeFile(manifestPath, JSON.stringify(manifest));
		await expect(buildScormPackage(desktop, options)).rejects.toThrow(
			"Missing required third-party notices",
		);
		const missingRuntime = JSON.parse(original);
		delete missingRuntime.thirdPartyNotices.outputs[missingRuntime.shell];
		await writeFile(manifestPath, JSON.stringify(missingRuntime));
		await expect(buildScormPackage(desktop, options)).rejects.toThrow(
			"Missing third-party notice mapping",
		);
	} finally {
		await writeFile(manifestPath, original);
	}
});

it("retains exact upstream supplemental licence text and rejects absent licence text", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "notice-package-"));
	try {
		await writeFile(
			path.join(directory, "package.json"),
			JSON.stringify({ name: "react-remove-scroll-bar", version: "2.3.8" }),
		);
		const collected = await readPackageNotice(path.join(directory, "package.json"));
		expect(collected.texts.LICENSE).toBe(
			await readFile(
				path.resolve(
					import.meta.dirname,
					"../../../../apps/desktop/resources/third-party-notices/react-remove-scroll-bar@2.3.8/LICENSE",
				),
				"utf8",
			),
		);
		await writeFile(
			path.join(directory, "package.json"),
			JSON.stringify({ name: "missing-license", version: "1.0.0" }),
		);
		await expect(readPackageNotice(path.join(directory, "package.json"))).rejects.toThrow(
			"Missing third-party license text",
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

it("preserves exact bilingual course runtime permissions in HTML and SCORM archives", async () => {
	const sha256 = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
	for (const format of ["html", "scorm12", "scorm2004"] as const) {
		const zip = new AdmZip((await buildScormPackage(source, { format })).zip);
		const runtime = zip.readAsText("PRAXITY-COURSE-RUNTIME-LICENSE.txt");
		const permissions = runtime
			.split("\n\n")
			.filter((paragraph) =>
				/^(Praxity grants|This permission|Praxity autorise|Cette permission)/.test(paragraph),
			);
		expect(permissions.map(sha256)).toEqual([
			"6a84f9bba97e96afc14c023a60534349dd9a00fe26fdf06ec3e26fac398c200f",
			"ad9b80a87a02166f5fdfe4206ea83c33aa5409d8b739a10a4680735689e35836",
			"8a03d696d3086541d868397e9da98ddd245fe9a6fd2d84b98d326278336dd94e",
			"9ad209c7112724dfc7c27d2ef510e0ea67d25daba9a08a5ac6a5c51d4db27d86",
		]);
		expect(runtime).toMatch(
			/does not impose authoring terms on that content or on recipients exercising/,
		);
		expect(runtime).toMatch(
			/n'impose pas de conditions de création à ce\ncontenu ou aux destinataires/,
		);
		expect(runtime).not.toMatch(/ethical-use|utilisation éthique/);
	}
});
