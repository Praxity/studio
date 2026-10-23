import { expect, it } from "vitest";
import { getDeckPreset, normalizeDeckDesign, resolveDeckDesign } from "../src/deck-design";
import { parseFrontmatter, serializeFrontmatter } from "../src/frontmatter";

it("defaults to free lesson navigation and admits only boolean ordering overrides", () => {
	expect(normalizeDeckDesign(undefined)).toEqual({});
	expect(resolveDeckDesign(undefined).sequentialLessons).toBe(false);
	for (const sequentialLessons of [true, false]) {
		expect(normalizeDeckDesign({ sequentialLessons })).toEqual({ sequentialLessons });
		expect(resolveDeckDesign({ sequentialLessons }).sequentialLessons).toBe(sequentialLessons);
	}
	for (const sequentialLessons of [null, "true", "false", 0, 1, [], {}, undefined]) {
		expect(normalizeDeckDesign({ sequentialLessons })).toEqual({});
		expect(resolveDeckDesign({ sequentialLessons }).sequentialLessons).toBe(false);
	}
	for (const preset of ["compact", "transcript", "selfPaced", "custom"] as const)
		expect(resolveDeckDesign({ preset }).sequentialLessons).toBe(false);
});

it("resolves deck defaults and applies safe overrides to presets", () => {
	expect(resolveDeckDesign(undefined)).toEqual({
		preset: "compact",
		outline: true,
		outlineDetail: "moduleLinks",
		initialPanel: "closed",
		slideCounter: true,
		followNarration: true,
		autoAdvance: false,
		sequentialLessons: false,
	});
	expect(resolveDeckDesign({ preset: "transcript", autoAdvance: false })).toMatchObject({
		initialPanel: "closed",
		autoAdvance: false,
	});
	expect(
		resolveDeckDesign({ preset: "selfPaced", outline: false, initialPanel: "outline" }),
	).toMatchObject({
		initialPanel: "closed",
		autoAdvance: false,
	});
	for (const raw of [
		null,
		[],
		"transcript",
		{ preset: "bogus", autoAdvance: "false", initialPanel: "bad", outlineDetail: "all" },
	])
		expect(resolveDeckDesign(raw)).toEqual(getDeckPreset("compact"));
});

it("starts transcript presets closed and preserves authored panel choices", () => {
	expect(getDeckPreset("transcript").initialPanel).toBe("closed");
	expect(resolveDeckDesign({ preset: "transcript" }).initialPanel).toBe("closed");
	expect(normalizeDeckDesign({ preset: "transcript" })).toEqual({ preset: "transcript" });
	for (const initialPanel of ["closed", "transcript", "outline"] as const) {
		expect(resolveDeckDesign({ preset: "transcript", initialPanel }).initialPanel).toBe(
			initialPanel,
		);
	}
});

it("starts every deck preset with auto-advance off and preserves an explicit opt-in", () => {
	for (const preset of ["compact", "transcript", "selfPaced", "custom"] as const) {
		expect(getDeckPreset(preset).autoAdvance).toBe(false);
		expect(resolveDeckDesign({ preset }).autoAdvance).toBe(false);
		expect(resolveDeckDesign({ preset, autoAdvance: true }).autoAdvance).toBe(true);
	}
});

it("round-trips Studio deck metadata without changing content or assessment rules", () => {
	const source =
		"---\ntitle: Lesson\ndesign:\n  deck:\n    preset: selfPaced\n    followNarration: false\n    outlineDetail: currentModule\n---\n\n# Check {deckStop}\n\n::: choice Check {deckGate=attempt}\n(x) Yes\n:::";
	const { frontmatter, body } = parseFrontmatter(source);
	const reopened = parseFrontmatter(serializeFrontmatter(frontmatter, body));
	expect(reopened).toEqual({ frontmatter, body });
	expect(resolveDeckDesign(reopened.frontmatter.design?.deck)).toMatchObject({
		autoAdvance: false,
		followNarration: false,
		outlineDetail: "currentModule",
	});
});

it("keeps lesson overrides sparse until course settings are applied", () => {
	const lesson = normalizeDeckDesign({ slideCounter: false, extra: true });
	expect(lesson).toEqual({ slideCounter: false });
	expect(resolveDeckDesign({ preset: "transcript", autoAdvance: false, ...lesson })).toMatchObject({
		initialPanel: "closed",
		autoAdvance: false,
		slideCounter: false,
	});
});

it("inherits outline detail and accepts only the two authored choices", () => {
	for (const outlineDetail of ["currentModule", "moduleLinks"] as const) {
		expect(normalizeDeckDesign({ outlineDetail })).toEqual({ outlineDetail });
		expect(
			resolveDeckDesign({ outlineDetail, ...normalizeDeckDesign({ slideCounter: false }) })
				.outlineDetail,
		).toBe(outlineDetail);
	}
	expect(normalizeDeckDesign({ outlineDetail: "all" })).toEqual({});
	expect(
		resolveDeckDesign({
			outlineDetail: "currentModule",
			...normalizeDeckDesign({ outlineDetail: "all" }),
		}).outlineDetail,
	).toBe("currentModule");
	expect(
		resolveDeckDesign({
			outlineDetail: "moduleLinks",
			...normalizeDeckDesign({ outlineDetail: "currentModule" }),
		}).outlineDetail,
	).toBe("currentModule");
});
