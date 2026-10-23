import type { ScormSessionState } from "./api/session";

type PrivateScorm12Session = ScormSessionState & { interactionNextIndex?: number };

/** Device filtering can shrink history; accepted IDs own a shared launch high water. */
export function appendPrivateScorm12Interaction(
	session: PrivateScorm12Session | null,
	get: (key: string) => string,
	set: (key: string, value: string) => boolean,
	id: string,
	historyIndex: number,
): number | undefined {
	let raw = "";
	try {
		raw = get("cmi.interactions._count");
	} catch {
		// Optional LMS count support must not suppress ordinary self-check-course rows.
	}
	if (raw && (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))) return;
	const index = Math.max(raw ? Number(raw) : historyIndex, session?.interactionNextIndex ?? 0);
	if (!Number.isSafeInteger(index) || !set(`cmi.interactions.${index}.id`, id)) return;
	if (session) session.interactionNextIndex = index + 1;
	return index;
}
