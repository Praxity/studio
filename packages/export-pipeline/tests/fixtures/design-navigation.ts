import { readLesson } from "@praxity/grammar";
import {
	grammar4Starter,
	withFixtureSetting,
} from "../../../grammar/__tests__/helpers/lesson-fixture.ts";
import type { DesktopExportInput } from "../../src/build";

const SOURCE =
	"# Navigation\n\n## First section\n\nRead about [navigation]{Moving between sections.}.\n\n## Second section\n\nContinue through the course.\n\n# Practice\n\n## Practice section\n\nReview the example.\n";
const baseline = {
	colorMode: "auto",
	navArchetype: "custom",
	navArchetypeBase: "sidebar",
	navOutline: true,
	navTopBar: true,
	navPrevNext: true,
	navPrevNextPosition: "bottom",
	navProgressStyle: "bar",
	navReadingSupportPlacement: "topBar",
	showA11yPill: true,
	navEdgeArrows: false,
	navFloatingToc: false,
	glossaryPage: true,
};
const LOGOS = new Map([
	[
		"assets/logo.svg",
		new TextEncoder().encode(
			'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#14532d"/></svg>',
		),
	],
	[
		"assets/dark-logo.svg",
		new TextEncoder().encode(
			'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><circle cx="60" cy="20" r="20" fill="#fef08a"/></svg>',
		),
	],
	[
		"assets/before-illustration.svg",
		new TextEncoder().encode(
			'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#14532d"/></svg>',
		),
	],
	[
		"assets/after-illustration.svg",
		new TextEncoder().encode(
			'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#fef08a"/></svg>',
		),
	],
]);

export const defaultControlCases = [
	["accordion", "style", "primary", "outline"],
	["tabs", "style", "pills", "outline"],
	["tabs", "orientation", "vertical", "horizontal"],
	["card", "layout", "slides", "grid"],
	["card", "style", "shaded", "outline"],
	["card", "shadow", "elevated", "none"],
	["card", "transition", "slide", "none"],
	["sequence", "style", "none", "timeline"],
	["sequence", "orientation", "horizontal", "vertical"],
	["sequence", "alignment", "right", "left"],
	["comparison", "layout", "slider", "side-by-side"],
	["rate", "style", "stars", "likert"],
	["assessment-group", "mode", "oneOf", "all"],
	["signature", "mode", "type", "draw"],
] as const;

export function buildDesignNavigationFixtures(): Array<{
	route: string;
	course: DesktopExportInput;
}> {
	const cases: Array<{ name: string; design: Record<string, unknown>; source?: string }> = [];
	for (const preset of ["sidebar", "bottomBar", "slides", "scroll", "minimal", "embedded", "none"])
		cases.push({ name: `preset-${preset}`, design: { navArchetype: preset } });
	for (const [label, key] of [
		["outline", "navOutline"],
		["header", "navTopBar"],
		["side-arrows", "navEdgeArrows"],
		["inpage", "navFloatingToc"],
		["glossary", "glossaryPage"],
	])
		for (const enabled of [true, false])
			cases.push({
				name: `${label}-${enabled}`,
				design: {
					...baseline,
					[key]: enabled,
					...(key === "navEdgeArrows" && enabled
						? { navPrevNext: false, navBottomArrows: false, navProgressStyle: "dots" }
						: {}),
				},
			});
	for (const mode of ["bar", "dots", "dotsArrows", "hidden"])
		cases.push({
			name: `bottom-${mode}`,
			design: {
				...baseline,
				navPrevNext: mode === "bar",
				navProgressStyle: mode === "bar" ? "bar" : mode === "hidden" ? "none" : "dots",
				navBottomArrows: mode === "dotsArrows",
			},
		});
	for (const placement of ["topBar", "bottomBar", "sidebar", "none"])
		cases.push({
			name: `reading-${placement}`,
			design: {
				...baseline,
				navReadingSupportPlacement: placement,
				showA11yPill: placement !== "none",
			},
		});
	for (const placement of ["header", "sidebar", "hidden"])
		cases.push({
			name: `brand-${placement}`,
			design: {
				...baseline,
				brand: {
					logoUrl: "/assets/logo.svg",
					logoDarkUrl: "/assets/dark-logo.svg",
					logoPlacement: placement,
				},
			},
		});
	cases.push({
		name: "brand-only-dark",
		design: {
			...baseline,
			brand: { logoDarkUrl: "/assets/dark-logo.svg", logoPlacement: "header" },
		},
	});
	cases.push({
		name: "brand-removed",
		design: { ...baseline, brand: { logoPlacement: "header" } },
	});
	for (const [keyword, key, selected, explicit] of defaultControlCases) {
		let omitted = grammar4Starter(keyword).replace(/^#.*\n\n/, "");
		omitted = withFixtureSetting(omitted, key);
		if (keyword === "card" && key === "shadow")
			omitted = withFixtureSetting(omitted, "style", "outline");
		if (keyword === "card" && key === "transition")
			omitted = withFixtureSetting(omitted, "layout", "slides");
		if (keyword === "assessment-group") {
			omitted = withFixtureSetting(omitted, "requireAll", "true").replace(
				/:::\n$/,
				"::: choice Choose the second answer {scored attempts=2 points=10 level=3}\n(x) Second correct answer\n( ) Second incorrect answer\n:::\n:::\n",
			);
		}
		const authored = withFixtureSetting(omitted, key, explicit);
		cases.push({
			name: `defaults-${keyword}-${key}`,
			design: { ...baseline, componentDefaults: { [keyword]: { [key]: selected } } },
			source: `# Default\n\n${omitted}\n\n# Override\n\n${authored}`,
		});
	}
	return cases.map(({ name, design, source }) => ({
		route: `design-navigation/${name}`,
		course: {
			courseId: `design-navigation-${name}`,
			blocks: readLesson(source ?? SOURCE).blocks,
			frontmatter: {
				title: "Design navigation",
				lang: "en",
				design,
			} as unknown as DesktopExportInput["frontmatter"],
			config: { completionThreshold: 1 },
			resolvedAssets: LOGOS,
			viewerVersion: "0.0.0",
			locale: "en",
		},
	}));
}
