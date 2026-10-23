import { isInlineProjectionMetadataKey } from "@praxity/shared-blocks/inline-markdown";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import {
	copyWriteDistractorsContent,
	type WriteDistractorsAssetReference,
	writeDistractorsContentRevision,
} from "@praxity/shared-blocks/write-distractors-content";
import type { Content } from "learning-patterns/patterns/write-distractors/logic.js";
import {
	type AuthoredContentAsset,
	encodeAuthoredContentAsset,
	writeAuthoredContentAssets,
} from "./authored-content-asset.ts";
import type { CourseArtifactFile, WriteDistractorsContentInput } from "./build.ts";
import { escapeHtml } from "./published-markup";

export type WriteDistractorsAuthoredContent = Content;
declare const capture: unique symbol;
/** Private authored bytes cannot be serialized with a compiler context. */
export interface WriteDistractorsRuntime {
	readonly [capture]: true;
}
export type { WriteDistractorsAssetReference } from "@praxity/shared-blocks/write-distractors-content";

interface RuntimeAsset extends WriteDistractorsAssetReference, AuthoredContentAsset {}
const captures = new WeakMap<
	WriteDistractorsRuntime,
	{
		inputs: WriteDistractorsContentInput[];
		assets: RuntimeAsset[];
		refused: ReadonlySet<string>;
	}
>();
function refuse(kind: "invalid" | "duplicate" | "orphaned" | "missing" | "revision"): never {
	const code = `write-distractors-content-${kind}`;
	throw Object.assign(new Error(code), { code });
}

// Inspect before copying: structuredClone would discard unknown own keys and prototypes.
function record(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
	if (
		!value ||
		typeof value !== "object" ||
		![Object.prototype, null].includes(Object.getPrototypeOf(value))
	)
		refuse("invalid");
	const own = Reflect.ownKeys(value);
	if (
		own.length !== keys.length ||
		own.some((key) => typeof key !== "string" || !keys.includes(key))
	)
		refuse("invalid");
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) refuse("invalid");
	}
}
function array(value: unknown): asserts value is unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) refuse("invalid");
	if (Reflect.ownKeys(value).length !== value.length + 1) refuse("invalid");
	for (let index = 0; index < value.length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) refuse("invalid");
	}
}
export function writeDistractorsContentInput(
	blockId: string,
	value: Content,
): WriteDistractorsContentInput {
	if (typeof blockId !== "string" || !blockId.trim()) refuse("invalid");
	const content = copyWriteDistractorsContent(value);
	return { blockId, contentRevision: writeDistractorsContentRevision(content), content };
}
export function captureWriteDistractorsRuntime(course: {
	writeDistractorsContents?: readonly WriteDistractorsContentInput[];
}): WriteDistractorsRuntime {
	const descriptor = Object.getOwnPropertyDescriptor(course, "writeDistractorsContents");
	if (descriptor && (!("value" in descriptor) || !descriptor.enumerable)) refuse("invalid");
	if (!descriptor && "writeDistractorsContents" in course) refuse("invalid");
	const inputs = descriptor?.value === undefined ? [] : descriptor.value;
	array(inputs);
	const seen = new Set<string>();
	const copied = inputs.map((input) => {
		record(input, ["blockId", "contentRevision", "content"]);
		if (typeof input.blockId !== "string") refuse("invalid");
		if (seen.has(input.blockId)) refuse("duplicate");
		seen.add(input.blockId);
		const copy = writeDistractorsContentInput(input.blockId, input.content as Content);
		if (copy.contentRevision !== input.contentRevision) refuse("revision");
		return copy;
	});
	const runtime = Object.freeze({}) as WriteDistractorsRuntime;
	captures.set(runtime, { inputs: copied, assets: [], refused: new Set() });
	return runtime;
}
function retained(runtime: WriteDistractorsRuntime) {
	const value = captures.get(runtime);
	if (!value) refuse("invalid");
	return value;
}
function activities(value: unknown, refused?: ReadonlySet<string>): PraxityBlock[] {
	if (!value || typeof value !== "object") return [];
	if ("type" in value && "id" in value && typeof value.id === "string" && refused?.has(value.id))
		return [];
	if ("type" in value && value.type === "writeDistractors") return [value as PraxityBlock];
	return Object.entries(value).flatMap(([key, child]) =>
		isInlineProjectionMetadataKey(key, { keepDisplay: true }) ? [] : activities(child, refused),
	);
}
export function admitWriteDistractorsRuntime(
	pages: readonly PraxityPage[],
	runtime: WriteDistractorsRuntime,
	refused: ReadonlySet<string> = new Set(),
): WriteDistractorsRuntime {
	const captured = retained(runtime);
	const { inputs } = captured;
	// A later context cannot resurrect content refused by this capture.
	refused = new Set([...captured.refused, ...refused]);
	const blocks = activities(pages);
	const ids = new Set(blocks.map((block) => block.id));
	const eligible = refused.size
		? new Set(activities(pages, refused).map((block) => block.id))
		: ids;
	if (inputs.some((input) => !ids.has(input.blockId))) refuse("orphaned");
	const entries = new Map(inputs.map((input) => [input.blockId, input]));
	const seen = new Set<string>();
	const assets: RuntimeAsset[] = [];
	for (const block of blocks) {
		if (seen.has(block.id)) refuse("duplicate");
		seen.add(block.id);
		const input = entries.get(block.id);
		if (!input) {
			if (!eligible.has(block.id)) continue;
			refuse("missing");
		}
		const prompt = block.data.content as {
			question: string;
			count: number;
			items: { id: string }[];
		};
		if (
			input.content.question !== prompt.question ||
			input.content.count !== prompt.count ||
			JSON.stringify(input.content.misconceptions.map((item) => item.id)) !==
				JSON.stringify(prompt.items.map((item) => item.id))
		)
			refuse("revision");
		if (!eligible.has(block.id)) continue;
		assets.push({
			blockId: block.id,
			contentRevision: input.contentRevision,
			...encodeAuthoredContentAsset("write-distractors", "__praxityWriteDistractorsAsset", input),
		});
	}
	const admitted = Object.freeze({}) as WriteDistractorsRuntime;
	captures.set(admitted, { inputs, assets, refused });
	return admitted;
}
export function writeDistractorsRuntimeAssets(
	runtime: WriteDistractorsRuntime,
): readonly RuntimeAsset[] {
	return retained(runtime).assets.map((asset) => ({
		...asset,
		bytes: Buffer.from(asset.bytes),
		manifest: { ...asset.manifest },
	}));
}
export function writeWriteDistractorsAssets(
	runtime: WriteDistractorsRuntime,
	distDir: string,
): Promise<CourseArtifactFile[]> {
	return writeAuthoredContentAssets(retained(runtime).assets, distDir);
}
export function writeDistractorsAssetReferences(
	runtime: WriteDistractorsRuntime,
): WriteDistractorsAssetReference[] {
	return retained(runtime).assets.map(({ blockId, contentRevision, path, sha256 }) => ({
		blockId,
		contentRevision,
		path,
		sha256,
	}));
}
export function writeDistractorsPageAssets(
	runtime: WriteDistractorsRuntime,
	blocks: readonly PraxityBlock[],
): WriteDistractorsAssetReference[] {
	const ids = new Set(activities(blocks).map((block) => block.id));
	return writeDistractorsAssetReferences(runtime).filter((asset) => ids.has(asset.blockId));
}

/** Bind only references owned by this admitted page; full Content stays in its asset. */
export function bindWriteDistractorsAssets(
	html: string,
	runtime: WriteDistractorsRuntime,
	blocks: readonly PraxityBlock[],
): string {
	const references = new Map(
		writeDistractorsPageAssets(runtime, blocks).map((reference) => [
			escapeHtml(reference.blockId),
			reference,
		]),
	);
	return html.replace(/data-distractor-id="([^"]*)"/g, (attribute, id: string) => {
		const reference = references.get(id);
		return reference
			? `${attribute} data-distractor-src="${escapeHtml(reference.path)}" data-distractor-revision="${escapeHtml(reference.contentRevision)}"`
			: attribute;
	});
}
