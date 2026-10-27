import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readLesson, readSelfCheckContent } from "@praxity/grammar";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import type { CourseExportInput, CoursePreviewDeployment } from "../src/build";
import { selfCheckRuntimeAssets } from "../src/self-check";

// Mock the asset resolver to avoid network calls
vi.mock("../src/asset-resolver", () => ({
	resolveAssets: vi.fn((pages: unknown[]) => Promise.resolve(pages)),
}));

// Import after mocks are set up
const {
	buildScormPackage,
	compileCourse,
	deployCourse,
	createCourseContext,
	selfCheckContentInput,
} = await import("../src/build");

const minimalCourse: CourseExportInput = {
	id: "test-course",
	title: "Test Course",
	sourceLocale: "en",
	// This fixture exercises a static artifact without interactive shell controls.
	navToggles: { navTopBar: false, showA11yPill: false },
	content: [
		{
			id: "p1",
			title: "Page 1",
			blocks: [{ id: "b1", type: "text", data: { content: "<p>Hello</p>" } }],
		},
	],
};

function zipContents(buffer: Buffer) {
	return new AdmZip(buffer)
		.getEntries()
		.filter((entry) => !entry.isDirectory)
		.map((entry) => ({ name: entry.entryName, content: entry.getData().toString("base64") }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

function zipFileNames(buffer: Buffer): string[] {
	return new AdmZip(buffer)
		.getEntries()
		.filter((entry) => !entry.isDirectory)
		.map((entry) => entry.entryName);
}

function zipText(buffer: Buffer, filename: string): string {
	return new AdmZip(buffer).getEntry(filename)?.getData().toString("utf8") ?? "";
}

async function previewFileBytes(
	preview: CoursePreviewDeployment,
	filename: string,
): Promise<Buffer> {
	const stream = await preview.openFile(filename);
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

function withoutDeploymentHead(html: string): string {
	return html.replace(
		/<script id="praxity-deployment-config" type="application\/json">[\s\S]*?<\/script>\s*<script defer src="host-(?:standalone|electron-preview)-[A-Z0-9]{8}\.js"><\/script>/u,
		"",
	);
}

function sha256(content: Buffer | string): string {
	return createHash("sha256").update(content).digest("hex");
}

async function previewTempDirectories(): Promise<string[]> {
	return (await readdir(tmpdir())).filter((name) => name.startsWith("praxity-preview-")).sort();
}

describe("buildScormPackage", () => {
	it("packages reader self-check tasks including markdown and a tooltip inside tabs", async () => {
		const task = "Write **an** answer about [PUBLIC_TERM]{Public definition.}.";
		const activity = `::: self-check ${task}\nmodel: HIDDEN_MODEL\n:: HIDDEN_LABEL\nmissed: HIDDEN_HINT\nevidence: HIDDEN_MODEL\n:::\n`;
		const read = readLesson(
			`# Practice\n\n${activity}\n::: tabs\n:: First\n${activity}:: Second\nText.\n:::\n`,
		);
		expect(read.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([]);
		const course = {
			...minimalCourse,
			content: splitBlocksIntoPages(read.blocks, "Practice"),
			selfCheckContents: [...read.nodes.values()]
				.filter((record) => !record.role && record.node.type === "self-check")
				.map((record) => selfCheckContentInput(record.id, readSelfCheckContent(read, record.id))),
		};
		const owned = new Map(
			selfCheckRuntimeAssets((await createCourseContext(course)).selfCheckRuntime).map((asset) => [
				asset.path,
				asset,
			]),
		);
		expect(owned.size).toBe(2);
		const result = await buildScormPackage(course, { format: "scorm12" });
		const entries = new AdmZip(result.zip).getEntries().filter((entry) => !entry.isDirectory);
		const html = entries
			.filter((entry) => entry.entryName.endsWith(".html"))
			.map((entry) => entry.getData().toString("utf8"))
			.join("\n");
		const body = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
		expect(
			[
				...new JSDOM(body).window.document.querySelectorAll(
					"[data-self-check] .praxity-assessment-stem",
				),
			].map((heading) => heading.textContent),
		).toEqual([task, task]);
		expect(html).toContain('class="praxity-tabs');
		for (const [path, asset] of owned) {
			expect(entries.find((entry) => entry.entryName === path)?.getData()).toEqual(asset.bytes);
		}
		for (const entry of entries.filter((entry) => !owned.has(entry.entryName)))
			expect(entry.getData().toString("utf8"), entry.entryName).not.toMatch(
				/HIDDEN_MODEL|HIDDEN_LABEL|HIDDEN_HINT/,
			);
	});

	it.each([false, true])(
		"loads the SCORM dependency before the host in content and utility documents, Guided=%s",
		async (guided) => {
			const artifact = await compileCourse({
				...minimalCourse,
				...(guided ? { moduleDeck: {} } : {}),
				content: minimalCourse.content.map((page) => ({
					...page,
					lessonId: "lesson-1",
					lessonTitle: "Lesson 1",
					blocks: [
						...page.blocks,
						{
							id: "glossary-text",
							type: "text",
							data: { content: "[SCO]{Shareable content object}" },
						},
					],
				})),
				resourceEntries: [
					{
						title: "Reference",
						description: "Reference page",
						url: "https://example.com/reference",
						resourceType: "link",
					},
				],
				glossaryTabEnabled: true,
				resourcesTabEnabled: true,
			});
			try {
				for (const format of ["scorm12", "scorm2004"] as const) {
					const result = await deployCourse(artifact, { format });
					const files = zipFileNames(result.zip);
					const helper = files.find((file) => file.startsWith("scorm-support-"));
					const host = files.find((file) => file.startsWith(`host-${format}-`));
					expect(helper).toBeDefined();
					expect(files).toContain("glossary.html");
					expect(files).toContain("resources.html");
					const documents = files.filter((file) => file.endsWith(".html") && file !== "index.html");
					expect(documents.length).toBeGreaterThanOrEqual(3);
					for (const file of documents) {
						expect(zipText(result.zip, file), file).toContain(
							`<script defer src="${helper}"></script>\n<script defer src="${host}"></script>`,
						);
					}
				}
			} finally {
				await artifact.dispose();
			}
		},
	);

	it("throws for empty course content", async () => {
		const emptyCourse: CourseExportInput = {
			...minimalCourse,
			content: [],
		};

		await expect(buildScormPackage(emptyCourse, { format: "scorm12" })).rejects.toThrow(
			"Cannot publish a course with no content pages. Add at least one page.",
		);
	});

	it("throws for null/undefined content", async () => {
		const nullCourse = {
			...minimalCourse,
			content: null as unknown as [],
		};

		await expect(buildScormPackage(nullCourse, { format: "scorm12" })).rejects.toThrow(
			"Cannot publish a course with no content pages. Add at least one page.",
		);
	});

	it("produces a zip buffer for SCORM 1.2 export", async () => {
		const result = await buildScormPackage(minimalCourse, { format: "scorm12" });

		expect(result.zip).toBeInstanceOf(Buffer);
		expect(result.zip.length).toBeGreaterThan(0);
		expect(result.pageCount).toBe(1);
		expect(result.format).toBe("scorm12");
	});

	it("produces a standalone HTML zip", async () => {
		const result = await buildScormPackage(minimalCourse, { format: "html" });
		const files = zipFileNames(result.zip);

		expect(result.format).toBe("html");
		expect(result.zip.length).toBeGreaterThan(0);
		expect(files.some((name) => name.startsWith("course-shell-"))).toBe(true);
		expect(files.some((name) => name.startsWith("island-"))).toBe(false);
		expect(files.some((name) => name.startsWith("viewer"))).toBe(false);
		expect(files.some((name) => name.startsWith("scorm-support-"))).toBe(false);
		expect(zipText(result.zip, "page-1.html")).not.toContain("scorm-support-");
	});

	it("deploys one opaque target-neutral artifact more than once until disposal", async () => {
		const artifact = await compileCourse(minimalCourse);
		const repeated = await compileCourse(minimalCourse);

		expect(artifact.manifest).toMatchObject({
			version: 1,
			rendererContractVersion: 1,
			learnerStateSchemaVersion: 1,
			courseId: "test-course",
			entry: "index.html",
			pageCount: 1,
			pages: [
				{
					id: "p1",
					title: "Page 1",
					slug: "page-1",
					runtime: { mode: "static", islands: [], legacyReasons: [] },
					statefulBlockIds: [],
				},
			],
		});
		expect(artifact.manifest.files.length).toBeGreaterThan(0);
		expect(artifact.manifest.files.find((file) => file.path === "index.html")?.mediaType).toBe(
			"text/html; charset=utf-8",
		);
		expect(repeated.manifest).toEqual(artifact.manifest);

		const html = await deployCourse(artifact, { format: "html" });
		const scorm12 = await deployCourse(artifact, { format: "scorm12" });
		const scorm2004 = await deployCourse(artifact, { format: "scorm2004" });
		const xapi = await deployCourse(artifact, {
			format: "xapi",
			xapiConfig: {
				endpoint: "https://lrs.example/xapi",
				auth: "Bearer test",
				actorMode: "lms",
			},
		});

		expect(zipFileNames(html.zip).filter((name) => name.startsWith("host-"))).toEqual([
			expect.stringMatching(/^host-standalone-/u),
		]);
		expect(zipText(html.zip, "page-1.html")).not.toContain("<!--praxity-deployment-head-->");
		expect(zipText(html.zip, "page-1.html")).toContain(
			'<script id="praxity-deployment-config" type="application/json">{"format":"standalone"}</script>',
		);
		for (const [deployment, selectedHost] of [
			[scorm12, "host-scorm12-"],
			[scorm2004, "host-scorm2004-"],
			[xapi, "host-xapi-"],
		] as const) {
			const files = zipFileNames(deployment.zip);
			const session = files.find((name) => name.startsWith("scorm-support-"));
			const page = zipText(deployment.zip, "page-1.html");
			if (deployment.format === "xapi") {
				expect(session).toBeUndefined();
				expect(page).not.toContain("scorm-support-");
			} else {
				expect(session).toMatch(/^scorm-support-[A-Z0-9]{8}\.js$/u);
				const host = files.find((name) => name.startsWith(selectedHost));
				expect(page).toContain(
					`<script defer src="${session}"></script>\n<script defer src="${host}"></script>`,
				);
				expect(zipText(deployment.zip, "imsmanifest.xml")).toContain(`<file href="${session}"`);
			}
			expect(files.filter((name) => name.startsWith("host-"))).toHaveLength(1);
			expect(files.some((name) => name.startsWith(selectedHost))).toBe(true);
			expect(files).not.toContain("scorm-runtime.js");
			expect(zipText(deployment.zip, "page-1.html")).not.toContain(
				"<!--praxity-deployment-head-->",
			);
		}
		expect(zipText(xapi.zip, "page-1.html")).toContain("https://lrs.example/xapi");
		expect(artifact.manifest).toEqual(repeated.manifest);

		const previewDirs = await previewTempDirectories();
		const preview = await deployCourse(artifact, { format: "electron-preview" });
		expect(await previewTempDirectories()).toEqual(previewDirs);
		expect(preview.courseToken).toMatch(/^[a-f0-9]{32}$/);
		expect(preview.manifest.revision).not.toBe(artifact.manifest.revision);
		expect(preview.manifest.pages).toEqual(artifact.manifest.pages);
		expect(
			preview.manifest.files.some((file) => file.path.startsWith("host-electron-preview-")),
		).toBe(true);
		expect(preview.manifest.files.some((file) => file.path.startsWith("scorm-support-"))).toBe(
			false,
		);
		const htmlArchive = new AdmZip(html.zip);
		for (const file of preview.manifest.files) {
			const previewBytes = await previewFileBytes(preview, file.path);
			expect(sha256(previewBytes), file.path).toBe(file.sha256);
			const htmlEntry = htmlArchive.getEntry(file.path);
			if (!htmlEntry || file.path.startsWith("host-electron-preview-")) continue;
			if (file.path.endsWith(".html")) {
				const normalizedPreview = withoutDeploymentHead(previewBytes.toString("utf8"));
				const normalizedHtml = withoutDeploymentHead(htmlEntry.getData().toString("utf8"));
				expect(normalizedPreview, file.path).toBe(normalizedHtml);
				expect(sha256(normalizedPreview), file.path).toBe(sha256(normalizedHtml));
			} else {
				expect(previewBytes, file.path).toEqual(htmlEntry.getData());
				expect(file.sha256, file.path).toBe(
					artifact.manifest.files.find((candidate) => candidate.path === file.path)?.sha256,
				);
			}
		}
		const repeatedPreview = await deployCourse(repeated, { format: "electron-preview" });
		expect(repeatedPreview.courseToken).toBe(preview.courseToken);
		expect(repeatedPreview.manifest).toEqual(preview.manifest);
		await repeatedPreview.dispose();
		const racingPreview = await deployCourse(repeated, { format: "electron-preview" });
		const racingOpen = racingPreview.openFile("index.html");
		const racingDispose = racingPreview.dispose();
		await expect(racingOpen).rejects.toThrow("disposed");
		await racingDispose;
		const opened = await preview.openFile("index.html", { start: 0, end: 4 });
		const chunks: Buffer[] = [];
		for await (const chunk of opened) chunks.push(Buffer.from(chunk));
		expect(Buffer.concat(chunks).toString("utf8")).toBe("<!doc");
		await expect(preview.openFile("../course.yaml")).rejects.toThrow("not listed");
		await expect(preview.openFile("index.html", { start: 4, end: 2 })).rejects.toThrow(
			"range is invalid",
		);
		await expect(artifact.dispose()).rejects.toThrow("deployment is active");
		const retainedFile = preview.manifest.files.find(
			(file) => !file.path.endsWith(".html") && !file.path.startsWith("host-electron-preview-"),
		);
		expect(retainedFile).toBeDefined();
		const retainedStream = await preview.openFile(retainedFile?.path ?? "");
		await preview.dispose();
		expect(retainedStream.destroyed).toBe(true);
		expect(await previewTempDirectories()).toEqual(previewDirs);
		await artifact.dispose();
		await expect(deployCourse(artifact, { format: "html" })).rejects.toThrow("disposed");
		await repeated.dispose();
	});

	it("produces identical core files from identical normalized input", async () => {
		const first = await buildScormPackage(minimalCourse, { format: "html" });
		const second = await buildScormPackage(minimalCourse, { format: "html" });

		expect(zipContents(second.zip)).toEqual(zipContents(first.zip));
	});

	it.each([
		{
			name: "HTML",
			course: {
				...minimalCourse,
				content: [
					{
						...minimalCourse.content[0],
						blocks: [
							{
								id: "b1",
								type: "text" as const,
								data: { content: '<p><a href="/outside">Outside</a></p>' },
							},
						],
					},
				],
			},
		},
		{
			name: "CSS",
			course: { ...minimalCourse, customCss: "body { background: url(/outside.png); }" },
		},
	])("rejects root-relative artifact references in $name", async ({ course }) => {
		await expect(compileCourse(course)).rejects.toThrow("must be revision-relative");
	});

	it("fingerprints the final course stylesheet bytes", async () => {
		const first = await buildScormPackage(minimalCourse, { format: "html" });
		const changed = await buildScormPackage(
			{ ...minimalCourse, customCss: ".client-theme { color: rebeccapurple; }" },
			{ format: "html" },
		);
		const stylesheet = (buffer: Buffer, lite = false) =>
			zipFileNames(buffer).find((name) =>
				(lite ? /^styles-lite\.[a-f0-9]{12}\.css$/ : /^styles\.[a-f0-9]{12}\.css$/).test(name),
			);

		expect(stylesheet(first.zip)).toBeDefined();
		expect(stylesheet(changed.zip)).toBeDefined();
		expect(stylesheet(changed.zip)).not.toBe(stylesheet(first.zip));
		expect(stylesheet(changed.zip, true)).not.toBe(stylesheet(first.zip, true));
		expect(zipFileNames(changed.zip)).not.toContain("styles.css");
		expect(zipText(changed.zip, "page-1.html")).toContain(
			`href="${stylesheet(changed.zip, true)}"`,
		);
	});

	it("records ordered stable identities and per-page runtime plans", async () => {
		const artifact = await compileCourse(
			{
				...minimalCourse,
				content: [
					{
						id: "page-stable",
						lessonId: "lesson-stable",
						title: "Checklist",
						blocks: [
							{
								id: "checklist-stable",
								type: "checklist",
								data: { items: [{ id: "item-1", text: "Done" }] },
							},
						],
					},
				],
			},
			{},
		);

		expect(artifact.manifest.pages).toEqual([
			{
				id: "page-stable",
				title: "Checklist",
				lessonId: "lesson-stable",
				slug: "checklist",
				runtime: { mode: "islands", islands: ["checklist"], legacyReasons: [] },
				statefulBlockIds: ["checklist-stable"],
			},
		]);
		await artifact.dispose();
	});

	it("packages only the islands referenced by the course", async () => {
		const result = await buildScormPackage(
			{
				...minimalCourse,
				content: [
					{
						id: "p1",
						title: "Checklist",
						blocks: [
							{
								id: "checklist-1",
								type: "checklist",
								data: { items: [{ id: "item-1", text: "Done" }] },
							},
						],
					},
				],
			},
			{ format: "html" },
		);

		const files = new AdmZip(result.zip).getEntries().map((entry) => entry.entryName);
		expect(files.some((file) => file.startsWith("course-shell-"))).toBe(true);
		expect(files.some((file) => file.startsWith("island-loader"))).toBe(true);
		expect(files.some((file) => file.startsWith("island-nav"))).toBe(false);
		expect(files.some((file) => file.startsWith("island-checklist"))).toBe(true);
		expect(files.some((file) => file.startsWith("island-rating"))).toBe(false);
		expect(files.some((file) => file.startsWith("island-signature"))).toBe(false);
		expect(files.some((file) => file.startsWith("island-image-comparison"))).toBe(false);
		expect(files.some((file) => file.startsWith("island-labeled-graphic"))).toBe(false);
		expect(files.some((file) => file.startsWith("island-narration"))).toBe(false);
		expect(files.some((file) => file.startsWith("island-logic"))).toBe(false);
		expect(files.some((file) => file.startsWith("island-assessment-group"))).toBe(false);
		expect(files.some((file) => file.startsWith("island-chart"))).toBe(false);
		expect(files.some((file) => file.startsWith("viewer-legacy"))).toBe(false);
	});

	it("packages a logic page without the legacy viewer", async () => {
		const result = await buildScormPackage(
			{
				...minimalCourse,
				content: [
					{
						id: "p1",
						title: "Logic",
						blocks: [
							{
								id: "flag",
								type: "variable",
								data: {
									variableName: "showDetail",
									dataType: "boolean",
									defaultValue: false,
								},
							},
							{
								id: "detail",
								type: "text",
								data: { content: "<p>Conditional</p>", visible: "showDetail" },
							},
						],
					},
				],
			},
			{ format: "html" },
		);
		const zip = new AdmZip(result.zip);
		const files = zip.getEntries().map((entry) => entry.entryName);
		const html = zip.getEntry("logic.html")?.getData().toString("utf8") ?? "";
		const logicAsset = files.find(
			(file) => file.startsWith("island-logic") && !file.endsWith(".classic.js"),
		);
		const classicLogicAsset = files.find(
			(file) => file.startsWith("island-logic") && file.endsWith(".classic.js"),
		);
		const navAsset = files.find((file) => file.startsWith("island-nav"));

		expect(logicAsset).toBeTruthy();
		expect(classicLogicAsset).toBeTruthy();
		expect(
			zip
				.getEntry(logicAsset ?? "")
				?.getData()
				.toString("utf8"),
		).toContain(`./${classicLogicAsset}`);
		expect(navAsset).toBeTruthy();
		expect(files.some((file) => file.startsWith("island-loader"))).toBe(true);
		expect(files.some((file) => file.startsWith("viewer-legacy"))).toBe(false);
		expect(html).toContain(`data-island-logic="${logicAsset}"`);
		expect(html).toContain(`data-island-nav="${navAsset}"`);
		expect(html).toContain('data-praxity-islands="logic,nav"');
		expect(html).toMatch(/href="styles-lite\.[a-f0-9]{12}\.css"/);
	});

	it("cleans up temp directory after successful build", async () => {
		const nodeOs = await import("node:os");
		const { mkdtemp, readdir, rm } = await import("node:fs/promises");
		const nodePath = await import("node:path");

		// Isolate this test's temp dirs from concurrent test files by pointing
		// os.tmpdir() (which reads TMPDIR/TMP each call) at a private base. Vitest
		// isolates files into workers and runs a file's tests sequentially, so
		// swapping TMPDIR here cannot race other tests.
		const isolatedBase = await mkdtemp(nodePath.join(nodeOs.tmpdir(), "praxity-cleanup-test-"));
		// Save originals so we can RESTORE exactly — including deleting keys that
		// were unset. Assigning `undefined` stringifies to "undefined" and would
		// poison os.tmpdir() for later tests (Linux CI leaves TMPDIR unset).
		const keys = ["TMPDIR", "TMP", "TEMP"] as const;
		const saved = new Map(keys.map((k) => [k, process.env[k]]));
		const setEnv = (k: (typeof keys)[number], v: string | undefined) => {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		};
		for (const k of keys) setEnv(k, isolatedBase);
		try {
			await buildScormPackage(minimalCourse, { format: "scorm12" });

			// Compilation and deployment use separate workspaces; neither may leak.
			const leaked = (await readdir(isolatedBase)).filter(
				(filename) =>
					filename.startsWith("praxity-export-") || filename.startsWith("praxity-deployment-"),
			);
			expect(leaked).toEqual([]);
		} finally {
			for (const k of keys) setEnv(k, saved.get(k));
			await rm(isolatedBase, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		}
	});

	it("returns correct page count for multi-page course", async () => {
		const multiPageCourse: CourseExportInput = {
			...minimalCourse,
			content: [
				{
					id: "p1",
					title: "Page 1",
					blocks: [{ id: "b1", type: "text", data: { content: "<p>1</p>" } }],
				},
				{
					id: "p2",
					title: "Page 2",
					blocks: [{ id: "b2", type: "text", data: { content: "<p>2</p>" } }],
				},
				{
					id: "p3",
					title: "Page 3",
					blocks: [{ id: "b3", type: "text", data: { content: "<p>3</p>" } }],
				},
			],
		};

		const result = await buildScormPackage(multiPageCourse, { format: "scorm2004" });
		expect(result.pageCount).toBe(3);
	});

	it("produces a zip buffer for SCORM 2004 export", async () => {
		const result = await buildScormPackage(minimalCourse, { format: "scorm2004" });

		expect(result.zip).toBeInstanceOf(Buffer);
		expect(result.format).toBe("scorm2004");
		// ZIP magic number
		expect(result.zip[0]).toBe(0x50);
		expect(result.zip[1]).toBe(0x4b);
	});
});
