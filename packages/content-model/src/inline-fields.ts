import type { InlineTree } from "./inline-tree";

/** Compiler trees are bound to the exact display field they describe. */
export interface InlineField {
	trees: InlineTree[];
	display: string;
}

export function isInlineProjectionMetadataKey(
	key: string,
	options: { keepDisplay?: boolean } = {},
): boolean {
	return (
		key === "_htmlFields" || key === "_inlineTrees" || (key === "_inline" && !options.keepDisplay)
	);
}

export function withoutInlineProjectionMetadata<T>(
	value: T,
	options: { keepDisplay?: boolean } = {},
): T {
	if (Array.isArray(value))
		return value.map((entry) => withoutInlineProjectionMetadata(entry, options)) as T;
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => !isInlineProjectionMetadataKey(key, options))
			.map(([key, entry]) => [key, withoutInlineProjectionMetadata(entry, options)]),
	) as T;
}

export function inlineField(owner: Record<string, unknown>, key: string): InlineField | undefined {
	const field = (owner._inlineTrees as Record<string, unknown> | undefined)?.[key];
	if (!field || typeof field !== "object" || Array.isArray(field)) return undefined;
	const entry = field as InlineField;
	return Array.isArray(entry.trees) && typeof entry.display === "string" ? entry : undefined;
}

/** A display transform may carry provenance forward only from matching input. */
export function rebindInlineFields(
	before: Record<string, unknown>,
	after: Record<string, unknown>,
): void {
	const fields = before._inlineTrees as Record<string, unknown> | undefined;
	if (!fields) return;
	const rebound = { ...fields };
	for (const key of Object.keys(fields)) {
		const field = inlineField(before, key);
		const display = (owner: Record<string, unknown>) =>
			(owner._inline as Record<string, unknown> | undefined)?.[key] ?? owner[key];
		if (field && field.display === display(before) && typeof display(after) === "string")
			rebound[key] = { ...field, display: display(after) };
	}
	after._inlineTrees = rebound;
}
