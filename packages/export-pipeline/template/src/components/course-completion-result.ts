import { interpolate } from "@praxity/shared-blocks/i18n/interpolate";
import { resolveLocale } from "@praxity/shared-blocks/i18n/locale";
import type { CourseTracker } from "../../../src/scorm/tracking";
import type { SCORMRuntime } from "../../../src/scorm/types";
import { readCoreCourseConfig } from "../hosts/core-course-config";

/** Pages and module completion share the same result labels and score presentation. */
export function renderCourseCompletionResult(
	root: ParentNode,
	strings: Record<string, string>,
	outcome: ReturnType<CourseTracker["getOutcome"]>,
	recordedScore: ReturnType<SCORMRuntime["getScore"]> | undefined,
): void {
	const outcomeLabel = root.querySelector<HTMLElement>("[data-course-outcome]");
	if (outcomeLabel) {
		outcomeLabel.hidden = !outcome;
		outcomeLabel.classList.toggle("praxity-assessment-result", !!outcome);
		const label = outcomeLabel.querySelector("[data-course-outcome-label]");
		if (label)
			label.textContent = outcome
				? outcome.passed
					? strings.assessmentGroupPassed
					: strings.assessmentGroupNotPassed
				: "";
		if (outcome) {
			outcomeLabel.dataset.result = outcome.passed ? "correct" : "incorrect";
			outcomeLabel
				.querySelector("svg")
				?.setAttribute("class", `icon icon-tabler icon-tabler-${outcome.passed ? "check" : "x"}`);
			outcomeLabel
				.querySelector("path")
				?.setAttribute("d", outcome.passed ? "M5 12l5 5l10 -10" : "M18 6l-12 12M6 6l12 12");
		} else {
			delete outcomeLabel.dataset.result;
		}
	}
	const score = outcome ? { raw: outcome.score, max: 100 } : recordedScore;
	const scoreLabel = root.querySelector<HTMLElement>("[data-course-score], #deck-completion-score");
	if (scoreLabel) {
		const passMark = outcome ? readCoreCourseConfig(scoreLabel.ownerDocument)?.passMark : undefined;
		scoreLabel.textContent = score
			? interpolate(
					passMark === undefined ? strings.courseRecordedScore : strings.courseScoreWithPassMark,
					{ score: score.raw, max: score.max, passMark: passMark ?? "" },
				)
			: "";
		scoreLabel.hidden = !score;
	}
}

/** Completion copy reports useful reading time, without a ticking seconds counter. */
export function formatCourseSessionTime(
	time: { minutes: number; seconds: number },
	locale: string,
	strings: Record<string, string>,
): string {
	let text: string;
	if (time.minutes < 1) text = strings.courseTimeLessThanMinute;
	else {
		locale = resolveLocale(locale);
		const duration = { hours: Math.floor(time.minutes / 60), minutes: time.minutes % 60 };
		const DurationFormat = (
			Intl as typeof Intl & {
				DurationFormat?: new (
					locale: string,
					options: { style: "long" },
				) => {
					format(duration: { hours: number; minutes: number }): string;
				};
			}
		).DurationFormat;
		if (DurationFormat) text = new DurationFormat(locale, { style: "long" }).format(duration);
		else {
			const units = (["hours", "minutes"] as const)
				.filter((unit) => duration[unit] > 0)
				.map((unit) =>
					new Intl.NumberFormat(locale, {
						style: "unit",
						unit: unit === "hours" ? "hour" : "minute",
						unitDisplay: "long",
					}).format(duration[unit]),
				);
			text = new Intl.ListFormat(locale, { style: "long", type: "unit" }).format(units);
		}
	}
	return interpolate(strings.courseTimeSpent, { duration: text });
}
