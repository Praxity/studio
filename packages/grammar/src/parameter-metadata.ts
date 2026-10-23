/** Canonical source names project onto stable runtime fields; shared by editor and grammar. */
export function toModelParameter(
	keyword: string,
	key: string,
	value: unknown,
): { key: string; value: unknown } {
	if (key === "width") return { key: "layoutMode", value };
	if (keyword === "image" && key === "size") return { key: "width", value };
	if (keyword === "columns" && key === "weight") return { key: "width", value };
	if (keyword === "comparison" && key === "layout") return { key: "style", value };
	if (keyword === "card" && key === "layout")
		return { key, value: value === "slides" ? "single" : value };
	return { key, value };
}

export function toSourceParameter(
	keyword: string,
	key: string,
	value: unknown,
): { key: string; value: unknown } {
	if (key === "layoutMode") return { key: "width", value };
	if (keyword === "image" && key === "width") return { key: "size", value };
	if (keyword === "columns" && key === "width") return { key: "weight", value };
	if (keyword === "comparison" && key === "style") return { key: "layout", value };
	if (keyword === "card" && key === "layout")
		return { key, value: value === "single" ? "slides" : value };
	return { key, value };
}

/** Defaults are authored source too: retain canonical names without mutating the input. */
export function canonicalComponentDefaults(
	value: unknown,
	onConflict?: (message: string) => void,
): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	return Object.fromEntries(
		Object.entries(value).map(([keyword, raw]) => {
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [keyword, raw];
			const params = raw as Record<string, unknown>;
			const output: Record<string, unknown> = {};
			const priorities = new Map<string, number>();
			for (const [key, value] of Object.entries(params)) {
				const outerWidth =
					typeof value === "string" && ["narrow", "wide", "full", "breakout"].includes(value);
				const source =
					key === "layout" && outerWidth
						? { key: "width", value }
						: key === "width" && outerWidth
							? { key, value }
							: toSourceParameter(keyword, key, value);
				const invalid =
					(source.key === "width" &&
						(typeof source.value !== "string" ||
							!["narrow", "wide", "full", "breakout"].includes(source.value))) ||
					(keyword === "image" &&
						source.key === "size" &&
						(typeof source.value !== "string" ||
							!["small", "medium", "large"].includes(source.value))) ||
					(keyword === "columns" &&
						source.key === "weight" &&
						!(
							typeof source.value === "number" &&
							Number.isFinite(source.value) &&
							source.value > 0
						)) ||
					(keyword === "card" &&
						source.key === "layout" &&
						(typeof source.value !== "string" ||
							!["grid", "masonry", "slides", "rows"].includes(source.value))) ||
					(keyword === "comparison" &&
						source.key === "layout" &&
						(typeof source.value !== "string" ||
							!["slider", "side-by-side", "toggle", "diff"].includes(source.value)));
				if (invalid) {
					const description =
						value !== null && typeof value === "object"
							? Array.isArray(value)
								? "array"
								: "object"
							: String(value);
					onConflict?.(`Invalid ${keyword}.${key} default: ${description}`);
					continue;
				}
				const priority = source.key === key ? 2 : key === "layoutMode" ? 0 : 1;
				const previous = priorities.get(source.key);
				if (previous !== undefined && output[source.key] !== source.value) {
					onConflict?.(`Conflicting ${keyword}.${source.key} defaults; canonical value wins`);
				}
				if (previous !== undefined && previous > priority) continue;
				priorities.set(source.key, priority);
				output[source.key] = source.value;
			}
			return [keyword, output];
		}),
	);
}
