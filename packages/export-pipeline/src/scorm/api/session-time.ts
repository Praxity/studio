import type { ScormSessionState } from "./session.ts";

/** ADL uses the last cumulative session time, never the sum of intermediate writes. */
export function sessionTime(state: ScormSessionState, version: "1.2" | "2004"): string {
	const elapsed = Math.max(0, Math.floor((Date.now() - (state.startedAt ?? Date.now())) / 10));
	// CMITimespan has at most four hour digits. Preserve a valid value at its ceiling.
	const centiseconds = version === "1.2" ? Math.min(elapsed, 3_599_999_999) : elapsed;
	const hours = Math.floor(centiseconds / 360_000);
	const minutes = Math.floor((centiseconds % 360_000) / 6000);
	const seconds = Math.floor((centiseconds % 6000) / 100);
	const fraction = centiseconds % 100;
	if (version === "1.2") {
		return `${String(hours).padStart(4, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(fraction).padStart(2, "0")}`;
	}
	const secondsText = fraction
		? `${seconds}.${String(fraction).padStart(2, "0")}`
		: String(seconds);
	return `PT${hours ? `${hours}H` : ""}${minutes ? `${minutes}M` : ""}${secondsText}S`;
}
