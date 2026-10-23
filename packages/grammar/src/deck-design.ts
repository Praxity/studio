/** Studio presentation and learner-flow choices for the module-deck runtime. */
export interface DeckDesign {
	preset?: "compact" | "transcript" | "selfPaced" | "custom";
	outline?: boolean;
	outlineDetail?: "currentModule" | "moduleLinks";
	initialPanel?: "closed" | "outline" | "transcript";
	slideCounter?: boolean;
	followNarration?: boolean;
	autoAdvance?: boolean;
	/** Require earlier slides to be visited. Authored assessment gates always apply. */
	sequentialLessons?: boolean;
}

export function getDeckPreset(preset: DeckDesign["preset"] = "compact"): Required<DeckDesign> {
	return {
		preset,
		outline: true,
		outlineDetail: "moduleLinks",
		initialPanel: "closed",
		slideCounter: true,
		followNarration: true,
		autoAdvance: false,
		sequentialLessons: false,
	};
}

/** Retain only valid authored keys, so normalization does not erase course inheritance. */
export function normalizeDeckDesign(value: unknown): DeckDesign {
	const raw =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	const result: DeckDesign = {};
	if (
		raw.preset === "compact" ||
		raw.preset === "transcript" ||
		raw.preset === "selfPaced" ||
		raw.preset === "custom"
	)
		result.preset = raw.preset;
	for (const key of [
		"outline",
		"slideCounter",
		"followNarration",
		"autoAdvance",
		"sequentialLessons",
	] as const) {
		if (typeof raw[key] === "boolean") result[key] = raw[key];
	}
	if (raw.outlineDetail === "currentModule" || raw.outlineDetail === "moduleLinks")
		result.outlineDetail = raw.outlineDetail;
	if (
		raw.initialPanel === "closed" ||
		raw.initialPanel === "outline" ||
		raw.initialPanel === "transcript"
	)
		result.initialPanel = raw.initialPanel;
	return result;
}

/** Share the same effective defaults between Studio and export. */
export function resolveDeckDesign(value: unknown): Required<DeckDesign> {
	const authored = normalizeDeckDesign(value);
	const result = { ...getDeckPreset(authored.preset), ...authored };
	if (!result.outline && result.initialPanel === "outline") result.initialPanel = "closed";
	return result;
}
