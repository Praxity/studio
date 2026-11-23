import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { resolveCourseIdentity } from "../identity-store";
import { resolveLessonSourcesForWrite } from "../lesson-source";
import { withProjectFileTransaction } from "../project-file-transactions";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

for (const entry of ["lesson", "identity"] as const) {
	it(`I4 ${entry} writer refuses a read admission before discovering source`, async () => {
		const root = await mkdtemp(join(tmpdir(), "identity-writer-"));
		roots.push(root);
		await writeFile(join(root, "course.yaml"), "title: [broken\n");
		await writeFile(join(root, "a.prax"), "# P\n\nText\n");
		await withProjectFileTransaction(
			root,
			async (admitted) => {
				await expect(
					entry === "lesson"
						? resolveLessonSourcesForWrite(admitted)
						: resolveCourseIdentity(admitted, { lessonPaths: ["a.prax"] }),
				).rejects.toMatchObject({
					code: "ECONFLICT",
					message: "File changed on disk: project write lock ownership was lost",
				});
			},
			"read",
		);
		expect((await readdir(root)).sort()).toEqual(["a.prax", "course.yaml"]);
		expect(await readFile(join(root, "a.prax"), "utf8")).toBe("# P\n\nText\n");
		expect(await readFile(join(root, "course.yaml"), "utf8")).toBe("title: [broken\n");
	});
}

it("I4 the lesson writer discovers and resolves inside an existing write admission", async () => {
	const root = await mkdtemp(join(tmpdir(), "identity-writer-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: C\nlessons: [a.prax]\n");
	await writeFile(join(root, "a.prax"), "# P\n\nText\n");
	await withProjectFileTransaction(
		root,
		async (admitted) => {
			const candidate = await resolveLessonSourcesForWrite(admitted);
			expect([...candidate.lessons.keys()]).toEqual(["a.prax"]);
			expect(candidate.lessons.get("a.prax")?.tree.stream.source).toBe("# P\n\nText\n");
		},
		"write",
	);
});
