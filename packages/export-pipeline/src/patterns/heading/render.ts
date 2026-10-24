import {
	HEADING_STYLES_PUBLISHED,
	normalizeHeadingLevel,
	sentenceCaseKicker,
	unwrapHeadingParagraph,
} from "@praxity/shared-blocks/heading-styles";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { fullyDecodeEntities } from "../../html-entities.ts";
import { escapeHtml, renderInlineField, sanitizeInline } from "../../published-markup.ts";

export interface LessonHeading {
	kicker?: string;
	time?: string;
}

/** Decorate either a page heading or its folded assessment-group title. */
export function renderHeadingLabels(
	headingHtml: string,
	lesson?: LessonHeading,
	blockKicker = "",
): string {
	// Lesson frontmatter wins over the kicker in legacy heading data.
	const kicker = lesson?.kicker?.trim()
		? escapeHtml(fullyDecodeEntities(lesson.kicker.trim()))
		: blockKicker;
	const time = lesson?.time?.trim()
		? `<p class="praxity-lesson-time">${escapeHtml(fullyDecodeEntities(lesson.time.trim()))}</p>`
		: "";
	return kicker || time
		? `<div class="praxity-heading-with-kicker">${kicker ? `<p class="praxity-kicker">${kicker}</p>` : ""}${headingHtml}${time}</div>`
		: headingHtml;
}

export function renderHeading(block: PraxityBlock, lesson?: LessonHeading): string {
	const data = block.data as Record<string, unknown>;
	const baseLevel = normalizeHeadingLevel(data.level);
	const rawOffset = Number(data.headingOffset ?? 0);
	const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;
	const level = normalizeHeadingLevel(baseLevel + offset, baseLevel);
	const content = unwrapHeadingParagraph(sanitizeInline(data.content));
	const display = typeof data.display === "string" ? data.display : "standard";
	const baseStyle = HEADING_STYLES_PUBLISHED[baseLevel];
	const style = [
		`font-size:${display === "chapter" ? "var(--praxity-type-chapter)" : baseStyle.fontSize}`,
		`font-family:${baseStyle.fontFamily}`,
		`font-weight:${baseStyle.fontWeight}`,
		`font-style:${baseStyle.fontStyle}`,
		`line-height:${baseStyle.lineHeight}`,
		`letter-spacing:${display === "chapter" ? "-0.02em" : (baseStyle.letterSpacing ?? "normal")}`,
	].join(";");
	const headingHtml = `<h${level} style="${style}">${content}</h${level}>`;
	const decorated = renderHeadingLabels(
		headingHtml,
		lesson,
		display === "chapter" ? "" : sentenceCaseKicker(renderInlineField(data, "kicker")),
	);

	if (display === "chapter") {
		return `<div class="praxity-heading-chapter">${decorated}<div class="praxity-heading-chapter-divider" aria-hidden="true"></div></div>`;
	}

	return decorated;
}
