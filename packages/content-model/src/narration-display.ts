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

export function narrationDisplayText(value: string): string {
	return value.replace(
		/(\\?)\[([^\]\r\n]*)\](\([^)\r\n]*\)|\[[^\]\r\n]*\]|:)?/gu,
		(token, escaped: string, label: string, suffix: string | undefined, offset: number) => {
			const tag = label.trim().toLowerCase();
			if (escaped || !SONIOX_AUDIO_TAGS.has(tag) || suffix?.startsWith("(")) return token;
			const nextTag = suffix?.startsWith("[")
				? suffix.slice(1, -1).trim().toLowerCase()
				: undefined;
			if (suffix?.startsWith("[") && !SONIOX_AUDIO_TAGS.has(nextTag ?? "")) return token;
			if (suffix === ":" && !value.slice(value.lastIndexOf("\n", offset - 1) + 1, offset).trim())
				return token;
			const sound = SONIOX_HUMAN_SOUND_TAGS.has(tag) ? `[${label}]` : "";
			return (
				sound + (nextTag ? (SONIOX_HUMAN_SOUND_TAGS.has(nextTag) ? suffix : "") : (suffix ?? ""))
			);
		},
	);
}
