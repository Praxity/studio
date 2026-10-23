import { getInlineField } from "@praxity/content-model/inline-preparation";
import { labelWithSeparator } from "@praxity/shared-blocks/i18n/label-separator";
import { escapeTypst, stripHtml } from "./common.ts";

type Data = Record<string, unknown>;
const record = (value: unknown): value is Data =>
	!!value && typeof value === "object" && !Array.isArray(value);

export function renderDialogueToTypst(
	data: unknown,
	rich: (html: string) => string,
	locale = "en",
): string {
	if (!record(data) || !Array.isArray(data.turns)) return "";
	const turns = data.turns
		.filter(
			(turn): turn is Data =>
				record(turn) &&
				Array.isArray(turn.paragraphs) &&
				turn.paragraphs.some((part) => typeof part === "string"),
		)
		.map((turn) => {
			const paragraphs = Array.isArray(turn.paragraphs) ? turn.paragraphs : [];
			const words = paragraphs
				.flatMap((part, index) =>
					typeof part === "string" ? [rich(getInlineField(turn, ["paragraphs", index]))] : [],
				)
				.join("\n\n");
			const name =
				(typeof turn.name === "string" ? stripHtml(turn.name).trim() : "") ||
				(typeof turn.speaker === "string" ? turn.speaker.trim() : "");
			return `#block(breakable: true)[${name ? `*${labelWithSeparator(escapeTypst(name), locale).trimEnd()}* ` : ""}${words}]`;
		});
	const caption =
		data.captionEnabled === false || typeof data.caption !== "string"
			? ""
			: rich(getInlineField(data, "caption"));
	return [caption, ...turns].filter(Boolean).join("\n\n");
}
