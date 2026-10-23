import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolvePageSlideStyle } from "@praxity/shared-blocks/viewer/slide-styles";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { expect, it } from "vitest";
import { persistFixtureIdentity, readIdentityFixture } from "../../test-utils/identity-fixture";
import { buildCourseExportInput } from "../export/build-export-input-from-project";

it("uses each lesson's leading delimiter as its first page in an assembled course", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "manifest-leading-pages-"));
	try {
		await writeFile(
			path.join(dir, "course.yaml"),
			"id: course-leading\ntitle: Course\nlessons: [one.prax, two.prax]\n",
		);
		for (const name of ["one", "two"]) {
			await writeFile(
				path.join(dir, `${name}.prax`),
				`---\ntitle: ${name}\n---\n\n# Welcome ${name} {hideTitle}\n\n## One idea\n\nBody.\n`,
			);
		}
		await persistFixtureIdentity(dir);
		const identity = await readIdentityFixture(dir);
		const input = await buildCourseExportInput({
			projectDir: dir,
			scope: "course",
			completionThreshold: 1,
			manifestPolicy: "read-only",
			viewerVersionPath: path.join(dir, "viewer-version.json"),
		});
		const pages = splitBlocksIntoPages(input.blocks, "Course");
		expect(
			pages.map((page) => [
				page.id,
				page.lessonId,
				page.title,
				page.blocks.length,
				page.isFirstPageOfLesson,
			]),
		).toEqual([
			[identity.pageIds["one.prax"][0], identity.lessonIds["one.prax"], "Welcome one", 2, true],
			[identity.pageIds["two.prax"][0], identity.lessonIds["two.prax"], "Welcome two", 2, true],
		]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it("assembles Orientation and three modules in manifest order with durable local page identities", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "manifest-modules-"));
	try {
		const titles = ["Orientation", "Module 1: Safety", "Module 2: Practice", "Module 3: Review"];
		const files = ["z-orientation.prax", "c-safety.prax", "b-practice.prax", "a-review.prax"];
		await writeFile(
			path.join(dir, "course.yaml"),
			`title: Modules\nlessons:\n${files.map((file) => `  - ${file}`).join("\n")}\n`,
		);
		for (const [index, file] of files.entries()) {
			await writeFile(
				path.join(dir, file),
				`---\ntitle: "${titles[index]}"\nkicker: Excluded from outline\n---\n\n# First {hideTitle}\n\nFirst page\n\n# Second {hideTitle}\n\nSecond page\n`,
			);
		}
		const input = await buildCourseExportInput({
			manifestPolicy: "write" as const,
			projectDir: dir,
			scope: "course",
			completionThreshold: 1,
			viewerVersionPath: path.join(dir, "viewer-version.json"),
		});
		const pages = splitBlocksIntoPages(input.blocks, input.frontmatter.title ?? "Modules");
		expect(pages).toHaveLength(8);
		expect(
			pages.filter((page) => page.isFirstPageOfLesson).map((page) => page.lessonTitle),
		).toEqual(titles);
		for (let index = 0; index < pages.length; index += 2) {
			expect(pages[index].lessonId).toBeTruthy();
			expect(pages[index + 1].lessonId).toBe(pages[index].lessonId);
			expect(pages[index + 1].id).not.toBe(pages[index].id);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}, 25_000);

it("retains lesson-local canonical and legacy page styles in full-course input without rewriting source", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "manifest-page-styles-"));
	try {
		const sources = [
			"---\npageStyles:\n  title:\n    cornerImage: /assets/first.png\n    measure: narrow\n  section:\n    background: surface\nstyles:\n  title:\n    cornerImage: /assets/ignored.png\n---\n\n# First {style=title}\n\n# Second {style=title}\n\n# Section {style=section}\n",
			"---\nstyles:\n  title:\n    cornerImage: /assets/second.png\n    align: start\n---\n\n# Third {style=title}\n\n# Fourth {style=scenario}\n",
			"---\npageStyles: {}\nstyles:\n  title:\n    cornerImage: /assets/ignored.png\n---\n\n# Fifth {style=title}\n",
		];
		const files = sources.map((_, index) => `lesson-${index}.prax`);
		await writeFile(
			path.join(dir, "course.yaml"),
			`title: Styles\nlessons:\n${files.map((file) => `  - ${file}`).join("\n")}\n`,
		);
		for (const [index, source] of sources.entries())
			await writeFile(path.join(dir, files[index]), source);
		const input = await buildCourseExportInput({
			manifestPolicy: "write" as const,
			projectDir: dir,
			scope: "course",
			completionThreshold: 1,
			viewerVersionPath: path.join(dir, "viewer-version.json"),
		});
		const pages = splitBlocksIntoPages(input.blocks, "Styles");
		const resolved = pages.map((page) => resolvePageSlideStyle(page, input.frontmatter.pageStyles));
		expect(resolved.map((style) => style.cornerImage)).toEqual([
			"/assets/first.png",
			"/assets/first.png",
			undefined,
			"/assets/second.png",
			undefined,
			undefined,
		]);
		expect(resolved[2].variables["--slide-accent-rule-width"]).toBe("4px");
		expect(resolved[0].name).not.toBe(resolved[3].name);
		expect(resolved[0].variables["--slide-measure"]).toBe("36rem");
		expect(resolved[0].variables["--slide-heading-scale"]).toBe(
			resolved[5].variables["--slide-heading-scale"],
		);
		expect(resolved[3].variables["--slide-align"]).toBe("start");
		expect(resolved[4].name).toBe("scenario");
		expect(resolved[5].name).toBe("title");
		expect(Object.keys(input.frontmatter.pageStyles ?? {})).toHaveLength(3);
		for (const [index, source] of sources.entries())
			expect(await readFile(path.join(dir, files[index]), "utf8")).toBe(source);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}, 20_000);
