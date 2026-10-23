import { canonicalComponentDefaults, toModelParameter, toSourceParameter } from "@praxity/grammar";
import { BLOCK_SCHEMA } from "@praxity/grammar/src/v4/schema.ts";
import { constructPromptBlockMetadata, promptBlockKeys } from "./prompt-block-metadata";
import type { PraxityBlock, SelfCheckPrompt } from "./types";

type Scalar = string | number | boolean;
export type SelfCheckPromptBlock = Omit<PraxityBlock, "type" | "data"> & {
	type: "selfCheck";
	data: { content: SelfCheckPrompt; [key: string]: SelfCheckPrompt | Scalar };
};
const settings = BLOCK_SCHEMA["self-check"].settings;

function invalidPrompt(): Error {
	return Object.assign(new Error("Invalid self-check prompt data."), { code: "ESELFCHECKPROMPT" });
}
function record(value: unknown): Record<string, unknown> {
	if (
		!value ||
		typeof value !== "object" ||
		![Object.prototype, null].includes(Object.getPrototypeOf(value))
	)
		throw invalidPrompt();
	return value as Record<string, unknown>;
}
function onlyKeys(value: object, keys: readonly string[]): void {
	if (
		Reflect.ownKeys(value).some(
			(key) =>
				typeof key !== "string" ||
				!keys.includes(key) ||
				!Object.getOwnPropertyDescriptor(value, key)?.enumerable,
		)
	)
		throw invalidPrompt();
}
function nonblank(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) throw invalidPrompt();
	return value;
}
function scalarSetting(key: string, value: unknown): Scalar {
	if (
		!Object.hasOwn(settings, key) ||
		(typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
	)
		throw invalidPrompt();
	const definition = settings[key];
	const numeric = definition.type === "integer" || definition.type === "number";
	if (typeof value === "number" && !numeric) throw invalidPrompt();
	if (!definition.accepts(typeof value === "number" ? String(value) : value)) throw invalidPrompt();
	if (numeric) return Number(value);
	if (definition.type === "boolean") return value === true || value === "true";
	// A future object-valued schema setting must not broaden this record.
	if (typeof value !== "string") throw invalidPrompt();
	return value;
}

/** Construct the closed published record. No input object is retained. */
export function constructSelfCheckPromptBlock(input: unknown): SelfCheckPromptBlock {
	try {
		const block = record(input);
		onlyKeys(block, promptBlockKeys);
		if (block.type !== "selfCheck") throw invalidPrompt();
		const data = record(block.data);
		const runtimeKeys = Object.keys(settings).map(
			(key) => toModelParameter("self-check", key, undefined).key,
		);
		onlyKeys(data, ["content", ...runtimeKeys]);
		const content = record(data.content);
		onlyKeys(content, ["task", "parts"]);
		const parts = content.parts;
		if (
			!Array.isArray(parts) ||
			!parts.length ||
			Reflect.ownKeys(parts).length !== parts.length + 1 ||
			Object.keys(parts).some((key, index) => key !== String(index))
		)
			throw invalidPrompt();
		const criterionIds: SelfCheckPrompt["parts"] = [];
		const partCount = parts.length;
		for (let index = 0; index < partCount; index++) {
			const part = record(parts[index]);
			onlyKeys(part, ["id"]);
			criterionIds.push({ id: nonblank(part.id) });
		}
		const result: SelfCheckPromptBlock = {
			id: nonblank(block.id),
			type: "selfCheck",
			data: {
				content: {
					task: nonblank(content.task),
					parts: criterionIds,
				},
			},
		};
		for (const key of Object.keys(data)) {
			if (key === "content") continue;
			const value = data[key];
			result.data[key] = scalarSetting(toSourceParameter("self-check", key, value).key, value);
		}
		Object.assign(
			result,
			constructPromptBlockMetadata(
				block,
				invalidPrompt,
				(value) => scalarSetting("name", value) as string,
			),
		);
		return result;
	} catch {
		throw invalidPrompt();
	}
}

/** Validate raw aliases before canonicalisation can discard them, even when overridden. */
export function constructSelfCheckDefaults(defaults: unknown): Record<string, Scalar> | undefined {
	if (!defaults || typeof defaults !== "object") return undefined;
	try {
		const map = defaults as Record<string, unknown>;
		const constructed: Record<string, Record<string, Scalar>> = {};
		for (const keyword of ["selfCheck", "self-check"]) {
			if (!Object.hasOwn(map, keyword)) continue;
			const raw = record(map[keyword]);
			const validated: Record<string, Scalar> = {};
			for (const key of Reflect.ownKeys(raw)) {
				if (typeof key !== "string" || !Object.getOwnPropertyDescriptor(raw, key)?.enumerable)
					throw invalidPrompt();
				const value = raw[key];
				const sourceKey =
					key === "layout" ? "width" : toSourceParameter("self-check", key, value).key;
				validated[key] = scalarSetting(sourceKey, value);
			}
			const canonical = canonicalComponentDefaults({ [keyword]: validated }) as Record<
				string,
				Record<string, Scalar>
			>;
			constructed[keyword] = Object.fromEntries(
				Object.entries(canonical[keyword]).map(([key, value]) => [
					toModelParameter("self-check", key, value).key,
					value,
				]),
			);
		}
		return constructed["self-check"] ?? constructed.selfCheck;
	} catch {
		throw invalidPrompt();
	}
}
