import YAML from "yaml";
import { migrateCoursePresetDesign } from "./course-reading-palettes";
import { findFrontmatterRange } from "./frontmatter-range.ts";
import { normalizeLineEndings } from "./line-endings.ts";
import { canonicalComponentDefaults } from "./parameter-metadata.ts";
import type { GrammarFrontmatter } from "./types.ts";

export { findFrontmatterRange } from "./frontmatter-range.ts";

export interface FrontmatterResult {
	frontmatter: GrammarFrontmatter;
	body: string;
	warnings?: string[];
	/** Zero-based line in the full source when the YAML block cannot be parsed. */
	errorLine?: number;
}

/**
 * Find the character offset where frontmatter ends in a grammar source string.
 * Returns 0 if no frontmatter block exists.
 * The offset includes the closing `---` line and any trailing blank lines,
 * so `source.slice(offset)` gives the body content.
 */
export function findFrontmatterEndOffset(source: string): number {
	const range = findFrontmatterRange(source);
	if (!range || range.endIndex === -1) return 0;
	let offset = range.end;

	while (offset < source.length) {
		if (source[offset] === "\n" || source[offset] === "\r") offset++;
		else break;
	}

	return offset;
}

/**
 * Serialize frontmatter back into YAML format prepended to body.
 * Inverse of parseFrontmatter: serializeFrontmatter(fm, body) produces
 * a string that parseFrontmatter will round-trip.
 *
 * flowLevel: 3 means objects 3+ levels deep use inline (JSON-like) syntax,
 * keeping deeply nested values like componentDefaults compact.
 */
export function serializeFrontmatter(frontmatter: GrammarFrontmatter, body: string): string {
	const entries = Object.entries(frontmatter).filter(([, v]) => v !== undefined && v !== null);
	if (entries.length === 0) return body;

	const canonical = Object.fromEntries(entries);
	if (
		canonical.design &&
		typeof canonical.design === "object" &&
		!Array.isArray(canonical.design)
	) {
		const design = canonical.design as Record<string, unknown>;
		canonical.design = {
			...design,
			...(design.componentDefaults === undefined
				? {}
				: { componentDefaults: canonicalComponentDefaults(design.componentDefaults) }),
		};
	}
	const yamlStr = YAML.stringify(canonical).trimEnd();
	return `---\n${yamlStr}\n---\n\n${body}`;
}

export function parseFrontmatter(source: string): FrontmatterResult {
	const range = findFrontmatterRange(source);

	if (!range) {
		return { frontmatter: {}, body: source };
	}
	if (range.endIndex === -1) return { frontmatter: {}, body: source, errorLine: 0 };
	const { endIndex } = range;

	const yamlContent = source.slice(range.yamlStart, range.yamlEnd);
	let parsed: unknown;
	try {
		parsed = YAML.parse(normalizeLineEndings(yamlContent));
	} catch (error) {
		// Malformed YAML: return empty frontmatter but still strip the
		// frontmatter block from the body (lines after the closing ---)
		const body = source.slice(range.end).replace(/^(?:\r\n|\r|\n)+/, "");
		const yamlLine = (error as { linePos?: Array<{ line: number }> }).linePos?.[0]?.line;
		return {
			frontmatter: {},
			body,
			errorLine: Math.min(Math.max(yamlLine ?? 1, 1), Math.max(endIndex - 1, 1)),
		};
	}
	const frontmatter: GrammarFrontmatter =
		typeof parsed === "object" && parsed !== null ? (parsed as GrammarFrontmatter) : {};
	const designAsRecord =
		typeof frontmatter.design === "object" && frontmatter.design !== null
			? (frontmatter.design as unknown as Record<string, unknown>)
			: null;
	if (designAsRecord) Object.assign(designAsRecord, migrateCoursePresetDesign(designAsRecord));

	const body = source.slice(range.end).replace(/^(?:\r\n|\r|\n)+/, "");

	const warnings: string[] = [];
	if (designAsRecord?.componentDefaults !== undefined)
		designAsRecord.componentDefaults = canonicalComponentDefaults(
			designAsRecord.componentDefaults,
			(message) => warnings.push(message),
		);
	return { frontmatter, body, ...(warnings.length ? { warnings } : {}) };
}
