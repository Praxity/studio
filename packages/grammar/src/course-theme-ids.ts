export const COURSE_PRESET_IDS = ["ink", "forest", "plum", "clay", "clear"] as const;
export type CoursePresetId = (typeof COURSE_PRESET_IDS)[number];

/** Saved IDs migrate here in grammar, authoring and published output. */
export const COURSE_PRESET_ALIASES = {
	ink: "ink",
	forest: "forest",
	plum: "plum",
	clay: "clay",
	clear: "clear",
	standard: "ink",
	waves: "ink",
	clean: "ink",
	minimal: "ink",
	default: "ink",
	ia: "ink",
	praxity: "ink",
	grove: "forest",
	bauhaus: "forest",
	blueprint: "forest",
	universal: "forest",
	ocean: "forest",
	nature: "forest",
	corporate: "forest",
	marquee: "plum",
	darkroom: "plum",
	bold: "plum",
	cinematic: "plum",
	dark: "plum",
	playful: "plum",
	campfire: "clay",
	dunes: "clay",
	editorial: "clay",
	warm: "clay",
	pastel: "clay",
	slate: "ink",
	"warm-canvas": "clay",
	midnight: "ink",
	espresso: "clay",
	"universal-light": "forest",
	"universal-dark": "forest",
} as const satisfies Record<string, CoursePresetId>;

export function resolveCoursePresetId(value: unknown): CoursePresetId {
	return typeof value === "string" && Object.hasOwn(COURSE_PRESET_ALIASES, value)
		? COURSE_PRESET_ALIASES[value as keyof typeof COURSE_PRESET_ALIASES]
		: "ink";
}

/** Old direct reads still work, while pickers enumerate the five current IDs. */
export function withCoursePresetAliases<T extends Record<CoursePresetId, unknown>>(
	presets: T,
): T & Record<keyof typeof COURSE_PRESET_ALIASES, T[CoursePresetId]> {
	const result = { ...presets };
	for (const [alias, target] of Object.entries(COURSE_PRESET_ALIASES)) {
		if (!Object.hasOwn(result, alias))
			Object.defineProperty(result, alias, { value: presets[target] });
	}
	return result as T & Record<keyof typeof COURSE_PRESET_ALIASES, T[CoursePresetId]>;
}
