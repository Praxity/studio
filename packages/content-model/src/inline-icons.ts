import { escapeHtml } from "./constants";
import { isInlineProjectionMetadataKey, rebindInlineFields } from "./inline-fields";
import { isLiteralTextBlockType } from "./types";

export type InlineIconCatalogs = {
	outline: Record<string, unknown>;
	filled: Record<string, unknown>;
};
type IconNodes = Record<string, unknown>;

const INLINE_ICON_RAW_KEYS = new Set([
	"code",
	"href",
	"src",
	"source",
	"url",
	"sourceUrl",
	"poster",
	"posterSrc",
	"imageSrc",
	"language",
	"id",
	"blockId",
	"pageId",
	"courseId",
	"lessonId",
]);

export function hasInlineIconMarkup(value: unknown, key?: string): boolean {
	if (key && INLINE_ICON_RAW_KEYS.has(key)) return false;
	if (typeof value === "string") {
		return value.includes("data-praxity-inline-icon=");
	}
	if (Array.isArray(value)) return value.some((child) => hasInlineIconMarkup(child, key));
	if (!value || typeof value !== "object") return false;
	if (isLiteralTextBlockType((value as Record<string, unknown>).type)) return false;
	return Object.entries(value).some(
		([entryKey, child]) =>
			entryKey !== "_tablerIconNodes" &&
			!isInlineProjectionMetadataKey(entryKey, { keepDisplay: true }) &&
			hasInlineIconMarkup(child, entryKey),
	);
}

function exportNameCandidates(spec: InlineIconSpec): string[] {
	if (!spec.source.startsWith("Icon")) return [spec.name];
	const body = spec.source.slice(4).replace(/Filled$/, "");
	const conventional = body
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/([A-Za-z])(\d)/g, "$1-$2")
		.toLowerCase();
	return [...new Set([spec.name, conventional, body.toLowerCase()])];
}

function findIconNodes(catalog: IconNodes, spec: InlineIconSpec): unknown {
	for (const candidate of exportNameCandidates(spec)) {
		if (catalog[candidate]) return catalog[candidate];
	}
	return null;
}

function unknownIconFallback(source: string): string {
	return escapeHtml(`@icon{${source}}`);
}

function iconPlaceholderOrFallback(
	source: string,
	spec: InlineIconSpec,
	catalogs: InlineIconCatalogs,
): string {
	const nodes = findIconNodes(catalogs[spec.variant], spec);
	return nodes
		? (inlineIconPlaceholder(source, nodes) ?? unknownIconFallback(source))
		: unknownIconFallback(source);
}

export function materializeInlineIcons(
	value: unknown,
	catalogs: InlineIconCatalogs,
	key?: string,
): unknown {
	if (key && INLINE_ICON_RAW_KEYS.has(key)) return value;
	if (typeof value === "string") {
		return replaceInlineIconMarkup(value, (source, spec, nodes, tag, original) =>
			nodes !== undefined || tag === "svg"
				? original
				: iconPlaceholderOrFallback(source, spec, catalogs),
		);
	}
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index++) {
			value[index] = materializeInlineIcons(value[index], catalogs, key);
		}
		return value;
	}
	if (!value || typeof value !== "object") return value;
	const record = value as Record<string, unknown>;
	if (isLiteralTextBlockType(record.type)) return value;
	const before = {
		...record,
		_inline: record._inline && { ...(record._inline as Record<string, unknown>) },
	};
	for (const [key, child] of Object.entries(record)) {
		if (key !== "_tablerIconNodes" && !isInlineProjectionMetadataKey(key, { keepDisplay: true }))
			record[key] = materializeInlineIcons(child, catalogs, key);
	}
	rebindInlineFields(before, record);
	return value;
}

export const INLINE_ICON_CLASS = "praxity-inline-icon";
export const INLINE_ICON_NODES_ATTRIBUTE = "data-praxity-inline-icon-nodes";

const MAX_INLINE_ICON_PATHS = 32;
const MAX_INLINE_ICON_PATH_DATA_LENGTH = 16_384;
const MAX_INLINE_ICON_ATTRIBUTE_LENGTH = 64 * 1024;
const MAX_INLINE_ICON_COORDINATE = 1_000_000;
const INLINE_ICON_PATH_DATA_PATTERN =
	/^(?:[\s,]|[MmZzLlHhVvCcSsQqTtAa]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)*$/;
const INLINE_ICON_NUMBER_PATTERN = /[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g;

/** Matches both kebab-case names and the PascalCase names exported by Tabler. */
export const INLINE_ICON_NAME_PATTERN = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*|Icon[A-Z0-9][A-Za-z0-9]*)$/;

export interface InlineIconSpec {
	source: string;
	name: string;
	variant: "outline" | "filled";
}

type InlineIconPathAttributes = {
	d: string;
	fill?: string | number;
	opacity?: string | number;
	stroke?: string | number;
};
type InlineIconPathNode = ["path", InlineIconPathAttributes];

function isSafeInlineIconPathData(value: string): boolean {
	if (!INLINE_ICON_PATH_DATA_PATTERN.test(value)) return false;
	for (const token of value.match(INLINE_ICON_NUMBER_PATTERN) ?? []) {
		const number = Number(token);
		if (!Number.isFinite(number) || Math.abs(number) > MAX_INLINE_ICON_COORDINATE) return false;
	}
	return true;
}

function normalizeInlineIconPaint(value: unknown): "none" | "currentColor" | undefined {
	return value === "none" || value === "currentColor" ? value : undefined;
}

function normalizeInlineIconOpacity(value: unknown): string | number | undefined {
	if (typeof value === "number") {
		return Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
	}
	if (typeof value !== "string" || !/^(?:0|1|0?\.\d+)$/.test(value)) return undefined;
	return value;
}

function normalizeInlineIconNodes(nodes: unknown): InlineIconPathNode[] | null {
	if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > MAX_INLINE_ICON_PATHS) {
		return null;
	}
	const normalized: InlineIconPathNode[] = [];
	for (const node of nodes) {
		if (!Array.isArray(node) || node[0] !== "path" || !node[1] || typeof node[1] !== "object") {
			return null;
		}
		const attrs = node[1] as Record<string, unknown>;
		if (
			typeof attrs.d !== "string" ||
			attrs.d.length === 0 ||
			attrs.d.length > MAX_INLINE_ICON_PATH_DATA_LENGTH ||
			!isSafeInlineIconPathData(attrs.d)
		) {
			return null;
		}
		const safeAttrs: InlineIconPathAttributes = { d: attrs.d };
		const fill = normalizeInlineIconPaint(attrs.fill);
		const opacity = normalizeInlineIconOpacity(attrs.opacity);
		const stroke = normalizeInlineIconPaint(attrs.stroke);
		if (fill !== undefined) safeAttrs.fill = fill;
		if (opacity !== undefined) safeAttrs.opacity = opacity;
		if (stroke !== undefined) safeAttrs.stroke = stroke;
		normalized.push(["path", safeAttrs]);
	}
	return normalized;
}

export function encodeInlineIconNodes(nodes: unknown): string | null {
	const normalized = normalizeInlineIconNodes(nodes);
	if (!normalized) return null;
	const encoded = encodeURIComponent(JSON.stringify(normalized));
	return encoded.length <= MAX_INLINE_ICON_ATTRIBUTE_LENGTH ? encoded : null;
}

export function decodeInlineIconNodes(encoded: string): InlineIconPathNode[] | null {
	if (!encoded || encoded.length > MAX_INLINE_ICON_ATTRIBUTE_LENGTH) {
		return null;
	}
	try {
		return normalizeInlineIconNodes(JSON.parse(decodeURIComponent(encoded)));
	} catch {
		return null;
	}
}

function pascalToKebab(value: string): string {
	return value
		.replace(/[A-Z]/g, (letter, index) => (index === 0 ? letter : `-${letter}`))
		.replace(/([A-Za-z])(\d)/g, "$1-$2")
		.toLowerCase();
}

/** Normalize an authored Tabler name without deciding whether the icon exists. */
export function parseInlineIconName(raw: string): InlineIconSpec | null {
	if (!INLINE_ICON_NAME_PATTERN.test(raw)) return null;
	if (raw.startsWith("Icon")) {
		const exportName = raw.slice(4);
		const variant = exportName.endsWith("Filled") ? "filled" : "outline";
		const baseName = variant === "filled" ? exportName.slice(0, -"Filled".length) : exportName;
		if (!baseName) return null;
		return { source: raw, name: pascalToKebab(baseName), variant };
	}
	const variant = raw.endsWith("-filled") ? "filled" : "outline";
	const name = variant === "filled" ? raw.slice(0, -"-filled".length) : raw;
	return name ? { source: raw, name, variant } : null;
}

/** HTML placeholder kept in parsed content until the export catalog is available. */
export function inlineIconPlaceholder(raw: string, nodes?: unknown): string | null {
	const spec = parseInlineIconName(raw);
	if (!spec) return null;
	const encodedNodes = nodes === undefined ? null : encodeInlineIconNodes(nodes);
	if (nodes !== undefined && !encodedNodes) return null;
	const nodesAttribute = encodedNodes
		? ` ${INLINE_ICON_NODES_ATTRIBUTE}="${escapeHtml(encodedNodes)}"`
		: "";
	return `<span class="${INLINE_ICON_CLASS}" data-praxity-inline-icon="${escapeHtml(spec.source)}" data-icon="${escapeHtml(spec.name)}" data-icon-variant="${spec.variant}"${nodesAttribute} aria-hidden="true"></span>`;
}

function isProtectedInlineIconContext(value: string, offset: number): boolean {
	const before = value.slice(0, offset);
	const openCode = before.lastIndexOf("<code");
	const closeCode = before.lastIndexOf("</code");
	if (openCode > closeCode) return true;
	const openTag = before.lastIndexOf("<");
	const closeTag = before.lastIndexOf(">");
	if (openTag > closeTag && /^<[a-z!/][^>]*$/i.test(before.slice(openTag))) return true;
	let unescapedBackticks = 0;
	for (let index = 0; index < before.length; index++) {
		if (before[index] !== "`" || before[index - 1] === "\\") continue;
		unescapedBackticks++;
	}
	return unescapedBackticks % 2 === 1;
}

/**
 * Replace trusted icon placeholders or generated SVGs without accepting arbitrary
 * markup. The callback owns the final output and can return a text fallback.
 */
export function replaceInlineIconMarkup(
	html: string,
	replace: (
		source: string,
		spec: InlineIconSpec,
		nodes: InlineIconPathNode[] | null | undefined,
		tag: "span" | "svg",
		original: string,
	) => string,
): string {
	return html.replace(
		/<(span|svg)\b(?=[^>]*\bdata-praxity-inline-icon="([^"]+)")[^>]*>[\s\S]*?<\/\1>/giu,
		(match, rawTag: string, source: string, offset: number, whole: string) => {
			if (isProtectedInlineIconContext(whole, offset)) return match;
			const spec = parseInlineIconName(source);
			if (!spec) return match;
			const tag = rawTag.toLowerCase() as "span" | "svg";
			const encodedNodes = match.match(
				new RegExp(`\\b${INLINE_ICON_NODES_ATTRIBUTE}="([^"]*)"`, "i"),
			)?.[1];
			const nodes = encodedNodes === undefined ? undefined : decodeInlineIconNodes(encodedNodes);
			return replace(source, spec, nodes, tag, match);
		},
	);
}

/** Minimal static SVG writer used by the export pipeline after sanitization. */
export function renderInlineIconSvg(
	source: string,
	spec: InlineIconSpec,
	nodes: unknown,
): string | null {
	const normalized = normalizeInlineIconNodes(nodes);
	if (!normalized) return null;
	const encodedNodes = encodeInlineIconNodes(normalized);
	if (!encodedNodes) return null;
	const paths: string[] = [];
	for (const node of normalized) {
		const attrs = node[1];
		const pathAttrs = [`d="${escapeHtml(attrs.d)}"`];
		for (const key of ["fill", "opacity", "stroke"] as const) {
			const value = attrs[key];
			if (typeof value === "string" || typeof value === "number") {
				pathAttrs.push(`${key}="${escapeHtml(String(value))}"`);
			}
		}
		paths.push(`<path ${pathAttrs.join(" ")}></path>`);
	}

	const paint =
		spec.variant === "filled"
			? 'fill="currentColor" stroke="none"'
			: 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
	return `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" ${paint} class="${INLINE_ICON_CLASS}" data-praxity-inline-icon="${escapeHtml(source)}" data-icon="${escapeHtml(spec.name)}" data-icon-variant="${spec.variant}" ${INLINE_ICON_NODES_ATTRIBUTE}="${escapeHtml(encodedNodes)}" aria-hidden="true" focusable="false">${paths.join("")}</svg>`;
}

/** Rebuild only validated, build-embedded markers after HTML sanitization. */
export function renderInlineIcons(html: string): string {
	if (!html.includes("data-praxity-inline-icon=")) return html;
	return replaceInlineIconMarkup(html, (source, spec, nodes, tag, original) => {
		if (nodes === undefined || tag === "svg") return original;
		return renderInlineIconSvg(source, spec, nodes) ?? escapeHtml(`@icon{${source}}`);
	});
}
