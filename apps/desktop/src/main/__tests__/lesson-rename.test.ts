import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { persistFixtureIdentity, readIdentityFixture } from "../../test-utils/identity-fixture";
import { loadCourse } from "../course-io";
import { renameProjectSource } from "../lesson-source";

const roots: string[] = [];
const source = "# First\r\n\r\nLesson bytes.\r\n";
const manifest = "title: Course\nlessons: [first.prax]\n";

async function project() {
	const root = await mkdtemp(join(tmpdir(), "praxity-lesson-rename-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), manifest);
	await writeFile(join(root, "first.prax"), source);
	await persistFixtureIdentity(root);
	return root;
}

async function snapshot(root: string, path = ""): Promise<Record<string, Buffer | null>> {
	const files: Record<string, Buffer | null> = {};
	for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
		const relative = path ? `${path}/${entry.name}` : entry.name;
		files[relative] = entry.isDirectory() ? null : await readFile(join(root, relative));
		if (entry.isDirectory()) Object.assign(files, await snapshot(root, relative));
	}
	return files;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["moved/first.prax", "moved\\first.prax", "moved/first.PRAX"])(
	"refuses a lesson move to %s without changing any project bytes",
	async (target) => {
		const root = await project();
		await mkdir(join(root, "moved"));
		const before = await snapshot(root);
		await expect(renameProjectSource(root, "first.prax", target)).rejects.toMatchObject({
			code: "ELESSONPATH",
			message: "Invalid lesson filename",
		});
		expect(await snapshot(root)).toEqual(before);
	},
);

it.each(["nested.prax", "nested.PRAX"])(
	"refuses a folder rename containing %s before installing any changes",
	async (filename) => {
		const root = await project();
		await mkdir(join(root, "old", "child"), { recursive: true });
		await writeFile(join(root, "old", "asset.txt"), "Asset bytes.");
		await writeFile(join(root, "old", "child", filename), "# Nested\n\nNested lesson.\n");
		const before = await snapshot(root);
		await expect(renameProjectSource(root, "old", "new")).rejects.toMatchObject({
			code: "ELESSONPATH",
			message: "Invalid lesson filename",
		});
		expect(await snapshot(root)).toEqual(before);
	},
);

it("keeps a root lesson rename working with exact source and retained identities", async () => {
	const root = await project();
	const before = await readIdentityFixture(root);
	await renameProjectSource(root, "first.prax", "renamed.prax");
	expect(await readFile(join(root, "renamed.prax"), "utf8")).toBe(source);
	await expect(readFile(join(root, "first.prax"))).rejects.toMatchObject({ code: "ENOENT" });
	expect(await readFile(join(root, "course.yaml"), "utf8")).toBe(
		'title: Course\nlessons: ["renamed.prax"]\n',
	);
	const after = await readIdentityFixture(root);
	expect(after.lessonIds).toEqual({ "renamed.prax": before.lessonIds["first.prax"] });
	expect(after.pageIds["renamed.prax"]).toEqual(before.pageIds["first.prax"]);
	expect((await loadCourse(root)).lessons.map((lesson) => lesson.filename)).toEqual([
		"renamed.prax",
	]);
});
