import type { BlockSchema, ValidationError } from "../validation-types.ts";

export const dialogueSchema: BlockSchema = {
	keyword: "dialogue",
	blockType: "dialogue",
	attributes: {},
	validate(block, config) {
		const fr = config.frontmatter.lang?.startsWith("fr");
		const data =
			block.data && typeof block.data === "object" && !Array.isArray(block.data) ? block.data : {};
		const turns = data.turns;
		const errors: ValidationError[] = [];
		const issue = (id: string, level: "error" | "warning", message: string, index?: number) =>
			errors.push({
				id,
				level,
				message,
				blockId: block.id,
				blockType: block.type,
				category: "content",
				...(index === undefined ? {} : { attribute: `turns.${index}` }),
			});
		if (data.speakers !== undefined) {
			if (!data.speakers || typeof data.speakers !== "object" || Array.isArray(data.speakers))
				issue(
					"dialogue-speakers-shape",
					"warning",
					fr
						? "Les interlocuteurs du dialogue doivent former une table."
						: "Dialogue speakers must be a map.",
				);
			else
				for (const [key, speaker] of Object.entries(data.speakers)) {
					if (!speaker || typeof speaker !== "object" || Array.isArray(speaker)) {
						issue(
							"dialogue-local-speaker-shape",
							"warning",
							fr
								? `L'interlocuteur ${key} doit être un objet.`
								: `Speaker ${key} must be an object.`,
						);
						continue;
					}
					if (
						Object.entries(speaker).some(
							([field, value]) =>
								["name", "avatar", "voice", "side"].includes(field) && typeof value !== "string",
						)
					)
						issue(
							"dialogue-local-speaker-shape",
							"warning",
							fr
								? `Les champs de l'interlocuteur ${key} doivent être du texte.`
								: `Speaker ${key} fields must be strings.`,
						);
					if ("side" in speaker && speaker.side !== "start" && speaker.side !== "end")
						issue(
							"dialogue-local-speaker-side",
							"warning",
							fr
								? `Le côté de l'interlocuteur ${key} doit être start ou end.`
								: `Speaker ${key} side must be start or end.`,
						);
				}
		}
		if (!Array.isArray(turns) || turns.length === 0) {
			issue(
				"dialogue-empty",
				"error",
				fr
					? "Ce dialogue n'a aucune réplique. Ajoutez des éléments comme - Alex : Bonjour."
					: "This dialogue has no turns. Add list items like - Alex: Hello.",
			);
		} else {
			turns.forEach((turn, index) => {
				if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
					issue(
						"dialogue-turn-shape",
						"warning",
						fr
							? `La réplique ${index + 1} doit être un objet.`
							: `Turn ${index + 1} must be an object.`,
						index,
					);
					return;
				}
				if (
					!Array.isArray(turn.paragraphs) ||
					!turn.paragraphs.every((part: unknown) => typeof part === "string")
				)
					issue(
						"dialogue-paragraphs",
						"warning",
						fr
							? `Les paragraphes de la réplique ${index + 1} doivent être des chaînes de texte.`
							: `Turn ${index + 1} paragraphs must be strings.`,
						index,
					);
				if (turn.speaker !== undefined && typeof turn.speaker !== "string") {
					issue(
						"dialogue-speaker-shape",
						"warning",
						fr
							? `L'interlocuteur de la réplique ${index + 1} doit être du texte.`
							: `Turn ${index + 1} speaker must be a string.`,
						index,
					);
					return;
				}
				if (typeof turn.speaker === "string" && turn.speaker.trim()) return;
				issue(
					"dialogue-turn-speaker",
					"error",
					fr
						? `La réplique ${index + 1} n'a pas d'interlocuteur. Commencez-la par une clé d'interlocuteur suivie de deux-points.`
						: `Turn ${index + 1} has no speaker. Start it with a speaker key and a colon.`,
					index,
				);
			});
		}
		if (data.style !== undefined && data.style !== "bubbles" && data.style !== "script") {
			issue(
				"dialogue-style",
				"warning",
				fr
					? "Le style du dialogue doit être bubbles ou script."
					: "Dialogue style must be bubbles or script.",
			);
		}
		return errors;
	},
};
