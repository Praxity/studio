import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistFixtureIdentity, readIdentityFixture } from "../../test-utils/identity-fixture";
import { createCourseLesson, loadCourse, readLesson } from "../course-io";
import { renameProjectSource, resolveLessonSources, writeLessonSource } from "../lesson-source";
import { writeProjectTextFile } from "../project-file-transactions";

describe("course-io", () => {
	let courseDir: string;

	beforeEach(async () => {
		courseDir = await mkdtemp(join(tmpdir(), "praxity-course-"));
		await mkdir(join(courseDir, "assets"), { recursive: true });
	});

	afterEach(async () => {
		await rm(courseDir, { recursive: true, force: true });
	});

	async function writeCourseYaml(content: string) {
		await writeFile(join(courseDir, "course.yaml"), content);
	}

	async function writeLessonFile(filename: string, content: string) {
		await writeFile(join(courseDir, filename), content);
	}

	describe("loadCourse", () => {
		it.each([
			['"Module 1 : S\'affirmer sans blesser"', "Module 1 : S'affirmer sans blesser"],
			["'Module 1 : S''affirmer sans blesser'", "Module 1 : S'affirmer sans blesser"],
			['"Say \\"hello\\" : kindly"', 'Say "hello" : kindly'],
			["Module 1:Introduction # YAML comment", "Module 1:Introduction"],
			["Introduction", "Introduction"],
			['""', "listed"],
			["42", "listed"],
			["[not, a, title]", "listed"],
		])("reads lesson labels from parsed YAML title %s", async (yamlTitle, expected) => {
			await writeCourseYaml("title: Test\nlessons: [listed.prax]\n");
			const source = `---\ntitle: ${yamlTitle}\n---\nContent.\n`;
			await writeLessonFile("listed.prax", source);
			await writeLessonFile("unlisted.prax", source);

			const result = await loadCourse(courseDir);
			expect(result.lessons[0].title).toBe(expected);
			expect(result.unlistedLessons[0].title).toBe(expected === "listed" ? "unlisted" : expected);
		});

		it("returns the exact manifest snapshot bytes without source ID migration", async () => {
			await writeCourseYaml("# Retain this comment\ntitle: Test\nlessons: [intro.prax]\n");
			await writeLessonFile("intro.prax", "Content.");
			const loaded = await loadCourse(courseDir);
			const raw = await readFile(join(courseDir, "course.yaml"), "utf8");
			expect(loaded.manifestSource).toBe(raw);
			expect(raw).toContain("# Retain this comment");
			expect(raw).toBe("# Retain this comment\ntitle: Test\nlessons: [intro.prax]\n");
			await writeProjectTextFile(
				courseDir,
				"course.yaml",
				raw.replace("title: Test", "title: Edited"),
				loaded.manifestSource,
			);
			expect(await readFile(join(courseDir, "course.yaml"), "utf8")).toContain("title: Edited");
		});
		it("returns the created manifest baseline for a manifest-free course", async () => {
			await createCourseLesson(courseDir, "intro.prax", "# Intro\nContent.");
			const loaded = await loadCourse(courseDir);
			const raw = await readFile(join(courseDir, "course.yaml"), "utf8");
			expect(loaded.manifestSource).toBe(raw);
			await writeProjectTextFile(
				courseDir,
				"course.yaml",
				`${raw}# Settings comment\n`,
				loaded.manifestSource,
			);
		}, 25_000);
		it("keeps snapshot bytes immutable when an external edit follows loading", async () => {
			const raw = "# Exact formatting\nid: existing-course\ntitle: Original\nlessons: []\n";
			await writeCourseYaml(raw);
			const loaded = await loadCourse(courseDir);
			await writeCourseYaml("id: existing-course\ntitle: External\nlessons: []\n");
			expect(loaded.manifestSource).toBe(raw);
			await expect(
				writeProjectTextFile(courseDir, "course.yaml", "title: Draft\n", loaded.manifestSource),
			).rejects.toThrow("changed on disk");
		});
		it("loads a course with manifest and lesson metadata", async () => {
			await writeCourseYaml("title: Test Course\nlessons:\n  - intro.prax\n  - chapter.prax\n");
			await writeLessonFile(
				"intro.prax",
				"---\ntitle: Introduction\n---\n# Introduction {hideTitle}\nWelcome.\n# Page 2 {hideTitle}\nPage 2.",
			);
			await writeLessonFile("chapter.prax", "---\ntitle: Chapter 1\n---\nContent here.");

			const result = await loadCourse(courseDir);
			expect(result.manifest.title).toBe("Test Course");
			expect(result.lessons).toHaveLength(2);
			expect(result.lessons[0].filename).toBe("intro.prax");
			expect(result.lessons[0].title).toBe("Introduction");
			expect(result.lessons[0].pageCount).toBe(2);
			expect(result.lessons[1].filename).toBe("chapter.prax");
			expect(result.unlistedLessons).toEqual([]);
		});

		it("persists one course ID for an existing project without changing its metadata", async () => {
			await writeCourseYaml("# Course comment\ntitle: Test Course\nlessons:\n  - intro.prax\n");
			await writeLessonFile("intro.prax", "Content.");

			await writeLessonSource(courseDir, "intro.prax", "# Content\nContent.");
			const firstIdentity = await resolveLessonSources(courseDir, {}, { strict: true });
			const first = await loadCourse(courseDir);
			const second = await loadCourse(courseDir);
			const yaml = await readFile(join(courseDir, "course.yaml"), "utf-8");

			expect(firstIdentity.identity.course.courseId).toMatch(/^[0-9a-f-]{36}$/);
			expect(
				(await resolveLessonSources(courseDir, {}, { strict: true })).identity.course.courseId,
			).toBe(firstIdentity.identity.course.courseId);
			expect(second.manifest).toEqual(first.manifest);
			expect(yaml).toContain("# Course comment");
			expect(yaml).toBe("# Course comment\ntitle: Test Course\nlessons:\n  - intro.prax\n");
		}, 15_000);

		it("detects unlisted .prax files", async () => {
			await writeCourseYaml("title: Test\nlessons:\n  - intro.prax\n");
			await writeLessonFile("intro.prax", "Hello.");
			await writeLessonFile("extra.prax", "Unlisted.");

			const result = await loadCourse(courseDir);
			expect(result.lessons).toHaveLength(1);
			expect(result.unlistedLessons).toHaveLength(1);
			expect(result.unlistedLessons[0].filename).toBe("extra.prax");
		});

		it("skips missing files referenced in manifest", async () => {
			await writeCourseYaml("title: Test\nlessons:\n  - exists.prax\n  - missing.prax\n");
			await writeLessonFile("exists.prax", "Content.");

			const result = await loadCourse(courseDir);
			expect(result.lessons).toHaveLength(1);
			expect(result.lessons[0].filename).toBe("exists.prax");
		});

		it("handles missing course.yaml by auto-discovering lessons", async () => {
			await writeLessonFile("alpha.prax", "Alpha content.");
			await writeLessonFile("beta.prax", "Beta content.");

			const result = await loadCourse(courseDir);
			expect(result.manifest.title).toBe("");
			expect(result.lessons).toHaveLength(2);
			// Alphabetical order when no manifest
			expect(result.lessons[0].filename).toBe("alpha.prax");
		});

		it("refuses an invalid manifest without overwriting it to add an ID", async () => {
			const invalid = "title: [broken";
			await writeCourseYaml(invalid);

			const entries = await readdir(courseDir);
			await expect(loadCourse(courseDir)).rejects.toThrow(/Plain YAML required/);
			expect(await readdir(courseDir)).toEqual(entries);
			expect(await readFile(join(courseDir, "course.yaml"), "utf-8")).toBe(invalid);
		});
	});

	describe("readLesson / writeLessonSource", () => {
		it("reads a lesson file", async () => {
			const source = "---\ntitle: Test\n---\n# Test {hideTitle}\nContent.";
			await writeLessonSource(courseDir, "test.prax", source);
			const result = await readLesson(courseDir, "test.prax");
			expect(result.grammar).toContain("Content.");
			expect(result.grammar).toBe(source);
			expect(result.grammar).not.toContain("firstPage:");
			const identity = await resolveLessonSources(courseDir, {}, { strict: true });
			expect(identity.lessons.get("test.prax")?.pages[0].id).toMatch(/^[0-9a-f-]{36}$/);
			expect(await readFile(join(courseDir, "test.prax"), "utf-8")).toBe(result.grammar);
			expect(result.lessonPath).toBe(join(courseDir, "test.prax"));
		}, 15_000);

		it("writes a lesson file", async () => {
			await writeLessonFile("test.prax", "Original.");
			await writeLessonSource(courseDir, "test.prax", "# Test\nUpdated.");
			const result = await readLesson(courseDir, "test.prax");
			expect(result.grammar).toContain("Updated.");
			expect(result.grammar).toBe("# Test\nUpdated.");
			expect(
				(await resolveLessonSources(courseDir, {}, { strict: true })).lessons.get("test.prax")
					?.pages[0].id,
			).toMatch(/^[0-9a-f-]{36}$/);
		}, 15_000);
	});

	describe("manifest sync", () => {
		it("preserves valid and invalid cast entries after lesson rename", async () => {
			const original =
				"# Course metadata\ntitle: Test\nlessons: [intro.prax]\ncast:\n  good:\n    name: Good\n  nameless:\n    avatar: assets/missing.png\n";
			await writeCourseYaml(original);
			await writeLessonFile("intro.prax", "# Intro\nBody.\n");
			await persistFixtureIdentity(courseDir);
			expect(await readFile(join(courseDir, "course.yaml"), "utf8")).toBe(original);
			const before = await readIdentityFixture(courseDir);
			await renameProjectSource(courseDir, "intro.prax", "renamed.prax");
			const yaml = await readFile(join(courseDir, "course.yaml"), "utf-8");
			expect(yaml).toBe(
				'# Course metadata\ntitle: Test\nlessons: ["renamed.prax"]\ncast:\n  good:\n    name: Good\n  nameless:\n    avatar: assets/missing.png\n',
			);
			expect(await readFile(join(courseDir, "renamed.prax"), "utf8")).toBe("# Intro\nBody.\n");
			await expect(readFile(join(courseDir, "intro.prax"))).rejects.toMatchObject({
				code: "ENOENT",
			});
			const after = await readIdentityFixture(courseDir);
			expect(after.lessonIds).toEqual({ "renamed.prax": before.lessonIds["intro.prax"] });
			expect(after.pageIds["renamed.prax"]).toEqual(before.pageIds["intro.prax"]);
			await expect(loadCourse(courseDir)).resolves.toMatchObject({
				manifest: {
					lessons: ["renamed.prax"],
					castWarnings: [expect.stringContaining("nameless")],
				},
			});
		});
		it("creates source, manifest and identity together and refuses duplicate creation", async () => {
			await writeCourseYaml("# Metadata\n{title: Test, lessons: [intro.prax]}\n");
			await writeLessonFile("intro.prax", "# Intro\nOriginal.\n");
			await persistFixtureIdentity(courseDir);
			await createCourseLesson(courseDir, "chapter.prax", "# Chapter\nNew.\n");
			const manifest = '# Metadata\n{title: Test, lessons: ["intro.prax","chapter.prax"]}\n';
			expect(await readFile(join(courseDir, "course.yaml"), "utf8")).toBe(manifest);
			expect(await readFile(join(courseDir, "chapter.prax"), "utf8")).toBe("# Chapter\nNew.\n");
			const identity = await readIdentityFixture(courseDir);
			expect(Object.keys(identity.lessonIds).sort()).toEqual(["chapter.prax", "intro.prax"]);
			const result = await loadCourse(courseDir);
			expect(result.manifest.lessons).toEqual(["intro.prax", "chapter.prax"]);
			await expect(createCourseLesson(courseDir, "chapter.prax", "# Duplicate\n")).rejects.toThrow(
				"File already exists",
			);
			expect(await readFile(join(courseDir, "course.yaml"), "utf8")).toBe(manifest);
			expect(await readFile(join(courseDir, "chapter.prax"), "utf8")).toBe("# Chapter\nNew.\n");
			expect(await readIdentityFixture(courseDir)).toEqual(identity);
		});
	});
});
