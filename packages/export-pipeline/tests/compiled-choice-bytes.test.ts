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
	// Regenerate by capturing every slug from this exact fixture through
	// prepareHtmlCourse/renderHtmlDocument, then stripChoiceStateFacts and SHA-256.
	// Compare raw old/new documents before accepting a new hash or UTF-8 byte count.
	// Change baseBytes/baseHash only for reviewed markup changes; the facts-only
	// delta must remain independently checked. Do not copy failure output blindly.
	// Verify: pnpm --filter @praxity/export-pipeline exec vitest run tests/compiled-choice-bytes.test.ts --maxWorkers=1
	// Each fact now retains the visible term label in "Pick one".
	const expected = [
		["practice", 26508, 1842, "aaa0b21b4e88f9194c996af7acfe4a950929b9e06484994752fb8f86d0117b29"],
		["second", 27049, 1842, "3de1bd34020564481f5cb2f8876726ecbec1fd5480dfe08f3543f9d979d0e665"],
		["glossary", 2273, 921, "49bc7d6126a51ebbdafcecba935f3ad9b7a6539f204cd8258441e9f7c0520cab"],
		["resources", 22326, 1842, "1a228990101b4c3abd74c99c0e63537b08f0b3a8f5440ec70fd3fbfaf62e771a"],
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
