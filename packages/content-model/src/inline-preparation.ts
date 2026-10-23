import { inlineMarkdown, parseInlineMarkdown } from "./inline-markdown";
import type { InlineTree } from "./inline-tree";
import { renderInlineTree } from "./inline-tree";
import { narrationDisplayText } from "./narration-display";
import { isLiteralTextBlockType, type PraxityBlock } from "./types";

type RecordData = Record<string, unknown>;
type FieldPath = string | readonly (string | number)[];

export { isInlineProjectionMetadataKey, withoutInlineProjectionMetadata } from "./inline-fields";

const DISPLAY_FIELDS: Record<string, string[]> = {
	heading: ["kicker"],
	note: ["title"],
	image: ["caption"],
	audio: ["title", "caption"],
	video: ["title", "caption"],
	table: ["title", "caption"],
	checklist: ["title"],
	chart: ["title", "subtitle", "caption"],
	stats: ["caption"],
	dialogue: ["caption"],
	card: ["title"],
};

function record(value: unknown): RecordData | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as RecordData)
		: undefined;
}

function readPath(value: unknown, path: FieldPath): unknown {
	for (const key of typeof path === "string" ? [path] : path) {
		if (!value || typeof value !== "object") return undefined;
		value = (value as Record<string | number, unknown>)[key];
	}
	return value;
}

/** Legacy block data can already contain rich HTML. Sanitize at the render sink. */
export const isInlineHtml = (value: string) =>
	/<(?:p|span|strong|em|a|code|mark|s|del|ul|ol|br)\b/i.test(value);

export function inlineTextTree(value: string): InlineTree | undefined {
	return isInlineHtml(value) ? undefined : parseInlineMarkdown(value);
}

export function formatInlineText(value: string, interactive = true, dialogue = false): string {
	if (dialogue) value = narrationDisplayText(value);
	return isInlineHtml(value) ? value : inlineMarkdown(value, { interactive });
}

/** Display HTML only. Never use this result as an answer value or accessible name. */
export function getInlineField(owner: unknown, path: FieldPath, interactive = true): string {
	const prepared = readPath(record(owner)?._inline, path);
	if (typeof prepared === "string") return prepared;
	const source = readPath(owner, path);
	return typeof source === "string"
		? formatInlineText(source, interactive, Array.isArray(path) && path[0] === "paragraphs")
		: typeof source === "number"
			? String(source)
			: "";
}

/**
 * Prepare display fields before collectors and runtime planning inspect them.
 * Raw labels and answer values stay intact; render-only HTML lives beside them.
 * Existing content/stem child blocks already hold HTML from the grammar parser.
 */
export function prepareInlineBlocks(blocks: PraxityBlock[]): PraxityBlock[] {
	const prepared = structuredClone(blocks);
	let changed = false;
	const field = (owner: RecordData, key: string, interactive = true, keepTree = false) => {
		const source = owner[key];
		if (typeof source !== "string" || typeof record(owner._inline)?.[key] === "string") return;
		const tree = keepTree ? inlineTextTree(source) : undefined;
		const html = tree
			? renderInlineTree(tree, { interactive })
			: formatInlineText(source, interactive);
		if (html !== source) {
			owner._inline = { ...record(owner._inline), [key]: html };
			if (tree)
				owner._inlineTrees = {
					...record(owner._inlineTrees),
					[key]: { trees: [tree], display: html },
				};
			changed = true;
		}
	};
	const fieldAt = (owner: RecordData, [key, index]: [string, number]) => {
		const source = readPath(owner, [key, index]);
		const cached = record(owner._inline) ?? {};
		if (typeof source !== "string" || typeof readPath(cached, [key, index]) === "string") return;
		const html = formatInlineText(source, true, true);
		if (html !== source) {
			const values = Array.isArray(cached[key]) ? [...cached[key]] : [];
			values[index] = html;
			owner._inline = { ...cached, [key]: values };
			changed = true;
		}
	};
	const fields = (owner: RecordData, keys: string[], interactive = true, keepTree = false) => {
		for (const key of keys) field(owner, key, interactive, keepTree);
	};
	const items = (value: unknown, keys: string[], interactive = true, keepTree = false) => {
		if (!Array.isArray(value)) return;
		for (const item of value) {
			const owner = record(item);
			if (owner) fields(owner, keys, interactive, keepTree);
		}
	};
	const fallbackItems = (value: unknown, keys: string[], interactive = true) => {
		if (!Array.isArray(value)) return;
		for (const item of value) {
			const owner = record(item);
			const key = owner && keys.find((candidate) => typeof owner[candidate] === "string");
			if (owner && key) field(owner, key, interactive);
		}
	};
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const child of value) visit(child);
			return;
		}
		const owner = record(value);
		if (!owner) return;
		const data = record(owner.data);
		if (data && typeof owner.type === "string") {
			if (isLiteralTextBlockType(owner.type)) return;
			fields(
				data,
				(DISPLAY_FIELDS[owner.type] ?? []).filter(
					(key) => key !== "caption" || data.captionEnabled !== false,
				),
			);
			switch (owner.type) {
				case "dialogue":
					if (Array.isArray(data.turns))
						for (const turn of data.turns) {
							const owner = record(turn);
							if (owner && Array.isArray(owner.paragraphs))
								owner.paragraphs.forEach((_, index) => fieldAt(owner, ["paragraphs", index]));
						}
					break;
				case "accordion":
				case "tabs":
					fallbackItems(data.items, ["label", "title"], false);
					break;
				case "sequence":
				case "card":
					fallbackItems(data.items, ["label", "title"]);
					break;
				case "table": {
					const cached = record(data._inline) ?? {};
					if (!cached.headers && Array.isArray(data.headers)) {
						changed = true;
						cached.headers = data.headers.map((cell) => formatInlineText(String(cell)));
					}
					if (!cached.rows && Array.isArray(data.rows)) {
						changed = true;
						cached.rows = data.rows.map((row) =>
							Array.isArray(row) ? row.map((cell) => formatInlineText(String(cell))) : [],
						);
					}
					const { caption, ...beforeCaption } = cached;
					data._inline = caption === undefined ? beforeCaption : { ...beforeCaption, caption };
					break;
				}
				case "checklist":
					items(data.items, ["text"], false);
					break;
				case "stats":
					items(data.items, ["label"]);
					break;
				case "button":
					field(data, "text", false);
					break;
				case "assessmentGroup":
					field(data, "groupName");
					break;
				case "assessment": {
					const response = record(data.response);
					if (response) {
						items(
							response.options,
							["label", "text", "feedback"],
							false,
							response.type === "choice",
						);
						items(response.items, ["label", "feedback"]);
						// Matching/categorization values also serve as answer keys. Keep them raw.
						items(response.pairs, ["prompt", "feedback"]);
					}
					break;
				}
			}
		}
		for (const [key, child] of Object.entries(owner)) {
			if (!key.startsWith("_")) visit(child);
		}
	};
	visit(prepared);
	return changed ? prepared : blocks;
}
