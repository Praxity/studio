// @vitest-environment jsdom
import { readLesson } from "@praxity/grammar";
import type { ChoiceStateQuestion } from "@praxity/shared-blocks/choice-state-facts";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { type CourseConfig, generateHtmlPage } from "../src/html-gen";
import { readCourseHostConfig } from "../template/src/hosts/course-config";
import { compilerIslandAssets } from "./fixtures/page-compiler";

const observed = vi.hoisted(
	() => new Map<string, { question: ChoiceStateQuestion; signature: string } | undefined>(),
);
// Observe the component boundary while mounting the real assessment controls.
vi.mock("@praxity/shared-blocks/blocks/assessment", async (original) => {
	const actual = await original<typeof import("@praxity/shared-blocks/blocks/assessment")>();
	return {
		...actual,
		PreviewAssessmentBlock: (props: Parameters<typeof actual.PreviewAssessmentBlock>[0]) => {
			observed.set(props.blockId, props.compiledChoiceFacts);
			return actual.PreviewAssessmentBlock(props);
		},
	};
});
vi.mock("@praxity/shared-blocks/self-check-consumers", async (original) => ({
	...(await original<typeof import("@praxity/shared-blocks/self-check-consumers")>()),
	shouldAttachIslandAutomatically: () => false,
}));
let attach: () => () => void;
beforeAll(async () => {
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
	});
	let id = 0;
	const read = readLesson(
		"# Practice\n::: choice First\n(x) Yes\n( ) No\n:::\n::: choice Second\n(x) Up\n( ) Down\n:::\n::: choice Broken\n(x) Left\n( ) Right\n:::\n",
		{ ids: () => `island-${++id}` },
	);
	const config = {
		id: "course",
		title: "Practice",
		sourceLocale: "en",
		pages: read.pages,
		totalPages: 1,
	} as CourseConfig;
	const page = read.pages[0];
	const html = generateHtmlPage({
		config,
		page,
		index: 0,
		currentSlug: "practice",
		slugMap: new Map([[page.id, "practice"]]),
		slugList: [{ pageId: page.id, title: "Practice", slug: "practice" }],
		islandAssets: compilerIslandAssets,
	});
	document.documentElement.innerHTML = new DOMParser().parseFromString(
		html,
		"text/html",
	).documentElement.innerHTML;
	const bad = page.blocks.filter((block) => block.type === "assessment").at(-1);
	if (!bad) throw Error("Missing bad question");
	for (const id of ["praxity-host-config", "praxity-config"]) {
		const script = document.getElementById(id);
		if (!script?.textContent) throw Error("Missing config");
		const value = JSON.parse(script.textContent);
		value.choiceStateSignatures[bad.id] = `sha256:${"d".repeat(64)}`;
		script.textContent = JSON.stringify(value);
	}
	attach = (await import("../template/src/islands/island-assessment")).attachIsland;
});
afterEach(() => observed.clear());
it("mounts each ID's compiled pair, matching the host rather than another question", () => {
	const host = readCourseHostConfig(document);
	const cleanup = attach();
	try {
		expect(observed.size).toBe(3);
		expect(host?.choiceStateInvalidIds).toHaveLength(1);
		for (const [id, pair] of observed) {
			if (host?.choiceStateInvalidIds?.includes(id)) expect(pair).toBeUndefined();
			else
				expect(pair).toEqual({
					question: host?.choiceStateQuestions?.[id],
					signature: host?.choiceStateSignatures?.[id],
				});
			expect(document.getElementById(`block-${id}`)?.querySelector("input")).toBeTruthy();
		}
		const pairs = [...observed.values()];
		expect(pairs[0]?.signature).not.toBe(pairs[1]?.signature);
	} finally {
		cleanup();
	}
});
