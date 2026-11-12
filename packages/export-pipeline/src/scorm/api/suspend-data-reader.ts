import type { ScormSessionState } from "./session";

/** Keep unreadable LMS bytes for recovery instead of certifying an empty attempt. */
export class SuspendDataReader<T> {
	unreadable = false;
	constructor(
		private readonly parse: (raw: string) => T | null,
		private readonly empty: () => T,
		private readonly version: "1.2" | "2004",
	) {}

	/**
	 * ADL SCORM 2004 4th edition RTE 3.1.7.4.1 and 4.2.23 distinguish
	 * General Get Failure (301) from an unset suspend value (403).
	 * SCORM 1.2 RTE 3.3 / 3.4.4 requires LMSGetLastError to distinguish
	 * an empty value from a failed LMSGetValue. Check before another API call.
	 */
	read(
		read: () => string,
		getLastError: () => string | number,
		session: ScormSessionState | null,
	): string | undefined {
		if (this.unreadable) return undefined;
		let raw = "";
		try {
			raw = read();
			const code = String(getLastError());
			if (code === "0") return raw;
			if (this.version === "2004" && code === "403") return "";
			this.hold(session, raw.length, `LMS read error ${code}`);
		} catch {
			this.hold(session, raw.length, "LMS read threw");
		}
		return undefined;
	}

	private hold(session: ScormSessionState | null, length: number, cause?: string): void {
		if (this.unreadable) return;
		this.unreadable = true;
		if (session) delete session.pendingCompletion;
		console.warn(
			`[SCORM ${this.version}] Saved progress is unreadable (${length} characters${cause ? `; ${cause}` : ""}); suspend data writes refused.`,
		);
	}

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
			this.hold(session, raw.length);
			onUnreadable?.(raw);
		}
		return this.empty();
	}
}
