import { extractNarrationSegments, parseNarrationVtt } from "@praxity/shared-blocks/narration";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { describe, expect, it } from "vitest";
import {
	buildNarrationVtt,
	expandPronunciation,
	lexiconFingerprint,
	mergePronunciationLexemes,
	NARRATION_METADATA_VERSION,
	parseNarrationProvenance,
	plainNarrationText,
	SONIOX_MODEL,
} from "../narration";

const provenance = {
	provider: "soniox" as const,
	model: SONIOX_MODEL,
	language: "en",
	voice: "Maya",
	speed: 1,
	scriptHash: "a".repeat(64),
	lexiconHash: "b".repeat(64),
	recipeHash: "c".repeat(64),
	version: NARRATION_METADATA_VERSION,
} as const;

describe("narration authoring", () => {
	it("strips non-spoken URL text", () => {
		expect(plainNarrationText("See https://example.test/path.")).toBe("See .");
	});

	it("applies lesson overrides and longest literal pronunciation matches", () => {
		const merged = mergePronunciationLexemes(
			[
				{ grapheme: "AI", alias: "A I", lang: "en" },
				{ grapheme: "AI Lab", alias: "Aye Eye Lab", lang: "en" },
			],
			[{ grapheme: "AI", alias: "artificial intelligence", lang: "en" }],
		);
		const expanded = expandPronunciation("AI Lab uses AI.", merged, "en");

		expect(expanded.synthesisText).toBe("Aye Eye Lab uses artificial intelligence.");
		expect(expanded.matches.map((match) => match.grapheme)).toEqual(["AI Lab", "AI"]);
		expect(lexiconFingerprint(expanded.matches)).toBe(
			lexiconFingerprint([...expanded.matches, expanded.matches[0]]),
		);
		expect(lexiconFingerprint(expanded.matches)).not.toBe(
			lexiconFingerprint([{ grapheme: "unused", alias: "unused", lang: "en" }]),
		);
	});

	it("builds original-text VTT cues with closed provenance and rejects incomplete timing", () => {
		const expanded = expandPronunciation(
			"AI works. Great!",
			[{ grapheme: "AI", alias: "A I", lang: "en" }],
			"en",
		);
		const characters = [...expanded.synthesisText];
		const starts = characters.map((_, index) => index / 10);
		const ends = characters.map((_, index) => (index + 1) / 10);
		const result = buildNarrationVtt(expanded, characters, starts, ends, provenance);

		expect(result.vtt).toContain("AI works.");
		expect(result.vtt).not.toContain("A I works.");
		expect(parseNarrationProvenance(result.vtt)).toEqual(provenance);
		expect(
			parseNarrationProvenance(
				result.vtt.slice(0, result.vtt.indexOf("\n\n1\n")).trimEnd().concat("\n"),
			),
		).toEqual(provenance);
		expect(
			parseNarrationProvenance(
				result.vtt.replace(
					`version=${NARRATION_METADATA_VERSION}`,
					`version=${NARRATION_METADATA_VERSION}\nextra=no`,
				),
			),
		).toBeNull();
		expect(
			parseNarrationVtt(result.vtt)
				?.map((cue) => cue.text)
				.join(" "),
		).toBe("AI works. Great!");
		expect(() =>
			buildNarrationVtt(expanded, characters.slice(1), starts.slice(1), ends.slice(1), provenance),
		).toThrow(/complete synthesis text/u);
		expect(() =>
			buildNarrationVtt(expanded, characters, [0, 0.2, 0.1, ...starts.slice(3)], ends, provenance),
		).toThrow(/malformed/u);
	});
});

it("aligns paragraph breaks and French spaces that Soniox times as single spaces", () => {
	const script = "Vous pourrez\u202f: «\u00a0bien\u00a0» !\n\nOui.";
	const expanded = expandPronunciation(script, [], "fr");
	expect(expanded.synthesisText).toBe(script);
	const characters = [..."Vous pourrez : « bien » ! Oui."];
	const result = buildNarrationVtt(
		expanded,
		characters,
		characters.map((_, index) => index / 10),
		characters.map((_, index) => (index + 1) / 10),
		{ ...provenance, language: "fr" },
	);
	expect(result.vtt).toContain("00:00:00.000 --> 00:00:02.500\nVous pourrez : « bien » !");
	expect(result.vtt).toContain("00:00:02.600 --> 00:00:03.000\nOui.");
	const missing = [..."Vous pourrez : bien ! Oui."];
	expect(() =>
		buildNarrationVtt(
			expanded,
			missing,
			missing.map((_, index) => index / 10),
			missing.map((_, index) => (index + 1) / 10),
			provenance,
		),
	).toThrow(/complete synthesis text/u);
});

it("aligns a derived item heading pause with normalized provider whitespace and caption timings", () => {
	const [segment] = extractNarrationSegments("", {}, [
		{
			id: "card",
			type: "card",
			data: { items: [{ label: "Assertif", content: "Vous exprimez vos besoins." }] },
		},
	]);
	const expanded = expandPronunciation(segment.script, [], "fr");
	expect(expanded.synthesisText).toBe("Assertif [pause]\n\nVous exprimez vos besoins.");
	const characters = [..."Assertif [pause] Vous exprimez vos besoins."];
	const result = buildNarrationVtt(
		expanded,
		characters,
		characters.map((_, index) => index / 10),
		characters.map((_, index) => (index + 1) / 10),
		{ ...provenance, language: "fr" },
	);
	expect(parseNarrationVtt(result.vtt)).toEqual([
		{ start: 0, end: 1.6, text: "Assertif" },
		{ start: 1.7, end: 4.3, text: "Vous exprimez vos besoins." },
	]);
	expect(result.vtt).not.toContain("[pause]");
	expect(
		parseNarrationVtt(result.vtt)
			?.map((cue) => cue.text)
			.join(" "),
	).toBe("Assertif Vous exprimez vos besoins.");
});

it("aligns optional provider whitespace without extending the final cue", () => {
	const build = (script: string, timedText: string) => {
		const characters = [...timedText];
		return buildNarrationVtt(
			expandPronunciation(script, [], "en"),
			characters,
			characters.map((_, index) => index / 10),
			characters.map((_, index) => (index + 1) / 10),
			provenance,
		).vtt;
	};

	expect(build("A.", " A.")).toContain("00:00:00.100 --> 00:00:00.300\nA.");
	expect(build("A.", "A.  ")).toContain("00:00:00.000 --> 00:00:00.200\nA.");
	expect(build("A. B.", "A.B.")).toContain("00:00:00.200 --> 00:00:00.400\nB.");
	expect(() => build("A.", "A")).toThrow(/complete synthesis text/u);
	expect(() => build("A.", "A.X")).toThrow(/complete synthesis text/u);
});

it("retains synthesis directions while captions preserve bracketed words and audible sounds", () => {
	const script = "[sincerely] Hello [star watcher]. [delighted] Yes! [sighs]";
	const expanded = expandPronunciation(script, [], "en");
	expect(expanded.synthesisText).toBe(script);
	const characters = [...script];
	const result = buildNarrationVtt(
		expanded,
		characters,
		characters.map((_, i) => i / 10),
		characters.map((_, i) => (i + 1) / 10),
		provenance,
	);
	expect(
		parseNarrationVtt(result.vtt)
			?.map((cue) => cue.text)
			.join(" "),
	).toBe("Hello [star watcher]. Yes! [sighs]");
	expect(result.vtt).not.toContain("[sincerely]");
	expect(result.vtt).not.toContain("[delighted]");
	expect(parseNarrationProvenance(result.vtt)).toEqual(provenance);
});
