import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { isFrameCommand } from "@praxity/editor-core/frame-bridge";
import { PracticeAdmissionError } from "@praxity/export-pipeline";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { runPraxityCli } from "../cli";
import { CoursePreviewService } from "../course-preview-service";
import { exportProject } from "../export/export-project";
import { resolveLessonSources } from "../lesson-source";
import { PreviewScheduler } from "../studio/preview-scheduler";
import { createStudioProjectSession, type StudioEvent } from "../studio/project-session";

const mocks = vi.hoisted(() => ({
	watcher: undefined as import("node:events").EventEmitter | undefined,
	compileCourse: vi.fn(),
	deployCourse: vi.fn(),
	host: vi.fn(),
}));
vi.mock("chokidar", async () => {
	const { EventEmitter } = await import("node:events");
	return {
		watch: () => {
			const watcher = Object.assign(new EventEmitter(), { close: async () => {} });
			mocks.watcher = watcher;
			queueMicrotask(() => watcher.emit("ready"));
			return watcher;
		},
	};
});
vi.mock("@praxity/export-pipeline/bundle-viewer", async (original) => ({
	...(await original<typeof import("@praxity/export-pipeline/bundle-viewer")>()),
	assertViewerAssetsReady: vi.fn(),
}));
vi.mock("@praxity/export-pipeline", async (original) => ({
	...(await original<typeof import("@praxity/export-pipeline")>()),
	compileCourse: mocks.compileCourse,
	deployCourse: mocks.deployCourse,
}));

const roots: string[] = [];
let cliRoot: string;
let cliEntry: string;
beforeAll(async () => {
	cliRoot = await mkdtemp(path.join(tmpdir(), "practice-admission-cli-"));
	cliEntry = path.join(cliRoot, "build-course-html.mjs");
	const script = new URL(
		"../../../../../packages/export-pipeline/scripts/build-course-html.ts",
		import.meta.url,
	);
	const runtimeRequire = createRequire(
		new URL("../../../../../packages/shared-blocks/package.json", import.meta.url),
	);
	// Keep source admission in the real CLI; a ZIP adapter avoids building viewer assets.
	await build({
		entryPoints: [fileURLToPath(script)],
		outfile: cliEntry,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		banner: {
			js: `import { createRequire as createBundleRequire } from "node:module"; const require = createBundleRequire(${JSON.stringify(script.href)});`,
		},
		plugins: [
			{
				name: "html-publication-adapter",
				setup(builder) {
					builder.onResolve({ filter: /^\.\.\/src\/build\.ts$/ }, () => ({
						path: "html-publication-adapter",
						namespace: "html-publication-adapter",
					}));
					builder.onLoad({ filter: /.*/, namespace: "html-publication-adapter" }, () => ({
						contents: `import AdmZip from "adm-zip";
							export async function buildScormPackage(course) {
								const zip = new AdmZip();
								zip.addFile("index.html", Buffer.from(JSON.stringify(course.blocks)));
								return { zip: zip.toBuffer(), pageCount: 1 };
							}`,
						resolveDir: path.dirname(fileURLToPath(script)),
					}));
				},
			},
			{
				name: "external-dom-runtime",
				setup(builder) {
					builder.onResolve({ filter: /^(isomorphic-dompurify|jsdom)$/ }, (args) => ({
						path: pathToFileURL(runtimeRequire.resolve(args.path)).href,
						external: true,
					}));
				},
			},
		],
	});
});
afterAll(async () => {
	if (cliRoot) await rm(cliRoot, { recursive: true, force: true });
});
const sessions: Awaited<ReturnType<typeof createStudioProjectSession>>[] = [];
const publicSource =
	"---\ntitle: Admission\nvariables:\n  picked: false\n---\n# Public\n::: text {name=publicText}\nPublic\n:::\n";
const choice =
	"::: choice HIDDEN QUESTION {private name=priv}\n(x) HIDDEN ANSWER\n( ) Other\n:::\n";
function fixtureSource(line: 21 | 22) {
	const lines = `${publicSource}${choice}`.trimEnd().split("\n");
	while (lines.length < 19) lines.push("");
	return `${lines.join("\n")}\n::: rule\nif: ${line === 21 ? "@priv.isCompleted" : "picked"} is true\nthen: ${line === 22 ? "require @priv" : "set picked = true"}\n:::\n`;
}
async function fixture(source = publicSource) {
	const root = await mkdtemp(
		path.join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "practice-admission-"),
	);
	roots.push(root);
	await writeFile(path.join(root, "lesson.prax"), source);
	await persistFixtureIdentity(root);
	return root;
}
const options = (projectDir: string) => ({
	manifestPolicy: "write" as const,
	projectDir,
	exportAssetsDir: path.join(projectDir, "export-assets"),
	scope: "course" as const,
	fallbackCompletionThreshold: 0.8,
	enforceAccessibility: false,
	inheritWorkspaceSettings: false,
});
function preview(projectDir: string) {
	return new CoursePreviewService({
		getProjectDir: () => projectDir,
		getExportAssetsDir: () => path.join(projectDir, "export-assets"),
		getWorkspacePath: () => null,
		getFallbackCompletionThreshold: () => 0.8,
		stateStore: {} as never,
		hostCourseArtifact: mocks.host,
		inheritWorkspaceSettings: false,
	});
}
const diagnostic = (line: number) => ({
	code: "practice-no-tracking",
	file: "lesson.prax",
	line,
	column: 1,
	messageRef: { key: "grammar.v4.practice-no-tracking", args: { line, column: 1 } },
	span: { start: expect.any(Number), end: expect.any(Number) },
});

const attemptsSource = (attempts: string) =>
	`# Page\n\n::: choice Pick one {attempts=${attempts}}\n(x) Yes\n( ) No\n:::\n`;
const attemptsDiagnostic = {
	code: "choice-invalid-attempts",
	message: expect.stringMatching(/^Invalid choice fact for block "[^"]+": attempts$/),
	file: "lesson.prax",
	line: 3,
	column: 22,
	span: { start: 29, end: 41 },
	messageRef: {
		key: "grammar.v4.choice-invalid-attempts",
		args: { blockId: expect.any(String), line: 3, column: 22 },
	},
};

async function prepareExportAdapter(root: string) {
	await mkdir(path.join(root, "export-assets"), { recursive: true });
	await writeFile(path.join(root, "export-assets", "viewer.version.json"), '{"version":"test"}');
	mocks.compileCourse.mockResolvedValue({
		manifest: { courseId: "test", revision: "r", pages: [{ id: "page", slug: "page" }] },
		dispose: async () => {},
	});
	mocks.deployCourse.mockResolvedValue({
		zip: Buffer.from("published"),
		pageCount: 1,
		entryHtml: "index.html",
		directory: root,
		manifest: { revision: "r" },
	});
}

it.each(["2.5", "'2'", "2"])(
	"startup opens choice attempts=%s and fences only invalid input",
	async (attempts) => {
		const root = await fixture();
		await writeFile(path.join(root, "lesson.prax"), attemptsSource(attempts));
		const session = await createStudioProjectSession(root, "test");
		sessions.push(session);
		const events: StudioEvent[] = [];
		session.subscribe((event) => events.push(event));
		expect(await session.invoke("editorSnapshot", {})).toBeDefined();
		if (attempts === "2")
			expect(events.filter((event) => event.type === "compileFailed")).toEqual([]);
		else {
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "compileFailed",
					seq: 0,
					diagnostics: [expect.objectContaining(attemptsDiagnostic)],
				}),
			);
			expect(events.some((event) => event.type === "pageCompiled")).toBe(false);
		}
	},
);

it.each(["2.5", "'2'", "2"])(
	"outside choice attempts=%s refreshes or retains the last good preview",
	async (attempts) => {
		const root = await fixture(attemptsSource("0"));
		const session = await createStudioProjectSession(root, "test");
		sessions.push(session);
		const events: StudioEvent[] = [];
		session.subscribe((event) => events.push(event));
		await session.invoke("previewSelectPage", {});
		await vi.waitFor(() =>
			expect(events.some((event) => event.type === "pageCompiled")).toBe(true),
		);
		events.length = 0;
		await writeFile(path.join(root, "lesson.prax"), attemptsSource(attempts));
		mocks.watcher?.emit("all", "change", path.join(root, "lesson.prax"));
		if (attempts === "2") {
			await vi.waitFor(() =>
				expect(events).toContainEqual(
					expect.objectContaining({
						type: "pageCompiled",
						patch: expect.objectContaining({ seq: 1 }),
					}),
				),
			);
			expect(events.filter((event) => event.type === "compileFailed")).toEqual([]);
		} else {
			await vi.waitFor(() =>
				expect(events).toContainEqual(
					expect.objectContaining({
						type: "compileFailed",
						diagnostics: [expect.objectContaining(attemptsDiagnostic)],
					}),
				),
			);
			expect(events.some((event) => event.type === "pageCompiled")).toBe(false);
			expect(await session.invoke("previewStats", {})).toMatchObject({ contextSeq: 0 });
			await writeFile(path.join(root, "lesson.prax"), attemptsSource("2"));
			mocks.watcher?.emit("all", "change", path.join(root, "lesson.prax"));
			await vi.waitFor(() =>
				expect(events).toContainEqual(
					expect.objectContaining({
						type: "pageCompiled",
						patch: expect.objectContaining({ seq: 2 }),
					}),
				),
			);
			const replay: StudioEvent[] = [];
			session.subscribe((event) => replay.push(event));
			expect(replay.filter((event) => event.type === "compileFailed")).toEqual([]);
		}
	},
);

it.each(["2.5", "'2'", "2"])(
	"choice draft attempts=%s returns a located refusal or a render",
	async (attempts) => {
		const initial = attemptsSource("0");
		const root = await fixture(initial);
		const session = await createStudioProjectSession(root, "test");
		sessions.push(session);
		const identity = await resolveLessonSources(root);
		const page = identity.lessons.get("lesson.prax")?.pages[0];
		const node = page?.blocks.find((block) => block.type === "assessment");
		if (!page || !node) throw Error("Missing choice");
		const result = await session.invoke("previewRenderDraft", {
			transactionId: "choice-attempts-draft",
			pageId: page.id,
			nodeId: node.id,
			seq: 1,
			source: attemptsSource(attempts).slice("# Page\n\n".length),
		});
		if (attempts === "2") expect(result).toMatchObject({ ok: true });
		else
			expect(result).toMatchObject({
				ok: false,
				code: "invalid-args",
				diagnostics: [expect.objectContaining(attemptsDiagnostic)],
			});
		expect(await readFile(path.join(root, "lesson.prax"), "utf8")).toBe(initial);
	},
);

it.each(["2.5", "'2'", "2"])(
	"export choice attempts=%s refuses before output or publishes the control",
	async (attempts) => {
		const root = await fixture(attemptsSource("2"));
		await writeFile(path.join(root, "lesson.prax"), attemptsSource(attempts));
		await prepareExportAdapter(root);
		if (attempts === "2") {
			expect((await exportProject({ ...options(root), format: "html" })).zip.toString()).toBe(
				"published",
			);
			expect(mocks.compileCourse).toHaveBeenCalledOnce();
		} else {
			for (const format of ["html", "scorm-1.2", "scorm-2004", "xapi", "pdf"] as const)
				await expect(exportProject({ ...options(root), format })).rejects.toMatchObject({
					code: "choice-invalid-attempts",
					diagnostics: [expect.objectContaining(attemptsDiagnostic)],
				});
			expect(mocks.compileCourse).not.toHaveBeenCalled();
			expect(mocks.deployCourse).not.toHaveBeenCalled();
		}
	},
);

it.each(["2.5", "'2'", "2"])(
	"CLI choice attempts=%s preserves output on refusal and publishes the control",
	async (attempts) => {
		const root = await fixture(attemptsSource("2"));
		await writeFile(path.join(root, "lesson.prax"), attemptsSource(attempts));
		await prepareExportAdapter(root);
		const output = path.join(root, "course.zip");
		await writeFile(output, "last good");
		const result = await runPraxityCli(["export", root, "--format", "html", "--output", output], {
			appVersion: "test",
			exportAssetsDir: path.join(root, "export-assets"),
		});
		if (attempts === "2") {
			expect(result.exitCode, result.stderr).toBe(0);
			expect(await readFile(output, "utf8")).toBe("published");
		} else {
			expect(result.exitCode).toBe(1);
			expect(JSON.parse(result.stdout)).toMatchObject({
				ok: false,
				error: {
					code: "choice-invalid-attempts",
					diagnostics: [expect.objectContaining(attemptsDiagnostic)],
				},
			});
			expect(await readFile(output, "utf8")).toBe("last good");
			expect(mocks.compileCourse).not.toHaveBeenCalled();
		}
	},
);

it.each(["2.5", "'2'", "2"])(
	"the real HTML script admits only valid choice attempts=%s before creating output",
	async (attempts) => {
		const root = await fixture();
		await writeFile(path.join(root, "lesson.prax"), attemptsSource(attempts));
		const run = promisify(execFile)(process.execPath, [
			cliEntry,
			path.join(root, "lesson.prax"),
			path.join(root, "output"),
		]);
		if (attempts === "2") {
			await run;
			const blocks = JSON.parse(await readFile(path.join(root, "output", "index.html"), "utf8"));
			expect(blocks).toContainEqual(
				expect.objectContaining({
					type: "assessment",
					data: expect.objectContaining({ attempts: 2 }),
				}),
			);
			return;
		}
		const result = await run.then(
			() => {
				throw Error("CLI unexpectedly published");
			},
			(error) => error,
		);
		expect(result.stderr).toContain("lesson.prax:3:22");
		expect(result.stderr).toContain("choice-invalid-attempts");
		await expect(stat(path.join(root, "output"))).rejects.toMatchObject({ code: "ENOENT" });
	},
);
afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	vi.clearAllMocks();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

it.each([21, 22] as const)(
	"export and full preview refuse %s:1; startup opens fenced with diagnostics",
	async (line) => {
		const root = await fixture();
		await writeFile(path.join(root, "lesson.prax"), fixtureSource(line));
		for (const format of ["html", "scorm-1.2", "scorm-2004", "xapi", "pdf"] as const) {
			await expect(exportProject({ ...options(root), format })).rejects.toMatchObject({
				code: "practice-no-tracking",
				diagnostics: expect.arrayContaining([expect.objectContaining(diagnostic(line))]),
			});
		}
		await expect(preview(root).build()).rejects.toMatchObject({
			code: "practice-no-tracking",
			diagnostics: [expect.objectContaining(diagnostic(line))],
		});
		const session = await createStudioProjectSession(root, "test");
		sessions.push(session);
		const events: StudioEvent[] = [];
		session.subscribe((event) => events.push(event));
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "compileFailed",
				seq: 0,
				diagnostics: [expect.objectContaining(diagnostic(line))],
			}),
		);
		expect(events.some((event) => event.type === "pageCompiled")).toBe(false);
		expect(await session.invoke("editorSnapshot", {})).toBeDefined();
		expect(JSON.stringify(events)).not.toMatch(/HIDDEN/);
		expect(mocks.compileCourse).not.toHaveBeenCalled();
		expect(mocks.host).not.toHaveBeenCalled();
	},
);

it.each([21, 22] as const)(
	"emits structured compileFailed diagnostics for an outside %s:1 violation",
	async (line) => {
		const root = await fixture();
		const session = await createStudioProjectSession(root, "test");
		sessions.push(session);
		const events: StudioEvent[] = [];
		session.subscribe((event) => events.push(event));
		const source = fixtureSource(line);
		await writeFile(path.join(root, "lesson.prax"), source);
		mocks.watcher?.emit("all", "change", path.join(root, "lesson.prax"));
		await vi.waitFor(() =>
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "compileFailed",
					diagnostics: [
						expect.objectContaining({
							...diagnostic(line),
							span: {
								start: source.indexOf(line === 21 ? "if:" : "then:"),
								end: expect.any(Number),
							},
						}),
					],
				}),
			),
		);
		const serialized = JSON.stringify(events.filter((event) => event.type === "compileFailed"));
		expect(serialized).not.toMatch(/HIDDEN|selectedOption/);
		const failure = events.find((event) => event.type === "compileFailed");
		if (failure?.type !== "compileFailed") throw new Error("Missing source diagnostic event");
		const identity = { channel: "test", pageId: failure.pageId };
		expect(
			isFrameCommand(
				{
					source: "praxity-editor",
					version: 1,
					...identity,
					action: "compileFailed",
					seq: failure.seq,
					diagnostics: failure.diagnostics,
				},
				identity,
			),
		).toBe(true);
		expect(await session.invoke("previewStats", {})).toMatchObject({ contextSeq: 0 });
	},
);

it("diagnostic decoding retains old payloads and refuses malformed source metadata", () => {
	const identity = { channel: "test", pageId: "page" };
	const command = (diagnostic: object) => ({
		source: "praxity-editor",
		version: 1,
		...identity,
		action: "compileFailed",
		seq: 1,
		diagnostics: [diagnostic],
	});
	expect(
		isFrameCommand(command({ message: "Old failure", file: "lesson.prax", line: 2 }), identity),
	).toBe(true);
	for (const invalid of [
		{ code: "" },
		{ column: 0 },
		{ column: -1 },
		{ column: 1.5 },
		{ span: { start: -1, end: 2 } },
		{ span: { start: 3, end: 2 } },
		{ span: { start: 1, end: 2, hiddenContent: "secret" } },
	])
		expect(isFrameCommand(command({ message: "Failure", ...invalid }), identity)).toBe(false);
});

it("emits the practice-only code with source coordinates from the backend", async () => {
	const root = await fixture();
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const events: StudioEvent[] = [];
	session.subscribe((event) => events.push(event));
	await writeFile(
		path.join(root, "lesson.prax"),
		`# Page\n${choice.replace("private name", "private required name")}`,
	);
	mocks.watcher?.emit("all", "change", path.join(root, "lesson.prax"));
	await vi.waitFor(() =>
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "compileFailed",
				diagnostics: [
					expect.objectContaining({
						code: "private-choice-practice-only",
						file: "lesson.prax",
						line: 2,
						column: 1,
						span: { start: 7, end: expect.any(Number) },
						messageRef: {
							key: "grammar.v4.private-choice-practice-only",
							args: { line: 2, column: 1 },
						},
					}),
				],
			}),
		),
	);
});

it("practice-only violations block export and full preview; startup opens fenced", async () => {
	const root = await fixture();
	await writeFile(
		path.join(root, "lesson.prax"),
		`# Page\n${choice.replace("private name", "private required name")}`,
	);
	const expected = {
		code: "private-choice-practice-only",
		diagnostics: [
			expect.objectContaining({
				code: "private-choice-practice-only",
				file: "lesson.prax",
				line: 2,
				column: 1,
			}),
		],
	};
	for (const format of ["html", "scorm-1.2", "scorm-2004", "xapi", "pdf"] as const)
		await expect(exportProject({ ...options(root), format })).rejects.toMatchObject(expected);
	await expect(preview(root).build()).rejects.toMatchObject(expected);
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const events: StudioEvent[] = [];
	session.subscribe((event) => events.push(event));
	expect(events).toContainEqual(
		expect.objectContaining({
			type: "compileFailed",
			seq: 0,
			diagnostics: expected.diagnostics,
		}),
	);
	expect(JSON.stringify(events)).not.toMatch(/HIDDEN/);
	expect(await session.invoke("editorSnapshot", {})).toBeDefined();
	expect(mocks.compileCourse).not.toHaveBeenCalled();
});

it("the real HTML CLI refuses a practice-only source violation", async () => {
	const root = await fixture();
	await writeFile(
		path.join(root, "lesson.prax"),
		`# Page\n${choice.replace("private name", "private required name")}`,
	);
	const result = await promisify(execFile)(
		process.execPath,
		[cliEntry, path.join(root, "lesson.prax"), path.join(root, "output")],
		{ cwd: path.resolve(import.meta.dirname, "../../../../..") },
	).then(
		() => {
			throw new Error("CLI unexpectedly published");
		},
		(error) => error,
	);
	expect(result.stderr).toContain("lesson.prax:2:1");
	expect(result.stderr).toContain("private-choice-practice-only");
	expect(result.stderr).not.toMatch(/HIDDEN/);
	expect(mocks.compileCourse).not.toHaveBeenCalled();
	await expect(stat(path.join(root, "output"))).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([21, 22] as const)("real CLI build refuses %s:1 before creating output", async (line) => {
	const root = await fixture();
	await writeFile(path.join(root, "lesson.prax"), fixtureSource(line));
	const result = await promisify(execFile)(
		process.execPath,
		[cliEntry, path.join(root, "lesson.prax"), path.join(root, "output")],
		{ cwd: path.resolve(import.meta.dirname, "../../../../..") },
	).then(
		() => {
			throw new Error("CLI unexpectedly published");
		},
		(error) => error,
	);
	expect(result.stderr).toContain(`lesson.prax:${line}:1`);
	expect(result.stderr).toContain("practice-no-tracking");
	expect(result.stderr).not.toMatch(/HIDDEN QUESTION|HIDDEN ANSWER/);
	await expect(stat(path.join(root, "output"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("existing duplicate-logic-name stays non-blocking for export, full preview and session", async () => {
	const source = `${publicSource}# Other\n::: text {name=publicText}\nOther\n:::\n`;
	const root = await fixture(source);
	await mkdir(path.join(root, "export-assets"));
	await writeFile(path.join(root, "export-assets", "viewer.version.json"), '{"version":"test"}');
	const dispose = vi.fn();
	mocks.compileCourse.mockResolvedValue({
		manifest: { courseId: "test", revision: "r", pages: [{ id: "page", slug: "page" }] },
		dispose,
	});
	mocks.deployCourse.mockResolvedValue({
		zip: Buffer.from("published"),
		pageCount: 2,
		entryHtml: "index.html",
		directory: root,
		manifest: { revision: "r" },
	});
	const result = await exportProject({ ...options(root), format: "html" });
	expect(result.zip.toString()).toBe("published");
	expect(mocks.compileCourse).toHaveBeenCalledOnce();
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	mocks.host.mockResolvedValue({ entryUrl: "http://localhost/course", release: async () => {} });
	const service = preview(root);
	const built = await service.build();
	expect(built.entryUrl).toBe("http://localhost/course");
	await service.release(built.leaseId);
	expect(mocks.compileCourse).toHaveBeenCalledTimes(2);
	expect(mocks.host).toHaveBeenCalledOnce();
});

it("a refused commit updates draft admission and suppresses its own watcher echo", async () => {
	const { createHash } = await import("node:crypto");
	const initialSource = fixtureSource(21);
	const root = await fixture(initialSource);
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const identity = await resolveLessonSources(root);
	const read = identity.lessons.get("lesson.prax");
	const node = read?.pages[0]?.blocks.find((block) => block.type === "text");
	const mapping = identity.identity.sourceMappings.find((entry) => entry.id === node?.id);
	if (!read || !node || !mapping) throw Error("Missing source mapping");
	const events: StudioEvent[] = [];
	session.subscribe((event) => events.push(event));
	events.length = 0;
	const result = await session.invoke("operationApply", {
		transactionId: "refused-preview-commit",
		operation: "editSource",
		files: [
			{
				path: "lesson.prax",
				baseRevision: createHash("sha256").update(initialSource).digest("hex"),
			},
		],
		targets: [
			{
				file: "lesson.prax",
				ref: {
					kind: "node",
					nodeId: node.id,
					path: mapping.path,
					fingerprint: mapping.fingerprint,
				},
				expectedText: initialSource.slice(mapping.span.start, mapping.span.end),
			},
		],
		args: { text: "::: text {name=publicText}\nRevised.\n" },
	});
	expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
	expect(events.filter((event) => event.type === "compileFailed")).toHaveLength(1);
	const treeChanged = new Promise<void>((resolve) => {
		const disconnect = session.subscribe((event) => {
			if (event.type === "treeChanged") {
				disconnect();
				resolve();
			}
		});
	});
	mocks.watcher?.emit("all", "change", path.join(root, "lesson.prax"));
	await treeChanged;
	expect(events.filter((event) => event.type === "compileFailed")).toHaveLength(1);
	expect(events.filter((event) => event.type === "editorChanged")).toHaveLength(1);
	expect(events.filter((event) => event.type === "grammarChanged")).toHaveLength(0);
});

it.each(["commit", "queued commit refresh", "outside change"] as const)(
	"compiled %s failures keep localization metadata",
	async (site) => {
		const root = await fixture();
		const session = await createStudioProjectSession(root, "test");
		sessions.push(session);
		const error = new PracticeAdmissionError("practice-no-tracking", "node", "data.actions", "fr");
		const events: StudioEvent[] = [];
		session.subscribe((event) => events.push(event));
		if (site !== "outside change") {
			if (site === "commit")
				vi.spyOn(PreviewScheduler.prototype, "renderCommitted").mockImplementation(() => {
					throw error;
				});
			else vi.spyOn(PreviewScheduler.prototype, "refresh").mockRejectedValue(error);
			const { createHash } = await import("node:crypto");
			const identity = await resolveLessonSources(root);
			const node = identity.lessons
				.get("lesson.prax")
				?.pages[0].blocks.find((block) => block.type === "text");
			const mapping = identity.identity.sourceMappings.find((entry) => entry.id === node?.id);
			if (!node || !mapping) throw Error("Missing source mapping");
			expect(
				await session.invoke("operationApply", {
					transactionId: "compiled-refusal",
					operation: "editSource",
					files: [
						{
							path: "lesson.prax",
							baseRevision: createHash("sha256").update(publicSource).digest("hex"),
						},
					],
					targets: [
						{
							file: "lesson.prax",
							ref: {
								kind: "node",
								nodeId: node.id,
								path: mapping.path,
								fingerprint: mapping.fingerprint,
							},
							expectedText: publicSource.slice(mapping.span.start, mapping.span.end),
						},
					],
					args: { text: "::: text {name=publicText}\nRevised.\n" },
				}),
			).toMatchObject({ ok: true });
		} else {
			vi.spyOn(PreviewScheduler.prototype, "refresh").mockRejectedValue(error);
			await writeFile(
				path.join(root, "lesson.prax"),
				publicSource.replace("Public\n", "Revised.\n"),
			);
			mocks.watcher?.emit("all", "change", path.join(root, "lesson.prax"));
		}
		await vi.waitFor(() =>
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "compileFailed",
					diagnostics: [
						expect.objectContaining({
							code: "practice-no-tracking",
							message: error.message,
							messageRef: { key: "grammar.v4.practice-no-tracking", args: {} },
						}),
					],
				}),
			),
		);
	},
);

it("startup fences cross-lesson violations and resumes preview after a repair", async () => {
	const root = await fixture(`${publicSource}${choice}`);
	await writeFile(
		path.join(root, "reader.prax"),
		"# Reader\n::: rule\nif: @priv.isCompleted is true\nthen: disableCompletion\n:::\n",
	);
	await writeFile(
		path.join(root, "course.yaml"),
		"title: Admission\nlessons:\n  - lesson.prax\n  - reader.prax\n",
	);
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const events: StudioEvent[] = [];
	session.subscribe((event) => events.push(event));
	expect(events).toContainEqual(
		expect.objectContaining({
			type: "compileFailed",
			seq: 0,
			diagnostics: [
				expect.objectContaining({
					code: "practice-no-tracking",
					file: "reader.prax",
					line: 3,
					column: 1,
				}),
			],
		}),
	);
	expect(events.some((event) => event.type === "pageCompiled")).toBe(false);
	await writeFile(path.join(root, "lesson.prax"), publicSource);
	await writeFile(path.join(root, "reader.prax"), "# Reader\nRepaired.\n");
	mocks.watcher?.emit("all", "change", path.join(root, "reader.prax"));
	await vi.waitFor(() =>
		expect(events).toContainEqual(
			expect.objectContaining({ type: "pageCompiled", patch: expect.objectContaining({ seq: 1 }) }),
		),
	);
	const reconnected: StudioEvent[] = [];
	session.subscribe((event) => reconnected.push(event));
	expect(reconnected.filter((event) => event.type === "compileFailed")).toEqual([]);
});

it("compiled-only startup refusals open fenced and retain localization metadata", async () => {
	const root = await fixture();
	const error = new PracticeAdmissionError(
		"private-choice-practice-only",
		"node",
		"moduleDeck.gates.node",
		"fr",
	);
	// Plant the compiled-only refusal currently masked by D02's reader fence.
	const create = vi.spyOn(PreviewScheduler, "create").mockRejectedValueOnce(error);
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const events: StudioEvent[] = [];
	session.subscribe((event) => events.push(event));
	expect(create).toHaveBeenCalledTimes(2);
	expect(events).toContainEqual(
		expect.objectContaining({
			type: "compileFailed",
			seq: 0,
			diagnostics: [
				{
					code: "private-choice-practice-only",
					message: error.message,
					messageRef: { key: "grammar.v4.private-choice-practice-only", args: {} },
				},
			],
		}),
	);
	expect(events.some((event) => event.type === "pageCompiled")).toBe(false);
	expect(await session.invoke("editorSnapshot", {})).toBeDefined();
	const identity = await resolveLessonSources(root);
	await expect(
		session.invoke("previewSelectPage", {
			pageId: identity.lessons.get("lesson.prax")?.pages[0].id,
		}),
	).rejects.toThrow("Unknown preview page");
});

async function textEdit(root: string, text: string, type = "text") {
	const { createHash, randomUUID } = await import("node:crypto");
	const identity = await resolveLessonSources(root);
	const source = await readFile(path.join(root, "lesson.prax"), "utf8");
	const node = identity.lessons
		.get("lesson.prax")
		?.pages.flatMap((page) => page.blocks)
		.find((block) => block.type === type);
	const mapping = identity.identity.sourceMappings.find((entry) => entry.id === node?.id);
	if (!node || !mapping) throw Error("Missing source mapping");
	return {
		transactionId: randomUUID(),
		operation: "editSource",
		files: [
			{ path: "lesson.prax", baseRevision: createHash("sha256").update(source).digest("hex") },
		],
		targets: [
			{
				file: "lesson.prax",
				ref: {
					kind: "node",
					nodeId: node.id,
					path: mapping.path,
					fingerprint: mapping.fingerprint,
				},
				expectedText: source.slice(mapping.span.start, mapping.span.end),
			},
		],
		args: { text },
	};
}

it("a queued commit refresh does not hide a later watcher event for real outside bytes", async () => {
	const root = await fixture();
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const events: StudioEvent[] = [];
	session.subscribe((event) => events.push(event));
	const operation = await textEdit(root, "::: text {name=publicText}\nRevised.\n");
	vi.useFakeTimers({ toFake: ["setImmediate", "clearImmediate"] });
	expect(await session.invoke("operationApply", operation)).toMatchObject({ ok: true });
	const outside = (await readFile(path.join(root, "lesson.prax"), "utf8")).replace(
		"Revised.",
		"Outside.",
	);
	await writeFile(path.join(root, "lesson.prax"), outside);
	await vi.runAllTimersAsync();
	await vi.waitFor(async () =>
		expect(await session.invoke("previewStats", {})).toMatchObject({ contextSeq: 1 }),
	);
	const watched = new Promise<void>((resolve) => {
		const disconnect = session.subscribe((event) => {
			if (event.type === "treeChanged") {
				disconnect();
				resolve();
			}
		});
	});
	mocks.watcher?.emit("all", "change", path.join(root, "lesson.prax"));
	await watched;
	expect(events).toContainEqual({
		type: "grammarChanged",
		filename: "lesson.prax",
		grammar: outside,
	});
	expect(events.filter((event) => event.type === "editorChanged")).toHaveLength(1);
});

it("an editor commit repairs a logic refusal and publishes the retained private choice", async () => {
	const root = await fixture(fixtureSource(21));
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const events: StudioEvent[] = [];
	session.subscribe((event) => events.push(event));
	expect(events).toContainEqual(
		expect.objectContaining({
			type: "compileFailed",
			diagnostics: [expect.objectContaining(diagnostic(21))],
		}),
	);
	const operation = await textEdit(root, "::: text\nRepaired.\n", "logic");
	expect(await session.invoke("operationApply", operation)).toMatchObject({ ok: true });
	await vi.waitFor(async () =>
		expect(await session.invoke("previewStats", {})).toMatchObject({ contextSeq: 1 }),
	);
	const replay: StudioEvent[] = [];
	session.subscribe((event) => replay.push(event));
	expect(replay.filter((event) => event.type === "compileFailed")).toEqual([]);
	expect(await readFile(path.join(root, "lesson.prax"), "utf8")).toContain(choice);
	const remaining = (await resolveLessonSources(root)).lessons.get("lesson.prax");
	expect(remaining?.errors).toEqual([]);
	await vi.waitFor(() =>
		expect(events).toContainEqual(
			expect.objectContaining({ type: "pageCompiled", patch: expect.objectContaining({ seq: 1 }) }),
		),
	);
});
