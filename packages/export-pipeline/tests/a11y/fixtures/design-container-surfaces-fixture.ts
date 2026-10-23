import { readLesson, serializeFrontmatter } from "@praxity/grammar";
import { DEFAULT_DESIGN_VARIANTS } from "../../../../editor-core/src/lib/themes/design-variant-defaults";
import { THEME_PRESET_DEFAULTS } from "../../../../editor-core/src/lib/themes/theme-preset-defaults";
import type { DesktopExportInput } from "../../../src/build";

export const CONTAINER_SURFACE_STYLES = [
	"none",
	"outline",
	"shaded",
	"primary",
	"secondary",
] as const;
export const NOTE_SURFACE_TONES = ["info", "success", "warning"] as const;
export const CARD_SURFACE_LAYOUTS = ["grid", "single", "masonry"] as const;

export function designContainerSurfaceFixtures(): Array<{
	route: string;
	course: DesktopExportInput;
}> {
	const grammar =
		"# Container surfaces\n\n::: quote {style=none source=https://example.com/none}\nQuote none text.\nspeaker: Speaker none\nwork: Work none\n:::\n\n::: accordion {style=none}\n:: Accordion none {level=3}\nFirst panel body.\n\n:: Second none panel {level=3}\nSecond panel body.\n:::\n\n::: cards {style=none layout=grid columns=2}\n:: Card grid static none {level=3}\nFront content.\n:::\n\n::: cards {style=none layout=grid columns=2}\n:: Card grid flip none {level=3}\nFront content.\n\n::: back\nBack content.\n:::\n:::\n\n::: cards {style=none layout=slides columns=2}\n:: Card single static none {level=3}\nFront content.\n:::\n\n::: cards {style=none layout=slides columns=2}\n:: Card single flip none {level=3}\nFront content.\n\n::: back\nBack content.\n:::\n:::\n\n::: cards {style=none layout=masonry columns=2}\n:: Card masonry static none {level=3}\nFront content.\n:::\n\n::: cards {style=none layout=masonry columns=2}\n:: Card masonry flip none {level=3}\nFront content.\n\n::: back\nBack content.\n:::\n:::\n\n::: quote {style=outline source=https://example.com/outline}\nQuote outline text.\nspeaker: Speaker outline\nwork: Work outline\n:::\n\n::: accordion {style=outline}\n:: Accordion outline {level=3}\nFirst panel body.\n\n:: Second outline panel {level=3}\nSecond panel body.\n:::\n\n::: cards {style=outline layout=grid columns=2}\n:: Card grid static outline {level=3}\nFront content.\n:::\n\n::: cards {style=outline layout=grid columns=2}\n:: Card grid flip outline {level=3}\nFront content.\n\n::: back\nBack content.\n:::\n:::\n\n::: cards {style=outline layout=slides columns=2}\n:: Card single static outline {level=3}\nFront content.\n:::\n\n::: cards {style=outline layout=slides columns=2}\n:: Card single flip outline {level=3}\nFront content.\n\n::: back\nBack content.\n:::\n:::\n\n::: cards {style=outline layout=masonry columns=2}\n:: Card masonry static outline {level=3}\nFront content.\n:::\n\n::: cards {style=outline layout=masonry columns=2}\n:: Card masonry flip outline {level=3}\nFront content.\n\n::: back\nBack content.\n:::\n:::\n\n::: quote {style=shaded source=https://example.com/shaded}\nQuote shaded text.\nspeaker: Speaker shaded\nwork: Work shaded\n:::\n\n::: accordion {style=shaded}\n:: Accordion shaded {level=3}\nFirst panel body.\n\n:: Second shaded panel {level=3}\nSecond panel body.\n:::\n\n::: cards {style=shaded layout=grid columns=2}\n:: Card grid static shaded {level=3}\nFront content.\n:::\n\n::: cards {style=shaded layout=grid columns=2}\n:: Card grid flip shaded {level=3}\nFront content.\n\n::: back\nBack content.\n:::\n:::\n\n::: cards {style=shaded layout=slides columns=2}\n:: Card single static shaded {level=3}\nFront content.\n:::\n\n::: cards {style=shaded layout=slides columns=2}\n:: Card single flip shaded {level=3}\nFront content.\n\n::: back\nBack content.\n:::\n:::\n\n::: cards {style=shaded layout=masonry columns=2}\n:: Card masonry static shaded {level=3}\nFront content.\n:::\n\n::: cards {style=shaded layout=masonry columns=2}\n:: Card masonry flip shaded {level=3}\nFront content.\n\n::: back\nBack content.\n:::\n:::\n\n::: quote {style=primary source=https://example.com/primary}\nQuote primary text.\nspeaker: Speaker primary\nwork: Work primary\n:::\n\n::: accordion {style=primary}\n:: Accordion primary {level=3}\nFirst panel body.\n\n:: Second primary panel {level=3}\nSecond panel body.\n:::\n\n::: cards {style=primary layout=grid columns=2}\n:: Card grid static primary {level=3}\nFront content.\n:::\n\n::: cards {style=primary layout=grid columns=2}\n:: Card grid flip primary {level=3}\nFront content.\n\n::: back\nBack content.\n:::\n:::\n\n::: cards {style=primary layout=slides columns=2}\n:: Card single static primary {level=3}\nFront content.\n:::\n\n::: cards {style=primary layout=slides columns=2}\n:: Card single flip primary {level=3}\nFront content.\n\n::: back\nBack content.\n:::\n:::\n\n::: cards {style=primary layout=masonry columns=2}\n:: Card masonry static primary {level=3}\nFront content.\n:::\n\n::: cards {style=primary layout=masonry columns=2}\n:: Card masonry flip primary {level=3}\nFront content.\n\n::: back\nBack content.\n:::\n:::\n\n::: quote {style=secondary source=https://example.com/secondary}\nQuote secondary text.\nspeaker: Speaker secondary\nwork: Work secondary\n:::\n\n::: accordion {style=secondary}\n:: Accordion secondary {level=3}\nFirst panel body.\n\n:: Second secondary panel {level=3}\nSecond panel body.\n:::\n\n::: cards {style=secondary layout=grid columns=2}\n:: Card grid static secondary {level=3}\nFront content.\n:::\n\n::: cards {style=secondary layout=grid columns=2}\n:: Card grid flip secondary {level=3}\nFront content.\n\n::: back\nBack content.\n:::\n:::\n\n::: cards {style=secondary layout=slides columns=2}\n:: Card single static secondary {level=3}\nFront content.\n:::\n\n::: cards {style=secondary layout=slides columns=2}\n:: Card single flip secondary {level=3}\nFront content.\n\n::: back\nBack content.\n:::\n:::\n\n::: cards {style=secondary layout=masonry columns=2}\n:: Card masonry static secondary {level=3}\nFront content.\n:::\n\n::: cards {style=secondary layout=masonry columns=2}\n:: Card masonry flip secondary {level=3}\nFront content.\n\n::: back\nBack content.\n:::\n:::\n\n::: note {style=shaded tone=info}\nNote info shaded text.\n:::\n\n::: note {style=shaded tone=info}\nNote info filled text.\n:::\n\n::: note {style=outline tone=info}\nNote info outline text.\n:::\n\n::: note {style=shaded tone=success}\nNote success shaded text.\n:::\n\n::: note {style=shaded tone=success}\nNote success filled text.\n:::\n\n::: note {style=outline tone=success}\nNote success outline text.\n:::\n\n::: note {style=shaded tone=warning}\nNote warning shaded text.\n:::\n\n::: note {style=shaded tone=warning}\nNote warning filled text.\n:::\n\n::: note {style=outline tone=warning}\nNote warning outline text.\n:::\n\n::: quote {source=https://example.com/legacy}\nLegacy quote text.\nspeaker: Legacy speaker\nwork: Legacy work\n:::\n\n::: cards {layout=slides}\n:: Boundary card one {level=3}\nReview the request.\n\n:: Boundary card two {level=3}\nConfirm the next action.\n:::\n\n::: cards {style=primary}\n:: Before the meeting {level=3}\nSend the agenda so everyone knows what to prepare.\n:::\n\n::: cards After the meeting {style=shaded level=3}\n:: After the meeting {level=3}\nShare the decisions and the tasks each person agreed to complete.\n:::\n";
	return (["light", "dark"] as const).map((colorMode) => {
		const parsed = readLesson(
			serializeFrontmatter(
				{
					title: "Container surfaces",
					lang: "en",
					design: {
						...DEFAULT_DESIGN_VARIANTS,
						...THEME_PRESET_DEFAULTS.standard,
						palette: "standard",
						colorMode,
						navArchetype: "minimal",
						dividerStyle: "none",
					},
				},
				grammar,
			),
		);
		// Retain the one-column surface samples supported by the publisher's
		// stored model; G4 source accepts card grids with two to four columns.
		for (const block of parsed.blocks) {
			if (block.type !== "card") continue;
			const items = block.data.items as Array<{ label: string }>;
			if (!items?.[0]?.label.startsWith("Card ")) continue;
			block.data.columns = 1;
			if (items[0].label.startsWith("Card single ")) block.data.layout = "single";
		}
		parsed.blocks.push({
			id: "plain-reading-table",
			type: "table",
			data: {
				title: "Reading table",
				headers: ["First", "Second"],
				rows: [
					["One", "Two"],
					["Three", "Four"],
				],
				striped: true,
				shadeHeaders: true,
				gridlines: "all",
			},
		});
		return {
			route: `design-container-surfaces-${colorMode}`,
			course: {
				courseId: `container-surfaces-${colorMode}`,
				blocks: parsed.blocks,
				frontmatter: parsed.frontmatter ?? {},
				config: { completionThreshold: 0.8 },
				resolvedAssets: new Map(),
				viewerVersion: "local",
				locale: "en",
			},
		};
	});
}
