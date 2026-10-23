import {
	HEADING_STYLES_PUBLISHED,
	normalizeHeadingLevel,
	sentenceCaseKicker,
	unwrapHeadingParagraph,
} from "@praxity/shared-blocks/heading-styles";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { renderInlineField, sanitizeInline } from "../../published-markup.ts";

export function renderHeading(block: PraxityBlock): string {
	const data = block.data as Record<string, unknown>;
	const baseLevel = normalizeHeadingLevel(data.level);
	const rawOffset = Number(data.headingOffset ?? 0);
	const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;
	const level = normalizeHeadingLevel(baseLevel + offset, baseLevel);
	const kicker = sentenceCaseKicker(renderInlineField(data, "kicker"));
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

	if (display === "chapter") {
		return `<div class="praxity-heading-chapter">${headingHtml}<div class="praxity-heading-chapter-divider" aria-hidden="true"></div></div>`;
	}

	if (kicker) {
		return `<div class="praxity-heading-with-kicker"><p class="praxity-kicker">${kicker}</p>${headingHtml}</div>`;
	}

	return headingHtml;
}
