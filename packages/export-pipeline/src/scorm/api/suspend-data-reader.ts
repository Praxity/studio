import type { ScormSessionState } from "./session";

export class SuspendDataReader<T> {
	unreadable = false;
	constructor(
		private readonly parse: (raw: string) => T | null,
		private readonly empty: () => T,
		private readonly version: "1.2" | "2004",
	) {}

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
