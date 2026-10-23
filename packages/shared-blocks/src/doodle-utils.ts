export type DoodleRoughType =
	| "underline"
	| "box"
	| "circle"
	| "highlight"
	| "strike-through"
	| "crossed-off"
	| "bracket";

export function parseDoodleMods(raw: string | null): Set<string> {
	return new Set(
		(raw ?? "")
			.split(/\s+/)
			.map((mod) => mod.trim())
			.filter(Boolean),
	);
}

export function hasDoodleMod(mods: Set<string>, name: string): boolean {
	return mods.has(name);
}

export function resolveDoodleStrokeWidth(mods: Set<string>): number {
	if (hasDoodleMod(mods, "thin")) return 1;
	if (hasDoodleMod(mods, "thick")) return 3;
	if (hasDoodleMod(mods, "marker")) return 4;
	return 2;
}

function tokenValue(style: CSSStyleDeclaration, name: string, fallback: string): string {
	const value = style.getPropertyValue(name).trim();
	return value || fallback;
}

export function resolveDoodleColor(style: CSSStyleDeclaration, mods: Set<string>): string {
	if (hasDoodleMod(mods, "yellow") || hasDoodleMod(mods, "warning")) {
		return tokenValue(
			style,
			"--praxity-color-doodle-warning",
			tokenValue(style, "--praxity-color-warning", "#825500"),
		);
	}
	if (hasDoodleMod(mods, "green")) {
		return tokenValue(
			style,
			"--praxity-color-doodle-success",
			tokenValue(style, "--praxity-color-success", "#1f7a34"),
		);
	}
	if (hasDoodleMod(mods, "red")) {
		return tokenValue(
			style,
			"--praxity-color-doodle-error",
			tokenValue(style, "--praxity-color-error", "#b42318"),
		);
	}
	if (hasDoodleMod(mods, "black")) {
		return tokenValue(
			style,
			"--praxity-color-doodle-ink",
			tokenValue(style, "--praxity-color-text", "#1f2900"),
		);
	}
	return tokenValue(
		style,
		"--praxity-color-doodle",
		tokenValue(style, "--praxity-color-accent", "#7b2cbf"),
	);
}

/**
 * Resolve highlight background color — separate from stroke color.
 * Reads --praxity-color-highlight-* CSS variables or an authored background color.
 * Falls back to the stroke color at 20% opacity if variables aren't set.
 */
export function resolveHighlightColor(style: CSSStyleDeclaration, mods: Set<string>): string {
	if (hasDoodleMod(mods, "yellow") || hasDoodleMod(mods, "warning")) {
		return tokenValue(
			style,
			"--praxity-color-highlight-warning",
			tokenValue(style, "--praxity-color-warning-light", "rgba(230, 119, 0, 0.18)"),
		);
	}
	if (hasDoodleMod(mods, "green")) {
		return tokenValue(style, "--praxity-color-highlight-success", "rgba(43, 138, 62, 0.18)");
	}
	if (hasDoodleMod(mods, "red")) {
		return tokenValue(style, "--praxity-color-highlight-error", "rgba(201, 42, 42, 0.18)");
	}
	if (hasDoodleMod(mods, "black")) {
		return tokenValue(style, "--praxity-color-highlight-ink", "rgba(31, 41, 0, 0.18)");
	}
	const authoredBackground = style.backgroundColor.trim();
	if (
		authoredBackground &&
		authoredBackground !== "transparent" &&
		authoredBackground !== "rgba(0, 0, 0, 0)"
	) {
		return authoredBackground;
	}
	return tokenValue(style, "--praxity-color-highlight-accent", "rgba(123, 44, 191, 0.18)");
}

export function resolveDoodleAnimation(
	mods: Set<string>,
	prefersReducedMotion: boolean,
): { animate: boolean; animationDuration: number } {
	const animate = hasDoodleMod(mods, "animated") && !prefersReducedMotion;
	return {
		animate,
		animationDuration: animate ? 900 : 0,
	};
}

export function buildWavyUnderlinePath(
	width: number,
	baseline = 8,
	amplitude = 2.5,
	step = 8,
): string {
	let d = `M0 ${baseline}`;
	let x = 0;
	let up = true;

	while (x < width) {
		const next = Math.min(width, x + step);
		const controlX = x + (next - x) / 2;
		const controlY = baseline + (up ? -amplitude : amplitude);
		d += ` Q ${controlX} ${controlY} ${next} ${baseline}`;
		x = next;
		up = !up;
	}

	return d;
}

export function resolveDoodleRoughType(doodleType: string, mods: Set<string>): DoodleRoughType {
	switch (doodleType) {
		case "underline":
			return "underline";
		case "circle":
			return hasDoodleMod(mods, "box") ? "box" : "circle";
		case "box":
			return "box";
		case "highlight":
			return "highlight";
		case "strike":
			return hasDoodleMod(mods, "crossed") ? "crossed-off" : "strike-through";
		case "bracket":
			return "bracket";
		default:
			return "underline";
	}
}

export function resolveDoodleIterations(doodleType: string, mods: Set<string>): number {
	if (doodleType === "strike" && hasDoodleMod(mods, "sketch")) return 9;
	if (doodleType === "highlight" && !hasDoodleMod(mods, "thick")) return 1;
	if (hasDoodleMod(mods, "sketch")) return 4;
	return 2;
}
