import { flattenLogicBlocks } from "./logic/flatten-blocks";
import type { PraxityBlock } from "./types";

/** One compiled rule for state routing, response reporting and size estimates. */
export function compileBlockStatePolicy(blocks: PraxityBlock[]): Record<string, "device" | "lms"> {
	return Object.fromEntries(
		flattenLogicBlocks(blocks).flatMap((block) => {
			if (block.type === "writeDistractors") return [[block.id, "device"]];
			if (block.type === "selfCheck")
				return [[block.id, block.data.private === false ? "lms" : "device"]];
			if (
				block.type === "assessment" &&
				block.data.assessmentType === "choice" &&
				(block.data.response as { selectionMode?: unknown } | undefined)?.selectionMode ===
					"single" &&
				block.data.private === true
			)
				return [[block.id, "device"]];
			return [];
		}),
	);
}

/** Also protect round trips through logic/deck custom state and older suspend
 * records. Preserve unrelated bytes exactly when nothing private was removed. */
export function filterPrivateSuspendData(
	raw: string,
	policy: Readonly<Record<string, "device" | "lms">>,
): string {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return raw;
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) return raw;
	const data = value as Record<string, unknown>;
	let changed = false;
	const blocks = data.blockState;
	if (blocks && typeof blocks === "object" && !Array.isArray(blocks)) {
		const entries = Object.entries(blocks).filter(([id]) => policy[id] !== "device");
		if (entries.length !== Object.keys(blocks).length) {
			if (entries.length) data.blockState = Object.fromEntries(entries);
			else delete data.blockState;
			changed = true;
		}
	}
	for (const key of ["interactions", "objectives"]) {
		if (Array.isArray(data[key])) {
			const interactions = (data[key] as unknown[]).filter(
				(entry) =>
					!entry ||
					typeof entry !== "object" ||
					policy[String((entry as Record<string, unknown>).id)] !== "device",
			);
			if (interactions.length !== (data[key] as unknown[]).length) {
				data[key] = interactions;
				changed = true;
			}
		}
	}
	return changed ? JSON.stringify(data) : raw;
}
