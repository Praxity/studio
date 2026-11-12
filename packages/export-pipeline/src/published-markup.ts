import { escapeHtml } from "@praxity/content-model/constants";
import { isSafeEmbedUrl, isSafeUrl } from "@praxity/grammar";
import {
	admitWriteDistractorsPrompt,
	constructSelfCheckPromptBlock,
} from "@praxity/shared-blocks/grammar-adapter";
import {
	getInlineField,
	isInlineProjectionMetadataKey,
	renderInlineIcons,
} from "@praxity/shared-blocks/inline-markdown";
import { processMathSpans } from "@praxity/shared-blocks/math";
import { sanitizeHtml } from "@praxity/shared-blocks/sanitize";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { isEmbeddableUrl, toEmbedUrl } from "@praxity/shared-blocks/video-url-utils";

export { escapeHtml };

export function camelToKebab(str: string): string {
	return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

export function sanitizeInline(value: unknown, interactive = true): string {
	if (typeof value !== "string") return "";
	return processMathSpans(
		renderInlineIcons(sanitizeHtml(value, interactive ? undefined : { interactive: false })),
	);
}

export function renderInlineField(
	owner: unknown,
	path: string | readonly (string | number)[],
	interactive = true,
): string {
	return processMathSpans(sanitizeHtml(getInlineField(owner, path, interactive), { interactive }));
}

const SAFE_DATA_MIME = /^data:image\/(?!svg\+xml)/i;
const RAW_TEXT_KEYS = new Set([
	"code",
	"latex",
	"language",
	"href",
	"src",
	"alt",
	"altText",
	"attribution",
	"speaker",
	"work",
	"title",
	"label",
	"caption",
	"chartType",
	"xLabel",
	"yLabel",
	"name",
]);
/** URL keys that may appear as <img>/<audio>/<video> src — allow data:image/* */
const MEDIA_URL_KEYS = new Set(["src", "source", "background", "imageSrc", "avatar"]);
/** URL keys that appear as <a href> — block ALL data: URIs */
const HREF_URL_KEYS = new Set(["href", "url", "sourceUrl"]);

export function sanitizeUrl(url: string): string {
	const trimmed = url.trim();
	return isSafeUrl(trimmed, SAFE_DATA_MIME) ? trimmed : "#";
}

/** Stricter variant for <a href> — blocks ALL data: URIs (SVG scripts execute on navigation). */
export function sanitizeHref(url: string): string {
	const trimmed = url.trim();
	return isSafeUrl(trimmed) ? trimmed : "#";
}

export function sanitizeEmbedUrl(url: string): string {
	const candidate = sanitizeUrl(url);
	if (candidate === "#") return "";
	return isSafeEmbedUrl(candidate) ? candidate : "";
}

export function normalizeEmbedUrl(url: string): string {
	const normalized = toEmbedUrl(url);
	return isEmbeddableUrl(normalized) ? sanitizeEmbedUrl(normalized) : "";
}

function sanitizeForJsonValue(value: unknown, key?: string): unknown {
	if (typeof value === "string") {
		if (key && HREF_URL_KEYS.has(key)) {
			return sanitizeHref(value);
		}
		if (key && MEDIA_URL_KEYS.has(key)) {
			return sanitizeUrl(value);
		}
		if (key && RAW_TEXT_KEYS.has(key)) {
			return value;
		}
		return sanitizeHtml(value, { renderInlineIcons: false });
	}
	if (Array.isArray(value)) {
		return value.map((entry) => sanitizeForJsonValue(entry));
	}
	if (value && typeof value === "object") {
		const distractors = admitWriteDistractorsPrompt(value);
		if (distractors) return distractors;
		const block = value as PraxityBlock;
		if (block.type === "selfCheck") return constructSelfCheckPromptBlock(block);
		if (
			(block.type === "retrievalSheet" || block.type === "highlight") &&
			block.data &&
			typeof block.data === "object"
		) {
			// All authored fields are public plain text, including HTML-looking answers.
			// Preserve them before the pattern renderer escapes them; sanitize settings only.
			const { content, ...settings } = block.data;
			return {
				...block,
				data: { ...(sanitizeForJsonValue(settings) as Record<string, unknown>), content },
			};
		}
		// A logic rule's source ("variable:score", "block:q1") is a reference the runtime resolves,
		// never a URL, so the media URL policy for the "source" key does not apply to it.
		const logicRule = typeof (value as { comparison?: unknown }).comparison === "string";
		const result: Record<string, unknown> = {};
		for (const [entryKey, entryValue] of Object.entries(value)) {
			if (entryKey === "_foldedPageTitle") continue;
			if (isInlineProjectionMetadataKey(entryKey, { keepDisplay: true })) continue;
			result[entryKey] =
				logicRule && entryKey === "source" && typeof entryValue === "string"
					? entryValue
					: sanitizeForJsonValue(entryValue, entryKey);
		}
		return result;
	}
	return value;
}

export function sanitizeBlockForJson(block: PraxityBlock): PraxityBlock {
	const distractors = admitWriteDistractorsPrompt(block);
	if (distractors) return distractors;
	if (block.type === "retrievalSheet" || block.type === "highlight")
		return sanitizeForJsonValue(block) as PraxityBlock;
	if (block.type === "selfCheck") return constructSelfCheckPromptBlock(block);
	return {
		...block,
		data: sanitizeForJsonValue(block.data) as PraxityBlock["data"],
	};
}
