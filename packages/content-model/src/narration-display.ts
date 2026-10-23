export const SONIOX_AUDIO_TAGS = new Set([
	"happy",
	"sad",
	"angry",
	"excited",
	"nervous",
	"fearful",
	"surprised",
	"annoyed",
	"relieved",
	"disappointed",
	"curious",
	"delighted",
	"calm",
	"warm",
	"stern",
	"serious",
	"playful",
	"sarcastic",
	"flirty",
	"deadpan",
	"sincerely",
	"reassuringly",
	"dramatically",
	"mockingly",
	"laughs",
	"chuckles",
	"giggles",
	"sobs",
	"sniffles",
	"whimpers",
	"sighs",
	"exhales",
	"gasps",
	"grunts",
	"groans",
	"clears throat",
	"coughs",
	"yawns",
	"whispering",
	"softly",
	"loudly",
	"shouting",
	"getting louder",
	"getting quieter",
	"trailing off",
	"muttering",
	"slowly",
	"quickly",
	"rushed",
	"drawn out",
	"hesitantly",
	"high-pitched",
	"low voice",
	"monotone",
	"breathy",
	"raspy",
	"trembling voice",
	"shaky",
	"pause",
	"long pause",
]);

// Human sounds convey audible information and belong in accessible transcripts/captions.
const SONIOX_HUMAN_SOUND_TAGS = new Set([
	"laughs",
	"chuckles",
	"giggles",
	"sobs",
	"sniffles",
	"whimpers",
	"sighs",
	"exhales",
	"gasps",
	"grunts",
	"groans",
	"clears throat",
	"coughs",
	"yawns",
]);

/** Learner text only. Keep the authored script (including delivery tags) for synthesis and hashes.
 * Supported directions: https://soniox.com/docs/tts/concepts/emotion-and-tone
 */
export function narrationDisplayText(value: string): string {
	return value.replace(
		/(\\?)\[([^\]\r\n]*)\](\([^)\r\n]*\)|\[[^\]\r\n]*\]|:)?/gu,
		(token, escaped: string, label: string, suffix: string | undefined, offset: number) => {
			const tag = label.trim().toLowerCase();
			if (escaped || !SONIOX_AUDIO_TAGS.has(tag) || suffix?.startsWith("(")) return token;
			// Known adjacent cues take precedence over reference-link syntax; real references stay intact.
			const nextTag = suffix?.startsWith("[")
				? suffix.slice(1, -1).trim().toLowerCase()
				: undefined;
			if (suffix?.startsWith("[") && !SONIOX_AUDIO_TAGS.has(nextTag ?? "")) return token;
			// A reference definition starts its own line. A colon within prose is ordinary punctuation.
			if (suffix === ":" && !value.slice(value.lastIndexOf("\n", offset - 1) + 1, offset).trim())
				return token;
			const sound = SONIOX_HUMAN_SOUND_TAGS.has(tag) ? `[${label}]` : "";
			return (
				sound + (nextTag ? (SONIOX_HUMAN_SOUND_TAGS.has(nextTag) ? suffix : "") : (suffix ?? ""))
			);
		},
	);
}
