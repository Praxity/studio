import { Scorm12Runtime } from "../../../src/scorm/api/scorm12";
import { findScormApi, readScormEntry } from "../../../src/scorm/api-discovery";
import { LocalStorageRuntime } from "../../../src/scorm/local-storage-runtime";
import { initializeScormCourseHost, type ScormCourseHostAdapter } from "./course-host";

export function initializeScorm12Host(): boolean {
	const adapter: ScormCourseHostAdapter = {
		format: "scorm12",
		createRuntime: (page, _deployment, win) =>
			findScormApi(win, "1.2")
				? new Scorm12Runtime(page.courseId)
				: new LocalStorageRuntime(undefined, page.courseId),
		isFallback: (runtime) => runtime instanceof LocalStorageRuntime,
		readEntry: (win) => {
			const discovered = findScormApi(win, "1.2");
			return discovered ? readScormEntry(discovered) : null;
		},
	};
	return initializeScormCourseHost(adapter);
}

initializeScorm12Host();
