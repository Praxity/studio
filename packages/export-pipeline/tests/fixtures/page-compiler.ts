import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readLesson } from "@praxity/grammar";
import type { CourseExportInput } from "../../src/build.ts";
import type { IslandName } from "../../src/runtime-plan.ts";

export const compilerIslandAssets = {
	loaderFilename: "island-loader.js",
	islandFilenames: Object.fromEntries(
		[
			"deck",
			"nav",
			"accordion",
			"tabs",
			"assessment",
			"assessmentGroup",
			"logic",
			"checklist",
			"selfCheck",
			"rating",
			"signature",
			"narration",
			"imageComparison",
			"labeledGraphic",
			"card",
			"doodle",
			"code",
			"tooltip",
			"media",
			"sequence",
			"table",
		].map((name) => [name, `${name}.js`]),
	) as Record<IslandName, string>,
};

export async function compilerFixture(
	name: "leadership" | "toolkit" | "comprehensive",
): Promise<CourseExportInput> {
	const root = resolve(import.meta.dirname, "../../../../");
	const filenames =
		name === "leadership"
			? [
					"00-avant-de-commencer",
					"01-affirmez-vous",
					"02-quatre-cavaliers",
					"03-resoudre-un-conflit",
				]
			: ["welcome"];
	const files =
		name === "comprehensive"
			? [resolve(root, "docs/test-fixtures/sample-course-grammar.md")]
			: filenames.map((file) =>
					resolve(root, `packages/grammar/__tests__/fixtures/v4/${name}/${file}.prax`),
				);
	const content = [];
	for (const [lessonIndex, file] of files.entries()) {
		let nextId = 0;
		const parsed = readLesson(await readFile(file, "utf8"), {
			ids: () => `${name}-${lessonIndex}-${nextId++}`,
		});
		if (parsed.hasErrors) throw new Error(`Invalid compiler fixture: ${file}`);
		for (const [pageIndex, page] of parsed.pages.entries())
			content.push({
				...page,
				lessonId: `lesson-${lessonIndex}`,
				lessonTitle: parsed.frontmatter.title ?? name,
				locale: parsed.frontmatter.lang ?? "en",
				isFirstPageOfLesson: pageIndex === 0,
			});
	}
	return {
		id: name,
		title: name,
		sourceLocale: name === "leadership" ? "fr" : "en",
		content,
		...(name === "leadership" ? { moduleDeck: {} } : {}),
	};
}
