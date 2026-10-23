import { describe, expect, it } from "vitest";
import {
	readBlockFixture as readBlockSource,
	replayLesson,
	grammar4Starter as starterSnippet,
	withFixtureSetting,
} from "../../grammar/__tests__/helpers/lesson-fixture.ts";
import { adaptGrammarPreviewBlocks } from "../src/grammar-adapter";

const cases = [
	["accordion", "style", "primary", "outline", "accordionStyle", "primary", "outline"],
	["tabs", "style", "pills", "outline", "variant", "pills", "outline"],
	["tabs", "orientation", "vertical", "horizontal", "orientation", "vertical", "horizontal"],
	["card", "layout", "slides", "grid", "layout", "single", "grid"],
	["card", "width", "narrow", "wide", "layoutMode", "narrow", "wide"],
	["card", "style", "shaded", "outline", "style", "shaded", "outline"],
	["card", "shadow", "elevated", "none", "shadow", "elevated", "none"],
	["card", "transition", "slide", "none", "transition", "slide", "none"],
	["sequence", "style", "none", "timeline", "variant", "plain", "timeline"],
	["sequence", "orientation", "horizontal", "vertical", "orientation", "horizontal", "vertical"],
	["sequence", "alignment", "right", "left", "alignment", "right", "left"],
	["rate", "style", "stars", "likert", "style", "stars", "likert"],
	["assessment-group", "mode", "oneOf", "all", "mode", "oneOf", "all"],
	["signature", "mode", "type", "draw", "mode", "type", "draw"],
] as const;

function sourceWithSetting(keyword: string, key: string, value?: string): string {
	return withFixtureSetting(starterSnippet(keyword), key, value);
}

describe("Design component default precedence", () => {
	it.each(["choose-one", "choose-many"])(
		"inherits %s scoring without overriding authored scoring",
		(keyword) => {
			const defaults = { [keyword]: { scored: true } };
			const omitted = readBlockSource(sourceWithSetting(keyword, "scored"));
			const explicit = readBlockSource(sourceWithSetting(keyword, "scored", "false"));
			expect(adaptGrammarPreviewBlocks(omitted.blocks, defaults)[0].data.gradingMode).toBe("exact");
			expect(adaptGrammarPreviewBlocks(explicit.blocks, defaults)[0].data.gradingMode).toBe("none");
			expect(
				adaptGrammarPreviewBlocks(adaptGrammarPreviewBlocks(omitted.blocks, defaults), defaults)[0]
					.data.gradingMode,
			).toBe("exact");
		},
	);
	it.each(cases)(
		"%s %s applies only when source omits it",
		(keyword, key, selected, explicit, field, expectedDefault, expectedExplicit) => {
			const defaults = { [keyword]: { [key]: selected } };
			const omitted = readBlockSource(sourceWithSetting(keyword, key));
			const authored = readBlockSource(sourceWithSetting(keyword, key, explicit));
			expect(adaptGrammarPreviewBlocks(omitted.blocks, defaults)[0].data[field]).toBe(
				expectedDefault,
			);
			expect(adaptGrammarPreviewBlocks(authored.blocks, defaults)[0].data[field]).toBe(
				expectedExplicit,
			);
			expect(
				adaptGrammarPreviewBlocks(readBlockSource(replayLesson(omitted)).blocks, defaults)[0].data[
					field
				],
			).toBe(expectedDefault);
			expect(
				adaptGrammarPreviewBlocks(readBlockSource(replayLesson(authored)).blocks, defaults)[0].data[
					field
				],
			).toBe(expectedExplicit);
		},
	);
	it("comparison layout defaults select the renderer without overriding explicit source", () => {
		const defaults = { comparison: { layout: "slider" } };
		const omitted = readBlockSource(sourceWithSetting("comparison", "layout"));
		expect(adaptGrammarPreviewBlocks(omitted.blocks, defaults)[0].type).toBe("imageComparison");
		expect(
			adaptGrammarPreviewBlocks(readBlockSource(replayLesson(omitted)).blocks, defaults)[0].type,
		).toBe("imageComparison");
		const explicit = readBlockSource(sourceWithSetting("comparison", "layout", "side-by-side"));
		expect(adaptGrammarPreviewBlocks(explicit.blocks, defaults)[0].type).toBe("columns");
	});
	it("keeps nested explicit overrides while applying defaults to sibling blocks", () => {
		const source =
			"# Untitled {hideTitle}\n\n::: columns\n::\n::: tabs\n:: First\nBody.\n:::\n\n::\n::: tabs {style=outline}\n:: Second\nBody.\n:::\n:::\n";
		const [columns] = adaptGrammarPreviewBlocks(readBlockSource(source).blocks, {
			tabs: { variant: "pills" },
		});
		const items = columns.data.items as Array<{ children: Array<{ data: { variant?: string } }> }>;
		expect(items.map((item) => item.children[0].data.variant)).toEqual(["pills", "outline"]);
	});
	it("keeps image size and outer width independent in defaults and authored overrides", () => {
		const image = "# Untitled {hideTitle}\n\n![Example](/assets/example.png)\n";
		const defaults = { image: { size: "small", width: "full" } };
		const inherited = adaptGrammarPreviewBlocks(readBlockSource(image).blocks, defaults)[0];
		expect(inherited.data).toMatchObject({ width: "small", layoutMode: "full" });
		const authored = adaptGrammarPreviewBlocks(
			readBlockSource(
				image.replace(
					"![Example](/assets/example.png)",
					"![Example](/assets/example.png){size=medium width=narrow}",
				),
			).blocks,
			defaults,
		)[0];
		expect(authored.data).toMatchObject({ width: "medium", layoutMode: "narrow" });
		const legacy = adaptGrammarPreviewBlocks(readBlockSource(image).blocks, {
			image: { width: "small", layout: "full" },
		})[0];
		expect(legacy.data).toMatchObject({ width: "small", layoutMode: "full" });
	});
});

it.each(["primary", "secondary"])(
	"preserves the named card %s surface through adaptation",
	(style) => {
		const parsed = readBlockSource(
			`# Fixture {hideTitle}\n\n::: cards {style=${style}}\n:: Surface\nBody.\n:::\n`,
		);
		expect(adaptGrammarPreviewBlocks(parsed.blocks)[0].data.style).toBe(style);
		expect(
			adaptGrammarPreviewBlocks(readBlockSource(replayLesson(parsed)).blocks)[0].data.style,
		).toBe(style);
	},
);
