import type { SCORMRuntime } from "../types";
import type { ScormSessionState } from "./session";

/** SCORM has no attempt identifier. Keep an opaque token in its existing custom
 * state, shared across documents and resume; it contains no block data or flags.
 * Both adapters share this owner without adding it to the session support bundle. */
export function deviceAttemptId(
	runtime: SCORMRuntime,
	session: ScormSessionState | null,
	entry: string,
): { attemptId: string; newAttempt: boolean } {
	if (!session) throw new Error("EATTEMPTIDENTITY");
	if (session.attemptId) return { attemptId: session.attemptId, newAttempt: false };
	const raw = runtime.getSuspendData();
	let data: Record<string, unknown> = {};
	if (raw) {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			throw new Error("EATTEMPTIDENTITY");
		data = parsed as Record<string, unknown>;
	}
	const saved = data.deviceAttemptId;
	const attemptId =
		entry !== "ab-initio" && typeof saved === "string" && /^[0-9a-f-]{36}$/.test(saved)
			? saved
			: globalThis.crypto.randomUUID();
	if (saved !== attemptId)
		if (runtime.setSuspendData(JSON.stringify({ ...data, deviceAttemptId: attemptId })) === false)
			throw new Error("EATTEMPTIDENTITY");
	session.attemptId = attemptId;
	return { attemptId, newAttempt: saved !== attemptId };
}

export function resolveLaunchAttempt(courseId: string, learnerId: string): string | undefined {
	if (typeof window === "undefined") return undefined;
	const params = new URLSearchParams(window.location?.search || "");
	const launched = params.get("registration");
	const key = `praxity-xapi-attempt:${JSON.stringify([courseId, learnerId])}`;
	try {
		const session = window.sessionStorage;
		if (launched) {
			session?.setItem(key, launched);
			return launched;
		}
		// An explicit launch without registration cannot inherit a previous attempt.
		if (params.has("actor")) {
			session?.removeItem(key);
			return undefined;
		}
		return session?.getItem(key) || undefined;
	} catch {
		return launched || undefined;
	}
}
