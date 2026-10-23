type SessionStorage = Pick<Storage, "getItem" | "setItem">;

/** The current tab's course reading session, independent of LMS completion. */
export function readCourseSessionTime(
	courseId: string,
	now: number,
	storage: () => SessionStorage,
): { minutes: number; seconds: number } | { error: unknown } {
	try {
		const store = storage();
		const key = `praxity-course-session:${courseId}`;
		const saved = store.getItem(key);
		const start = saved === null ? now : Number(saved);
		if (!Number.isFinite(start) || start < 0 || start > now || saved === "") {
			throw new Error("Invalid course session timestamp");
		}
		if (saved === null) store.setItem(key, String(start));
		const elapsed = Math.floor((now - start) / 1000);
		return { minutes: Math.floor(elapsed / 60), seconds: elapsed % 60 };
	} catch (error) {
		return { error };
	}
}
