/**
 * Block data fields that may contain asset URLs.
 *
 * Used by the publish pipeline (resolve-asset-urls), export pipeline
 * (asset-resolver and desktop preview) to walk block data and rewrite
 * asset references. This is the SINGLE SOURCE OF TRUTH — do not
 * duplicate this list elsewhere.
 *
 * Fields covered:
 * - src: ImageBlock, VideoSource, AudioBlock, EmbedBlock
 * - imageSrc: LabeledGraphicBlock, FlashcardBlock items
 * - image: HotspotResponse, ChoiceResponse options
 * - backgroundImage: general
 * - cornerImage: decorative slide artwork
 * - audioSrc: AudioBlock, DictationResponse
 * - posterSrc / poster: video or embed poster (including legacy data)
 * - url: DocumentBlock
 * - narrationAudio: narration MP3 on page titles and logical blocks
 * - narrationTimings: optional WebVTT sentence timings for narration
 * - avatar: dialogue speaker portraits, resolved from the course cast
 */
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

/**
 * Praxity application hostnames used for same-origin embed/script protection.
 */
export const SELF_HOSTNAMES = ["praxity.io", "www.praxity.io", "app.praxity.io"] as const;

/** Fraction of course pages learners must visit when no completion threshold is saved. */
export const DEFAULT_COMPLETION_THRESHOLD = 1;

/**
 * Y.Text field name for grammar source in collaborative Y.Docs.
 */
export const GRAMMAR_YTEXT_FIELD = "grammar" as const;

/** Supported palette ids for section rhythm theming. */
export const SECTION_PALETTES = ["light", "dark", "accent", "warm", "cool", "growth"] as const;

export type SectionPaletteName = (typeof SECTION_PALETTES)[number];

/** Response-type restriction only. Group modes and authored answers need separate validation. */
export function supportsDeckPassGate(assessmentType: unknown): boolean {
	return !["textResponse", "fileUpload", "matrix", "likert"].includes(String(assessmentType));
}

export function isSectionPalette(value: unknown): value is SectionPaletteName {
	return typeof value === "string" && (SECTION_PALETTES as readonly string[]).includes(value);
}

/**
 * Escape text for HTML text content and double-quoted attributes. This is the only HTML escaper:
 * published pages, the grammar and shared blocks all import it, so one fix reaches every output.
 */
export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Escape a JSON string for a single-quoted HTML attribute. */
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

/**
 * Escape JSON for a `<script type="application/json">` element. The HTML tokenizer reads script
 * content as raw text, where `</script` ends the element early and `<!--` followed by `<script`
 * enters the "script data double escaped" state, in which `</script>` no longer ends it and the
 * rest of the page is swallowed. Writing `<` as a JSON string escape keeps `JSON.parse` output
 * unchanged; `>` and `&` are escaped too, following the usual JSON-in-HTML convention.
 */
export function escapeJsonForScript(json: string): string {
	return json.replace(/[<>&]/g, (character) => JSON_SCRIPT_ESCAPES[character] ?? character);
}
