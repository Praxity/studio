import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { preserveEditorLineEndings } from "../../shared/editor-source";
import { serializeNarrationSidecarV2 } from "../../shared/narration-sidecar";
import { persistFixtureIdentity, readIdentityFixture } from "../../test-utils/identity-fixture";
import { narrationFixture } from "../../test-utils/narration-fixture";
import { createCourseLesson, loadCourse } from "../course-io";
import { buildCourseExportInput } from "../export/build-export-input-from-project";
import { exportProject } from "../export/export-project";
import { inspectProjectV1 } from "../export/inspect-project-v1";
import { loadIdentityStore } from "../identity-store";
import { readLessonSource, renameProjectSource, writeLessonSource } from "../lesson-source";
import { writeProjectTextFile } from "../project-file-transactions";

const roots: string[] = [];
async function project() {
	const root = await mkdtemp(join(tmpdir(), "prax-line-endings-"));
	roots.push(root);
	return root;
}
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function expectStyle(source: string, eol: string) {
	expect(source).toContain(eol);
	if (eol === "\r\n") expect(source.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
	else expect(source).not.toContain("\r");
}

it("writes submitted lesson bytes literally, including mixed endings and removed final newline", async () => {
	const root = await project();
	const original = "\uFEFF# First\r\n\nBody.\r\n\nUnchanged.\n";
	await writeFile(join(root, "lesson.prax"), original);
	const edited = "\uFEFF# First\r\n\nBody. Typed.\r\n\nUnchanged.\n";
	await writeLessonSource(root, "lesson.prax", edited, original);
	expect(await readFile(join(root, "lesson.prax"))).toEqual(Buffer.from(edited));
	await writeLessonSource(root, "lesson.prax", edited.slice(0, -1), edited);
	expect(await readFile(join(root, "lesson.prax"))).toEqual(Buffer.from(edited.slice(0, -1)));
}, 20_000);

it("does not normalize an explicit lesson replacement or restore its removed newline", async () => {
	const root = await project();
	const original = "# First\r\n\r\nBody.\r\n";
	const edited = "# First\n\nBody. Typed.";
	await writeFile(join(root, "lesson.prax"), original);
	await writeLessonSource(root, "lesson.prax", edited, original);
	expect(await readFile(join(root, "lesson.prax"))).toEqual(Buffer.from(edited));
});

for (const source of [
	"---\ntitle: Example\n---\n\n# First\n\nFirst page.\n\n# Second {hideTitle}\n\nSecond page.\n",
	"---\ntitle: Example\n---\n\n# First\n\nFirst page.\n\n# Second\n\n::: note {tone=tip}\nKeep this block.\n:::\n\nSecond page.\n",
]) {
	it.each(["\n", "\r\n"])(
		`shared lesson writer retains exact bytes and final newline with ${source.includes("hideTitle") ? "a hidden title" : "a note block"}, %j`,
		async (eol) => {
			const root = await project();
			const original = source.replace(/\n/g, eol);
			await writeFile(join(root, "lesson.prax"), original);
			await writeLessonSource(
				root,
				"lesson.prax",
				original.replace(/\r?\n$/, ` Edit.${eol}`),
				original,
			);
			expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
				original.replace(/\r?\n$/, ` Edit.${eol}`),
			);
		},
		15_000,
	);
}

it("saves a CRLF lesson without adding machine data to authored source", async () => {
	const root = await project();
	const original = "# Welcome\r\n\r\nBody.\r\n";
	await writeFile(join(root, "lesson.prax"), original);
	await writeLessonSource(
		root,
		"lesson.prax",
		preserveEditorLineEndings("# Welcome\n\nEdited body.\n", original),
		original,
	);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		"# Welcome\r\n\r\nEdited body.\r\n",
	);
});

it.each(["\n", "\r\n"])(
	"preserves existing lesson line endings through consecutive editor saves and identity migration, %j",
	async (eol) => {
		const root = await project();
		const legacy =
			"---\ntitle: Example\n---\n\n# Cards {hideTitle}\n\n::: cards Topics\n:: Alpha\nA stable card paragraph retains its identity during consecutive line ending edits. Original words.\n:::\n".replace(
				/\n/g,
				eol,
			);
		await writeFile(join(root, "lesson.prax"), legacy);
		await persistFixtureIdentity(root);
		const identity = await readIdentityFixture(root);
		const originalParagraph = (await loadIdentityStore(root)).snapshots
			.flatMap((snapshot) => Object.entries(snapshot.nodes))
			.find(([, node]) => node.type === "body" && node.matchText.endsWith("Original words."));
		if (!originalParagraph) throw new Error("Missing card fixture paragraph");
		let baseline = await readLessonSource(root, "lesson.prax");
		expectStyle(baseline, eol);
		expect(baseline).not.toContain("id: page-");
		expect(baseline).not.toContain("id: block-");
		for (const word of ["First edit.", "Second edit."]) {
			// The editor produces LF paragraphs even when the loaded baseline is CRLF.
			const draft = baseline
				.replace(/\r\n/g, "\n")
				.replace(/(?:Original words\.|First edit\.)/, word);
			await writeLessonSource(
				root,
				"lesson.prax",
				preserveEditorLineEndings(draft, baseline),
				baseline,
			);
			baseline = await readLessonSource(root, "lesson.prax");
			expectStyle(baseline, eol);
			expect(baseline).toContain(word);
			expect(
				(await loadIdentityStore(root)).snapshots
					.flatMap((snapshot) => Object.entries(snapshot.nodes))
					.find(([id]) => id === originalParagraph[0])?.[1],
			).toMatchObject({
				status: "active",
				matchText: `A stable card paragraph retains its identity during consecutive line ending edits. ${word}`,
			});
		}
		expect((await readIdentityFixture(root)).pageIds["lesson.prax"]).toEqual(
			identity.pageIds["lesson.prax"],
		);
	},
	20_000,
);

it.each(["course.yaml", "narration.yaml"])(
	"preserves CRLF through the public text writer, %s",
	async (filename) => {
		const root = await project();
		const original =
			filename === "course.yaml"
				? "title: Original\r\nlessons: []\r\n"
				: "version: 1\r\nlessons: {}\r\n";
		await writeFile(join(root, filename), original);
		await writeProjectTextFile(
			root,
			filename,
			`${original.replace(/\r\n/g, "\n")}# Edited\n`,
			original,
		);
		expectStyle(await readFile(join(root, filename), "utf8"), "\r\n");
	},
);

// Two durable commits: Intel Mac max 7120.7 ms, Linux CI 339 ms; allow twice the slower run.
it("loads CRLF lesson metadata and preserves manifest style through ID, add and rename writes", async () => {
	const root = await project();
	await writeFile(join(root, "course.yaml"), "title: Course\r\nlessons: [lesson.prax]\r\n");
	await writeFile(
		join(root, "lesson.prax"),
		"---\r\ntitle: Lesson title\r\n---\r\n\r\n# Intro\r\n\r\n# Next {hideTitle}\r\n\r\nBody.\r\n",
	);
	const course = await loadCourse(root);
	expect(course.lessons[0]).toMatchObject({ title: "Lesson title", pageCount: 2 });
	expectStyle(course.manifestSource ?? "", "\r\n");
	await persistFixtureIdentity(root);
	const source = "# Added\r\n\r\nBody.\r\n";
	await createCourseLesson(root, "added.prax", source);
	expect(await readFile(join(root, "course.yaml"), "utf8")).toBe(
		'title: Course\r\nlessons: ["lesson.prax","added.prax"]\r\n',
	);
	expect(await readFile(join(root, "added.prax"), "utf8")).toBe(source);
	const before = await readIdentityFixture(root);
	await renameProjectSource(root, "added.prax", "renamed.prax");
	expect(await readFile(join(root, "course.yaml"), "utf8")).toBe(
		'title: Course\r\nlessons: ["lesson.prax","renamed.prax"]\r\n',
	);
	expect(await readFile(join(root, "renamed.prax"), "utf8")).toBe(source);
	await expect(readFile(join(root, "added.prax"))).rejects.toMatchObject({ code: "ENOENT" });
	expect((await readIdentityFixture(root)).lessonIds).toEqual({
		"lesson.prax": before.lessonIds["lesson.prax"],
		"renamed.prax": before.lessonIds["added.prax"],
	});
}, 14_242); // timeout: docs/context/testing-strategy.md; run 38146537167

it("exports a CRLF course with LF-authored narration anchors and zero unlinked entries", async () => {
	const root = await project();
	await writeFile(
		join(root, "course.yaml"),
		"id: example-course\r\ntitle: Example\r\nnarrationEnabled: true\r\nlessons: [lesson.prax]\r\n",
	);
	await writeFile(
		join(root, "lesson.prax"),
		"---\r\ntitle: Example\r\n---\r\n\r\n# Welcome\r\n\r\nFirst words.\r\nSecond line.\r\n",
	);
	const fixture = await narrationFixture(root, "lesson.prax");
	const item = fixture.items.find((item) => item.segment.target.role === "body");
	if (!item) throw new Error("Missing multiline narration target");
	const sidecar = fixture.update(item.segment.target, {
		script: "Preserved custom narration.",
		reviewedRevision: item.segment.revision,
	});
	await writeFile(
		join(root, "narration.yaml"),
		serializeNarrationSidecarV2(sidecar).replace(/\n/g, "\r\n"),
	);

	const viewerVersionPath = join(root, "viewer-version.json");
	await writeFile(viewerVersionPath, '{"appVersion":"0.3.0","viewerSourceHash":"test"}');
	const input = await buildCourseExportInput({
		manifestPolicy: "write" as const,
		projectDir: root,
		viewerVersionPath,
		completionThreshold: 0.8,
		scope: "course",
	});
	expect(JSON.stringify(input.blocks)).not.toContain("\\r");
	expect(
		(
			(input.blocks.find((block) => block.type === "pageBreak")?.data._narrationSegments ??
				[]) as Array<{
				script: string;
				target: { id: string };
			}>
		).find((segment) => segment.target.id === item.segment.target.id)?.script,
	).toBe("Preserved custom narration.");
	const inspection = await inspectProjectV1(root, "test");
	expect(inspection.lessons.map((lesson) => lesson.unlinkedNarrationCount)).toEqual([0]);
	const result = await exportProject({
		manifestPolicy: "write" as const,
		projectDir: root,
		format: "html",
		exportAssetsDir: resolve(import.meta.dirname, "../../../resources/export-assets"),
		scope: "course",
		fallbackCompletionThreshold: 0.8,
		enforceAccessibility: true,
	});
	expect(result).toMatchObject({ title: "Example", pageCount: 1 });
	if (!("zip" in result)) throw new Error("HTML export did not return a ZIP");
	expect([...result.zip.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
});
