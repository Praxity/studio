import { IconAlertTriangle } from "@tabler/icons-react";
import { createElement } from "react";
import type { LearnerStrings } from "./i18n/strings";
import type { NoteStyle, NoteTone } from "./types";

type ReadingNoteTone = NoteTone | "error";

export function normalizeNoteProps(
	rawStyle: unknown,
	rawColor: unknown,
): { style: NoteStyle; color: ReadingNoteTone } {
	const color: ReadingNoteTone =
		rawColor === "error" || rawColor === "danger"
			? "error"
			: rawColor === "warning"
				? "warning"
				: "note";
	const style = rawStyle === "outline" || rawStyle === "light" ? "outline" : "shaded";
	return { style, color };
}

export function getNoteTypeLabel(
	color: ReadingNoteTone,
	strings: Pick<LearnerStrings, "noteType" | "warningNoteType" | "errorNoteType">,
): string {
	if (color === "error") return strings.errorNoteType;
	if (color === "warning") return strings.warningNoteType;
	return strings.noteType;
}

export function NoteIcon({
	color,
}: {
	color: ReadingNoteTone;
	icon?: unknown;
	iconNodes?: unknown;
}) {
	return color === "warning" || color === "error"
		? createElement(IconAlertTriangle, {
				"aria-hidden": "true",
				className: "praxity-note-icon",
				size: 20,
				stroke: 2,
			})
		: null;
}

/** Inputs are sanitized by the rendering edge. The label reflows with the first paragraph in both renderers. */
export function noteBodyHtml(labelHtml: string, contentHtml: string, iconHtml = ""): string {
	const label = `${iconHtml}<strong class="praxity-note-label">${labelHtml}</strong> `;
	const firstParagraph = /^(\s*(?:<div\b[^>]*>\s*)*<p\b[^>]*>)/i;
	if (firstParagraph.test(contentHtml))
		return contentHtml.replace(firstParagraph, (opening) => `${opening}${label}`);
	if (/^\s*<(?:ul|ol|table|div|h[1-6]|blockquote)\b/i.test(contentHtml))
		return `<p>${label}</p>${contentHtml}`;
	return `<p>${label}${contentHtml}</p>`;
}
