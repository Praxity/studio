import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	parseNarrationSidecarV2,
	resolveLessonNarration,
	resolveNarrationPanel,
	serializeNarrationSidecarV2,
} from "../../shared/narration-sidecar";
import {
	persistFixtureIdentity,
	persistLegacyPendingFixture,
	readIdentityFixture,
} from "../../test-utils/identity-fixture";
import { runPraxityCli } from "../cli";
import { buildCourseExportInput } from "../export/build-export-input-from-project";
import { persistCourseIdentity } from "../identity-store";
import {
	parseLessonSource,
	readLessonSource,
	resolveLessonSources,
	resolveLessonSourcesForWrite,
	writeLessonSource,
} from "../lesson-source";
import {
	cleanupNarrationRecordings,
	readNarrationAuthoring,
	writeNarrationAuthoring,
} from "../narration-authoring";
import { withProjectFileTransaction } from "../project-file-transactions";
import { startStudioServer } from "../studio/server";

const roots: string[] = [];
const runtime = { appVersion: "test", exportAssetsDir: "unused" };
it.each([false, true])(
	"narration authoring resolves inherited deck gates when moduleDeck=%s",
	async (moduleDeck) => {
		const { root } = await fixture();
		await writeFile(
			join(root, "course.yaml"),
			`title: Course\nmoduleDeck: ${moduleDeck}\nlessons:\n  - lesson.prax\n`,
		);
		const view = await readNarrationAuthoring(root, {
			"lesson.prax":
				"# Welcome\n\nNew text.\n\n::: choice Pick {required}\n(x) First\n( ) Last\n:::\n",
		});
		const item = view.documents
			.flatMap((document) => document.items)
			.find(({ segment }) => segment.script.includes("Pick"));
		expect(item?.segment.script.includes("I don't know")).toBe(!moduleDeck);
	},
);
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(directory = tmpdir()) {
	const root = await mkdtemp(join(directory, "n2-authoring-"));
	roots.push(root);
	await writeFile(join(root, "lesson.prax"), "# Welcome\n\nNew text.\n");
	await mkdir(join(root, "assets"));
	await writeFile(join(root, "assets", "clip.mp3"), Buffer.from([0x49, 0x44, 0x33, 1]));
	const read = await withProjectFileTransaction(
		root,
		async () => {
			const identity = await withProjectFileTransaction(
				root,
				async () => persistCourseIdentity(root, await resolveLessonSourcesForWrite(root)),
				"write",
				false,
			);
			return parseLessonSource(root, "lesson.prax", await readLessonSource(root, "lesson.prax"), {
				identity,
			});
		},
		"write",
	);
	const body = read.blocks.find((block) => block.type === "text");
	if (!body) throw new Error("Missing fixture body");
	const target = {
		id: body.id,
		role: "body" as const,
	};
	const orphan = { id: "10000000-0000-4000-8000-000000000001", role: "body" as const };
	await writeFile(
		join(root, "narration.yaml"),
		serializeNarrationSidecarV2({
			version: 2,
			courseId: read.courseId,
			lessons: {
				[read.lessonId]: {
					enabled: true,
					segments: [
						{
							target,
							reviewedRevision: "0".repeat(64),
							audio: "assets/clip.mp3",
							audioFor: { script: "Old text.", language: "en", voice: "Maya", speed: 1 },
						},
						{ target: orphan, audio: "assets/clip.mp3" },
					],
				},
			},
		}),
	);
	return { root, target: `${target.id}:body`, orphan: `${orphan.id}:body` };
}
it.skipIf(process.platform !== "win32").each(["lower", "upper"])(
	"narration writers and cleanup use canonical roots through a %s drive alias",
	async (letterCase) => {
		const { root, target } = await fixture(process.cwd());
		const alias = root.replace(/^[a-z]/i, (drive) =>
			letterCase === "lower" ? drive.toLowerCase() : drive.toUpperCase(),
		);
		for (const args of [
			["narration", "accept", target, "--project", alias],
			["narration", "attach", target, "assets/clip.mp3", "--project", alias],
		]) {
			const result = await runPraxityCli(args, runtime);
			expect(result.exitCode, result.stderr).toBe(0);
		}
		const view = await readNarrationAuthoring(alias);
		const saved = await writeNarrationAuthoring(alias, view.sidecar, view.source);
		expect(await readFile(join(root, "narration.yaml"), "utf8")).toBe(saved);
		await mkdir(join(root, "assets", "narration"));
		const pair = [
			"assets/narration/narration-abcdef123456.mp3",
			"assets/narration/narration-abcdef123456.vtt",
		];
		for (const path of pair) await writeFile(join(root, path), "unused");
		await cleanupNarrationRecordings(alias, pair, saved);
		for (const path of pair)
			await expect(readFile(join(root, path))).rejects.toMatchObject({ code: "ENOENT" });
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("# Welcome\n\nNew text.\n");
	},
);
it("N2 status lists flagged and unresolved targets without writes", async () => {
	const { root, target, orphan } = await fixture();
	const before = await readFile(join(root, "narration.yaml"), "utf8");
	const result = await runPraxityCli(["narration", "status", root], runtime);
	expect(result.exitCode, result.stderr).toBe(0);
	const status = JSON.parse(result.stdout);
	expect(status.flagged.map((item: { target: string }) => item.target)).toContain(target);
	expect(status.unresolved.map((item: { target: string }) => item.target)).toContain(orphan);
	expect(await readFile(join(root, "narration.yaml"), "utf8")).toBe(before);
});
it("N2 accept clears a flag while keeping the original recording and provenance", async () => {
	const { root, target } = await fixture();
	const result = await runPraxityCli(["narration", "accept", target, "--project", root], runtime);
	expect(result.exitCode, result.stderr).toBe(0);
	const status = JSON.parse((await runPraxityCli(["narration", "status", root], runtime)).stdout);
	expect(status.flagged.map((item: { target: string }) => item.target)).not.toContain(target);
	expect(await readFile(join(root, "narration.yaml"), "utf8")).toContain("Old text.");
	expect(await readFile(join(root, "assets/clip.mp3"))).toEqual(Buffer.from([0x49, 0x44, 0x33, 1]));
	await writeLessonSource(
		root,
		"lesson.prax",
		"# Welcome\n\nNew text!\n",
		"# Welcome\n\nNew text.\n",
	);
	const changed = JSON.parse((await runPraxityCli(["narration", "status", root], runtime)).stdout);
	expect(changed.flagged.map((item: { target: string }) => item.target)).toContain(target);
}, 20_000);
const windowsDriveAsset = "C:/outside.mp3";
it.each(
	[
		"../outside.mp3",
		"assets/../../outside.mp3",
		windowsDriveAsset,
		"assets/missing.mp3",
		"assets",
		"https://example.com/clip.mp3",
	].map((asset) => [asset === windowsDriveAsset ? "Windows drive path" : asset, asset] as const),
)(
	"N2 attach refuses %s without changing sidecar",
	async (_label, asset) => {
		const { root, target } = await fixture();
		const before = await readFile(join(root, "narration.yaml"), "utf8");
		const result = await runPraxityCli(
			["narration", "attach", target, asset, "--project", root],
			runtime,
		);
		expect(result.exitCode).toBe(1);
		expect(await readFile(join(root, "narration.yaml"), "utf8")).toBe(before);
	},
	15_000,
);
it("N2 attach links an existing recording and refuses unresolved targets", async () => {
	const { root, target, orphan } = await fixture();
	expect(
		(
			await runPraxityCli(
				["narration", "attach", target, "assets/clip.mp3", "--project", root],
				runtime,
			)
		).exitCode,
	).toBe(0);
	const result = await runPraxityCli(["narration", "accept", orphan, "--project", root], runtime);
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toMatch(/unresolved|unknown/i);
}, 15_000);

it("N2 accept preserves every byte outside the target entry", async () => {
	const { root, target } = await fixture();
	const path = join(root, "narration.yaml");
	const original = `# Keep this header\r\n${(await readFile(path, "utf8")).replace(/\n/g, "\r\n")}# Keep this footer\r\n`;
	await writeFile(path, original);
	const suffix = original.slice(
		original.indexOf("      - target:", original.indexOf("      - target:") + 1),
	);
	expect(suffix).toContain("10000000-0000-4000-8000-000000000001");
	const result = await runPraxityCli(["narration", "accept", target, "--project", root], runtime);
	expect(result.exitCode, result.stderr).toBe(0);
	const edited = await readFile(path, "utf8");
	expect(edited.startsWith("# Keep this header\r\n")).toBe(true);
	expect(edited.endsWith(suffix)).toBe(true);
}, 15_000);
it("N2 attach refuses an asset junction escaping the project", async () => {
	const { root, target } = await fixture();
	const outside = await mkdtemp(join(tmpdir(), "n2-outside-"));
	roots.push(outside);
	await writeFile(join(outside, "clip.mp3"), "outside recording");
	await symlink(
		outside,
		join(root, "assets", "escape"),
		process.platform === "win32" ? "junction" : "dir",
	);
	const before = await readFile(join(root, "narration.yaml"), "utf8");
	expect(
		(
			await runPraxityCli(
				["narration", "attach", target, "assets/escape/clip.mp3", "--project", root],
				runtime,
			)
		).exitCode,
	).toBe(1);
	expect(await readFile(join(root, "narration.yaml"), "utf8")).toBe(before);
});

it("N2 keeps cross-lesson entries linked in both status and the panel", async () => {
	const { root } = await fixture();
	await writeLessonSource(root, "second.prax", "# Second\n\nMoved text.\n");
	const view = await readNarrationAuthoring(root);
	const first = view.documents.find((doc) => doc.filename === "lesson.prax");
	const second = view.documents.find((doc) => doc.filename === "second.prax");
	const body = second?.items.find((item) => item.segment.target.role === "body");
	if (!first || !second || !body) throw new Error("Missing moved fixture");
	const entry = {
		target: body.segment.target,
		audio: "assets/clip.mp3",
		reviewedRevision: body.segment.revision,
	};
	const sidecar = {
		...view.sidecar,
		lessons: { [first.lessonId]: { enabled: true, segments: [entry] } },
	};
	await writeFile(join(root, "narration.yaml"), serializeNarrationSidecarV2(sidecar));
	const current = await readNarrationAuthoring(root);
	expect(current.unresolved).toEqual([]);
	const firstDocument = current.documents.find((doc) => doc.filename === "lesson.prax");
	if (!firstDocument) throw new Error("Missing first document");
	expect(resolveNarrationPanel(firstDocument, current.sidecar).unlinked).toEqual([]);
}, 20_000);
it("N2 refuses a stale panel baseline and preserves the outside edit", async () => {
	const { root } = await fixture();
	const view = await readNarrationAuthoring(root);
	const outside = `${view.source}# Outside comment\n`;
	await writeFile(join(root, "narration.yaml"), outside);
	await expect(writeNarrationAuthoring(root, view.sidecar, view.source)).rejects.toThrow();
	expect(await readFile(join(root, "narration.yaml"), "utf8")).toBe(outside);
	expect(await readFile(join(root, "assets/clip.mp3"))).toEqual(Buffer.from([0x49, 0x44, 0x33, 1]));
});
it.each(["missing", "empty", "flow"])(
	"N2 attaches a new entry to a %s sidecar",
	async (kind) => {
		const { root } = await fixture();
		const view = await readNarrationAuthoring(root);
		const doc = view.documents[0];
		const target = doc.items.find((item) => item.segment.target.role === "body")?.segment.target;
		if (!target) throw new Error("Missing fixture target");
		const sidecar = {
			version: 2 as const,
			courseId: view.sidecar.courseId,
			lessons: kind === "missing" ? {} : { [doc.lessonId]: { segments: [] } },
		};
		await writeFile(
			join(root, "narration.yaml"),
			kind === "flow" ? JSON.stringify(sidecar) : serializeNarrationSidecarV2(sidecar),
		);
		const result = await runPraxityCli(
			["narration", "attach", `${target.id}:body`, "assets/clip.mp3", "--project", root],
			runtime,
		);
		expect(result.exitCode, result.stderr).toBe(0);
		expect(
			parseNarrationSidecarV2(await readFile(join(root, "narration.yaml"), "utf8")).lessons[
				doc.lessonId
			].segments[0],
		).toMatchObject({ target, audio: "assets/clip.mp3", acceptedFor: { script: "New text." } });
	},
	20_000,
);

it.each([
	"10000000-0000-4000-8000-000000000001:body:",
	"10000000-0000-4000-8000-000000000001:body::extra",
	"10000000-0000-4000-8000-000000000001:invalid",
	"not-a-uuid:body",
])("N2 refuses malformed target %s before project access", async (target) => {
	const result = await runPraxityCli(["narration", "accept", target], runtime);
	expect(result.exitCode).toBe(2);
});

it.each(["en", "fr"] as const)(
	"invalid self-check and custom script keep preview, inspect and authoring available in %s",
	async (locale) => {
		const { root } = await fixture();
		const source =
			"# Practice\n\n::: self-check Write your answer.\nmodel: The answer is Paris.\n:: City\nmissed: Name the city.\nevidence: NOT_IN_MODEL\n:::\n";
		await writeFile(
			join(root, "course.yaml"),
			`title: Course\nlocale: ${locale}\nlessons: [lesson.prax]\nnarrationEnabled: true\n`,
		);
		// The durable narration target was saved while valid, before the invalid author draft.
		await writeFile(
			join(root, "lesson.prax"),
			source.replace("evidence: NOT_IN_MODEL", "evidence: Paris"),
		);
		await persistLegacyPendingFixture(root);
		const saved = (await resolveLessonSources(root)).lessons.get("lesson.prax");
		expect(saved?.hasErrors).toBe(false);
		const savedTarget = saved?.blocks.find((block) => block.type === "selfCheck")?.id;
		if (!savedTarget) throw new Error("Missing saved self-check target");
		const savedView = await readNarrationAuthoring(root);
		const target = savedView.documents[0].items.find(
			({ segment }) => segment.blockType === "selfCheck",
		)?.segment.target;
		if (!target) throw new Error("Missing saved narration target");
		expect(target.id).toBe(savedTarget);
		const script = "Read the task and write your own answer.";
		await writeNarrationAuthoring(
			root,
			{
				version: 2,
				courseId: savedView.sidecar.courseId,
				lessons: { [savedView.documents[0].lessonId]: { segments: [{ target, script }] } },
			},
			savedView.source,
		);
		const savedSource = await readFile(join(root, "narration.yaml"), "utf8");
		const identityBefore = await readIdentityFixture(root);
		await writeFile(join(root, "lesson.prax"), source);
		const identity = await resolveLessonSources(root, {}, { strict: false });
		const read = identity.lessons.get("lesson.prax");
		if (!read) throw new Error("Missing draft read");
		expect(read.diagnostics.some((diagnostic) => diagnostic.code === "evidence-not-once")).toBe(
			true,
		);
		const lessonId = identity.identity.sourceMappings.find(
			(node) => node.file === "lesson.prax" && node.path.length === 0,
		)?.id;
		if (!lessonId) throw new Error("Missing lesson identity");
		const sidecar = {
			version: 2 as const,
			courseId: identity.identity.course.courseId,
			lessons: {},
		};
		const natural = resolveLessonNarration({
			read,
			courseId: sidecar.courseId,
			lessonId,
			sidecar,
			locale: "en",
			enabled: true,
			digest: (text) => createHash("sha256").update(text).digest("hex"),
		});
		const segment = natural.items.find(({ segment }) => segment.blockType === "selfCheck")?.segment;
		if (!segment) throw new Error("Missing self-check target");
		expect(segment.target.id).toMatch(/^rt-/);
		expect(segment.target.id).not.toBe(savedTarget);
		const editorAssetsDir = await mkdtemp(join(tmpdir(), "narration-editor-"));
		roots.push(editorAssetsDir);
		await writeFile(join(editorAssetsDir, "canvas.js"), "void 0;");
		await writeFile(
			join(editorAssetsDir, "canvas.sha256"),
			"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362\n",
		);
		const server = await startStudioServer({
			projectDir: root,
			editorAssetsDir,
			appVersion: "test",
			exportAssetsDir: join(import.meta.dirname, "../../../resources/export-assets"),
		});
		try {
			const attemptedSource = JSON.stringify({
				...sidecar,
				lessons: {
					[lessonId]: {
						segments: [
							{ target: segment.target, script: "Keep this attempted script exactly. 🚦" },
						],
					},
				},
			});
			const token = new URLSearchParams(new URL(server.readyUrl).hash.slice(1)).get("session");
			const response = await fetch(`${server.origin}/api/rpc`, {
				method: "POST",
				headers: {
					Origin: server.origin,
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					method: "narrationAuthoringWrite",
					args: { source: attemptedSource, expectedSource: savedSource },
				}),
			});
			expect(response.status).toBe(422);
			expect(await response.json()).toEqual({
				ok: false,
				error: {
					code: "narration_target_unresolved",
					message:
						locale === "fr"
							? "Corrigez le bloc avant de modifier sa narration. Le texte de votre script est conservé."
							: "Fix the block before editing its narration. Your script text is kept.",
					details: { source: attemptedSource },
				},
			});
		} finally {
			await server.close();
		}
		expect(await readFile(join(root, "narration.yaml"), "utf8")).toBe(savedSource);
		const preview = await buildCourseExportInput({
			projectDir: root,
			mode: "preview",
			manifestPolicy: "read-only",
			completionThreshold: 0,
			inheritWorkspaceSettings: false,
			viewerVersionPath: "unused",
		});
		expect(preview.warnings ?? []).toEqual([
			{ code: "ENARRATIONUNLINKED", file: "lesson.prax", count: 1 },
		]);
		for (const schema of ["0", "1"]) {
			const result = await runPraxityCli(["inspect", root, "--schema", schema], runtime);
			expect(result.exitCode, result.stderr).toBe(0);
			if (schema === "1") expect(result.stdout).toContain(script);
		}
		const panel = await readNarrationAuthoring(root, { "lesson.prax": source });
		expect(panel.documents[0].warnings).toEqual([]);
		expect(panel.unresolved).toEqual([{ lessonId, entry: { target, script } }]);
		expect(await readIdentityFixture(root)).toEqual(identityBefore);
	},
	15_000,
);
