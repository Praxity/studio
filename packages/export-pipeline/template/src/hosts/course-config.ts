import { admitChoiceStateFacts } from "@praxity/shared-blocks/choice-state-facts";
import { decodeCoreCourseConfig } from "./core-course-config";
import type { CourseHostConfig } from "./course-host";
import { readJsonElement } from "./host-json";

export { readCoreCourseConfig } from "./core-course-config";

export function readCourseHostConfig(doc: Document): CourseHostConfig | null {
	const value = readJsonElement(doc, "praxity-host-config");
	const core = decodeCoreCourseConfig(value);
	return core && value ? { ...core, ...admitChoiceStateFacts(value) } : null;
}
