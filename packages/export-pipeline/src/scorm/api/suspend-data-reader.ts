import type { ScormSessionState } from "./session";

/** Keep unreadable LMS bytes for recovery instead of certifying an empty attempt. */
export class SuspendDataReader<T> {
	unreadable = false;
	constructor(
		private readonly parse: (raw: string) => T | null,
		private readonly empty: () => T,
		private readonly version: "1.2" | "2004",
	) {}

	load(
		read: () => string | undefined,
		session: ScormSessionState | null,
		onUnreadable?: (raw: string) => void,
	): T {
		if (this.unreadable) return this.empty();
		const raw = read();
		if (raw === undefined) return this.empty();
		if (raw) {
			const data = this.parse(raw);
			if (data) return data;
			this.unreadable = true;
			console.warn(
				`[SCORM ${this.version}] Saved progress is unreadable (${raw.length} characters); suspend data writes refused.`,
			);
			if (session) delete session.pendingCompletion;
			onUnreadable?.(raw);
		}
		return this.empty();
	}
}
