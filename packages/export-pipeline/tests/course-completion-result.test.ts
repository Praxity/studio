import { getStrings } from "@praxity/shared-blocks/i18n/strings";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { renderCourseCompletionResult } from "../template/src/components/course-completion-result";

function completion(passMark?: number, module = false) {
	const dom = new JSDOM(
		`<p data-course-outcome hidden><svg class="icon icon-tabler" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path/></svg><span data-course-outcome-label></span></p><p ${module ? 'id="deck-completion-score"' : "data-course-score"} hidden></p>`,
	);
	const config = dom.window.document.createElement("script");
	config.id = "praxity-host-config";
	config.type = "application/json";
	config.textContent = JSON.stringify({
		version: 1,
		courseId: "course",
		pageId: "summary",
		pageTitle: "Summary",
		currentPage: 1,
		totalPages: 1,
		currentSlug: "summary",
		availableSlugs: ["summary"],
		pageIdMap: { summary: "summary" },
		completionMethod: "allPages",
		pageRole: "content",
		strings: {},
		passMark,
		scoredAssessmentIds: ["question"],
	});
	dom.window.document.body.append(config);
	return dom.window.document;
}

describe("completion result presentation", () => {
	for (const module of [false, true]) {
		for (const locale of ["en", "fr"]) {
			for (const passed of [true, false]) {
				it(`${module ? "modules" : "Pages"} ${locale} ${passed ? "pass" : "fail"} shows the mark and status icon with its word`, () => {
					const doc = completion(80, module);
					renderCourseCompletionResult(
						doc,
						{ ...getStrings(locale) },
						{ score: passed ? 100 : 0, passed },
						undefined,
					);
					expect
						.soft(doc.querySelector("[data-course-score], #deck-completion-score")?.textContent)
						.toBe(
							locale === "fr"
								? passed
									? "Score : 100 / 100 · Seuil de réussite : 80"
									: "Score : 0 / 100 · Seuil de réussite : 80"
								: passed
									? "Score: 100 / 100 · Pass mark: 80"
									: "Score: 0 / 100 · Pass mark: 80",
						);
					const status = doc.querySelector<HTMLElement>("[data-course-outcome]");
					expect(status?.textContent).toBe(
						locale === "fr" ? (passed ? "Réussi" : "Non réussi") : passed ? "Passed" : "Not passed",
					);
					expect(status?.hidden).toBe(false);
					expect.soft(status?.classList.contains("praxity-assessment-result")).toBe(true);
					expect.soft(status?.dataset.result).toBe(passed ? "correct" : "incorrect");
					const icon = status?.querySelector("svg");
					expect
						.soft(icon?.classList.contains(passed ? "icon-tabler-check" : "icon-tabler-x"))
						.toBe(true);
					expect.soft(icon?.getAttribute("aria-hidden")).toBe("true");
					expect.soft(icon?.getAttribute("focusable")).toBe("false");
				});
			}
			it(`${module ? "modules" : "Pages"} ${locale} without a mark preserves the recorded score`, () => {
				const doc = completion(undefined, module);
				renderCourseCompletionResult(doc, { ...getStrings(locale) }, undefined, {
					raw: 79,
					min: 0,
					max: 100,
				});
				expect
					.soft(doc.querySelector("[data-course-score], #deck-completion-score")?.textContent)
					.toBe(locale === "fr" ? "Score : 79 / 100" : "Score: 79 / 100");
				expect(doc.querySelector<HTMLElement>("[data-course-outcome]")?.hidden).toBe(true);
			});
		}
	}
});
