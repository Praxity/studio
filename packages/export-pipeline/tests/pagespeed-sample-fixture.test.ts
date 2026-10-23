import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getNavPreset, readLesson } from "@praxity/grammar";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { beforeAll, describe, expect, it } from "vitest";
import { planPageRuntime } from "../src/runtime-plan";

const FIXTURE_ROOT = resolve(import.meta.dirname, "../../../docs/test-fixtures");
const SOURCE_PATH = resolve(FIXTURE_ROOT, "sample-course-grammar.md");
const EXTRAS_PATH = resolve(FIXTURE_ROOT, "sample-course-pagespeed-extras.json");

const config = {
	sourceLocale: "en",
	navigationStyle: "sidebar" as const,
	navToggles: getNavPreset("sidebar"),
};

let pages: ReturnType<typeof splitBlocksIntoPages>;

beforeAll(async () => {
	const parsed = readLesson(await readFile(SOURCE_PATH, "utf-8"));
	const extras = JSON.parse(await readFile(EXTRAS_PATH, "utf-8")) as PraxityBlock[];
	pages = splitBlocksIntoPages(
		adaptGrammarPreviewBlocks([...parsed.blocks, ...extras]),
		"Comprehensive Grammar v3 Test Course",
	);
});

function plan(slug: string) {
	const page = pages.find((candidate) => candidate.slug === slug);
	if (!page) throw new Error(`Missing PageSpeed fixture page: ${slug}`);
	return { page, runtime: planPageRuntime(config, page, true) };
}

describe("PageSpeed sample fixture", () => {
	it("uses native islands for assessments and assessment groups", () => {
		expect(plan("assessment-blocks").runtime).toMatchObject({
			mode: "islands",
			islands: expect.arrayContaining(["assessment", "rating"]),
		});
		expect(plan("complex-assessments").runtime).toMatchObject({
			mode: "islands",
			islands: expect.arrayContaining(["assessment"]),
		});
		expect(plan("assessment-groups").runtime).toMatchObject({
			mode: "islands",
			islands: expect.arrayContaining(["assessment", "assessmentGroup"]),
		});
	});

	it("covers the video facade, direct video, audio, and visual islands", () => {
		const media = plan("media-and-embeds").page.blocks;
		const videos = media.filter((block) => block.type === "video");
		expect(videos).toHaveLength(2);
		expect(JSON.stringify(videos)).toContain("aqz-KE-bpKQ");
		expect(JSON.stringify(videos)).toContain("flower.mp4");
		expect(media.find((block) => block.type === "audio")?.data).toMatchObject({
			src: expect.stringContaining("en-control.mp3"),
			title: "Spoken Narration Sample",
		});

		expect(plan("visual-interactions").runtime).toMatchObject({
			mode: "islands",
			islands: expect.arrayContaining(["imageComparison", "labeledGraphic"]),
		});
	});

	it("covers narration and an HTML-only static baseline", () => {
		const narrated = plan("narrated-page");
		expect(narrated.runtime).toMatchObject({
			mode: "islands",
			islands: expect.arrayContaining(["narration"]),
		});
		expect(narrated.page.data).toMatchObject({
			narrationAudio: expect.stringContaining("en-control.mp3"),
			narrationTimings: expect.stringContaining("en-control.vtt"),
			narrationDuration: 15.768,
		});
		expect(plan("static-baseline").runtime).toEqual({
			mode: "static",
			islands: [],
			legacyReasons: [],
		});
	});

	it("keeps the slides-navigation sample on native islands", () => {
		expect(plan("summary").runtime).toEqual({
			mode: "islands",
			islands: ["accordion", "nav"],
			legacyReasons: [],
		});
	});
});
