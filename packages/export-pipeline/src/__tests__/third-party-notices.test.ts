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

it("preserves the exact MIT licence for the Praxity course player in HTML and SCORM archives", async () => {
	for (const format of ["html", "scorm12", "scorm2004"] as const) {
		const zip = new AdmZip((await buildScormPackage(source, { format })).zip);
		const runtime = zip.readAsText("PRAXITY-COURSE-RUNTIME-LICENSE.txt");
		expect(createHash("sha256").update(runtime).digest("hex")).toBe(
			"d817c04f10efaffd1ab6dba0792a6567dce98f8ab41e86c64833a7b9cff7ecc5",
		);
	}
});
