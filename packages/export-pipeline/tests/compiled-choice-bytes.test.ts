import { createHash } from "node:crypto";
import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import * as head from "../src/html-gen";
import { stripChoiceStateFacts } from "./fixtures/choice-facts";
import { compilerIslandAssets } from "./fixtures/page-compiler";

it("records exact per-document additions against main", () => {
	let id = 0;
	const read = readLesson(
		"# Practice\n::: choice Pick [one]{Definition} @source{Note}\n(x) Yes\n( ) No\n:::\n",
		{ ids: () => `byte-${++id}` },
	);
	const second = structuredClone(read.pages[0]);
	second.id = "second";
	second.title = "Second";
	second.blocks = second.blocks.map((block) => ({ ...block, id: `second-${block.id}` }));
	const config: head.CourseConfig = {
		id: "course",
		title: "Practice",
		sourceLocale: "en",
		totalPages: 2,
		pages: [read.pages[0], second],
		glossaryTerms: [
			{ term: "Word", definition: "Definition", lessonTitle: "Practice", lessonSlug: "practice" },
		],
		resourceEntries: [
			{
				title: "Read",
				description: "Reference",
				url: "https://example.org",
				resourceType: "link",
				lessonTitle: "Practice",
				lessonSlug: "practice",
			},
		],
	};
	// Each fact now retains the visible term label in "Pick one".
	const expected = [
		["practice", 26454, 1842, "cfb71a00871c56b0c63a7bf0518fbf7c99ff26fb560f487f0a3fefa180b72163"],
		["second", 26995, 1842, "8027e369e042ce9067870db01a5bc83245ba5087df211837e2354653f2892900"],
		["glossary", 2273, 921, "49bc7d6126a51ebbdafcecba935f3ad9b7a6539f204cd8258441e9f7c0520cab"],
		["resources", 22265, 1842, "13dbb99da3ea36bdba11db1e0802282cb2e0dea3a2ee24feeb9c068502728bae"],
	] as const;
	const current = head.prepareHtmlCourse(config, compilerIslandAssets);
	// Pinned from main before adding facts. Every other learner/config byte stays exact.
	for (const [slug, baseBytes, delta, baseHash] of expected) {
		const after = head.renderHtmlDocument(
			current,
			slug,
			{ islandAssets: compilerIslandAssets },
			(page) => head.renderPageContent(config, page, new Set(["assessment"])),
		);
		const stripped = stripChoiceStateFacts(after);
		expect(createHash("sha256").update(stripped).digest("hex")).toBe(baseHash);
		expect(Buffer.byteLength(stripped)).toBe(baseBytes);
		expect(Buffer.byteLength(after) - baseBytes).toBe(delta);
		expect(after).not.toMatch(
			/_inlineTrees|_htmlFields|referenceTrivia|generatedBy|"kind":"(?:source|glossary|highlight|doodle)"/,
		);
	}
});
