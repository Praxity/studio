import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLesson } from "@praxity/grammar";
import { afterEach, expect, test } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { buildCourseExportInput } from "../export/build-export-input-from-project";
import { inspectProjectV1 } from "../export/inspect-project-v1";
import {
	deleteLessonSource,
	parseLessonSource,
	readLessonSource,
	renameProjectSource,
	resolveLessonSources,
	writeLessonSource,
} from "../lesson-source";
import { createStudioProjectSession } from "../studio/project-session";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const command =
	"pnpm --dir ../praxity-converter --filter @praxity/convert convert <course-copy> --from 3 --out <new-output-directory>";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("Studio opens a fresh grammar 4 project with durable I4 identity and unchanged source", async () => {
	const root = await mkdtemp(join(tmpdir(), "x1-studio-open-"));
	roots.push(root);
	const source = "# Page\n\nFresh source.\n";
	await writeFile(join(root, "lesson.prax"), source);
	await writeFile(join(root, "course.yaml"), "title: Fresh\nlessons: [lesson.prax]\n");
	const session = await createStudioProjectSession(root, "test");
	try {
		const identity = await resolveLessonSources(root, {}, { strict: true });
		expect(identity.lessons.get("lesson.prax")?.transientIds).toBe(false);
		expect(hash(await readFile(join(root, "lesson.prax")))).toBe(hash(Buffer.from(source)));
	} finally {
		await session.close();
	}
}, 15_000);

test("X1 refuses grammar 3 with the archived converter command", async () => {
	const source = "# Old lesson\n\n## Question\nas: choice\n\n(x) Yes\n( ) No\n";
	expect(
		readLesson(source).errors.find((error) => error.messageRef.key === "grammar.v4.grammar-3")
			?.message,
	).toContain(command);
	const root = await mkdtemp(join(tmpdir(), "x1-refuse-"));
	roots.push(root);
	await writeFile(join(root, "lesson.prax"), source);
	await expect(readLessonSource(root, "lesson.prax")).rejects.toThrow(command);
});

test("X1 reads and saves exact BOM and CRLF source bytes without source IDs", async () => {
	const root = await mkdtemp(join(tmpdir(), "x1-bytes-"));
	roots.push(root);
	const source =
		"\uFEFF---\r\ntitle: Café 😀\r\n---\r\n# Page\r\n\r\n::: note\r\nUnchanged.\r\n:::\r\n";
	const file = join(root, "lesson.prax");
	await writeFile(file, source);
	const before = hash(await readFile(file));
	expect(await readLessonSource(root, "lesson.prax")).toBe(source);
	expect(hash(await readFile(file))).toBe(before);
	await writeLessonSource(root, "lesson.prax", source, source);
	expect(hash(await readFile(file))).toBe(before);
	const parsed = await parseLessonSource(root, "lesson.prax", source);
	expect(parsed.hasErrors).toBe(false);
	expect(parsed.blocks.find((block) => block.type === "note")?.data.content).toContain(
		"<p>Unchanged.</p>",
	);
	expect(hash(await readFile(file))).toBe(before);
}, 15_000);

test("X1 preview, export and Check/Trace inspection preserve saved source bytes and identity", async () => {
	const root = await mkdtemp(join(tmpdir(), "x1-export-"));
	roots.push(root);
	const source = "---\r\ntitle: Café\r\n---\r\n# Page\r\n\r\n::: note\r\nUnchanged.\r\n:::\r\n";
	await writeFile(join(root, "lesson.prax"), source);
	await writeFile(join(root, "course.yaml"), "title: Course\nlessons: [lesson.prax]\n");
	await writeLessonSource(root, "lesson.prax", source, source);
	const before = hash(await readFile(join(root, "lesson.prax")));
	const options = {
		projectDir: root,
		scope: "course" as const,
		completionThreshold: 80,
		viewerVersionPath: "unused",
		loadAssets: false,
		manifestPolicy: "read-only" as const,
	};
	const preview = await buildCourseExportInput({ ...options, mode: "preview" });
	const exported = await buildCourseExportInput({ ...options, mode: "export" });
	expect(exported.blocks.map((block) => block.id)).toEqual(preview.blocks.map((block) => block.id));
	const inspection = await inspectProjectV1(root, "test");
	const note = inspection.lessons[0].pages[0].blocks.find((block) => block.type === "note");
	expect(note?.entityId).toBe(exported.blocks.find((block) => block.type === "note")?.id);
	expect(note?.revision).toMatch(/^[0-9a-f]{64}$/);
	expect(hash(await readFile(join(root, "lesson.prax")))).toBe(before);
}, 15_000);

// Two durable commits: Intel Mac max 7265.8 ms, Linux CI 944 ms; allow twice the slower run.
test("X1 rename keeps sidecar identities and exact source; deletion retires them atomically", async () => {
	const root = await mkdtemp(join(tmpdir(), "x1-rename-"));
	roots.push(root);
	const source = "# Page\n\n::: note\nUnchanged.\n:::\n";
	await writeFile(join(root, "lesson.prax"), source);
	await writeFile(join(root, "course.yaml"), "title: Course\nlessons: [lesson.prax]\n");
	await persistFixtureIdentity(root);
	const before = await parseLessonSource(root, "lesson.prax", source);
	await renameProjectSource(root, "lesson.prax", "renamed.prax");
	expect(await readLessonSource(root, "renamed.prax")).toBe(source);
	const after = await parseLessonSource(root, "renamed.prax", source);
	expect(after.lessonId).toBe(before.lessonId);
	expect(after.blocks.map((block) => block.id)).toEqual(before.blocks.map((block) => block.id));
	await expect(renameProjectSource(root, "renamed.prax", "../escape.prax")).rejects.toThrow();
	await deleteLessonSource(root, "renamed.prax");
	await expect(readFile(join(root, "renamed.prax"))).rejects.toMatchObject({ code: "ENOENT" });
	expect(await readFile(join(root, "course.yaml"), "utf8")).toContain("[]");
}, 14_532); // timeout: docs/context/testing-strategy.md; run 38146537167
