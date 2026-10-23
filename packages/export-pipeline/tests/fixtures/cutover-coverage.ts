import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readLesson } from "@praxity/grammar";
import { renderBlockHtml } from "../../src/render-block-html";

export function cutoverCoverageHtml(): string {
	const source = readFileSync(
		resolve(import.meta.dirname, "../../../../docs/test-fixtures/cutover-coverage.md"),
		"utf8",
	);
	const lesson = readLesson(source);
	if (lesson.diagnostics.length) throw new Error(JSON.stringify(lesson.diagnostics));
	return lesson.blocks.map((block) => renderBlockHtml(block)).join("\n");
}
