import { narrationDisplayText } from "@praxity/content-model/narration-display";
import { getInlineField } from "./inline-markdown";
import type { PraxityBlock } from "./types";

export type { PraxityBlock } from "./types";

export interface ContentDensityConfig {
	readingSpeed: 150 | 180 | 220; // WPM
}

/**
 * Strip HTML tags and count whitespace-separated words.
 * Handles empty / undefined input gracefully.
 */
export function countWordsInHtml(html: string | undefined | null): number {
	if (!html) return 0;
	// Replace tags with spaces to avoid merging adjacent text nodes
	const text = html.replace(/<[^>]*>/g, " ").trim();
	if (!text) return 0;
	return text.split(/\s+/).filter(Boolean).length;
}

export function countDialogueWords(data: unknown): number {
	if (!data || typeof data !== "object" || Array.isArray(data)) return 0;
	const dialogue = data as Record<string, unknown>;
	let count = countWordsInHtml(narrationDisplayText(getInlineField(dialogue, "caption")));
	if (!Array.isArray(dialogue.turns)) return count;
	for (const turn of dialogue.turns) {
		if (!turn || typeof turn !== "object" || Array.isArray(turn)) continue;
		const item = turn as Record<string, unknown>;
		const name = typeof item.name === "string" ? item.name : "";
		count +=
			countWordsInHtml(name) ||
			countWordsInHtml(typeof item.speaker === "string" ? item.speaker : "");
		if (Array.isArray(item.paragraphs)) {
			for (const [index, paragraph] of item.paragraphs.entries()) {
				if (typeof paragraph === "string")
					count += countWordsInHtml(getInlineField(item, ["paragraphs", index]));
			}
		}
	}
	return count;
}

// ─── Per-block time estimation ────────────────────────────────────────────────

/**
 * Returns the estimated reading/engagement time in minutes for a single block.
 */
export function estimateBlockTime(block: PraxityBlock, config: ContentDensityConfig): number {
	const { readingSpeed } = config;
	const d = block.data;

	switch (block.type) {
		case "text":
			return countWordsInHtml(d.content as string) / readingSpeed;

		case "heading":
			return countWordsInHtml(d.content as string) / readingSpeed;

		case "quote":
			// QuoteBlockData uses `text`, NOT `content`
			return countWordsInHtml(d.text as string) / readingSpeed;

		case "dialogue":
			return countDialogueWords(d) / readingSpeed;

		case "note": {
			const titleWords = countWordsInHtml(d.title as string | undefined);
			const contentWords = countWordsInHtml(d.content as string | undefined);
			return (titleWords + contentWords) / readingSpeed;
		}

		case "video":
			return (((d.duration as number | undefined) ?? 180) * 1.1) / 60;

		case "audio":
			return ((d.duration as number | undefined) ?? 120) / 60;

		case "image":
			return 0.1;

		case "imageComparison":
			return 0.25;

		case "chart":
			return 0.5;

		case "table": {
			const rows = (d.rows as unknown[][] | undefined) ?? [];
			return rows.length * 0.1;
		}

		case "assessment": {
			const assessmentType = d.assessmentType as string | undefined;
			// Open-ended / recording types take longer
			if (
				assessmentType === "textResponse" ||
				assessmentType === "audioRecording" ||
				assessmentType === "videoRecording" ||
				assessmentType === "speech" ||
				assessmentType === "dictation" ||
				assessmentType === "fileUpload"
			) {
				return 2.0;
			}
			// Simple selection types
			return 0.5;
		}

		case "card": {
			const items = (d.items as unknown[] | undefined) ?? [];
			return items.length * 0.25;
		}

		case "accordion": {
			const items = (d.items as unknown[] | undefined) ?? [];
			return items.length * 0.25;
		}

		case "tabs": {
			const items = (d.items as unknown[] | undefined) ?? [];
			return items.length * 0.25;
		}

		case "checklist": {
			const items = (d.items as unknown[] | undefined) ?? [];
			return items.length * 0.1;
		}

		case "embed":
			return 1.0;

		case "document":
			return 2.0;

		// Zero-time blocks
		case "divider":
		case "pageBreak":
		case "button":
		case "variable":
		case "logic":
		case "labeledGraphic":
		case "rating":
		case "signature":
		case "columns":
		case "sequence":
			return 0;

		default:
			return 0;
	}
}
