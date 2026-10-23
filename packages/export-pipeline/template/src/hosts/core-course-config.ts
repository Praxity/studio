import type {} from "../../../src/scorm/privacy-capability";
import { isNonemptyString, isPositiveInteger, isString } from "../../../src/scorm/types";
import type { CourseHostConfig } from "./course-host";
import { isRecord, isStringArray, isStringRecord, readJsonElement } from "./host-json";

/** Display-only consumers do not depend on optional assessment metadata. */
export function readCoreCourseConfig(doc: Document): CourseHostConfig | null {
	return decodeCoreCourseConfig(readJsonElement(doc, "praxity-host-config"));
}

export function decodeCoreCourseConfig(
	value: Record<string, unknown> | null,
): CourseHostConfig | null {
	if (!value) return null;
	const completionMethod = value.completionMethod;
	const pageRole = value.pageRole;
	if (
		value.version !== 1 ||
		!isNonemptyString(value.courseId) ||
		!isNonemptyString(value.pageId) ||
		!isString(value.pageTitle) ||
		!isPositiveInteger(value.currentPage) ||
		!isPositiveInteger(value.totalPages) ||
		!isNonemptyString(value.currentSlug) ||
		!isStringArray(value.availableSlugs) ||
		!isStringRecord(value.pageIdMap) ||
		!(value.requiredAssessmentIds === undefined || isStringArray(value.requiredAssessmentIds)) ||
		!(value.scoredAssessmentIds === undefined || isStringArray(value.scoredAssessmentIds)) ||
		!(
			value.passMark === undefined ||
			(typeof value.passMark === "number" && value.passMark > 0 && value.passMark <= 100)
		) ||
		!(
			completionMethod === "allPages" ||
			completionMethod === "percentage" ||
			completionMethod === "quiz"
		) ||
		!(pageRole === "content" || pageRole === "glossary" || pageRole === "resources") ||
		!isStringRecord(value.strings) ||
		!(
			!(globalThis.__praxityPrivateState !== false) ||
			value.blockStatePolicy === undefined ||
			(isRecord(value.blockStatePolicy) &&
				Object.values(value.blockStatePolicy).every((mode) => mode === "device" || mode === "lms"))
		)
	) {
		return null;
	}
	return {
		version: 1,
		...(globalThis.__praxityPrivateState !== false && value.blockStatePolicy
			? { blockStatePolicy: value.blockStatePolicy as CourseHostConfig["blockStatePolicy"] }
			: {}),
		...(value.deck === true ? { deck: true } : {}),
		...(globalThis.__praxityPrivateState !== false && value.deferVisits === true
			? { deferVisits: true }
			: {}),
		courseId: value.courseId,
		pageId: value.pageId,
		pageTitle: value.pageTitle,
		currentPage: value.currentPage,
		totalPages: value.totalPages,
		currentSlug: value.currentSlug,
		availableSlugs: value.availableSlugs,
		pageIdMap: value.pageIdMap,
		completionMethod,
		...(typeof value.completionThreshold === "number" && Number.isFinite(value.completionThreshold)
			? { completionThreshold: value.completionThreshold }
			: {}),
		...(value.requiredAssessmentIds === undefined
			? {}
			: { requiredAssessmentIds: value.requiredAssessmentIds as string[] }),
		...(typeof value.passMark === "number" && isStringArray(value.scoredAssessmentIds)
			? { passMark: value.passMark, scoredAssessmentIds: value.scoredAssessmentIds }
			: {}),
		pageRole,
		strings: value.strings,
	};
}
