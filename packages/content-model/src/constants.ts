export const ASSET_FIELDS = [
	"src",
	"imageSrc",
	"image",
	"backgroundImage",
	"cornerImage",
	"audioSrc",
	"posterSrc",
	"poster",
	"url",
	"narrationAudio",
	"narrationTimings",
	"audioUrl",
	"timingsUrl",
	"avatar",
] as const;

export const SELF_HOSTNAMES = ["praxity.io", "www.praxity.io", "app.praxity.io"] as const;

export const DEFAULT_COMPLETION_THRESHOLD = 1;

export const GRAMMAR_YTEXT_FIELD = "grammar" as const;

export const SECTION_PALETTES = ["light", "dark", "accent", "warm", "cool", "growth"] as const;

export type SectionPaletteName = (typeof SECTION_PALETTES)[number];

export function supportsDeckPassGate(assessmentType: unknown): boolean {
	return !["textResponse", "fileUpload", "matrix", "likert"].includes(String(assessmentType));
}

export function isSectionPalette(value: unknown): value is SectionPaletteName {
	return typeof value === "string" && (SECTION_PALETTES as readonly string[]).includes(value);
}

export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function escapeJsonForHtml(json: string): string {
	return json
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/'/g, "&#39;");
}

const JSON_SCRIPT_ESCAPES: Record<string, string> = {
	"<": "\\u003c",
	">": "\\u003e",
	"&": "\\u0026",
};

export function escapeJsonForScript(json: string): string {
	return json.replace(/[<>&]/g, (character) => JSON_SCRIPT_ESCAPES[character] ?? character);
}
