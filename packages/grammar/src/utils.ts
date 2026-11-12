import { escapeHtml, SELF_HOSTNAMES } from "@praxity/content-model/constants";
import { inlineMarkdown } from "@praxity/content-model/inline-markdown";

export { escapeHtml, inlineMarkdown };

let blockCounter = 0;

export function resetBlockCounter(): void {
	blockCounter = 0;
}

export function positionalId(type: string): string {
	return `${type}-${blockCounter++}`;
}

const SAFE_URL_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const URL_TAB_OR_NEWLINE = /[\t\n\r]/g;
const URL_SCHEME = /^([a-z][a-z\d+.-]*):/i;
// Raster images only: an SVG document can carry script.
const RASTER_IMAGE_DATA_URL = /^data:image\/(?!svg\+xml)/i;

/**
 * Whether a URL from course source may go into an href: relative URLs, fragments, and http,
 * https, mailto and tel. Every other scheme is refused, including `data:`, so an unknown or
 * disguised scheme never reaches the page.
 */
export function isSafeUrl(url: string): boolean {
	return isAllowedUrl(url, false);
}

/** Media src attributes accept the same URLs plus raster image `data:` URLs. */
export function isSafeMediaUrl(url: string): boolean {
	return isAllowedUrl(url, true);
}

/**
 * Reads the scheme as the URL Standard's basic URL parser does
 * (https://url.spec.whatwg.org/#concept-basic-url-parser), so text the browser treats as
 * `javascript:` is refused here too:
 * 1. "Remove any leading and trailing C0 control or space from input" (U+0000 to U+0020).
 *    Only the leading run can change the scheme or the anchored `data:` check, so trailing
 *    characters are left alone.
 * 2. "Remove all ASCII tab or newline from input" (U+0009, U+000A, U+000D).
 * 3. Scheme start and scheme states: an ASCII alpha, then ASCII alphanumerics, "+", "-" or ".",
 *    ended by ":". Anything else has no scheme and resolves against the page.
 * Each step is a single linear pass; a backtracking edge-trim regex took quadratic time on long
 * whitespace runs.
 */
function isAllowedUrl(url: string, rasterImageData: boolean): boolean {
	let start = 0;
	while (start < url.length && url.charCodeAt(start) <= 0x20) start++;
	const normalized = url.slice(start).replace(URL_TAB_OR_NEWLINE, "");
	const scheme = URL_SCHEME.exec(normalized)?.[1]?.toLowerCase();
	if (scheme === undefined) return true;
	if (scheme === "data") return rasterImageData && RASTER_IMAGE_DATA_URL.test(normalized);
	return SAFE_URL_SCHEMES.has(scheme);
}

/** A caption attachment is a safe VTT path or an HTTPS VTT URL. */
export function isSafeCaptionTrackUrl(value: unknown): value is string {
	if (typeof value !== "string" || value !== value.trim()) return false;
	if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
		try {
			const url = new URL(value);
			return (
				url.protocol === "https:" && !url.username && !url.password && /\.vtt$/i.test(url.pathname)
			);
		} catch {
			return false;
		}
	}
	if (value.startsWith("//") || /[?#]/.test(value)) return false;
	const relative = value.replace(/^(?:\/|\.\/)/, "");
	if (!/\.vtt$/i.test(relative)) return false;
	try {
		return relative.split("/").every((part) => {
			const decoded = decodeURIComponent(part);
			return decoded !== "" && decoded !== "." && decoded !== ".." && !/[\\/\0]/.test(decoded);
		});
	} catch {
		return false;
	}
}

function isSelfHostname(hostname: string): boolean {
	const normalizedHost = hostname.replace(/\.$/, "");
	return SELF_HOSTNAMES.some(
		(selfHost) => normalizedHost === selfHost || normalizedHost.endsWith(`.${selfHost}`),
	);
}

/**
 * Safe iframe embed URLs must be HTTPS and third-party (not Praxity origin).
 */
export function isSafeEmbedUrl(raw: string): boolean {
	try {
		const url = new URL(raw);
		if (url.protocol !== "https:") return false;
		if (isSelfHostname(url.hostname)) return false;
		return true;
	} catch {
		return false;
	}
}

const KNOWN_EFFECTS = new Set([
	"grayscale",
	"colorWash",
	"accentLighting",
	"progressiveBlur",
	"accentBlur",
	"motionBlur",
	"grain",
	"halftone",
	"dithering",
]);

const SECONDARY_PARAMS: Record<string, string> = {
	colorWash: "color",
	motionBlur: "direction",
};

/**
 * Parse an effects expression string into a structured map.
 * Syntax: "none" | "effectName" | "effectName(intensity)" | "effectName(intensity param)"
 * Multiple effects separated by whitespace.
 */
export function parseEffectsExpression(
	input: string,
): "none" | Record<string, { intensity: number; [key: string]: unknown }> {
	const trimmed = input.trim();
	if (trimmed === "none") return "none";
	if (trimmed === "") return {};

	const result: Record<string, { intensity: number; [key: string]: unknown }> = {};

	// Tokenize: split on whitespace but respect parentheses
	const tokens: string[] = [];
	let current = "";
	let parenDepth = 0;
	for (const char of trimmed) {
		if (char === "(") {
			parenDepth++;
			current += char;
		} else if (char === ")") {
			parenDepth = Math.max(0, parenDepth - 1);
			current += char;
		} else if (char === " " && parenDepth === 0) {
			if (current) tokens.push(current);
			current = "";
		} else {
			current += char;
		}
	}
	if (current) tokens.push(current);

	for (const token of tokens) {
		const parenIdx = token.indexOf("(");
		if (parenIdx === -1) {
			// Bare effect name - auto-calculated intensity
			if (KNOWN_EFFECTS.has(token)) {
				result[token] = { intensity: -1 };
			}
			continue;
		}

		const name = token.slice(0, parenIdx);
		if (!KNOWN_EFFECTS.has(name)) continue;

		const closeIdx = token.lastIndexOf(")");
		const argsStr = token.slice(parenIdx + 1, closeIdx > parenIdx ? closeIdx : undefined).trim();
		const args = argsStr.split(/\s+/);

		const rawIntensity = Number.parseFloat(args[0]);
		const entry: Record<string, unknown> = {
			intensity: Number.isFinite(rawIntensity) ? rawIntensity : 0,
		};

		// Secondary parameter
		if (args.length > 1 && SECONDARY_PARAMS[name]) {
			const paramKey = SECONDARY_PARAMS[name];
			const paramValue = args[1];
			// Try to parse as number (for direction), otherwise keep as string (for color)
			const numValue = Number.parseFloat(paramValue);
			entry[paramKey] = Number.isFinite(numValue) ? numValue : paramValue;
		}

		result[name] = entry as { intensity: number; [key: string]: unknown };
	}

	return result;
}

/**
 * Serialize an effects map back to grammar expression syntax.
 */
export function serializeEffectsExpression(
	effects: "none" | Record<string, { intensity: number; [key: string]: unknown }>,
): string {
	if (effects === "none") return "none";

	const parts: string[] = [];
	for (const [name, params] of Object.entries(effects)) {
		if (params.intensity === -1) {
			// Auto-calculated - bare name
			parts.push(name);
			continue;
		}

		const args: (string | number)[] = [params.intensity];
		const secondaryKey = SECONDARY_PARAMS[name];
		if (secondaryKey && secondaryKey in params) {
			args.push(params[secondaryKey] as string | number);
		}

		parts.push(`${name}(${args.join(" ")})`);
	}

	return parts.join(" ");
}
