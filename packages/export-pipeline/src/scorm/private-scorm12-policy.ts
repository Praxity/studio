import type { ScormSessionState } from "./api/session";

type PrivateScorm12Session = ScormSessionState & { interactionNextIndex?: number };

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
	} catch {}
	if (raw && (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))) return;
	const index = Math.max(raw ? Number(raw) : historyIndex, session?.interactionNextIndex ?? 0);
	if (!Number.isSafeInteger(index) || !set(`cmi.interactions.${index}.id`, id)) return;
	if (session) session.interactionNextIndex = index + 1;
	return index;
}
