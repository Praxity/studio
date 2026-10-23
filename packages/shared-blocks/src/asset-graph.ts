import { isInlineProjectionMetadataKey } from "@praxity/content-model/inline-fields";
import { isAvatarNone } from "@praxity/grammar";
import { ASSET_FIELDS } from "./constants";
import type { PraxityBlock, PraxityPage } from "./types";

const DEFAULT_ASSET_FIELDS = new Set<string>(ASSET_FIELDS);

export type AssetGraphPathSegment = string | number;

export interface AssetGraphContext {
	page: PraxityPage;
	pageIndex: number;
	block: PraxityBlock;
	blockIndex: number;
	path: readonly AssetGraphPathSegment[];
	key: string;
	value: string;
}

export interface AssetGraphAdapter {
	onAsset?: (context: AssetGraphContext) => void | Promise<void>;
	rewriteAsset?: (context: AssetGraphContext) => string | undefined | Promise<string | undefined>;
}

export interface TraverseAssetGraphOptions {
	assetFields?: readonly string[];
	shouldSkipBlock?: (block: PraxityBlock, page: PraxityPage) => boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAssetReference(key: string, value: unknown, assetFields: Set<string>): value is string {
	return (
		assetFields.has(key) && typeof value === "string" && !(key === "avatar" && isAvatarNone(value))
	);
}

async function walkValue(
	value: unknown,
	path: AssetGraphPathSegment[],
	context: Omit<AssetGraphContext, "path" | "key" | "value">,
	assetFields: Set<string>,
	onAsset?: (context: AssetGraphContext) => void | Promise<void>,
): Promise<void> {
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			await walkValue(item, [...path, index], context, assetFields, onAsset);
		}
		return;
	}

	if (!isRecord(value)) {
		return;
	}

	for (const [key, child] of Object.entries(value)) {
		if (isInlineProjectionMetadataKey(key, { keepDisplay: true })) continue;
		const nextPath = [...path, key];
		if (isAssetReference(key, child, assetFields)) {
			if (onAsset) {
				await onAsset({ ...context, path: nextPath, key, value: child });
			}
		}

		if (Array.isArray(child) || isRecord(child)) {
			await walkValue(child, nextPath, context, assetFields, onAsset);
		}
	}
}

async function rewriteValue(
	value: unknown,
	path: AssetGraphPathSegment[],
	context: Omit<AssetGraphContext, "path" | "key" | "value">,
	assetFields: Set<string>,
	onAsset?: (context: AssetGraphContext) => void | Promise<void>,
	rewriteAsset?: (context: AssetGraphContext) => string | undefined | Promise<string | undefined>,
): Promise<unknown> {
	if (Array.isArray(value)) {
		return Promise.all(
			value.map((item, index) =>
				rewriteValue(item, [...path, index], context, assetFields, onAsset, rewriteAsset),
			),
		);
	}

	if (!isRecord(value)) {
		return value;
	}

	const result: Record<string, unknown> = Object.fromEntries(
		Object.entries(value).filter(([key]) =>
			isInlineProjectionMetadataKey(key, { keepDisplay: true }),
		),
	);

	for (const [key, child] of Object.entries(value)) {
		if (isInlineProjectionMetadataKey(key, { keepDisplay: true })) continue;
		const nextPath = [...path, key];
		if (isAssetReference(key, child, assetFields)) {
			const assetContext: AssetGraphContext = { ...context, path: nextPath, key, value: child };
			if (onAsset) {
				await onAsset(assetContext);
			}
			if (rewriteAsset) {
				const rewritten = await rewriteAsset(assetContext);
				if (typeof rewritten === "string") {
					result[key] = rewritten;
					continue;
				}
			}
		}

		if (Array.isArray(child) || isRecord(child)) {
			result[key] = await rewriteValue(
				child,
				nextPath,
				context,
				assetFields,
				onAsset,
				rewriteAsset,
			);
			continue;
		}

		result[key] = child;
	}

	return result;
}

export async function traverseAssetGraph(
	pages: PraxityPage[],
	adapter: AssetGraphAdapter,
	options: TraverseAssetGraphOptions = {},
): Promise<PraxityPage[]> {
	const assetFields =
		options.assetFields && options.assetFields.length > 0
			? new Set<string>(options.assetFields)
			: DEFAULT_ASSET_FIELDS;

	if (!adapter.rewriteAsset) {
		for (const [pageIndex, page] of pages.entries()) {
			if (page.data) {
				const block: PraxityBlock = { id: page.id, type: "pageBreak", data: page.data };
				if (!options.shouldSkipBlock?.(block, page))
					await walkValue(
						page.data,
						["data"],
						{ page, pageIndex, block, blockIndex: -1 },
						assetFields,
						adapter.onAsset,
					);
			}
			for (const [blockIndex, block] of page.blocks.entries()) {
				if (options.shouldSkipBlock?.(block, page)) continue;
				await walkValue(
					block.data,
					[],
					{ page, pageIndex, block, blockIndex },
					assetFields,
					adapter.onAsset,
				);
			}
		}
		return pages;
	}

	return Promise.all(
		pages.map(async (page, pageIndex) => ({
			...page,
			...(page.data
				? { data: await rewritePageData(page, pageIndex, assetFields, adapter, options) }
				: {}),
			blocks: await Promise.all(
				page.blocks.map(async (block, blockIndex) => ({
					...block,
					data: options.shouldSkipBlock?.(block, page)
						? block.data
						: ((await rewriteValue(
								block.data,
								[],
								{ page, pageIndex, block, blockIndex },
								assetFields,
								adapter.onAsset,
								adapter.rewriteAsset,
							)) as Record<string, unknown>),
				})),
			),
		})),
	);
}

async function rewritePageData(
	page: PraxityPage,
	pageIndex: number,
	assetFields: Set<string>,
	adapter: AssetGraphAdapter,
	options: TraverseAssetGraphOptions,
): Promise<Record<string, unknown>> {
	const block: PraxityBlock = { id: page.id, type: "pageBreak", data: page.data ?? {} };
	if (options.shouldSkipBlock?.(block, page)) return block.data;
	return (await rewriteValue(
		block.data,
		["data"],
		{ page, pageIndex, block, blockIndex: -1 },
		assetFields,
		adapter.onAsset,
		adapter.rewriteAsset,
	)) as Record<string, unknown>;
}
