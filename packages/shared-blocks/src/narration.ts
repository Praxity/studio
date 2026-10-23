import { type AssessmentDeckOptions, resolveAssessmentDontKnow } from "@praxity/content-model";
import { escapeHtml } from "@praxity/content-model/constants";
import { inlineMarkdown } from "@praxity/content-model/inline-markdown";
import { isInlineProjectionMetadataKey } from "@praxity/content-model/inline-preparation";
import { narrationDisplayText, SONIOX_AUDIO_TAGS } from "@praxity/content-model/narration-display";
import { isDisplayNodeId } from "@praxity/content-model/types";
import { childRecords } from "./child-records";
import { DONT_KNOW_LABELS } from "./i18n/dont-know-labels";
import { resolveLocale } from "./i18n/locale";
import { type LogicAction, normalizeAction } from "./logic/evaluate";
import { flattenLogicBlocks } from "./logic/flatten-blocks";
import { initiallyHiddenBlockIds, resolveBlockTargetIds } from "./logic/visibility";

export { narrationDisplayText, SONIOX_AUDIO_TAGS };

import type { PraxityBlock, PraxityPage } from "./types";

export const NARRATION_ROLES = ["title", "body", "intro", "front", "back", "turn"] as const;
export const DEFAULT_NARRATION_VOICE = "Maya";
export function isNarrationSpeed(value: unknown): value is number {
	return typeof value === "number" && value >= 0.7 && value <= 1.3;
}
export interface NarrationTarget {
	id: string;
	role: (typeof NARRATION_ROLES)[number];
}
export interface NarrationAudioFor {
	script: string;
	language: string;
	voice: string;
	speed: number;
}
export interface NarrationEntryV2 extends NarrationSettings {
	target: NarrationTarget;
	reviewedRevision?: string;
	script?: string;
	disabled?: boolean;
	audio?: string;
	timings?: string;
	duration?: number;
	audioFor?: NarrationAudioFor;
	/** Explicit author acknowledgement of this script/settings; original recording provenance stays intact. */
	acceptedFor?: NarrationAudioFor;
}
export interface NarrationLessonV2 {
	enabled?: boolean;
	defaults?: NarrationSettings;
	segments: NarrationEntryV2[];
}
export interface NarrationSidecarV2 {
	version: 2;
	courseId: string;
	lessons: Record<string, NarrationLessonV2>;
}
export interface NarrationSegmentV2 extends NarrationSegment {
	target: NarrationTarget;
	revision: string;
	status: NarrationStatus;
	audioForCurrent: boolean;
}

export function narrationTargetKey(target: NarrationTarget): string {
	return `${target.id}:${target.role}`;
}

/** Accepted retirement removes all roles on that identity, including unopened lessons. */
export function retireNarration(
	sidecar: NarrationSidecarV2,
	retiredIds: readonly string[],
): NarrationSidecarV2 {
	const retired = new Set(retiredIds);
	return {
		...sidecar,
		lessons: Object.fromEntries(
			Object.entries(sidecar.lessons).map(([id, lesson]) => [
				id,
				{ ...lesson, segments: lesson.segments.filter((entry) => !retired.has(entry.target.id)) },
			]),
		),
	};
}

export function updateNarrationV2Entry(
	sidecar: NarrationSidecarV2,
	lessonId: string,
	target: NarrationTarget,
	patch: Partial<Omit<NarrationEntryV2, "target">>,
): NarrationSidecarV2 {
	// Targets may have moved across lessons since their recording was stored.
	const key = narrationTargetKey(target);
	const owners = Object.entries(sidecar.lessons).filter(([, lesson]) =>
		lesson.segments.some((entry) => narrationTargetKey(entry.target) === key),
	);
	if (owners.length > 1) throw new Error(`Duplicate narration target: ${key}`);
	const ownerId = owners[0]?.[0] ?? lessonId;
	const lesson = sidecar.lessons[ownerId];
	if (!lesson) throw new Error(`Unknown narration lesson: ${lessonId}`);
	const segments = [...lesson.segments];
	const index = segments.findIndex(
		(entry) => narrationTargetKey(entry.target) === narrationTargetKey(target),
	);
	const previous = index < 0 ? { target } : segments[index];
	const next = { ...previous, ...patch };
	// Replacing a recording may supply its new provenance in the same operation.
	if (
		!Object.hasOwn(patch, "audioFor") &&
		(["script", "language", "voice", "speed"] as const).some(
			(key) => Object.hasOwn(patch, key) && patch[key] !== previous[key],
		)
	)
		delete next.audioFor;
	if (
		(["script", "language", "voice", "speed", "audio"] as const).some(
			(key) => Object.hasOwn(patch, key) && patch[key] !== previous[key],
		) &&
		!Object.hasOwn(patch, "acceptedFor")
	)
		delete next.acceptedFor;
	if (index < 0) segments.push(next);
	else segments[index] = next;
	return { ...sidecar, lessons: { ...sidecar.lessons, [ownerId]: { ...lesson, segments } } };
}

/** The inputs authors accept and synthesis records use the same normalization and defaults. */
export function narrationRecordingInputs(
	script: string,
	settings: NarrationSettings,
	locale: string,
): NarrationAudioFor {
	return {
		script: normalizeNarrationScript(narrationScriptText(script)),
		language: settings.language ?? locale,
		voice: settings.voice ?? DEFAULT_NARRATION_VOICE,
		speed: settings.speed ?? 1,
	};
}

/** Approve the retained recording without claiming it was synthesized from today's script. */
export function acceptNarrationV2Entry(
	sidecar: NarrationSidecarV2,
	lessonId: string,
	segment: NarrationSegmentV2,
	locale: string,
): NarrationSidecarV2 {
	return updateNarrationV2Entry(sidecar, lessonId, segment.target, {
		reviewedRevision: segment.revision,
		...(segment.needsDraftReview ? { script: segment.script } : {}),
		acceptedFor: narrationRecordingInputs(segment.script, segment.settings, locale),
	});
}

/** The host supplies SHA-256, as it does for identity. No paths or positions enter revisions.
 * Identity joins precede review checks; a changed revision never detaches a recording. */
export function resolveNarrationV2(input: {
	courseId: string;
	lessonId: string;
	pages: readonly PraxityPage[];
	sidecar: NarrationSidecarV2;
	locale: string;
	enabled?: boolean;
	defaults?: NarrationSettings;
	moduleDeck?: AssessmentDeckOptions;
	digest: (text: string) => string;
}): {
	pages: Array<{ pageId: string; enabled: boolean; segments: NarrationSegmentV2[] }>;
	unresolved: Array<{ lessonId: string; entry: NarrationEntryV2; entryIndex: number }>;
} {
	if (input.courseId !== input.sidecar.courseId)
		throw new Error("Narration course identity does not match.");
	const targetIds = new Set(
		Object.values(input.sidecar.lessons).flatMap((lesson) =>
			lesson.segments.map((entry) => entry.target.id),
		),
	);
	for (const page of input.pages)
		assertHighlightNarrationInputs(page.blocks, input.locale, targetIds);
	const lesson = input.sidecar.lessons[input.lessonId];
	const entries = new Map<
		string,
		{ lessonId: string; entry: NarrationEntryV2; entryIndex: number }
	>();
	for (const [lessonId, owner] of Object.entries(input.sidecar.lessons)) {
		for (const [entryIndex, entry] of owner.segments.entries()) {
			const key = narrationTargetKey(entry.target);
			if (entries.has(key)) throw new Error(`Duplicate narration target: ${key}`);
			entries.set(key, { lessonId, entry, entryIndex });
		}
	}
	const matched = new Set<string>();
	const defaults = { voice: DEFAULT_NARRATION_VOICE, ...input.defaults, ...lesson?.defaults };
	const scope = {
		narrationLanguage: defaults.language,
		narrationVoice: defaults.voice,
		narrationSpeed: defaults.speed,
	};
	const enabled = resolveNarrationEnabled(input.enabled, lesson?.enabled);
	const wholeContainerIds = new Set(
		[...entries.values()]
			.filter(({ entry }) => entry.target.role === "body")
			.map(({ entry }) => entry.target.id),
	);
	const seen = new Set<string>();
	const pages = input.pages.map((page) => {
		// V2 entries own authoring metadata; derive targets from clean renderer input.
		const clean = (value: unknown): unknown => {
			if (Array.isArray(value)) return value.map(clean);
			if (!isRecord(value)) return value;
			return Object.fromEntries(
				Object.entries(value)
					.filter(([key]) => !(NARRATION_BLOCK_FIELDS as readonly string[]).includes(key))
					.map(([key, child]) => [
						key,
						isInlineProjectionMetadataKey(key, { keepDisplay: true }) ? child : clean(child),
					]),
			);
		};
		const blocks = clean(page.blocks) as PraxityBlock[];
		const byId = new Map(flattenLogicBlocks(blocks).map((block) => [block.id, block]));
		const retainEmptyTargets = new Set<string>();
		if (entries.has(narrationTargetKey({ id: page.id, role: "title" })))
			retainEmptyTargets.add("page-title");
		for (const block of byId.values()) {
			if (["body", "title", "intro"].some((role) => entries.has(`${block.id}:${role}`)))
				retainEmptyTargets.add(block.id);
			for (const child of childRecords(block)) {
				const location = /^block\.data\.(items|turns)\[(\d+)\]\.(id|backId)$/.exec(child.path);
				if (!location || typeof child.id !== "string") continue;
				const role =
					location[1] === "turns"
						? "turn"
						: block.type === "card"
							? location[3] === "backId"
								? "back"
								: "front"
							: "body";
				if (entries.has(`${child.id}:${role}`))
					retainEmptyTargets.add(
						`${block.id}:item:${location[2]}${location[3] === "backId" ? ":back" : ""}`,
					);
			}
		}
		const segments = extractNarrationSegments(
			typeof page.data?.title === "string" ? page.data.title : page.title,
			clean(page.data ?? {}) as Record<string, unknown>,
			blocks,
			scope,
			input.locale,
			{ wholeContainerIds, retainEmptyTargets, moduleDeck: input.moduleDeck },
		).map((segment) => {
			let target: NarrationTarget;
			if (segment.kind === "pageTitle") target = { id: page.id, role: "title" };
			else {
				const block = byId.get(segment.blockId ?? "");
				if (!block) throw new Error(`Missing narration block identity: ${segment.blockId}`);
				if (segment.itemIndex !== undefined) {
					const turn = block.type === "dialogue";
					const back = segment.itemSide === "back";
					const path = turn
						? `block.data.turns[${segment.itemIndex}].id`
						: `block.data.items[${segment.itemIndex}].${back ? "backId" : "id"}`;
					const child = childRecords(block).find((record) => record.path === path);
					if (typeof child?.id !== "string" || !child.id)
						throw new Error(`Missing narration child identity: ${path}`);
					target = {
						id: child.id,
						role: turn ? "turn" : block.type === "card" ? (back ? "back" : "front") : "body",
					};
				} else
					target = {
						id: block.id,
						role:
							segment.containerPart === "intro"
								? "intro"
								: block.type === "heading" || block.type === "selfCheck"
									? "title"
									: "body",
					};
			}
			const key = narrationTargetKey(target);
			if (seen.has(key)) throw new Error(`Duplicate resolved narration target: ${key}`);
			seen.add(key);
			const entry = entries.get(key)?.entry;
			if (entry) matched.add(key);
			const revision = input.digest(
				normalizeNarrationScript(segment.derivedScript).normalize("NFC"),
			);
			const settings = {
				...segment.settings,
				...Object.fromEntries(
					Object.entries(entry ?? {}).filter(([key]) =>
						["language", "voice", "speed"].includes(key),
					),
				),
			};
			const script = entry?.script ?? segment.script;

			const currentInputs = narrationRecordingInputs(script, settings, input.locale);
			const isCurrent = (recorded: NarrationAudioFor | undefined) =>
				!!recorded &&
				normalizeNarrationScript(recorded.script) === currentInputs.script &&
				recorded.language === currentInputs.language &&
				recorded.voice === currentInputs.voice &&
				recorded.speed === currentInputs.speed;
			const audioForCurrent = isCurrent(entry?.audioFor);
			const acceptedForCurrent = isCurrent(entry?.acceptedFor);

			const disabled = entry?.disabled ?? segment.disabled;
			const status: NarrationStatus = disabled
				? "disabled"
				: entry && entry.reviewedRevision !== revision
					? "needsReview"
					: segment.needsDraftReview && entry?.script === undefined
						? "needsReview"
						: entry?.audio
							? audioForCurrent || acceptedForCurrent
								? "ready"
								: "stale"
							: "missing";
			return {
				...segment,
				id: key,
				target,
				revision,
				script,
				settings,
				custom: entry?.script !== undefined,
				disabled,
				status,
				audioForCurrent,
				...(entry?.audio ? { audioUrl: entry.audio } : {}),
				...(entry?.timings ? { timingsUrl: entry.timings } : {}),
				...(entry?.duration !== undefined ? { duration: entry.duration } : {}),
			};
		});
		return { pageId: page.id, enabled, segments };
	});
	return {
		pages,
		unresolved: [...entries.entries()]
			.filter(([key, value]) => value.lessonId === input.lessonId && !matched.has(key))
			.map(([, value]) => value),
	};
}

export const NARRATION_BLOCK_FIELDS = [
	"narrationBack",
	"narrationContainerSplit",
	"narration",
	"narrationDisabled",
	"narrationLanguage",
	"narrationVoice",
	"narrationSpeed",
	"narrationAudio",
	"narrationTimings",
	"narrationDuration",
	"narrationReviewedSourceHash",
	"narrationAcceptedInputsHash",
] as const;

export interface NarrationSettings {
	language?: string;
	voice?: string;
	speed?: number;
}

export interface NarrationCardTarget {
	containerId: string;
	itemIndex: number;
	side: "front" | "back";
}

export interface NarrationSegment {
	cardTargets?: NarrationCardTarget[];
	itemSide?: "back";
	id: string;
	kind: "pageTitle" | "block";
	blockId?: string;
	ancestorBlockIds?: string[];
	/** Item owner within block.data.items; omitted for a container introduction. */
	itemIndex?: number;
	containerPart?: "intro" | "item";
	/** Resolved dialogue speaker name for transcripts; never spoken. */
	speaker?: string;
	/** Preserved whole-container recording or explicit script from older lessons. */
	wholeContainer?: boolean;
	blockType?: PraxityBlock["type"];
	conditionalBlockId?: string;
	authoredStopBlockIds?: string[];
	stopBefore?: Array<{ blockId: string; ancestorBlockIds?: string[]; conditionalBlockId?: string }>;
	trailingStops?: Array<{
		blockId: string;
		ancestorBlockIds?: string[];
		conditionalBlockId?: string;
	}>;
	label: string;
	/** Deterministic script from the current visible source, before any custom override. */
	derivedScript: string;
	/** Stable block source used to detect whether a preserved custom script needs review. */
	sourceContent: string;
	script: string;
	custom: boolean;
	disabled: boolean;
	needsDraftReview: boolean;
	pauseAfter: boolean;
	audioUrl?: string;
	timingsUrl?: string;
	duration?: number;
	reviewedSourceHash?: string;
	acceptedInputsHash?: string;
	overrides: NarrationSettings;
	settings: NarrationSettings;
}

export interface NarrationVttCue {
	start: number;
	end: number;
	text: string;
}

/** Empty editor targets carry stop metadata but occupy no narration position. */
export function hasNarrationContent(segment: NarrationSegment): boolean {
	return Boolean(segment.script || segment.audioUrl);
}

export type NarrationStatus =
	| "missing"
	| "ready"
	| "stale"
	| "needsReview"
	| "manualNoTimings"
	| "disabled";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeEntity(entity: string): string {
	const named: Record<string, string> = {
		amp: "&",
		apos: "'",
		gt: ">",
		lt: "<",
		nbsp: "\u00a0",
		quot: '"',
	};
	if (entity in named) return named[entity];
	const numeric = entity.startsWith("#x")
		? Number.parseInt(entity.slice(2), 16)
		: entity.startsWith("#")
			? Number.parseInt(entity.slice(1), 10)
			: Number.NaN;
	return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : `&${entity};`;
}

export function plainNarrationText(value: unknown): string {
	if (typeof value !== "string") return "";
	return value
		.replace(
			/<\/?(?:p|div|h[1-6]|li|ul|ol|section|article|blockquote|br|figure|figcaption|table|thead|tbody|tfoot|tr|td|th|dl|dt|dd)\b[^>]*>/gi,
			" ",
		)
		.replace(/<[^>]*>/g, "")
		.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) =>
			decodeEntity(entity.toLowerCase()),
		)
		.replace(/https?:\/\/\S+/gi, (url) => (/[,.;:!?]$/u.test(url) ? ` ${url.at(-1)} ` : " "))
		.replace(/[ \t\r\n\f]+/g, " ")
		.trim();
}

export function normalizeNarrationScript(value: string): string {
	return value.replace(/[ \t\r\n\f]+/g, " ").trim();
}

/** One authored script, rendered as restrained Markdown or spoken as plain text. */
function narrationScriptBlocks(
	value: string,
): Array<{ tag: string; text: string; start?: number; depth?: number; breakBefore?: boolean }> {
	const blocks: Array<{
		tag: string;
		text: string;
		start?: number;
		depth?: number;
		breakBefore?: boolean;
	}> = [];
	let paragraph: string[] = [];
	let blankBefore = false;
	const flush = () => {
		if (paragraph.length) blocks.push({ tag: "p", text: paragraph.join(" ") });
		paragraph = [];
	};
	for (const line of value.replace(/\r\n?/gu, "\n").split("\n")) {
		const heading = /^(#{1,3})\s+(.+)$/u.exec(line);
		const item = /^( *)(?:[-+*]\s+|(\d+)\.\s+)(.+)$/u.exec(line);
		if (!line.trim() || heading || item) flush();
		if (heading) blocks.push({ tag: `h${Math.min(heading[1].length + 2, 5)}`, text: heading[2] });
		else if (item)
			blocks.push({
				tag: item[2] ? "ol" : "ul",
				text: item[3],
				depth: Math.floor(item[1].length / 2),
				...(blankBefore ? { breakBefore: true } : {}),
				...(item[2] ? { start: Number(item[2]) } : {}),
			});
		else if (line.trim()) paragraph.push(line.trim());
		blankBefore = !line.trim();
	}
	flush();
	return blocks;
}

function narrationInline(text: string): string {
	return inlineMarkdown(normalizeNarrationScript(text), { emphasisOnly: true });
}

/** Escaped semantic HTML; authored HTML and non-narration syntax remain literal text. */
export function renderNarrationScript(value: string): string {
	const html: string[] = [];
	const lists: string[] = [];
	const closeItem = () => {
		html[html.length - 1] += "</li>";
	};
	const closeList = () => {
		closeItem();
		html.push(`</${lists.pop()}>`);
	};
	for (const block of narrationScriptBlocks(narrationDisplayText(value))) {
		if (block.tag === "ul" || block.tag === "ol") {
			if (block.breakBefore && block.depth === 0) while (lists.length) closeList();
			const depth = Math.min(block.depth ?? 0, lists.length);
			while (lists.length > depth + 1) closeList();
			if (lists.length === depth + 1) {
				closeItem();
				if (lists[depth] !== block.tag) html.push(`</${lists.pop()}>`);
			}
			if (lists.length === depth) {
				lists.push(block.tag);
				html.push(
					`<${block.tag}${block.tag === "ol" && block.start !== 1 ? ` start="${block.start}"` : ""}>`,
				);
			}
			html.push(`<li>${narrationInline(block.text)}`);
		} else {
			while (lists.length) closeList();
			html.push(`<${block.tag}>${narrationInline(block.text)}</${block.tag}>`);
		}
	}
	while (lists.length) closeList();
	return html.join("\n");
}

/** Keep paragraph/list boundaries for speech without adding punctuation or changing words. */
export function narrationScriptText(value: string): string {
	// Speak escaped bracketed cues as words before Markdown consumes the escape.
	return narrationScriptBlocks(value)
		.map((block) =>
			narrationInline(
				block.text.replace(
					/(\\+)\[([^\\\]\r\n]*)\\?\]/gu,
					(match, slashes: string, words: string) =>
						slashes.length % 2 === 0 ? match : `${slashes.slice(0, -1)}${words}`,
				),
			)
				.replace(/<\/?(?:strong|em)>/gu, "")
				.replace(/&(amp|apos|gt|lt|quot|#39);/gu, (_match, entity: string) => decodeEntity(entity)),
		)
		.join("\n\n");
}

function listNarrationText(value: string): string {
	const parts: string[] = [];
	const lists: Array<{ tag: "ul" | "ol"; next: number }> = [];
	let line = "";
	let cursor = 0;
	const append = (html: string) => {
		const text = plainNarrationText(html);
		if (text) line += `${line && !line.endsWith(" ") ? " " : ""}${text}`;
	};
	const flush = () => {
		if (line.trim()) parts.push(line.trimEnd());
		line = "";
	};
	for (const match of value.matchAll(/<\/?(?:ul|ol|li)\b[^>]*>/gi)) {
		append(value.slice(cursor, match.index));
		const closing = match[0].startsWith("</");
		const tag = /^<\/?(ul|ol|li)/i.exec(match[0])?.[1].toLowerCase();
		if (tag === "li") {
			flush();
			if (!closing) {
				const list = lists.at(-1);
				line = `${"  ".repeat(Math.max(0, lists.length - 1))}${list?.tag === "ol" ? `${list.next++}.` : "-"} `;
			}
		} else if (tag === "ul" || tag === "ol") {
			flush();
			if (closing) lists.pop();
			else {
				const start = Number(/\bstart\s*=\s*["']?(\d+)/i.exec(match[0])?.[1] ?? 1);
				lists.push({ tag, next: Number.isSafeInteger(start) ? start : 1 });
			}
		}
		cursor = match.index + match[0].length;
	}
	append(value.slice(cursor));
	flush();
	return parts.join("\n");
}

function joinText(
	values: unknown[],
	deduplicate = false,
	headingIndexes: readonly number[] = [],
	scriptIndexes: readonly number[] = [],
): string {
	const seen = new Map<string, number>();
	const parts: Array<{ text: string; structured: boolean; heading: boolean }> = [];
	for (const [index, value] of values.entries()) {
		const listHtml = typeof value === "string" && /<(?:ul|ol)\b/i.test(value);
		const structured =
			listHtml ||
			(typeof value === "string" &&
				(/(?:^|\n) *([-+*]|\d+\.)\s+/u.test(value) ||
					(scriptIndexes.includes(index) && /\n\s*\n/u.test(value))));
		const text = listHtml
			? listNarrationText(value)
			: structured && typeof value === "string"
				? value.trim()
				: plainNarrationText(value);
		const key = plainNarrationText(value).toLocaleLowerCase();
		if (!text) continue;
		const duplicate = deduplicate ? seen.get(key) : undefined;
		if (duplicate !== undefined) {
			parts[duplicate].heading ||= headingIndexes.includes(index);
		} else {
			seen.set(key, parts.length);
			parts.push({ text, structured, heading: headingIndexes.includes(index) });
		}
	}
	return parts.reduce((script, part, index) => {
		const previous = parts[index - 1];
		const separator = index
			? part.heading || previous.heading || part.structured || previous.structured
				? "\n\n"
				: " "
			: "";
		const pause =
			part.heading && index < parts.length - 1 && !/[.,;:!?…]["'”’»)\]]*$/u.test(part.text)
				? " [pause]"
				: "";
		return `${script}${separator}${part.text}${pause}`;
	}, "");
}

function uniqueText(...values: unknown[]): string {
	return joinText(values, true);
}

/** Turn paragraphs are inline Markdown; speak link text, keep delivery cues. */
function dialogueTurnScript(paragraphs: readonly string[]): string {
	return paragraphs
		.map((part) => {
			// Inline Markdown consumes escapes. Reserve markers absent from the authored text.
			let open = "\uE000";
			let close = "\uE001";
			while (part.includes(open) || part.includes(close)) {
				open += "\uE000";
				close += "\uE001";
			}
			return plainNarrationText(
				inlineMarkdown(
					part.replace(/(\\+)([[\]])/gu, (match, slashes: string, bracket: string) =>
						slashes.length % 2 === 0
							? match
							: `${slashes.slice(0, -1)}${bracket === "[" ? open : close}`,
					),
					{ interactive: true },
				),
			)
				.replaceAll(open, "\\[")
				.replaceAll(close, "\\]");
		})
		.filter(Boolean)
		.join("\n\n");
}

export function resolveNarrationEnabled(courseValue: unknown, lessonValue: unknown): boolean {
	if (typeof lessonValue === "boolean") return lessonValue;
	return typeof courseValue === "boolean" ? courseValue : false;
}

export function narrationDefaultsFromScope(
	scope: Record<string, unknown>,
): Record<string, unknown> {
	return Object.fromEntries(
		["narrationLanguage", "narrationVoice", "narrationSpeed"].flatMap((key) =>
			scope[key] === undefined ? [] : [[key, scope[key]]],
		),
	);
}

export function resolveNarrationSettings(
	lesson: Record<string, unknown>,
	page: Record<string, unknown>,
	block: Record<string, unknown>,
	courseLocale?: string,
): NarrationSettings {
	const value = (key: "Language" | "Voice" | "Speed") =>
		block[`narration${key}`] ?? page[`narration${key}`] ?? lesson[`narration${key}`];
	const language = value("Language") ?? courseLocale;
	const voice = value("Voice");
	const speed = value("Speed");
	return {
		...(typeof language === "string" && language ? { language } : {}),
		...(typeof voice === "string" && voice ? { voice } : {}),
		...(isNarrationSpeed(speed) ? { speed } : {}),
	};
}

interface NarrationPhrases {
	highlightUnsupported: string;
	pageTitleLabel: string;
	dialogueTurnLabel: string;
	cardBackLabel: string;
	choiceInstruction: string;
	itemsInstruction: string;
	tableDirection: string;
	codeExample: string;
	codeDirection: string;
	equationDirection: string;
}

const ENGLISH_PHRASES: NarrationPhrases = {
	highlightUnsupported: "Highlight does not support block narration.",
	pageTitleLabel: "Page title",
	dialogueTurnLabel: "Turn",
	cardBackLabel: "Back",
	choiceInstruction: "Now review the options on the page and choose your answer.",
	itemsInstruction: "Now review the items on the page and complete the activity.",
	tableDirection: "Review the table on the page for the complete data.",
	codeExample: "Code example.",
	codeDirection: "Review the code on the page.",
	equationDirection: "Review the equation on the page.",
};

const FRENCH_PHRASES: NarrationPhrases = {
	highlightUnsupported: "Le surlignage ne prend pas en charge la narration de bloc.",
	pageTitleLabel: "Titre de la page",
	dialogueTurnLabel: "Réplique",
	cardBackLabel: "Verso",
	choiceInstruction: "Examinez maintenant les options sur la page et choisissez votre réponse.",
	itemsInstruction: "Examinez maintenant les éléments sur la page et terminez l’activité.",
	tableDirection: "Consultez le tableau sur la page pour voir toutes les données.",
	codeExample: "Exemple de code.",
	codeDirection: "Consultez le code sur la page.",
	equationDirection: "Consultez l’équation sur la page.",
};

function phrasesFor(locale?: string): NarrationPhrases {
	return locale?.toLocaleLowerCase().startsWith("fr") ? FRENCH_PHRASES : ENGLISH_PHRASES;
}

export class HighlightNarrationError extends Error {
	readonly code = "highlight-narration-unsupported";
	readonly reason: string;

	constructor(
		readonly blockId: string,
		locale?: string,
	) {
		const reason = phrasesFor(locale).highlightUnsupported;
		super(`${blockId}: ${reason}`);
		this.name = "HighlightNarrationError";
		this.reason = reason;
	}
}

function assertHighlightNarrationInputs(
	blocks: readonly PraxityBlock[],
	locale?: string,
	targetIds?: ReadonlySet<string>,
): void {
	// Validate before visibility, container scripts or v2 cleanup can hide an explicit input.
	for (const block of flattenLogicBlocks(blocks)) {
		if (block.type !== "highlight") continue;
		if (
			NARRATION_BLOCK_FIELDS.some((field) => Object.hasOwn(block.data, field)) ||
			targetIds?.has(block.id) ||
			childRecords(block).some((child) => typeof child.id === "string" && targetIds?.has(child.id))
		)
			throw new HighlightNarrationError(block.id, locale);
	}
}

function assessmentInstruction(data: Record<string, unknown>, phrases: NarrationPhrases): string {
	const response = isRecord(data.response) ? data.response : {};
	const type = typeof response.type === "string" ? response.type : "";
	if (type === "choice") return phrases.choiceInstruction;
	if (["matching", "sequence", "categorize", "matrix", "hotspot"].includes(type)) {
		return phrases.itemsInstruction;
	}
	return "";
}

function assessmentOptions(data: Record<string, unknown>, locale: string): string[] {
	const response = isRecord(data.response) ? data.response : {};
	const options =
		response.type === "choice"
			? response.options
			: ["single", "multi"].includes(String(data.assessmentType))
				? data.options
				: undefined;
	if (!Array.isArray(options)) return [];
	const labels = options.flatMap((option) => {
		if (!isRecord(option)) return [];
		const label = plainNarrationText(response.type === "choice" ? option.label : option.text);
		return label ? [label] : [];
	});
	if (data._dontKnow === true) labels.push(DONT_KNOW_LABELS[resolveLocale(locale)]);
	return labels;
}

function childBlocks(value: unknown): PraxityBlock[] {
	return Array.isArray(value)
		? value.filter(
				(item): item is PraxityBlock =>
					isRecord(item) && typeof item.id === "string" && typeof item.type === "string",
			)
		: [];
}

// Narration sources ship in page data. Self-check contributes only its task;
// comparison content and private answers must never reach this channel.
function selfCheckSourceData(data: unknown): Record<string, unknown> {
	const content = isRecord(data) && isRecord(data.content) ? data.content : {};
	return { content: { task: content.task } };
}

function retrievalSheetSourceData(data: unknown): Record<string, unknown> {
	const content = isRecord(data) && isRecord(data.content) ? data.content : {};
	const questions = Array.isArray(content.questions) ? content.questions : [];
	return {
		content: {
			title: content.title,
			questions: questions.filter(isRecord).map((item) => ({ question: item.question })),
		},
	};
}

function writeDistractorsSourceData(data: unknown): Record<string, unknown> {
	const content = isRecord(data) && isRecord(data.content) ? data.content : {};
	return { content: { question: content.question } };
}

function sourceValue(input: unknown): unknown {
	// A silent highlight contributes no record, even to a surrounding recording.
	if (Array.isArray(input))
		return input.filter((value) => !isRecord(value) || value.type !== "highlight").map(sourceValue);
	if (!isRecord(input)) return input;
	const value =
		input.type === "selfCheck" && isRecord(input.data)
			? { ...input, data: selfCheckSourceData(input.data) }
			: input.type === "retrievalSheet" && isRecord(input.data)
				? { ...input, data: retrievalSheetSourceData(input.data) }
				: input.type === "writeDistractors" && isRecord(input.data)
					? { ...input, data: writeDistractorsSourceData(input.data) }
					: input;
	// Reader and item identity never contributes to recorded content. Grammar 4
	// uses durable or runtime display IDs; keep authored names.
	const itemId =
		typeof value.id === "string" &&
		((/^item-\d+(?:-\d+)?$/u.test(value.id) &&
			["label", "title", "text", "front", "children"].some((key) => key in value)) ||
			/^stats-\d+-item-\d+$/u.test(value.id) ||
			isDisplayNodeId(value.id));
	const blockId =
		typeof value.type === "string" &&
		isRecord(value.data) &&
		typeof value.id === "string" &&
		((value.id.startsWith(`${value.type}-`) &&
			/^\d+$/u.test(value.id.slice(value.type.length + 1))) ||
			isDisplayNodeId(value.id));
	return Object.fromEntries(
		Object.keys(value)
			.filter(
				(key) =>
					!(key === "id" && (blockId || itemId)) &&
					!isInlineProjectionMetadataKey(key) &&
					!NARRATION_BLOCK_FIELDS.includes(key as (typeof NARRATION_BLOCK_FIELDS)[number]),
			)
			.sort()
			.map((key) => [key, sourceValue(value[key])]),
	);
}

/** Upgrade a saved source fingerprint without changing its content or sidecar schema. */
export function normalizeNarrationSourceContent(source: string): string {
	try {
		const value: unknown = JSON.parse(source);
		if (
			!isRecord(value) ||
			typeof value.type !== "string" ||
			!isRecord(value.data) ||
			Object.keys(value).some((key) => !["type", "a11y", "data"].includes(key))
		)
			return source;
		return narrationSourceContent(value as unknown as PraxityBlock);
	} catch {
		// Page-title text and unknown legacy fingerprints must survive writes intact.
		return source;
	}
}

function narrationSourceContent(block: PraxityBlock): string {
	if (block.type === "highlight") return "";
	return JSON.stringify({
		type: block.type,
		a11y: sourceValue(block.a11y),
		data: sourceValue(
			block.type === "selfCheck"
				? selfCheckSourceData(block.data)
				: block.type === "retrievalSheet"
					? retrievalSheetSourceData(block.data)
					: block.type === "writeDistractors"
						? writeDistractorsSourceData(block.data)
						: block.data,
		),
	});
}

function isNarrationContainer(block: PraxityBlock): boolean {
	return ["accordion", "tabs", "card", "sequence"].includes(block.type);
}

function derivedBlockScript(
	block: PraxityBlock,
	phrases: NarrationPhrases,
): {
	script: string;
	needsReview?: boolean;
	pauseAfter?: boolean;
} {
	const data = isRecord(block.data) ? block.data : {};
	switch (block.type) {
		case "text":
		case "heading":
			return { script: uniqueText(data.kicker, data.content) };
		case "note":
			return { script: uniqueText(data.title, data.content, data.text) };
		case "quote":
			return { script: uniqueText(data.content, data.text, data.attribution, data.speaker) };
		case "dialogue": {
			if (
				!Array.isArray(data.turns) ||
				!data.turns.every(
					(turn) =>
						isRecord(turn) &&
						Array.isArray(turn.paragraphs) &&
						turn.paragraphs.every((paragraph) => typeof paragraph === "string"),
				)
			)
				return { script: "" };
			return {
				script: dialogueTurnScript(data.turns.flatMap((turn) => turn.paragraphs as string[])),
			};
		}
		case "heroCover":
			return { script: uniqueText(data.title, data.subtitle) };
		case "assessmentGroup":
			return { script: uniqueText(data.groupName, data.instructions) };
		case "image":
			return data.decorative === true || block.a11y?.decorative === true
				? { script: "" }
				: {
						script: uniqueText(
							data.altText,
							data.alt,
							block.a11y?.altText,
							data.caption,
							data.description,
						),
					};
		case "chart":
		case "labeledGraphic":
		case "imageComparison": {
			const script = uniqueText(
				data.title,
				data.altText,
				data.imageAlt,
				data.caption,
				data.description,
			);
			return { script, needsReview: !script };
		}
		case "table":
			return {
				script: uniqueText(data.caption, data.summary, phrases.tableDirection),
			};
		case "code":
			return {
				script: uniqueText(
					data.title,
					typeof data.language === "string" ? `${data.language} code.` : phrases.codeExample,
					data.description,
					phrases.codeDirection,
				),
			};
		case "equation": {
			const description = uniqueText(data.description, data.altText, data.title);
			return {
				script: description || phrases.equationDirection,
				needsReview: !description,
			};
		}
		case "stats": {
			const items = Array.isArray(data.items)
				? data.items.flatMap((item) => (isRecord(item) ? [item.label, item.value] : []))
				: [];
			return { script: uniqueText(...items, data.caption) };
		}
		case "resourceEntry":
			return { script: uniqueText(data.label, data.title, data.description) };
		case "checklist":
		case "rating":
		case "signature":
		case "button":
			return {
				script: uniqueText(data.title, data.label, data.sublabel, data.instructions, data.text),
				pauseAfter: true,
			};
		case "assessment": {
			const stemChildren = childBlocks(data.stem);
			const descriptionChildren = childBlocks(data.description);
			const stem = joinText(
				stemChildren.map((child) => derivedBlockScript(child, phrases).script),
				false,
				[],
				stemChildren.map((_child, index) => index),
			);
			const description = joinText(
				descriptionChildren.map((child) => derivedBlockScript(child, phrases).script),
				false,
				[],
				descriptionChildren.map((_child, index) => index),
			);
			const options = assessmentOptions(data, phrases === FRENCH_PHRASES ? "fr" : "en");
			return {
				script: [
					joinText([stem, description, data.question, data.instructions], true, [], [0, 1]),
					options.length ? options.map((option) => `- ${option}`).join("\n") : "",
					assessmentInstruction(data, phrases),
				]
					.filter(Boolean)
					.join("\n\n"),
				pauseAfter: true,
			};
		}
		case "embed":
		case "document":
			return {
				script: uniqueText(data.title, data.caption, data.instructions),
				pauseAfter: true,
			};
		case "audio":
		case "video":
			return { script: "", pauseAfter: true };
		case "accordion":
		case "tabs":
		case "card":
		case "sequence": {
			const values: unknown[] = [data.title, data.instructions];
			const headingIndexes: number[] = [];
			const scriptIndexes: number[] = [];
			for (const item of Array.isArray(data.items) ? data.items : []) {
				if (!isRecord(item)) continue;
				headingIndexes.push(values.length);
				values.push(item.label, item.content);
				for (const child of [...childBlocks(item.children), ...childBlocks(item.front)]) {
					if (child.type === "heading") headingIndexes.push(values.length);
					scriptIndexes.push(values.length);
					values.push(derivedBlockScript(child, phrases).script);
				}
			}
			return { script: joinText(values, true, headingIndexes, scriptIndexes) };
		}
		case "columns":
		case "divider":
		case "pageBreak":
		case "blockBreak":
		case "logic":
		case "variable":
			return { script: "" };
		case "retrievalSheet": {
			// Speak literal title/questions deliberately; authored answers stay on the back.
			const content = isRecord(data.content) ? data.content : {};
			const questions = Array.isArray(content.questions) ? content.questions : [];
			const values = [
				content.title,
				...questions.map((q) => (isRecord(q) ? q.question : undefined)),
			];
			return {
				script: joinText(
					values.map((value) => (typeof value === "string" ? `<p>${escapeHtml(value)}</p>` : "")),
					false,
					[0],
				),
			};
		}
		case "writeDistractors": {
			const question = isRecord(data.content) ? data.content.question : undefined;
			return {
				script: typeof question === "string" ? uniqueText(`<p>${escapeHtml(question)}</p>`) : "",
			};
		}
		// Highlight is silent, including its title when aggregated by a container.
		case "highlight":
			return { script: "" };
		case "selfCheck": {
			// The task is literal text; feedback narration awaits a learner-step target contract.
			const task = isRecord(data.content) ? data.content.task : undefined;
			return { script: typeof task === "string" ? uniqueText(`<p>${escapeHtml(task)}</p>`) : "" };
		}
	}
}

function segmentFromData(
	id: string,
	kind: NarrationSegment["kind"],
	label: string,
	derived: ReturnType<typeof derivedBlockScript>,
	data: Record<string, unknown>,
	settings: NarrationSettings,
	block?: PraxityBlock,
	retainEmpty = false,
): NarrationSegment | null {
	const custom = Object.hasOwn(data, "narration") && typeof data.narration === "string";
	const script = custom ? (data.narration as string).trim() : derived.script.trim();
	if (
		!retainEmpty &&
		!script &&
		!custom &&
		!derived.needsReview &&
		block?.type !== "image" &&
		block?.type !== "assessmentGroup"
	)
		return null;
	return {
		id,
		kind,
		...(block ? { blockId: block.id, blockType: block.type } : {}),
		label,
		derivedScript: derived.script.trim(),
		sourceContent: block ? narrationSourceContent(block) : normalizeNarrationScript(derived.script),
		script,
		custom,
		disabled: data.narrationDisabled === true,
		needsDraftReview: derived.needsReview === true && !custom,
		pauseAfter: derived.pauseAfter === true,
		...(derived.pauseAfter && block ? { authoredStopBlockIds: [block.id] } : {}),
		...(typeof data.narrationAudio === "string" ? { audioUrl: data.narrationAudio } : {}),
		...(typeof data.narrationTimings === "string" ? { timingsUrl: data.narrationTimings } : {}),
		...(typeof data.narrationDuration === "number" &&
		Number.isFinite(data.narrationDuration) &&
		data.narrationDuration > 0
			? { duration: data.narrationDuration }
			: {}),
		...(typeof data.narrationReviewedSourceHash === "string"
			? { reviewedSourceHash: data.narrationReviewedSourceHash }
			: {}),
		...(typeof data.narrationAcceptedInputsHash === "string"
			? { acceptedInputsHash: data.narrationAcceptedInputsHash }
			: {}),
		overrides: {
			...(typeof data.narrationLanguage === "string" ? { language: data.narrationLanguage } : {}),
			...(typeof data.narrationVoice === "string" ? { voice: data.narrationVoice } : {}),
			...(typeof data.narrationSpeed === "number" ? { speed: data.narrationSpeed } : {}),
		},
		settings,
	};
}

export function extractNarrationSegments(
	pageTitle: string,
	pageData: Record<string, unknown>,
	blocks: readonly PraxityBlock[],
	lessonDefaults: Record<string, unknown> = {},
	courseLocale?: string,
	options: {
		wholeContainerIds?: ReadonlySet<string>;
		retainEmptyTargets?: ReadonlySet<string>;
		moduleDeck?: AssessmentDeckOptions;
	} = {},
): NarrationSegment[] {
	assertHighlightNarrationInputs(blocks, courseLocale);
	// Standalone scripts also accept raw source blocks. Prepared blocks keep their resolved context.
	if (
		flattenLogicBlocks(blocks).some(
			(block) => block.type === "assessment" && block.data._dontKnow === undefined,
		)
	)
		blocks = resolveAssessmentDontKnow(blocks, options.moduleDeck);
	// A surviving v2 target with no words still owns its attached recording.
	const makeSegment = (...args: Parameters<typeof segmentFromData>) => {
		const [id, kind, label, derived, data, settings, block] = args;
		return segmentFromData(
			id,
			kind,
			label,
			derived,
			data,
			settings,
			block,
			options.retainEmptyTargets?.has(id),
		);
	};
	const segments: NarrationSegment[] = [];
	const hiddenIds = initiallyHiddenBlockIds(blocks);
	const scoped = flattenLogicBlocks(blocks);
	const showableIds = new Set<string>();
	const logicTargetIds = new Set<string>();
	let pendingStops: NonNullable<NarrationSegment["stopBefore"]> = [];
	for (const block of scoped) {
		const data = isRecord(block.data) ? block.data : {};
		if (typeof data.visible === "string" && data.visible.trim()) {
			resolveBlockTargetIds(scoped, block.id).forEach((id) => showableIds.add(id));
		}
		if (block.type !== "logic" || !Array.isArray(data.actions)) continue;
		for (const raw of data.actions) {
			if (!isRecord(raw) || typeof raw.type !== "string") continue;
			const action = normalizeAction(raw as unknown as LogicAction);
			if (action?.type !== "show" && action?.type !== "hide") continue;
			if (!Array.isArray(action.targets)) continue;
			for (const target of action.targets) {
				if (typeof target !== "string") continue;
				for (const id of resolveBlockTargetIds(scoped, target)) {
					logicTargetIds.add(id);
					if (action.type === "show") showableIds.add(id);
				}
			}
		}
	}
	const phrases = phrasesFor(courseLocale);
	const title = makeSegment(
		"page-title",
		"pageTitle",
		pageTitle || phrases.pageTitleLabel,
		{ script: plainNarrationText(pageTitle) },
		pageData,
		resolveNarrationSettings(lessonDefaults, pageData, pageData, courseLocale),
	);
	if (title) segments.push(title);

	const visit = (
		items: readonly PraxityBlock[],
		inherited: Record<string, unknown> = {},
		cardTargets: NarrationCardTarget[] = [],
		inheritedOwner?: string,
		ancestorBlockIds: string[] = [],
	) => {
		const push = (segment: NarrationSegment, targets = cardTargets) => {
			segments.push({
				...segment,
				...(ancestorBlockIds.length ? { ancestorBlockIds } : {}),
				...(pendingStops.length ? { stopBefore: pendingStops } : {}),
				...(targets.length ? { cardTargets: targets } : {}),
			});
			pendingStops = [];
		};
		for (const block of items) {
			if (block.type === "highlight") continue;
			const data = isRecord(block.data) ? block.data : {};
			const authoredHidden = block.visible === false || data.hide === true || data.hidden === true;
			if (authoredHidden && !showableIds.has(block.id)) continue;
			if (hiddenIds.has(block.id) && !showableIds.has(block.id) && !inheritedOwner) continue;
			const owner = hiddenIds.has(block.id)
				? showableIds.has(block.id)
					? block.id
					: inheritedOwner
				: inheritedOwner;
			const scope = {
				...inherited,
				...narrationDefaultsFromScope(data.narrationContainerSplit === true ? {} : data),
				narrationDisabled:
					inherited.narrationDisabled === true ||
					(data.narrationContainerSplit !== true && data.narrationDisabled === true),
			};
			const effectiveData = {
				...data,
				narrationDisabled: scope.narrationDisabled || data.narrationDisabled === true,
			};
			const settings = resolveNarrationSettings(
				lessonDefaults,
				pageData,
				{ ...scope, ...data },
				courseLocale,
			);
			if (block.type === "columns") {
				const columns = Array.isArray(data.columns) ? data.columns : data.items;
				if (Array.isArray(columns)) {
					for (const column of columns) {
						if (!isRecord(column)) continue;
						visit(
							[...childBlocks(column.children), ...childBlocks(column.blocks)],
							scope,
							cardTargets,
							owner,
							[...ancestorBlockIds, block.id],
						);
					}
				}
				continue;
			}
			if (block.type === "dialogue") {
				const dialogueName = typeof data.name === "string" ? data.name : null;
				const caption = typeof data.caption === "string" ? dialogueTurnScript([data.caption]) : "";
				const intro = caption
					? makeSegment(block.id, "block", caption, { script: caption }, effectiveData, settings, {
							id: block.id,
							type: block.type,
							data: { dialogue: dialogueName, caption: data.caption },
						})
					: null;
				if (intro)
					push({
						...intro,
						containerPart: "intro",
						...(owner ? { conditionalBlockId: owner } : {}),
					});
				for (const [itemIndex, turn] of (Array.isArray(data.turns) ? data.turns : []).entries()) {
					if (!isRecord(turn) || !Array.isArray(turn.paragraphs)) continue;
					const paragraphs = turn.paragraphs.filter(
						(part): part is string => typeof part === "string",
					);
					const key = typeof turn.speaker === "string" ? turn.speaker.trim() : "";
					// Literal display text; every output escapes it.
					const name = (typeof turn.name === "string" && turn.name.trim()) || key;
					const turnScope = {
						...scope,
						...(typeof turn.voice === "string" && turn.voice ? { narrationVoice: turn.voice } : {}),
						...narrationDefaultsFromScope(turn),
						narrationDisabled: scope.narrationDisabled === true || turn.narrationDisabled === true,
					};
					const segment = makeSegment(
						`${block.id}:item:${itemIndex}`,
						"block",
						name || `${phrases.dialogueTurnLabel} ${itemIndex + 1}`,
						{ script: dialogueTurnScript(paragraphs) },
						{ ...turn, narrationDisabled: turnScope.narrationDisabled },
						resolveNarrationSettings(lessonDefaults, pageData, turnScope, courseLocale),
						{
							id: block.id,
							type: block.type,
							data: {
								dialogue: dialogueName,
								turn: { speaker: key ? key.toLowerCase() : null, paragraphs },
							},
						},
					);
					if (segment)
						push({
							...segment,
							containerPart: "item",
							itemIndex,
							...(name ? { speaker: name } : {}),
							...(owner ? { conditionalBlockId: owner } : {}),
						});
				}
				continue;
			}
			const splitForVisibility =
				isNarrationContainer(block) &&
				flattenLogicBlocks([block])
					.slice(1)
					.some(
						(child) =>
							child.type !== "variable" &&
							child.type !== "highlight" &&
							child.type !== "logic" &&
							(hiddenIds.has(child.id) || logicTargetIds.has(child.id)),
					);
			const wholeContainer =
				isNarrationContainer(block) &&
				!splitForVisibility &&
				(options.wholeContainerIds?.has(block.id) ||
					(data.narrationContainerSplit !== true &&
						(typeof data.narration === "string" || typeof data.narrationAudio === "string")));
			if (isNarrationContainer(block) && !wholeContainer) {
				const { items: containerItems, ...introData } = data;
				// A whole-container clip/script cannot become an introduction after splitting.
				const introNarration =
					splitForVisibility && data.narrationContainerSplit !== true
						? {
								...effectiveData,
								narration: undefined,
								narrationAudio: undefined,
								narrationTimings: undefined,
								narrationDuration: undefined,
								narrationReviewedSourceHash: undefined,
								narrationAcceptedInputsHash: undefined,
							}
						: effectiveData;
				const intro = makeSegment(
					block.id,
					"block",
					plainNarrationText(data.title ?? data.instructions) || block.type,
					{ script: uniqueText(data.title, data.instructions) },
					introNarration,
					settings,
					{ ...block, data: introData },
				);
				if (intro)
					push({
						...intro,
						containerPart: "intro",
						...(owner ? { conditionalBlockId: owner } : {}),
					});
				if (!Array.isArray(containerItems)) continue;
				for (const [itemIndex, item] of containerItems.entries()) {
					if (!isRecord(item) || item.hide === true || item.visible === false) continue;
					const sides =
						block.type === "card" &&
						(childBlocks(item.back).length ||
							options.retainEmptyTargets?.has(`${block.id}:item:${itemIndex}:back`))
							? (["front", "back"] as const)
							: (["front"] as const);
					for (const side of sides) {
						const back = side === "back";
						const faceData = back ? (isRecord(item.narrationBack) ? item.narrationBack : {}) : item;
						const targets: NarrationCardTarget[] =
							block.type === "card"
								? [...cardTargets, { containerId: block.id, itemIndex, side }]
								: cardTargets;
						const children = back
							? childBlocks(item.back)
							: [...childBlocks(item.children), ...childBlocks(item.front)];
						// Nested containers and child overrides retain their own owners and authored order.
						const recurse = flattenLogicBlocks(children)
							.filter((child) => child.type !== "highlight")
							.some(
								(child) =>
									isNarrationContainer(child) ||
									child.type === "selfCheck" ||
									child.type === "dialogue" ||
									child.type === "columns" ||
									(hiddenIds.has(child.id) && showableIds.has(child.id)) ||
									logicTargetIds.has(child.id) ||
									NARRATION_BLOCK_FIELDS.some((key) => Object.hasOwn(child.data ?? {}, key)),
							);
						const itemScope = {
							...scope,
							...narrationDefaultsFromScope(faceData),
							narrationDisabled:
								scope.narrationDisabled === true || faceData.narrationDisabled === true,
						};
						const includedChildren = recurse
							? []
							: children.filter((child) => child.type !== "highlight" && !hiddenIds.has(child.id));
						const childScripts = includedChildren.map((child) =>
							derivedBlockScript(child, phrases),
						);
						const childStopIds = includedChildren.flatMap((child, index) =>
							childScripts[index].pauseAfter ? [child.id] : [],
						);
						const derived = {
							script: joinText(
								[
									back ? undefined : item.label,
									back ? undefined : item.content,
									...childScripts.map((child) => child.script),
								],
								true,
								[
									0,
									...includedChildren.flatMap((child, index) =>
										child.type === "heading" ? [index + 2] : [],
									),
								],
								childScripts.map((_child, index) => index + 2),
							),
							needsReview: childScripts.some((child) => child.needsReview),
							pauseAfter: childScripts.some((child) => child.pauseAfter),
						};
						const segment = makeSegment(
							`${block.id}:item:${itemIndex}${back ? ":back" : ""}`,
							"block",
							(plainNarrationText(item.label ?? item.content) ||
								`${intro?.label ?? block.type} ${itemIndex + 1}`) +
								(back ? ` · ${phrases.cardBackLabel}` : ""),
							derived,
							{ ...faceData, narrationDisabled: itemScope.narrationDisabled },
							resolveNarrationSettings(lessonDefaults, pageData, itemScope, courseLocale),
							{
								...block,
								data: {
									item: back
										? { back: recurse ? undefined : item.back }
										: recurse
											? { ...item, children: undefined, front: undefined }
											: item,
								},
							},
						);
						if (segment)
							push(
								{
									...segment,
									containerPart: "item",
									itemIndex,
									authoredStopBlockIds: childStopIds,
									...(back ? { itemSide: "back" as const } : {}),
									...(owner ? { conditionalBlockId: owner } : {}),
								},
								targets,
							);
						if (recurse)
							visit(children, itemScope, targets, owner, [...ancestorBlockIds, block.id]);
					}
				}
				continue;
			}
			const derived = derivedBlockScript(block, phrases);
			if (!derived.script && derived.pauseAfter) {
				for (let index = segments.length - 1; index >= 0; index--) {
					if (!hasNarrationContent(segments[index])) continue;
					segments[index].pauseAfter = true;
					break;
				}
				pendingStops.push({
					blockId: block.id,
					...(ancestorBlockIds.length ? { ancestorBlockIds } : {}),
					...(owner ? { conditionalBlockId: owner } : {}),
				});
				continue;
			}
			const segment = makeSegment(
				block.id,
				"block",
				plainNarrationText(data.groupName ?? data.title ?? data.label ?? data.content) ||
					(block.type === "image" && typeof data.src === "string"
						? plainNarrationText(data.src.split(/[?#]/u)[0]?.split(/[\\/]/u).pop())
						: "") ||
					block.type,
				derived,
				effectiveData,
				settings,
				// Group membership uses parser IDs at runtime. Fingerprint the members'
				// content so edits elsewhere cannot detach the group's introduction.
				block.type === "assessmentGroup"
					? {
							...block,
							data: {
								...data,
								memberBlockIds: undefined,
								// Broken member references are the group validators' error to
								// report (course PDF, editor diagnostics); narration skips them.
								members: (Array.isArray(data.memberBlockIds) ? data.memberBlockIds : []).flatMap(
									(id) => {
										const member = scoped.find((candidate) => candidate.id === id);
										return member
											? [{ type: member.type, a11y: member.a11y, data: member.data }]
											: [];
									},
								),
							},
						}
					: block,
			);
			if (
				segment &&
				block.type === "heading" &&
				segments.length === 1 &&
				!title?.disabled &&
				segment.derivedScript === title?.derivedScript &&
				!NARRATION_BLOCK_FIELDS.some((field) => Object.hasOwn(data, field)) &&
				!owner
			) {
				if (title) title.blockId = block.id;
				continue;
			}
			if (segment)
				push({
					...(wholeContainer ? { ...segment, wholeContainer: true } : segment),
					...(owner ? { conditionalBlockId: owner } : {}),
				});
		}
	};
	visit(blocks);
	if (pendingStops.length && segments.length) {
		const last = segments[segments.length - 1];
		last.trailingStops = [...(last.trailingStops ?? []), ...pendingStops];
	}
	return segments;
}

export function validateNarrationCues(script: string): string[] {
	const invalid: string[] = [];
	for (const match of script.matchAll(/\[([^\]]*)\]/gu)) {
		const tag = match[1]?.trim().toLocaleLowerCase() ?? "";
		if (!tag || !SONIOX_AUDIO_TAGS.has(tag)) invalid.push(match[0]);
	}
	const open = [...script].filter((character) => character === "[").length;
	const close = [...script].filter((character) => character === "]").length;
	if (open !== close) invalid.push("unmatched bracket");
	return [...new Set(invalid)];
}

function vttSeconds(value: string): number | null {
	const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/u.exec(value.trim());
	if (!match) return null;
	const seconds =
		Number(match[1] ?? 0) * 3600 +
		Number(match[2]) * 60 +
		Number(match[3]) +
		Number(match[4]) / 1000;
	return Number.isFinite(seconds) ? seconds : null;
}

export function parseNarrationVtt(vtt: string): NarrationVttCue[] | null {
	if (!vtt.replace(/^\uFEFF/u, "").startsWith("WEBVTT")) return null;
	const cues: NarrationVttCue[] = [];
	let previousEnd = 0;
	for (const block of vtt.split(/\r?\n\r?\n/u).slice(1)) {
		if (block.startsWith("NOTE")) continue;
		const lines = block.split(/\r?\n/u);
		const timingIndex = lines.findIndex((line) => line.includes("-->"));
		if (timingIndex < 0) continue;
		const [startValue, endValue] = lines[timingIndex].split("-->").map((value) => value.trim());
		const start = startValue ? vttSeconds(startValue) : null;
		const end = endValue ? vttSeconds(endValue.split(/\s/u)[0] ?? "") : null;
		const text = plainNarrationText(lines.slice(timingIndex + 1).join(" "));
		if (start === null || end === null || end <= start || !text) return null;
		if (start < previousEnd) return null;
		previousEnd = end;
		const displayText = plainNarrationText(
			narrationDisplayText(lines.slice(timingIndex + 1).join(" ")),
		);
		if (displayText) cues.push({ start, end, text: displayText });
	}
	return cues.length > 0 ? cues : null;
}

export function deriveNarrationStatus(input: {
	disabled?: boolean;
	needsDraftReview?: boolean;
	audioUrl?: string;
	timingsUrl?: string;
	custom?: boolean;
	manual?: boolean;
	sourceHash?: string;
	reviewedSourceHash?: string;
	provenanceCurrent?: boolean;
	acceptedInputsCurrent?: boolean;
}): NarrationStatus {
	if (input.disabled) return "disabled";
	if (input.needsDraftReview) return "needsReview";
	if (!input.audioUrl)
		return input.custom && input.sourceHash !== input.reviewedSourceHash
			? "needsReview"
			: "missing";
	if (
		(input.custom || input.manual) &&
		input.sourceHash &&
		input.sourceHash !== input.reviewedSourceHash
	) {
		return "needsReview";
	}
	if (input.manual) return input.timingsUrl ? "ready" : "manualNoTimings";
	return input.provenanceCurrent === false && !input.acceptedInputsCurrent ? "stale" : "ready";
}
