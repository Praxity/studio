import {
	COURSE_PRESET_ALIASES,
	resolveCoursePresetId,
	withCoursePresetAliases,
} from "./course-theme-ids";

function palette(accent: string, darkAccent: string, paper = "#ffffff") {
	return {
		light: {
			colorBackground: paper,
			colorSurface: "#f4f6f8",
			colorNavigationSurface: paper,
			colorText: "#18212d",
			colorTextMuted: "#414a54",
			colorBorder: "#78808a",
			colorAccent: accent,
			colorSecondary: null,
			colorTertiary: null,
			colorButtonBackground: accent,
			colorButtonText: "#ffffff",
			colorSuccess: "#285039",
			colorError: "#78343c",
			colorWarning: "#624218",
		},
		dark: {
			colorBackground: "#121417",
			colorSurface: "#1c2025",
			colorNavigationSurface: "#121417",
			colorText: "#eceef0",
			colorTextMuted: "#ccd2d9",
			colorBorder: "#78828e",
			colorAccent: darkAccent,
			colorSecondary: null,
			colorTertiary: null,
			colorButtonBackground: darkAccent,
			colorButtonText: "#121417",
			// Dark status saturation must retain the existing Lc75 reading floor.
			colorSuccess: "#9ee1ab",
			colorError: "#ffbddb",
			colorWarning: "#f0dfb9",
		},
	};
}

/** One palette owner, shared by editor swatches, preview and exported courses. */
export const READING_PALETTES = withCoursePresetAliases({
	ink: palette("#294c78", "#c9dff8"),
	forest: palette("#245036", "#c6dfd1"),
	plum: palette("#633655", "#e5c9db"),
	clay: palette("#823c2e", "#f1cbbd", "#fbf9f6"),
	clear: palette("#294c78", "#c9dff8"),
});

// Saved Studio designs contain the old preset's default colours. Keep these
// migration facts separate from the current roles; authored overrides survive.
const legacyPalettes = {
	clean: {
		light: {
			colorBackground: "#fbfbfb",
			colorSurface: "#f3f3f3",
			colorNavigationSurface: "#e7e7e7",
			colorText: "#181818",
			colorAccent: "#343434",
			colorButtonBackground: "#1a1a1a",
			colorButtonText: "#ffffff",
			colorSuccess: "#285039",
			colorError: "#78343c",
			colorWarning: "#624218",
		},
		dark: {
			colorBackground: "#171717",
			colorSurface: "#222222",
			colorNavigationSurface: "#2b2b2b",
			colorText: "#f5f5f5",
			colorAccent: "#e2e2e2",
			colorButtonBackground: "#f2f2f2",
			colorButtonText: "#171717",
			colorSuccess: "#cbe5d2",
			colorError: "#f1d5dc",
			colorWarning: "#f0dfb9",
		},
	},
	waves: {
		light: {
			colorBackground: "#ffffff",
			colorSurface: "#f5f8fc",
			colorNavigationSurface: "#e8eef6",
			colorText: "#18212d",
			colorAccent: "#294c78",
			colorButtonBackground: "#294c78",
			colorButtonText: "#ffffff",
			colorSuccess: "#285039",
			colorError: "#78343c",
			colorWarning: "#624218",
		},
		dark: {
			colorBackground: "#171c24",
			colorSurface: "#202935",
			colorNavigationSurface: "#263244",
			colorText: "#f2f6fc",
			colorAccent: "#c9dff8",
			colorButtonBackground: "#c9dff8",
			colorButtonText: "#172433",
			colorSuccess: "#cbe5d2",
			colorError: "#f1d5dc",
			colorWarning: "#f0dfb9",
		},
	},
	standard: {
		light: {
			colorBackground: "#f5faf4",
			colorSurface: "#e8f2e8",
			colorNavigationSurface: "#dcebdd",
			colorText: "#12231a",
			colorAccent: "#244d36",
			colorSecondary: "#634314",
			colorButtonBackground: "#efd078",
			colorButtonText: "#18271e",
			colorSuccess: "#285037",
			colorError: "#72373e",
			colorWarning: "#644317",
		},
		dark: {
			colorBackground: "#142820",
			colorSurface: "#1e352a",
			colorNavigationSurface: "#274333",
			colorText: "#f2faee",
			colorAccent: "#d1ebd6",
			colorSecondary: "#f3da99",
			colorButtonBackground: "#efd078",
			colorButtonText: "#18271e",
			colorSuccess: "#d1e7ca",
			colorError: "#f5d6d6",
			colorWarning: "#f4dfa9",
		},
	},
	bauhaus: {
		light: {
			colorBackground: "#fff9eb",
			colorSurface: "#fff1cf",
			colorNavigationSurface: "#f0e5cb",
			colorText: "#202024",
			colorAccent: "#81222c",
			colorSecondary: "#263c6c",
			colorButtonBackground: "#f5d14d",
			colorButtonText: "#202024",
			colorSuccess: "#2b4f37",
			colorError: "#81222c",
			colorWarning: "#624014",
		},
		dark: {
			colorBackground: "#25221c",
			colorSurface: "#332e24",
			colorNavigationSurface: "#423a29",
			colorText: "#fff8e9",
			colorAccent: "#ffd1cb",
			colorSecondary: "#ccdef7",
			colorButtonBackground: "#f5d14d",
			colorButtonText: "#202024",
			colorSuccess: "#d8eaca",
			colorError: "#ffd1cb",
			colorWarning: "#f7e4b1",
		},
	},
	campfire: {
		light: {
			colorBackground: "#fff7ee",
			colorSurface: "#f8eadb",
			colorNavigationSurface: "#eedbc8",
			colorText: "#261913",
			colorAccent: "#622a1d",
			colorSecondary: "#33402d",
			colorButtonBackground: "#773323",
			colorButtonText: "#fff7ee",
			colorSuccess: "#2d412d",
			colorError: "#612930",
			colorWarning: "#533517",
		},
		dark: {
			colorBackground: "#2b1c16",
			colorSurface: "#3c2a21",
			colorNavigationSurface: "#493428",
			colorText: "#fff6eb",
			colorAccent: "#f4d4bf",
			colorSecondary: "#d9e8c6",
			colorButtonBackground: "#f1cfad",
			colorButtonText: "#302018",
			colorSuccess: "#d6e8c7",
			colorError: "#f6d3d8",
			colorWarning: "#f2dfb6",
		},
	},
	darkroom: {
		light: {
			colorBackground: "#faf5fc",
			colorSurface: "#f1e7f6",
			colorNavigationSurface: "#e9dcef",
			colorText: "#211628",
			colorAccent: "#523069",
			colorSecondary: "#583443",
			colorButtonBackground: "#56336f",
			colorButtonText: "#faf5fc",
			colorSuccess: "#2a4534",
			colorError: "#642d3c",
			colorWarning: "#573915",
		},
		dark: {
			colorBackground: "#211a2c",
			colorSurface: "#30243e",
			colorNavigationSurface: "#3c2d4c",
			colorText: "#fcf4ff",
			colorAccent: "#e5d4fa",
			colorSecondary: "#f3d7e4",
			colorButtonBackground: "#e5d4fa",
			colorButtonText: "#2a1c39",
			colorSuccess: "#d2e8d5",
			colorError: "#f4d5e3",
			colorWarning: "#f0dfbd",
		},
	},
} as const;
const legacyNames: Record<string, keyof typeof legacyPalettes> = {
	clean: "clean",
	minimal: "clean",
	waves: "waves",
	standard: "standard",
	grove: "bauhaus",
	bauhaus: "bauhaus",
	blueprint: "bauhaus",
	marquee: "darkroom",
	darkroom: "darkroom",
	campfire: "campfire",
	dunes: "campfire",
};

export function migrateCoursePresetDesign(
	design: Record<string, unknown>,
): Record<string, unknown> {
	const name = typeof design.palette === "string" ? design.palette : "";
	const id = resolveCoursePresetId(name);
	const legacyName = Object.hasOwn(legacyNames, name) ? legacyNames[name] : undefined;
	if (!legacyName)
		return {
			...design,
			...(name && Object.hasOwn(COURSE_PRESET_ALIASES, name) ? { palette: id } : {}),
		};
	const current = READING_PALETTES[id];
	const old = legacyPalettes[legacyName];
	const migrated: Record<string, unknown> = { ...design, palette: id };
	const replace = (key: string, oldValue: string, value: string) => {
		if (typeof design[key] === "string" && design[key].toLowerCase() === oldValue.toLowerCase())
			migrated[key] = value;
	};
	for (const mode of ["light", "dark"] as const) {
		replace(
			mode === "light" ? "colorBackgroundLight" : "colorBackgroundDark",
			old[mode].colorBackground,
			current[mode].colorBackground,
		);
		replace("colorBackground", old[mode].colorBackground, current[mode].colorBackground);
		for (const [key, value] of Object.entries(old[mode])) {
			if (key === "colorBackground") continue;
			if (
				design.accentHueCustomized === true &&
				(key === "colorAccent" || key === "colorButtonBackground")
			)
				continue;
			const next = current[mode][key as keyof typeof current.light];
			if (typeof next === "string") replace(key, value, next);
		}
	}
	return migrated;
}
