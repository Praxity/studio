import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistFixtureIdentity, readIdentityFixture } from "../../test-utils/identity-fixture";
import { renameCourseFile } from "../course-io";
import { deleteLessonSource } from "../lesson-source";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("course source operations", () => {
	it("restores the lesson when identity cleanup fails", async () => {
		const active = await mkdtemp(join(tmpdir(), "praxity-course-delete-"));
		tempDirs.push(active);
		await mkdir(join(active, ".praxity"));
		await writeFile(join(active, "lesson.prax"), "lesson source", "utf-8");
		await writeFile(
			join(active, ".praxity", "content-identity.json"),
			JSON.stringify({ version: 99, lessons: {}, blocks: {} }),
			"utf-8",
		);
		await expect(deleteLessonSource(active, "lesson.prax")).rejects.toThrow();
		expect(existsSync(join(active, "lesson.prax"))).toBe(true);
	});

	it("preserves both lessons and their identities when the rename destination exists", async () => {
		const active = await mkdtemp(join(tmpdir(), "praxity-course-rename-"));
		tempDirs.push(active);
		const manifest = "# Inventory\n{title: Course, lessons: [one.prax, two.prax]}\n";
		await writeFile(join(active, "course.yaml"), manifest);
		for (const filename of ["one.prax", "two.prax"]) {
			await writeFile(join(active, filename), `# ${filename}\n`);
		}
		await persistFixtureIdentity(active);
		const before = await readIdentityFixture(active);
		await expect(renameCourseFile(active, "one.prax", "two.prax")).rejects.toThrow(
			"Rename destination already exists",
		);
		for (const filename of ["one.prax", "two.prax"]) {
			expect(await readFile(join(active, filename), "utf-8")).toBe(`# ${filename}\n`);
		}
		expect(await readIdentityFixture(active)).toEqual(before);
		expect(await readFile(join(active, "course.yaml"), "utf8")).toBe(manifest);
	}, 25_000);
	it("serializes concurrent renames to the same absent destination", async () => {
		const active = await mkdtemp(join(tmpdir(), "praxity-course-concurrent-rename-"));
		tempDirs.push(active);
		await writeFile(
			join(active, "course.yaml"),
			"# Inventory\n{title: Course, lessons: [one.prax, two.prax]}\n",
		);
		for (const filename of ["one.prax", "two.prax"]) {
			await writeFile(join(active, filename), `# ${filename}\n`);
		}
		await persistFixtureIdentity(active);
		const before = await readIdentityFixture(active);
		const results = await Promise.allSettled(
			["one.prax", "two.prax"].map((oldFilename) =>
				renameCourseFile(active, oldFilename, "target.prax"),
			),
		);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		const winner = results[0].status === "fulfilled" ? "one.prax" : "two.prax";
		const loser = winner === "one.prax" ? "two.prax" : "one.prax";
		expect(await readFile(join(active, "target.prax"), "utf8")).toBe(`# ${winner}\n`);
		expect(await readFile(join(active, loser), "utf8")).toBe(`# ${loser}\n`);
		expect(existsSync(join(active, winner))).toBe(false);
		expect(await readFile(join(active, "course.yaml"), "utf8")).toBe(
			winner === "one.prax"
				? '# Inventory\n{title: Course, lessons: ["target.prax","two.prax"]}\n'
				: '# Inventory\n{title: Course, lessons: ["one.prax","target.prax"]}\n',
		);
		const after = await readIdentityFixture(active);
		expect(after.lessonIds).toEqual({
			[loser]: before.lessonIds[loser],
			"target.prax": before.lessonIds[winner],
		});
	});
});
