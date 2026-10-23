import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";
import { runPraxityCli } from "../cli";

beforeAll(async () => {
	// Keep the host reader real without charging its cold import to the format assertions.
	await import("../export/inspect-project");
});

it("inspects converted question formats through the host reader", async () => {
	const source = await readFile(
		new URL("../../../../../docs/test-fixtures/cutover-coverage.md", import.meta.url),
		"utf8",
	);
	const project = await mkdtemp(join(tmpdir(), "c5-grammar4-inspect-"));
	try {
		await writeFile(
			join(project, "course.yaml"),
			"title: Cutover coverage\nlessons:\n  - lesson.prax\n",
		);
		await writeFile(join(project, "lesson.prax"), source);
		const result = await runPraxityCli(["inspect", project], {
			appVersion: "0.3.0",
			exportAssetsDir: "/studio/export-assets",
		});
		expect(result.exitCode).toBe(0);
		const blocks = JSON.parse(result.stdout).lessons.flatMap(
			(lesson: { pages: { blocks: { type: string; data: Record<string, unknown> }[] }[] }) =>
				lesson.pages.flatMap((page) => page.blocks),
		);
		expect(blocks.map((block: { type: string }) => block.type)).toEqual(
			expect.arrayContaining(["accordion", "tabs", "assessmentGroup", "assessment", "rating"]),
		);
		expect(
			blocks
				.filter((block: { type: string }) => block.type === "assessment")
				.map((block: { data: Record<string, unknown> }) => block.data.assessmentType),
		).toEqual([
			"choice",
			"matching",
			"sequence",
			"categorize",
			"fillBlank",
			"textResponse",
			"matrix",
			"hotspot",
		]);
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});
