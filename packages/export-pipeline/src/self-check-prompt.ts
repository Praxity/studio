import { isProxy } from "node:util/types";
import {
	admitWriteDistractorsPrompt,
	constructSelfCheckDefaults,
	constructSelfCheckPromptBlock,
	constructWriteDistractorsDefaults,
} from "@praxity/shared-blocks/grammar-adapter";
import { isInlineProjectionMetadataKey } from "@praxity/shared-blocks/inline-markdown";

// Stage discriminators without changing caller records. Native cloning still owns
// host objects and clone failures; descriptors keep prompt data intact for admission.
function captureBlockTypes(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
	if (!value || typeof value !== "object") return value;
	if (seen.has(value)) return seen.get(value);
	if (isProxy(value)) return value;
	if (
		!Array.isArray(value) &&
		!(value instanceof Map) &&
		!(value instanceof Set) &&
		![Object.prototype, null].includes(Object.getPrototypeOf(value))
	)
		return value;
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const type = descriptors.type;
	if (type?.enumerable && !("value" in type)) {
		let captured: unknown;
		try {
			captured = Reflect.get(value, "type");
		} catch {
			throw Object.assign(new Error("Cannot capture compiler input."), { code: "ECOMPILERCLONE" });
		}
		descriptors.type = { value: captured, enumerable: true, configurable: true, writable: true };
	}
	const staged = Array.isArray(value)
		? []
		: value instanceof Map
			? new Map()
			: value instanceof Set
				? new Set()
				: Object.create(Object.getPrototypeOf(value));
	seen.set(value, staged);
	// Route before visiting owned data: its getters and erased properties must
	// reach the closed constructor untouched.
	if (descriptors.type?.value === "writeDistractors") {
		Object.defineProperties(staged, descriptors);
		const prompt = admitWriteDistractorsPrompt(staged);
		seen.set(value, prompt);
		return prompt;
	}
	if (value instanceof Map) {
		for (const [key, child] of Map.prototype.entries.call(value))
			staged.set(captureBlockTypes(key, seen), captureBlockTypes(child, seen));
	} else if (value instanceof Set) {
		for (const child of Set.prototype.values.call(value))
			staged.add(captureBlockTypes(child, seen));
	}
	for (const key of Reflect.ownKeys(descriptors)) {
		if (Array.isArray(value) && key === "length") continue;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor) continue;
		const captured = key === "type" ? descriptors.type : descriptor;
		descriptors[key as string] = {
			...captured,
			...("value" in captured
				? { value: captureBlockTypes(captured.value, seen) }
				: { get: captured.get?.bind(value) }),
		};
	}
	Object.defineProperties(staged, descriptors);
	return staged;
}

/** Replace staged-answer prompts in a compiler-owned snapshot, including Map/Set entries. */
export function constructSelfCheckPromptData<T>(value: T, componentDefaults?: unknown): T {
	const seen = new WeakMap<object, unknown>();
	let defaultsValidated = false;
	let distractorsDefaultsValidated = false;
	return construct(value);

	function construct<T>(value: T): T {
		if (!value || typeof value !== "object") return value;
		if (seen.has(value)) return seen.get(value) as T;
		const distractors = admitWriteDistractorsPrompt(value);
		if (distractors) {
			if (!distractorsDefaultsValidated) {
				constructWriteDistractorsDefaults(componentDefaults);
				distractorsDefaultsValidated = true;
			}
			seen.set(value, distractors);
			return distractors as T;
		}
		if ((value as { type?: unknown }).type === "selfCheck") {
			const block = constructSelfCheckPromptBlock(value);
			if (!defaultsValidated) {
				constructSelfCheckDefaults(componentDefaults);
				defaultsValidated = true;
			}
			seen.set(value, block);
			return block as T;
		}
		seen.set(value, value);
		if (value instanceof Map) {
			const entries = [...value];
			value.clear();
			for (const [key, child] of entries) value.set(construct(key), construct(child));
		} else if (value instanceof Set) {
			const entries = [...value];
			value.clear();
			for (const child of entries) value.add(construct(child));
		} else {
			const record = value as Record<string, unknown>;
			for (const key of Object.keys(record))
				if (!isInlineProjectionMetadataKey(key, { keepDisplay: true }))
					record[key] = construct(record[key]);
		}
		return value;
	}
}

// structuredClone drops symbol and nonenumerable properties. Preserve self-check refusals,
// without evaluating getters a second time or using live values in the compiler.
function assertCloneProperties(
	value: unknown,
	seen = new WeakMap<object, boolean>(),
	selfCheck = false,
): void {
	if (!value || typeof value !== "object") return;
	if (admitWriteDistractorsPrompt(value)) return;

	selfCheck ||= Object.getOwnPropertyDescriptor(value, "type")?.value === "selfCheck";
	if (seen.get(value) === true || seen.get(value) === selfCheck) return;
	seen.set(value, selfCheck);
	if (value instanceof Map) {
		for (const [key, child] of Map.prototype.entries.call(value)) {
			assertCloneProperties(key, seen, selfCheck);
			assertCloneProperties(child, seen, selfCheck);
		}
	} else if (value instanceof Set) {
		for (const child of Set.prototype.values.call(value))
			assertCloneProperties(child, seen, selfCheck);
	}
	for (const key of Reflect.ownKeys(value)) {
		if (Array.isArray(value) && key === "length") continue;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (selfCheck && (typeof key !== "string" || !descriptor?.enumerable))
			throw Object.assign(new Error("Invalid self-check prompt data."), {
				code: "ESELFCHECKPROMPT",
			});
		if (descriptor && "value" in descriptor)
			assertCloneProperties(descriptor.value, seen, selfCheck);
	}
}

export function cloneAdmittedSelfCheckData<T>(value: T, componentDefaults?: unknown): T {
	const captured = captureBlockTypes(value);
	assertCloneProperties(captured);
	let clone: T;
	try {
		clone = structuredClone(captured) as T;
	} catch {
		throw Object.assign(new Error("Cannot capture compiler input."), { code: "ECOMPILERCLONE" });
	}
	return constructSelfCheckPromptData(clone, componentDefaults);
}
