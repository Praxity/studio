import type { PronunciationLexeme } from "@praxity/grammar";
import {
	narrationDisplayText,
	narrationScriptText,
	normalizeNarrationScript,
	plainNarrationText,
} from "@praxity/shared-blocks/narration";

export { normalizeNarrationScript, plainNarrationText };

export const SONIOX_MODEL = "tts-rt-v2";
export const NARRATION_METADATA_VERSION = 2;
export const NARRATION_RECIPE = "mp3-64kbps-sentence-vtt-v1";

export interface NarrationCue {
	text: string;
	synthesisStart: number;
	synthesisEnd: number;
}

export interface ExpandedNarration {
	synthesisText: string;
	cues: NarrationCue[];
	matches: Array<{ grapheme: string; alias: string; lang: string }>;
}

export interface NarrationProvenance {
	provider: "soniox";
	model: typeof SONIOX_MODEL;
	language: string;
	voice: string;
	speed: number;
	scriptHash: string;
	lexiconHash: string;
	recipeHash: string;
	version: typeof NARRATION_METADATA_VERSION;
}

function validLexemes(lexemes: readonly PronunciationLexeme[]): PronunciationLexeme[] {
	return lexemes.filter(
		(entry) =>
			typeof entry?.grapheme === "string" &&
			entry.grapheme.length > 0 &&
			typeof entry.alias === "string" &&
			entry.alias.length > 0 &&
			typeof entry.lang === "string" &&
			entry.lang.length > 0,
	);
}

export function mergePronunciationLexemes(
	course: readonly PronunciationLexeme[],
	lesson: readonly PronunciationLexeme[],
): PronunciationLexeme[] {
	const merged = new Map<string, PronunciationLexeme>();
	for (const entry of [...validLexemes(course), ...validLexemes(lesson)]) {
		merged.set(`${entry.lang}\0${entry.grapheme}`, { ...entry });
	}
	return [...merged.values()];
}

export function lexiconFingerprint(
	lexemes: readonly PronunciationLexeme[],
	language?: string,
): string {
	const unique = new Map(
		validLexemes(lexemes)
			.filter((entry) => language === undefined || entry.lang === language)
			.map((entry) => [`${entry.lang}\0${entry.grapheme}\0${entry.alias}`, entry]),
	);
	return JSON.stringify(
		[...unique.values()]
			.map(({ grapheme, alias, lang }) => ({ grapheme, alias, lang }))
			.sort((a, b) =>
				`${a.lang}\0${a.grapheme}\0${a.alias}`.localeCompare(
					`${b.lang}\0${b.grapheme}\0${b.alias}`,
				),
			),
	);
}

function cueRanges(script: string): Array<{ start: number; end: number; text: string }> {
	const ranges: Array<{ start: number; end: number; text: string }> = [];
	let cursor = 0;
	const boundary = /(?:[.!?]+(?=\s|$)|\n+)/gu;
	for (const match of script.matchAll(boundary)) {
		const end = (match.index ?? 0) + match[0].length;
		const raw = script.slice(cursor, end);
		const leading = raw.search(/\S/u);
		if (leading >= 0) {
			const text = raw.trim();
			ranges.push({ start: cursor + leading, end: cursor + leading + text.length, text });
		}
		cursor = end;
	}
	const raw = script.slice(cursor);
	const leading = raw.search(/\S/u);
	if (leading >= 0) {
		const text = raw.trim();
		ranges.push({ start: cursor + leading, end: cursor + leading + text.length, text });
	}
	return ranges;
}

export function expandPronunciation(
	originalScript: string,
	lexemes: readonly PronunciationLexeme[],
	language: string,
): ExpandedNarration {
	const script = narrationScriptText(originalScript);
	const candidates = validLexemes(lexemes)
		.filter((entry) => entry.lang === language)
		.map((entry, index) => ({ entry, index }))
		.sort((a, b) => b.entry.grapheme.length - a.entry.grapheme.length || a.index - b.index);
	const offsetMap = new Array<number>(script.length + 1).fill(0);
	const matches: ExpandedNarration["matches"] = [];
	let synthesisText = "";
	let synthesisCharacters = 0;
	let index = 0;

	while (index < script.length) {
		const match = candidates.find(({ entry }) => script.startsWith(entry.grapheme, index));
		if (match) {
			const end = index + match.entry.grapheme.length;
			for (let cursor = index; cursor < end; cursor += 1) offsetMap[cursor] = synthesisCharacters;
			synthesisText += match.entry.alias;
			synthesisCharacters += [...match.entry.alias].length;
			offsetMap[end] = synthesisCharacters;
			matches.push({ ...match.entry });
			index = end;
			continue;
		}

		const character = String.fromCodePoint(script.codePointAt(index) ?? 0);
		offsetMap[index] = synthesisCharacters;
		for (let cursor = 1; cursor < character.length; cursor += 1) {
			offsetMap[index + cursor] = synthesisCharacters;
		}
		synthesisText += character;
		synthesisCharacters += 1;
		index += character.length;
		offsetMap[index] = synthesisCharacters;
	}

	return {
		synthesisText,
		matches,
		cues: cueRanges(script).map((cue) => ({
			text: cue.text,
			synthesisStart: offsetMap[cue.start] ?? 0,
			synthesisEnd: offsetMap[cue.end] ?? synthesisCharacters,
		})),
	};
}

function vttTime(seconds: number): string {
	const milliseconds = Math.max(0, Math.round(seconds * 1000));
	const hours = Math.floor(milliseconds / 3_600_000);
	const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
	const secs = Math.floor((milliseconds % 60_000) / 1000);
	const millis = milliseconds % 1000;
	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function safeCueText(text: string): string {
	return narrationDisplayText(text)
		.replace(/\s+/gu, " ")
		.trim()
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;");
}

function provenanceNote(provenance: NarrationProvenance): string {
	return [
		"NOTE praxity-narration",
		`provider=${provenance.provider}`,
		`model=${provenance.model}`,
		`language=${provenance.language}`,
		`voice=${provenance.voice}`,
		`speed=${provenance.speed}`,
		`scriptHash=${provenance.scriptHash}`,
		`lexiconHash=${provenance.lexiconHash}`,
		`recipeHash=${provenance.recipeHash}`,
		`version=${provenance.version}`,
	].join("\n");
}

/**
 * Map each synthesis-text position to its index in the provider's timed characters.
 * Soniox returns each whitespace run, such as a paragraph break or a French NBSP,
 * as one plain space, so any whitespace run matches any run, including none.
 */
function timedPositions(synthesisText: string, characters: readonly string[]): number[] | null {
	const sent = [...synthesisText];
	const positions = new Array<number>(sent.length + 1);
	const isSpace = (value: string | undefined) => value !== undefined && /^\s+$/u.test(value);
	let timed = 0;
	for (let index = 0; index < sent.length; ) {
		if (isSpace(sent[index])) {
			while (index < sent.length && isSpace(sent[index])) positions[index++] = timed;
			while (isSpace(characters[timed])) timed += 1;
			continue;
		}
		while (isSpace(characters[timed])) timed += 1;
		if (characters[timed] !== sent[index]) return null;
		positions[index++] = timed++;
	}
	positions[sent.length] = timed;
	while (isSpace(characters[timed])) timed += 1;
	if (timed !== characters.length) return null;
	return positions;
}

export function buildNarrationVtt(
	expanded: ExpandedNarration,
	characters: readonly string[],
	startTimes: readonly number[],
	endTimes: readonly number[],
	provenance: NarrationProvenance,
): { vtt: string; durationSeconds: number } {
	const positions =
		characters.length > 0 &&
		characters.length === startTimes.length &&
		characters.length === endTimes.length
			? timedPositions(expanded.synthesisText, characters)
			: null;
	if (!positions) {
		throw new Error("Narration timing did not cover the complete synthesis text.");
	}
	for (let index = 0; index < characters.length; index += 1) {
		const start = startTimes[index];
		const end = endTimes[index];
		if (
			!Number.isFinite(start) ||
			!Number.isFinite(end) ||
			start < 0 ||
			end < start ||
			(index > 0 && start < startTimes[index - 1])
		) {
			throw new Error("Narration timing data was malformed.");
		}
	}

	const timed = expanded.cues.map((cue) => {
		const start = startTimes[positions[cue.synthesisStart]];
		const end = endTimes[positions[cue.synthesisEnd] - 1];
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
			throw new Error("Narration cue alignment was incomplete.");
		}
		return { ...cue, start, end };
	});
	for (let index = 0; index < timed.length - 1; index += 1) {
		timed[index].end = Math.min(timed[index].end, timed[index + 1].start);
		if (timed[index].end <= timed[index].start) {
			throw new Error("Narration cue alignment was ambiguous.");
		}
	}

	const cues = timed
		.map((cue) => ({ cue, text: safeCueText(cue.text) }))
		.filter(({ text }) => text.length > 0)
		.map(
			({ cue, text }, index) =>
				`${index + 1}\n${vttTime(cue.start)} --> ${vttTime(cue.end)}\n${text}`,
		)
		.join("\n\n");
	return {
		vtt: `WEBVTT\n\n${provenanceNote(provenance)}\n\n${cues}\n`,
		durationSeconds: endTimes.at(-1) ?? 0,
	};
}

export function parseNarrationProvenance(vtt: string): NarrationProvenance | null {
	const block = vtt
		.split(/\r?\n\r?\n/u)
		.find((entry) => entry.startsWith("NOTE praxity-narration\n"));
	if (!block) return null;
	const entries = block
		.trimEnd()
		.split(/\r?\n/u)
		.slice(1)
		.map((line) => {
			const index = line.indexOf("=");
			return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : ["", ""];
		});
	const expectedKeys = [
		"provider",
		"model",
		"language",
		"voice",
		"speed",
		"scriptHash",
		"lexiconHash",
		"recipeHash",
		"version",
	];
	if (
		entries.length !== expectedKeys.length ||
		new Set(entries.map(([key]) => key)).size !== expectedKeys.length ||
		expectedKeys.some((key) => !entries.some(([entryKey]) => entryKey === key))
	) {
		return null;
	}
	const values = Object.fromEntries(entries);
	const speed = Number(values.speed);
	const version = Number(values.version);
	if (
		values.provider !== "soniox" ||
		values.model !== SONIOX_MODEL ||
		!/^\w[\w-]{0,49}$/u.test(values.language ?? "") ||
		!/^\w[\w-]{0,49}$/u.test(values.voice ?? "") ||
		!Number.isFinite(speed) ||
		speed < 0.7 ||
		speed > 1.3 ||
		!/^[a-f0-9]{64}$/u.test(values.scriptHash ?? "") ||
		!/^[a-f0-9]{64}$/u.test(values.lexiconHash ?? "") ||
		!/^[a-f0-9]{64}$/u.test(values.recipeHash ?? "") ||
		version !== NARRATION_METADATA_VERSION
	) {
		return null;
	}
	return {
		provider: "soniox",
		model: SONIOX_MODEL,
		language: values.language,
		voice: values.voice,
		speed,
		scriptHash: values.scriptHash,
		lexiconHash: values.lexiconHash,
		recipeHash: values.recipeHash,
		version: NARRATION_METADATA_VERSION,
	};
}
