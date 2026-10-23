/** Source positions survive filtering so narration and identity keep their targets. */
export function dialogueTurns<
	T extends { speaker?: unknown; side?: unknown; paragraphs?: unknown },
>(value: unknown) {
	const turns = (Array.isArray(value) ? value : []).flatMap((turn, index) =>
		turn &&
		typeof turn === "object" &&
		!Array.isArray(turn) &&
		Array.isArray(turn.paragraphs) &&
		turn.paragraphs.some((part: unknown) => typeof part === "string")
			? [{ turn: turn as T, index }]
			: [],
	);
	const speakerKey = (turn: T) =>
		typeof turn.speaker === "string" ? turn.speaker.trim().toLowerCase() : "";
	const firstSpeaker = turns.map(({ turn }) => speakerKey(turn)).find(Boolean);
	return turns.map(({ turn, index }, position) => ({
		turn,
		index,
		speaker: typeof turn.speaker === "string" ? turn.speaker.trim() : "",
		continuation: Boolean(
			position > 0 && speakerKey(turn) && speakerKey(turn) === speakerKey(turns[position - 1].turn),
		),
		side:
			turn.side === "start" || turn.side === "end"
				? turn.side
				: !speakerKey(turn) || speakerKey(turn) === firstSpeaker
					? "start"
					: "end",
	}));
}
