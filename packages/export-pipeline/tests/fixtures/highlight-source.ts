import type { HighlightContent } from "@praxity/shared-blocks/types";

/** One authored-source projection for the controlled highlight fixture content. */
export function highlightSource(
	content: HighlightContent,
	options: { name?: string; hide?: boolean } = {},
): string {
	const settings = [
		`mode=${content.mode}`,
		...(content.maxMarks === undefined ? [] : [`maxMarks=${content.maxMarks}`]),
		...(options.name ? [`name=${options.name}`] : []),
		...(options.hide ? ["hide"] : []),
	];
	return (
		`::: highlight ${content.title} {${settings.join(" ")}}\n${content.question ? `question: ${content.question}\n` : ""}` +
		content.paragraphs
			.map((paragraph, i) =>
				paragraph
					.map(
						(chunk, j) =>
							`:: ${chunk.text}${chunk.key || (i > 0 && j === 0) ? ` {${chunk.key ? "key " : ""}${i > 0 && j === 0 ? "paragraph" : ""}}` : ""}\n${chunk.note ? `note: ${chunk.note}\n` : ""}`,
					)
					.join(""),
			)
			.join("") +
		":::\n"
	);
}
