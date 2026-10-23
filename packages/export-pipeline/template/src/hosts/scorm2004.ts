import { Scorm2004Runtime } from "../../../src/scorm/api/scorm2004";
import { findScormApi, readScormEntry } from "../../../src/scorm/api-discovery";
import { LocalStorageRuntime } from "../../../src/scorm/local-storage-runtime";
import { initializeScormCourseHost, type ScormCourseHostAdapter } from "./course-host";

export function initializeScorm2004Host(): boolean {
	const adapter: ScormCourseHostAdapter = {
		format: "scorm2004",
		createRuntime: (page, _deployment, win) =>
			findScormApi(win, "2004")
				? new Scorm2004Runtime(win)
				: new LocalStorageRuntime(undefined, page.courseId),
		isFallback: (runtime) => runtime instanceof LocalStorageRuntime,
		readEntry: (win) => {
			const discovered = findScormApi(win, "2004");
			return discovered ? readScormEntry(discovered) : null;
		},
	};
	return initializeScormCourseHost(adapter);
}

initializeScorm2004Host();
