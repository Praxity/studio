import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readLesson, validateCourse } from "@praxity/grammar";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { JSDOM } from "jsdom";
import { expect, it } from "vitest";
import { readCourseManifestData } from "../../../apps/desktop/src/main/course-manifest-io";
import { renderBlockHtml } from "../src/render-block-html";

it.each([
	["en", "A useful pause", "They know when to expect you."],
	["fr", "Une pause utile", "Ils savent quand vous attendre."],
])(
	"parses and renders the documented %s highlight example with both optional modes",
	async (locale, title, target) => {
		const source = await readFile(
			new URL(`../../../docs/prax-format/examples/highlight/${locale}.prax`, import.meta.url),
			"utf8",
		);
		const lesson = readLesson(source);
		expect(lesson.diagnostics).toEqual([]);
		const blocks = adaptGrammarPreviewBlocks(lesson.blocks);
		const practice = blocks.filter((block) => block.type === "highlight");
		expect(practice.map((block) => block.data.content)).toMatchObject([
			{ mode: "key", maxMarks: 2, title },
			{ mode: "evidence", maxMarks: 2, title },
		]);
		const document = new JSDOM(
			practice.map((block) => renderBlockHtml(block, { sourceLocale: locale })).join(""),
		).window.document;
		expect(document.querySelectorAll("[data-highlight]")).toHaveLength(2);
		for (const activity of document.querySelectorAll("[data-highlight]")) {
			expect(activity.querySelector("summary")?.textContent).toBe(
				locale === "en" ? "Answer" : "Réponse",
			);
			expect(activity.querySelector("[data-highlight-fallback]")?.textContent).toContain(target);
		}
		expect(blocks.filter((block) => block.type === "assessment")).toHaveLength(1);
	},
);

it("validates the documented course manifest and its cross-lesson references", async () => {
	const directory = new URL("../../../docs/prax-format/examples/highlight/", import.meta.url);
	const { orderedLessons } = await readCourseManifestData(fileURLToPath(directory), {
		requireManifest: true,
	});
	expect(orderedLessons).toEqual(["en.prax", "fr.prax"]);
	const lessons = await Promise.all(
		orderedLessons.map(async (path) => ({
			path,
			tree: readLesson(await readFile(new URL(path, directory), "utf8")).tree,
		})),
	);
	expect(validateCourse(lessons).diagnostics).toEqual([]);
});
