import { XapiRuntime } from "../../../src/scorm/api/xapi";
import { LocalStorageRuntime } from "../../../src/scorm/local-storage-runtime";
import { initializeCourseHost, readCourseDeploymentConfig } from "./course-host";

export function initializeXapiHost(): boolean {
	return initializeCourseHost({
		format: "xapi",
		readDeploymentConfig: readCourseDeploymentConfig,
		createRuntime: (page, deployment) =>
			deployment.xapiConfig
				? new XapiRuntime(
						deployment.xapiConfig,
						page.courseId,
						undefined,
						deployment.courseActivityId,
					)
				: new LocalStorageRuntime(undefined, page.courseId),
	});
}

initializeXapiHost();
