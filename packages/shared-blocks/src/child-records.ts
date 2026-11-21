import type { PraxityBlock } from "./types";

export type ChildRecordKind =
	| "block"
	| "item"
	| "back"
	| "option"
	| "pair"
	| "match"
	| "step"
	| "blank"
	| "category"
	| "category-item"
	| "statement"
	| "spot"
	| "turn"
	| "task"
	| "level"
	| "criterion"
	| "image";

export interface ChildRecord {
	readonly kind: ChildRecordKind;
	readonly id: unknown;
	readonly ownerId: unknown;
	readonly path: string;
}

type DataRecord = Record<string, unknown>;
const record = (value: unknown): DataRecord =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as DataRecord) : {};

export function childRecords(block: PraxityBlock): ChildRecord[] {
	const result: ChildRecord[] = [];
	const add = (kind: ChildRecordKind, id: unknown, ownerId: unknown, path: string) => {
		result.push({ kind, id, ownerId, path });
	};
	const blocks = (value: unknown, ownerId: unknown, path: string) => {
		if (!Array.isArray(value)) return;
		value.forEach((child, index) => {
			const entry = record(child);
			const location = `${path}[${index}]`;
			add("block", entry.id, ownerId, `${location}.id`);
			visit(entry as unknown as PraxityBlock, location);
		});
	};
	const entries = (
		value: unknown,
		kind: ChildRecordKind,
		ownerId: unknown,
		path: string,
		visitEntry?: (entry: DataRecord, path: string) => void,
	) => {
		if (!Array.isArray(value)) return;
		value.forEach((child, index) => {
			const entry = record(child);
			const location = `${path}[${index}]`;
			add(kind, entry.id, ownerId, `${location}.id`);
			visitEntry?.(entry, location);
		});
	};
	function visit(current: PraxityBlock, path: string) {
		const data = record(current.data);
		const owner = current.id;
		const location = `${path}.data`;
		blocks((current as PraxityBlock & { children?: unknown }).children, owner, `${path}.children`);
		if ("imageId" in data) add("image", data.imageId, owner, `${location}.imageId`);
		switch (current.type) {
			case "card":
				entries(data.items, "item", owner, `${location}.items`, (item, itemPath) => {
					blocks(item.front, item.id, `${itemPath}.front`);
					if ("backId" in item || (Array.isArray(item.back) && item.back.length > 0))
						add("back", item.backId, item.id, `${itemPath}.backId`);
					blocks(item.back, item.backId, `${itemPath}.back`);
				});
				break;
			case "accordion":
			case "tabs":
			case "sequence":
			case "columns":
				entries(data.items, "item", owner, `${location}.items`, (item, itemPath) =>
					blocks(item.children, item.id, `${itemPath}.children`),
				);
				break;
			case "dialogue":
				entries(data.turns, "turn", owner, `${location}.turns`);
				break;
			case "checklist":
				entries(data.items, "task", owner, `${location}.items`);
				break;
			case "rating":
				entries(data.scale, "level", owner, `${location}.scale`);
				break;
			case "highlight": {
				const paragraphs = record(data.content).paragraphs;
				if (Array.isArray(paragraphs))
					paragraphs.forEach((paragraph, index) =>
						entries(paragraph, "item", owner, `${location}.content.paragraphs[${index}]`),
					);
				break;
			}
			case "retrievalSheet":
				entries(record(data.content).questions, "item", owner, `${location}.content.questions`);
				break;
			case "writeDistractors":
				entries(record(data.content).items, "item", owner, `${location}.content.items`);
				break;
			case "selfCheck":
				entries(record(data.content).parts, "criterion", owner, `${location}.content.parts`);
				break;
			case "assessment": {
				blocks(data.stem, owner, `${location}.stem`);
				blocks(data.description, owner, `${location}.description`);
				const feedback = record(data.feedback);
				blocks(feedback.correct, owner, `${location}.feedback.correct`);
				blocks(feedback.incorrect, owner, `${location}.feedback.incorrect`);
				const response = record(data.response);
				const responsePath = `${location}.response`;
				switch (response.type) {
					case "choice":
						entries(response.options, "option", owner, `${responsePath}.options`);
						break;
					case "matching":
						entries(response.pairs, "pair", owner, `${responsePath}.pairs`, (pair, pairPath) =>
							add("match", pair.matchId, pair.id, `${pairPath}.matchId`),
						);
						break;
					case "sequence":
						entries(response.items, "step", owner, `${responsePath}.items`);
						break;
					case "fillBlank":
						entries(response.blanks, "blank", owner, `${responsePath}.blanks`);
						break;
					case "categorize":
						entries(
							response.categories,
							"category",
							owner,
							`${responsePath}.categories`,
							(category, categoryPath) => {
								const ids = Array.isArray(category.itemIds) ? category.itemIds : [];
								if (Array.isArray(category.items))
									category.items.forEach((_item, index) =>
										add(
											"category-item",
											ids[index],
											category.id,
											`${categoryPath}.itemIds[${index}]`,
										),
									);
							},
						);
						break;
					case "matrix":
						entries(response.statements, "statement", owner, `${responsePath}.statements`);
						entries(response.scalePoints, "level", owner, `${responsePath}.scalePoints`);
						break;
					case "hotspot":
						entries(response.hotspots, "spot", owner, `${responsePath}.hotspots`);
						if ("imageId" in response)
							add("image", response.imageId, owner, `${responsePath}.imageId`);
						break;
				}
				break;
			}
		}
	}
	visit(block, "block");
	return result;
}

export function assertChildIds(blocks: readonly PraxityBlock[]): ReadonlySet<string> {
	const seen = new Set<string>();
	for (const block of blocks) {
		const records: ChildRecord[] = [
			{ kind: "block", id: block.id, ownerId: undefined, path: "block.id" },
			...childRecords(block),
		];
		for (const child of records) {
			if (typeof child.id !== "string" || !child.id.trim())
				throw new Error(`Missing child ID: ${child.kind} at ${child.path}`);
			if (seen.has(child.id)) throw new Error(`Duplicate child ID: ${child.id} at ${child.path}`);
			seen.add(child.id);
		}
	}
	return seen;
}
