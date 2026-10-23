import { isInlineProjectionMetadataKey } from "@praxity/shared-blocks/inline-markdown";
import { flattenLogicBlocks } from "@praxity/shared-blocks/logic/flatten-blocks";
import {
	type DependencyRule,
	selfCheckDependencies,
} from "@praxity/shared-blocks/logic/self-check-dependencies";
import { selfCheckContentRevision } from "@praxity/shared-blocks/self-check-state";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import { type Content, validateContent } from "learning-patterns/patterns/self-check/logic.js";
import {
	encodeAuthoredContentAsset,
	writeAuthoredContentAssets,
} from "./authored-content-asset.ts";
import type { CourseArtifactFile, SelfCheckContentInput } from "./build.ts";
import { blockRequiresPageGate } from "./runtime-plan";
export type SelfCheckAuthoredContent = Content;

declare const capture: unique symbol;
/** Authored bytes live in the owner, never on a serializable compiler context. */
export interface SelfCheckRuntime {
	readonly [capture]: true;
}
export interface SelfCheckAssetReference {
	readonly blockId: string;
	readonly contentRevision: string;
	readonly path: string;
	readonly sha256: string;
}
interface RuntimeAsset extends SelfCheckAssetReference {
	readonly bytes: Buffer;
	readonly manifest: CourseArtifactFile;
}
const captures = new WeakMap<
	SelfCheckRuntime,
	{ inputs: SelfCheckContentInput[]; assets: RuntimeAsset[]; refused: ReadonlySet<string> }
>();
function refuse(code: string): never {
	throw Object.assign(new Error(code), { code });
}
function contentCopy(value: Content): Content {
	try {
		const content = structuredClone(value);
		validateContent(content);
		if (Object.hasOwn(content, "context")) refuse("self-check-content-invalid");
		return {
			task: content.task,
			model: content.model,
			parts: content.parts.map((part) => ({
				id: part.id,
				label: part.label,
				missed: part.missed,
				evidence: part.evidence,
			})),
		};
	} catch {
		return refuse("self-check-content-invalid");
	}
}

export function selfCheckContentInput(blockId: string, value: Content): SelfCheckContentInput {
	const content = contentCopy(value);
	return { blockId, contentRevision: selfCheckContentRevision(content), content };
}
export function captureSelfCheckRuntime(course: {
	selfCheckContents?: readonly SelfCheckContentInput[];
}): SelfCheckRuntime {
	let inputs = course.selfCheckContents ?? [];
	try {
		inputs = structuredClone(inputs);
	} catch {
		refuse("self-check-content-invalid");
	}
	if (!Array.isArray(inputs)) refuse("self-check-content-invalid");
	const seen = new Set<string>();
	const captured = inputs.map((input) => {
		if (
			!input ||
			typeof input.blockId !== "string" ||
			!input.blockId.trim() ||
			Object.keys(input).some((key) => !["blockId", "contentRevision", "content"].includes(key))
		)
			refuse("self-check-content-invalid");
		if (seen.has(input.blockId)) refuse("self-check-content-duplicate");
		seen.add(input.blockId);
		const copy = selfCheckContentInput(input.blockId, input.content);
		if (copy.contentRevision !== input.contentRevision) refuse("self-check-content-revision");
		return copy;
	});
	const runtime = Object.freeze({}) as SelfCheckRuntime;
	captures.set(runtime, { inputs: captured, assets: [], refused: new Set() });
	return runtime;
}
function selfChecks(value: unknown, refused?: ReadonlySet<string>): PraxityBlock[] {
	if (!value || typeof value !== "object") return [];
	if ("type" in value && "id" in value && typeof value.id === "string" && refused?.has(value.id))
		return [];
	if ("type" in value && value.type === "selfCheck") return [value as PraxityBlock];
	return Object.entries(value).flatMap(([key, child]) =>
		isInlineProjectionMetadataKey(key, { keepDisplay: true }) ? [] : selfChecks(child, refused),
	);
}
function retained(runtime: SelfCheckRuntime) {
	const retained = captures.get(runtime);
	if (!retained) refuse("self-check-content-invalid");
	return retained;
}
export function admitSelfCheckRuntime(
	pages: readonly PraxityPage[],
	runtime: SelfCheckRuntime,
	refused: ReadonlySet<string> = new Set(),
): SelfCheckRuntime {
	const captured = retained(runtime);
	const inputs = captured.inputs;
	// A publishing-context rebuild cannot re-admit an activity refused at capture.
	refused = new Set([...captured.refused, ...refused]);
	const entries = new Map(inputs.map((input) => [input.blockId, input]));
	const blocks = selfChecks(pages);
	const blockIds = new Set(blocks.map((block) => block.id));
	const eligible = refused.size
		? new Set(selfChecks(pages, refused).map((block) => block.id))
		: blockIds;
	if (inputs.some((input) => !blockIds.has(input.blockId))) refuse("self-check-content-orphaned");
	const seen = new Set<string>();
	const assets: RuntimeAsset[] = [];
	for (const block of blocks) {
		if (seen.has(block.id)) refuse("self-check-content-duplicate");
		seen.add(block.id);
		const input = entries.get(block.id);
		if (!input) {
			if (!eligible.has(block.id)) continue;
			refuse("self-check-content-missing");
		}
		const prompt = block.data.content as { task: string; parts: { id: string }[] };
		if (
			input.content.task !== prompt.task ||
			JSON.stringify(input.content.parts.map((part) => part.id)) !==
				JSON.stringify(prompt.parts.map((part) => part.id))
		)
			refuse("self-check-content-revision");
		if (!eligible.has(block.id)) continue;
		assets.push({
			blockId: block.id,
			contentRevision: input.contentRevision,
			...encodeAuthoredContentAsset("self-check", "__praxitySelfCheckAsset", input),
		});
	}
	const admitted = Object.freeze({}) as SelfCheckRuntime;
	captures.set(admitted, { inputs, assets, refused });
	return admitted;
}
export function selfCheckRuntimeAssets(runtime: SelfCheckRuntime): readonly RuntimeAsset[] {
	return retained(runtime).assets.map((asset) => ({
		...asset,
		bytes: Buffer.from(asset.bytes),
		manifest: { ...asset.manifest },
	}));
}
export async function writeSelfCheckAssets(
	runtime: SelfCheckRuntime,
	distDir: string,
): Promise<CourseArtifactFile[]> {
	return writeAuthoredContentAssets(retained(runtime).assets, distDir);
}
/** Generic compiler callers receive references, never authored bytes. */
export function selfCheckAssetReferences(runtime: SelfCheckRuntime): SelfCheckAssetReference[] {
	return retained(runtime).assets.map(({ blockId, contentRevision, path, sha256 }) => ({
		blockId,
		contentRevision,
		path,
		sha256,
	}));
}
export function selfCheckPageAssets(
	runtime: SelfCheckRuntime,
	blocks: readonly PraxityBlock[],
): SelfCheckAssetReference[] {
	if (!retained(runtime).assets.length) return [];
	const ids = new Set(selfChecks(blocks).map((block) => block.id));
	return retained(runtime)
		.assets.filter((asset) => ids.has(asset.blockId))
		.map(({ blockId, contentRevision, path, sha256 }) => ({
			blockId,
			contentRevision,
			path,
			sha256,
		}));
}
function attribute(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
export function bindSelfCheckAssets(
	html: string,
	runtime: SelfCheckRuntime,
	blocks: readonly PraxityBlock[],
): string {
	if (!html.includes('data-self-check-id="')) return html;
	const captured = retained(runtime);
	const current = new Map(selfChecks(blocks).map((block) => [block.id, block.data.content]));
	const assets = new Map(
		captured.assets
			.filter((asset) => {
				const input = captured.inputs.find((input) => input.blockId === asset.blockId);
				if (!input) refuse("self-check-content-missing");
				return (
					JSON.stringify(current.get(asset.blockId)) ===
					JSON.stringify({
						task: input.content.task,
						parts: input.content.parts.map((part) => ({ id: part.id })),
					})
				);
			})
			.map((asset) => [attribute(asset.blockId), asset]),
	);
	return html.replace(/data-self-check-id="([^"]*)"/g, (match, id: string) => {
		const asset = assets.get(id);
		return asset
			? `${match} data-self-check-src="${asset.path}" data-self-check-revision="${asset.contentRevision}"`
			: match;
	});
}

/** The compiler supplies content-free course references, including other modules' gates. */
export function bindSelfCheckDocument(
	html: string,
	runtime: SelfCheckRuntime,
	pages: readonly PraxityPage[],
): string {
	let requiredIds: string[] = [];
	html = html.replace(
		/(<script id="praxity-config" type="application\/json">)([\s\S]*?)(<\/script>)/,
		(_match, open: string, json: string, close: string) => {
			const config = JSON.parse(json);
			const blocks = flattenLogicBlocks(pages.flatMap((page) => page.blocks));
			const local = flattenLogicBlocks(config.blocks ?? []);
			const writers = blocks
				.filter((block) => block.type === "logic")
				.map((block) => ({ ...block.data, blockId: block.id }) as unknown as DependencyRule);
			const rules: DependencyRule[] = [
				...(config.logic?.rules ?? []),
				...(config.logic?.visibility ?? []).map(
					(entry: { conditions: DependencyRule["conditions"] }) => ({ ...entry, actions: [] }),
				),
			];
			const dependencies = new Set(
				rules.flatMap((rule) => selfCheckDependencies(blocks, [...rules, ...writers], rule)),
			);
			for (const block of local)
				if (block.type === "selfCheck" && blockRequiresPageGate(block as PraxityBlock))
					dependencies.add(block.id);
			for (const page of config.deckPages ?? [])
				for (const gate of page.gates)
					if (blocks.some((block) => block.id === gate.id && block.type === "selfCheck"))
						dependencies.add(gate.id);
			const selected = new Set([
				...dependencies,
				...local.filter((block) => block.type === "selfCheck").map((block) => block.id),
			]);
			if (!selected.size) return open + json + close;
			if (rules.length) config.logic.dependencyRules = writers;
			config.selfChecks = {
				dependencies: [...dependencies],
				references: selfCheckAssetReferences(runtime)
					.filter((reference) => selected.has(reference.blockId))
					.map((reference) => ({
						...reference,
						independent: dependencies.size > 0 && !dependencies.has(reference.blockId),
						ownerHref: `${config.pageIdMap?.[pages.find((page) => flattenLogicBlocks(page.blocks).some((block) => block.id === reference.blockId))?.id ?? ""] ?? ""}.html`,
					})),
			};
			requiredIds = config.selfChecks.dependencies;
			for (const id of dependencies)
				if (!local.some((block) => block.id === id)) {
					const block = blocks.find((block) => block.id === id);
					if (block)
						config.blocks.push({
							id,
							type: "selfCheck",
							name: block.name,
							data: { name: block.data.name },
						});
				}
			return open + JSON.stringify(config).replaceAll("<", "\\u003c") + close;
		},
	);
	if (requiredIds.length)
		html = html.replace(
			/(<script id="praxity-host-config" type="application\/json">)([\s\S]*?)(<\/script>)/,
			(_match, open: string, json: string, close: string) =>
				open +
				JSON.stringify({ ...JSON.parse(json), deferVisits: true }).replaceAll("<", "\\u003c") +
				close,
		);
	return requiredIds.length
		? html.replace(
				/<html\b/,
				`<html data-self-check-dependencies="${attribute(requiredIds.join(" "))}"`,
			)
		: html;
}
