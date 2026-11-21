export function declaredCourseActivityId(courseId: string, activityBase?: string): string {
	return activityBase
		? `${activityBase.endsWith("/") ? activityBase : `${activityBase}/`}course`
		: `https://praxity.io/courses/${courseId}`;
}

export function isAbsoluteIri(value: unknown): value is string {
	if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || /\s/.test(value))
		return false;
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
}
