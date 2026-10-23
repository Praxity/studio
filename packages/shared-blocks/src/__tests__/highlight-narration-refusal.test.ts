import { expect, it } from "vitest";
import {
	extractNarrationSegments,
	NARRATION_BLOCK_FIELDS,
	NARRATION_ROLES,
	resolveNarrationV2,
} from "../narration";
import type { PraxityBlock } from "../types";

const highlight = (data: Record<string, unknown> = {}): PraxityBlock => ({
	id: "highlight",
	type: "highlight",
	visible: false,
	data: {
		content: {
			mode: "key",
			title: "Unspoken title",
			paragraphs: [[{ id: "chunk", text: "Unspoken passage", key: true }]],
		},
		...data,
	},
});
const nested = (block: PraxityBlock): PraxityBlock => ({
	id: "parent",
	type: "card",
	data: { hide: true, items: [{ id: "front", front: [block], back: [] }] },
});
const message = (locale: string) =>
	locale === "en"
		? "Highlight does not support block narration."
		: "Le surlignage ne prend pas en charge la narration de bloc.";

it.each(["en", "fr-CA"])("refuses every compiled highlight narration field in %s", (locale) => {
	for (const field of NARRATION_BLOCK_FIELDS) {
		// Presence is unsupported, including an empty script or a false disabled flag.
		const blocks = [nested(highlight({ [field]: field === "narrationDisabled" ? false : "" }))];
		const expected = expect.objectContaining({
			code: "highlight-narration-unsupported",
			blockId: "highlight",
			name: "HighlightNarrationError",
			reason: message(locale),
			message: `highlight: ${message(locale)}`,
		});
		expect(() => extractNarrationSegments("", {}, blocks, {}, locale)).toThrowError(expected);
		// V2 must refuse before stripping legacy narration fields from compiled input.
		expect(() =>
			resolveNarrationV2({
				courseId: "course",
				lessonId: "lesson",
				locale,
				pages: [{ id: "page", title: "", blocks }],
				sidecar: { version: 2, courseId: "course", lessons: {} },
				digest: (text) => text,
			}),
		).toThrowError(expected);
	}
});

it.each(["en", "fr-CA"])("refuses explicit highlight and chunk sidecar targets in %s", (locale) => {
	for (const id of ["highlight", "chunk"]) {
		for (const role of NARRATION_ROLES) {
			expect(() =>
				resolveNarrationV2({
					courseId: "course",
					lessonId: "lesson",
					locale,
					enabled: false,
					pages: [{ id: "page", title: "", blocks: [nested(highlight())] }],
					sidecar: {
						version: 2,
						courseId: "course",
						lessons: {
							// A moved target is refused even if its old lesson owns the entry.
							previous: {
								segments: [{ target: { id, role }, audio: "unspoken.mp3", disabled: true }],
							},
						},
					},
					digest: (text) => text,
				}),
			).toThrowError(
				expect.objectContaining({
					code: "highlight-narration-unsupported",
					blockId: "highlight",
					name: "HighlightNarrationError",
					reason: message(locale),
					message: `highlight: ${message(locale)}`,
				}),
			);
		}
	}
});
