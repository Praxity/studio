import type { IdentityMapping } from "./types.ts";

/** Reverse one survivor and restore each merge donor, without sharing identities. */
export function invertIdentityMapping(
	mapping: readonly IdentityMapping[],
	/** Restore prior pending status; a newly invalid draft still undoes to active. */
	pendingIds: ReadonlySet<string> = new Set(),
	cutIds: ReadonlySet<string> = new Set(),
): IdentityMapping[] {
	const result: IdentityMapping[] = [];
	for (const map of mapping) {
		if (map.oldId && map.fate !== "copied" && cutIds.has(map.oldId)) {
			result.push({ oldId: map.newId ?? map.oldId, newId: null, fate: "cut" });
		} else if (
			map.fate === "copied" ||
			map.fate === "new" ||
			(map.fate === "pending" && map.oldId !== map.newId && map.newId !== null)
		) {
			if (map.newId) result.push({ oldId: map.newId, newId: null, fate: "retired" });
		} else if (map.fate === "absorbed" || map.fate === "retired" || map.fate === "cut") {
			if (map.oldId)
				result.push({
					oldId: null,
					newId: map.oldId,
					fate: pendingIds.has(map.oldId) ? "pending" : "new",
				});
		} else if (map.fate === "pending" && map.newId === null) {
			result.push({
				oldId: null,
				newId: map.oldId,
				fate: map.oldId && pendingIds.has(map.oldId) ? "pending" : "new",
			});
		} else
			result.push({
				oldId: map.newId,
				newId: map.oldId,
				fate: map.oldId && pendingIds.has(map.oldId) ? "pending" : "kept",
			});
	}
	return result;
}
