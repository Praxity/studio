import type { ScormSessionState } from "./session";

/** Keep unreadable LMS bytes for recovery instead of certifying an empty attempt. */
export class SuspendDataReader<T> {
	unreadable = false;
	constructor(
		private readonly parse: (raw: string) => T | null,
		private readonly empty: () => T,
	) {}

	load(
		read: () => string,
		session: ScormSessionState | null,
		onUnreadable?: (raw: string) => void,
	): T {
		if (this.unreadable) return this.empty();
		const raw = read();
		if (raw) {
			const data = this.parse(raw);
			if (data) return data;
			this.unreadable = true;
			if (session) delete session.pendingCompletion;
			onUnreadable?.(raw);
		}
		return this.empty();
	}
}
