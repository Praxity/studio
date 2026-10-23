export type BlockStatus = "core" | "hidden";

/**
 * Runtime types outside the supported authoring set.
 * Parser reachability varies; parser-reachable types produce a validation warning.
 */
export const HIDDEN_BLOCK_TYPES: ReadonlySet<string> = new Set([
	"chart",
	"labeledGraphic",
	"imageComparison",
	"resourceEntry",
	"document",
]);

/** Tombstones retained so stale persisted content fails clearly instead of disappearing. */
export const RETIRED_BLOCK_TYPES: ReadonlySet<string> = new Set(["diagram", "interactiveVideo"]);

export function isCoreBlockType(blockType: string): boolean {
	return !HIDDEN_BLOCK_TYPES.has(blockType) && !RETIRED_BLOCK_TYPES.has(blockType);
}

export function blockStatus(blockType: string): BlockStatus {
	return isCoreBlockType(blockType) ? "core" : "hidden";
}
