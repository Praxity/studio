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

const BLOCKED_SCHEMES = /^(javascript|vbscript|blob):/i;
const BLOCKED_DATA = /^data:text\/html/i;

/** Reject dangerous URL schemes in media src attributes. */
export function isSafeMediaUrl(url: string): boolean {
	const trimmed = url.trim();
	return !BLOCKED_SCHEMES.test(trimmed) && !BLOCKED_DATA.test(trimmed);
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
