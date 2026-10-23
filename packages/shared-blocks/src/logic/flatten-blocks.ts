import { isInlineProjectionMetadataKey } from "@praxity/content-model/inline-fields";
export interface LogicBlockLike {
	id: string;
	type: string;
	name?: string;
	visible?: boolean;
	data: Record<string, unknown>;
}

export type ScopedLogicBlock<T extends LogicBlockLike = LogicBlockLike> = T & {
	logicScope: string;
};

function isBlock(value: unknown): value is LogicBlockLike {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const block = value as Record<string, unknown>;
	return (
		typeof block.id === "string" &&
		typeof block.type === "string" &&
		Boolean(block.data) &&
		typeof block.data === "object" &&
		!Array.isArray(block.data)
	);
}

/** Flatten nested block arrays while retaining their heading-section boundary. */
export function flattenLogicBlocks<T extends LogicBlockLike>(
	blocks: readonly T[],
): Array<ScopedLogicBlock<T>> {
	const flattened: Array<ScopedLogicBlock<T>> = [];
	let nextScope = 0;

	const visitValue = (value: unknown, parentScope: string): void => {
		if (Array.isArray(value)) {
			const scope = `${parentScope}/${++nextScope}`;
			for (const item of value) {
				if (isBlock(item)) visitBlock(item as T, scope);
				else visitValue(item, parentScope);
			}
			return;
		}
		if (!value || typeof value !== "object") return;
		if (isBlock(value)) {
			visitBlock(value as T, `${parentScope}/${++nextScope}`);
			return;
		}
		for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
			if (isInlineProjectionMetadataKey(key, { keepDisplay: true })) continue;
			visitValue(child, parentScope);
		}
	};

	const visitBlock = (block: T, scope: string): void => {
		flattened.push({ ...block, logicScope: scope });
		visitValue(block.data, scope);
	};

	for (const block of blocks) visitBlock(block, "root");
	return flattened;
}
