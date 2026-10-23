import { toSourceParameter } from "@praxity/grammar";
import { BLOCK_SCHEMA } from "@praxity/grammar/src/v4/schema.ts";
import schema from "learning-patterns/patterns/write-distractors/content.schema.json" with {
	type: "json",
};
import { constructPromptBlockMetadata, promptBlockKeys } from "./prompt-block-metadata";
import type { PraxityBlock, WriteDistractorsData, WriteDistractorsPrompt } from "./types";

export type WriteDistractorsPromptBlock = Omit<PraxityBlock, "type" | "data"> & {
	type: "writeDistractors";
	data: WriteDistractorsData;
};
const settings = BLOCK_SCHEMA["write-distractors"].settings;
const dataKeys = ["content", "level", "layoutMode", "hide", "visible", "entrance"];
function invalidPrompt(): Error {
	return Object.assign(new Error("Invalid write-distractors prompt data."), {
		code: "EWRITEDISTRACTORSPROMPT",
	});
}
/** Check descriptors before reading: cloning would erase unknown keys and invoke getters. */
function assertPlain(value: unknown, seen = new Set<object>()): void {
	if (!value || typeof value !== "object") return;
	if (
		seen.has(value) ||
		(!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) ||
		(Array.isArray(value) && Object.getPrototypeOf(value) !== Array.prototype)
	)
		throw invalidPrompt();
	seen.add(value);
	for (const key of Reflect.ownKeys(value)) {
		if (Array.isArray(value) && key === "length") continue;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (typeof key !== "string" || !descriptor?.enumerable || !("value" in descriptor))
			throw invalidPrompt();
		assertPlain(descriptor.value, seen);
	}
	seen.delete(value);
}
function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidPrompt();
	return value as Record<string, unknown>;
}
function onlyKeys(value: object, keys: readonly string[]): void {
	if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !keys.includes(key)))
		throw invalidPrompt();
}
function nonblank(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) throw invalidPrompt();
	return value;
}
function setting(key: string, value: unknown): string | number | boolean {
	const definition = settings[key];
	if (
		!definition ||
		(typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
	)
		throw invalidPrompt();
	if (!definition.accepts(typeof value === "number" ? String(value) : value)) throw invalidPrompt();
	if (definition.type === "integer" || definition.type === "number") return Number(value);
	if (definition.type === "boolean") {
		if (typeof value !== "boolean") throw invalidPrompt();
		return value;
	}
	if (typeof value !== "string") throw invalidPrompt();
	return value;
}

/** Recognize a prompt before generic visitors can invoke or erase its discriminator. */
export function admitWriteDistractorsPrompt(
	input: unknown,
): WriteDistractorsPromptBlock | undefined {
	if (!input || typeof input !== "object") return undefined;
	const type = Object.getOwnPropertyDescriptor(input, "type");
	if (type && !("value" in type)) throw invalidPrompt();
	if (!type && "type" in input) {
		// Inspect the inherited discriminator without invoking a getter. An unknown
		// accessor is a generic capture refusal, not a distractor-specific diagnosis.
		for (
			let prototype = Object.getPrototypeOf(input);
			prototype;
			prototype = Object.getPrototypeOf(prototype)
		) {
			const inherited = Object.getOwnPropertyDescriptor(prototype, "type");
			if (!inherited) continue;
			if (!("value" in inherited))
				throw Object.assign(new Error("Cannot capture compiler input."), {
					code: "ECOMPILERCLONE",
				});
			if (inherited.value === "writeDistractors") throw invalidPrompt();
			break;
		}
	}
	return type?.value === "writeDistractors"
		? constructWriteDistractorsPromptBlock(input)
		: undefined;
}

/** The closed generic record. Full Content is never accepted here. */
export function constructWriteDistractorsPromptBlock(input: unknown): WriteDistractorsPromptBlock {
	try {
		assertPlain(input);
		const block = record(input);
		onlyKeys(block, promptBlockKeys);
		if (block.type !== "writeDistractors") throw invalidPrompt();
		const data = record(block.data);
		onlyKeys(data, dataKeys);
		const content = record(data.content);
		onlyKeys(content, ["question", "count", "items"]);
		const question = nonblank(content.question);
		if ([...question].length > schema.properties.question.maxLength) throw invalidPrompt();
		const count = content.count;
		if (
			typeof count !== "number" ||
			!Number.isInteger(count) ||
			!settings.count.accepts(String(count))
		)
			throw invalidPrompt();
		const items = content.items;
		if (
			!Array.isArray(items) ||
			items.length < schema.properties.misconceptions.minItems ||
			Object.keys(items).length !== items.length ||
			Object.keys(items).some((key, index) => key !== String(index))
		)
			throw invalidPrompt();
		const ids = new Set<string>();
		const identity = schema.properties.misconceptions.items.properties.id;
		const promptItems = items.map((item) => {
			const entry = record(item);
			onlyKeys(entry, ["id"]);
			const id = nonblank(entry.id);
			if (
				id === identity.not.const ||
				id.length > identity.maxLength ||
				!new RegExp(identity.pattern).test(id) ||
				ids.has(id)
			)
				throw invalidPrompt();
			ids.add(id);
			return { id };
		});
		const level = data.level;
		if (typeof level !== "number" || !Number.isInteger(level)) throw invalidPrompt();
		setting("level", level);
		const result: WriteDistractorsPromptBlock = {
			...constructPromptBlockMetadata(
				block,
				invalidPrompt,
				(value) => setting("name", value) as string,
			),
			id: nonblank(block.id),
			type: "writeDistractors",
			data: {
				content: { question, count: count as WriteDistractorsPrompt["count"], items: promptItems },
				level,
			},
		};
		for (const key of ["layoutMode", "hide", "visible", "entrance"] as const) {
			if (Object.hasOwn(data, key))
				Object.assign(result.data, {
					[key]: setting(toSourceParameter("write-distractors", key, data[key]).key, data[key]),
				});
		}
		return result;
	} catch {
		throw invalidPrompt();
	}
}

/** Validate raw defaults before canonicalisation can discard hidden/unknown fields.
 * Count belongs to the source prompt, so defaults cannot introduce another count. */
export function constructWriteDistractorsDefaults(
	defaults: unknown,
): Partial<WriteDistractorsData> | undefined {
	if (!defaults || typeof defaults !== "object") return undefined;
	try {
		const map = defaults as Record<string, unknown>;
		let result: Partial<WriteDistractorsData> | undefined;
		for (const alias of ["writeDistractors", "write-distractors"]) {
			const descriptor = Object.getOwnPropertyDescriptor(map, alias);
			if (!descriptor) continue;
			if (!("value" in descriptor) || !descriptor.enumerable) throw invalidPrompt();
			assertPlain(descriptor.value);
			const raw = record(descriptor.value);
			onlyKeys(raw, ["width", "layoutMode", "hide", "visible", "entrance", "level"]);
			const validated: Partial<WriteDistractorsData> = {};
			for (const [key, value] of Object.entries(raw)) {
				const sourceKey = toSourceParameter("write-distractors", key, value).key;
				Object.assign(validated, {
					[sourceKey === "width" ? "layoutMode" : sourceKey]: setting(sourceKey, value),
				});
			}
			result = validated;
		}
		return result;
	} catch {
		throw invalidPrompt();
	}
}
