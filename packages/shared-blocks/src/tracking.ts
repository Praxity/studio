export interface CourseOutcome {
	score?: number;
	success?: "passed" | "failed" | "unknown";
	completion?: "incomplete" | "completed" | "passed" | "failed";
	courseFailure?: boolean;
	forceCompletion?: boolean;
	objective?: { id: string; score: number; passed: boolean };
	finish?: "complete" | "terminate";
}

/** The runtime-only End path and course tracker share this injected writer. */
interface OutcomeRuntime {
	setScore?(raw: number, min: number, max: number): void;
	setSuccess?(status: "passed" | "failed" | "unknown"): void;
	setCompletion?(status: "incomplete" | "completed" | "passed" | "failed"): void;
	getCompletion?(): string;
	setCourseFailure?(failed: boolean): void;
	trackObjective?(id: string, score: number, passed: boolean): void;
	terminate?(explicitFinish?: boolean): boolean;
	commit?(): unknown;
}

export function writeCourseOutcome(
	runtime: OutcomeRuntime | undefined,
	outcome: CourseOutcome,
): boolean {
	if (!runtime) return true;
	if (outcome.objective) {
		const { id, score, passed } = outcome.objective;
		runtime.trackObjective?.(id, score, passed);
	}
	if (outcome.score !== undefined) runtime.setScore?.(outcome.score, 0, 100);
	if (outcome.courseFailure !== undefined) runtime.setCourseFailure?.(outcome.courseFailure);
	if (outcome.success !== undefined) runtime.setSuccess?.(outcome.success);
	if (
		outcome.completion !== undefined &&
		(outcome.forceCompletion || runtime.getCompletion?.() !== outcome.completion)
	)
		runtime.setCompletion?.(outcome.completion);
	// SCORM prepares completion before its final commit, after pending writes.
	if (outcome.finish === "terminate") return runtime.terminate?.(true) ?? false;
	if (outcome.finish === "complete") runtime.commit?.();
	return true;
}

/** Runtime-only End has no tracker. Keep its legacy completion rule beside the writer. */
export function finishRuntimeCourse(runtime: OutcomeRuntime | undefined): boolean {
	return writeCourseOutcome(runtime, {
		completion: "completed",
		forceCompletion: true,
		finish: "complete",
	});
}
