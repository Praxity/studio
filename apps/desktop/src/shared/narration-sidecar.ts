import { type GrammarFrontmatter, normalizeLineEndings } from "@praxity/grammar";
import type { AssessmentDeckOptions } from "@praxity/shared-blocks/assessment-choice";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import {
	DEFAULT_NARRATION_VOICE,
	isNarrationSpeed,
	NARRATION_ROLES,
	type NarrationEntryV2,
	type NarrationLessonV2,
	type NarrationSettings,
	type NarrationSidecarV2,
	type NarrationStatus,
	normalizeNarrationScript,
	resolveNarrationEnabled,
	resolveNarrationV2,
	updateNarrationV2Entry,
} from "@praxity/shared-blocks/narration";
import { isDisplayNodeId, type PraxityPage } from "@praxity/shared-blocks/types";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { NarrationVoice } from "./bridge";
import { NarrationTargetUnresolvedError } from "./project-write-errors";
import {
	type SelfCheckNarrationWarning,
	selfCheckNarrationAdvice,
} from "./self-check-narration-advice";

export { DEFAULT_NARRATION_VOICE } from "@praxity/shared-blocks/narration";
export type { SelfCheckNarrationWarning } from "./self-check-narration-advice";
export type NarrationDisplayState = Exclude<NarrationStatus, "manualNoTimings">;
export function defaultNarrationVoice(
	voices: NarrationVoice[],
	language: string,
): string | undefined {
	const available = voices.filter((voice) => voice.languages.includes(language));
	return available.find((voice) => voice.id === DEFAULT_NARRATION_VOICE)?.id ?? available[0]?.id;
}

export const NARRATION_SIDECAR_PATH = "narration.yaml";
export type { NarrationEntryV2, NarrationLessonV2, NarrationSidecarV2 };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Missing sidecars have a display-only empty view, including before the first identity save. */
export function emptyNarrationReadView(courseId: string): NarrationSidecarV2 {
	if (!isDisplayNodeId(courseId)) throw new Error("Invalid narration read course identity");
	return { version: 2, courseId, lessons: {} };
}

/** V2 refuses lossy reads: unknown fields, duplicate targets and malformed entries are errors. */
export function parseNarrationSidecarV2(source: string, courseId?: string): NarrationSidecarV2 {
	const fail = (reason: string): never => {
		throw new Error(`Invalid narration.yaml v2: ${reason}`);
	};
	const uuid = (value: unknown): value is string =>
		typeof value === "string" &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
	const object = (
		value: unknown,
		keys: readonly string[],
		label: string,
	): Record<string, unknown> => {
		if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key)))
			return fail(label);
		return value;
	};
	const settings = (value: Record<string, unknown>) => {
		for (const key of ["language", "voice"] as const)
			if (
				value[key] !== undefined &&
				(typeof value[key] !== "string" || !(value[key] as string).trim())
			)
				fail(key);
		if (value.speed !== undefined && !isNarrationSpeed(value.speed))
			fail("speed must be between 0.7 and 1.3");
	};
	if (!source.trim()) {
		if (!uuid(courseId)) return fail("an empty v2 sidecar requires the course identity");
		return emptyNarrationReadView(courseId);
	}
	const parsed: unknown = parseYaml(normalizeLineEndings(source));
	if (isRecord(parsed) && parsed.version === 1)
		throw new Error(
			"Narration version 1 cannot be opened for grammar 4. Run pnpm --dir ../praxity-converter --filter @praxity/convert convert <course-copy> --from 3 --out <new-output-directory>.",
		);
	const root = object(
		parsed,
		["version", "courseId", "lessons"],
		"expected version 2 with courseId and lessons",
	);
	if (root.version !== 2 || !uuid(root.courseId) || !isRecord(root.lessons))
		return fail("expected version 2 with courseId and lessons");
	if (courseId !== undefined && root.courseId !== courseId)
		return fail("course identity does not match");
	const targets = new Set<string>();
	for (const [lessonId, raw] of Object.entries(root.lessons)) {
		if (!uuid(lessonId)) fail("lesson identity must be a UUID");
		const lesson = object(raw, ["enabled", "defaults", "segments"], "lesson fields");
		if (lesson.enabled !== undefined && typeof lesson.enabled !== "boolean")
			fail("enabled must be boolean");
		if (lesson.defaults !== undefined)
			settings(object(lesson.defaults, ["language", "voice", "speed"], "defaults"));
		if (!Array.isArray(lesson.segments)) fail("segments must be an array");
		for (const rawEntry of lesson.segments as unknown[]) {
			const entry = object(
				rawEntry,
				[
					"target",
					"reviewedRevision",
					"script",
					"disabled",
					"language",
					"voice",
					"speed",
					"audio",
					"timings",
					"duration",
					"audioFor",
					"acceptedFor",
				],
				"segment fields",
			);
			const target = object(entry.target, ["id", "role"], "target fields");
			if (!uuid(target.id) && isDisplayNodeId(target.id))
				throw new NarrationTargetUnresolvedError(source);
			if (!uuid(target.id) || !(NARRATION_ROLES as readonly unknown[]).includes(target.role))
				fail("target identity or role");
			const key = `${target.id}:${target.role}`;
			if (targets.has(key)) fail("duplicate target");
			targets.add(key);
			settings(entry);
			if (
				entry.reviewedRevision !== undefined &&
				(typeof entry.reviewedRevision !== "string" ||
					!/^[a-f0-9]{64}$/.test(entry.reviewedRevision))
			)
				fail("reviewedRevision must be SHA-256");
			if (entry.script !== undefined && typeof entry.script !== "string")
				fail("script must be text");
			if (entry.disabled !== undefined && typeof entry.disabled !== "boolean")
				fail("disabled must be boolean");
			for (const key of ["audio", "timings"])
				if (
					entry[key] !== undefined &&
					(typeof entry[key] !== "string" || !(entry[key] as string).trim())
				)
					fail(`${key} must be a path`);
			if (
				entry.duration !== undefined &&
				(typeof entry.duration !== "number" ||
					!Number.isFinite(entry.duration) ||
					entry.duration <= 0)
			)
				fail("duration must be positive");
			for (const provenance of ["audioFor", "acceptedFor"]) {
				if (entry[provenance] === undefined) continue;
				const audioFor = object(
					entry[provenance],
					["script", "language", "voice", "speed"],
					"audioFor fields",
				);
				if (
					typeof audioFor.script !== "string" ||
					typeof audioFor.language !== "string" ||
					typeof audioFor.voice !== "string" ||
					typeof audioFor.speed !== "number"
				)
					fail("audioFor requires script, language, voice and speed");
				settings(audioFor);
			}
		}
	}
	return root as unknown as NarrationSidecarV2;
}

export function serializeNarrationSidecarV2(sidecar: NarrationSidecarV2): string {
	const source = stringifyYaml(sidecar, { lineWidth: 0 });
	parseNarrationSidecarV2(source);
	return source;
}

export type ProjectNarrationWarning = (
	| { code: "ENARRATIONUNLINKED"; count: number }
	| SelfCheckNarrationWarning
) & { file: string };

export function resolveLessonNarration(input: {
	read: import("@praxity/grammar").ReadLessonResult;
	courseId: string;
	lessonId: string;
	sidecar: NarrationSidecarV2;
	locale: string;
	enabled?: boolean;
	defaults?: NarrationSettings;
	componentDefaults?: Record<string, Record<string, unknown>>;
	moduleDeck?: AssessmentDeckOptions;
	digest: (text: string) => string;
}) {
	const pages = splitBlocksIntoPages(
		adaptGrammarPreviewBlocks(input.read.blocks, input.componentDefaults, input.locale, {
			moduleDeck: input.moduleDeck,
			preserveSource: true,
		}),
		input.read.frontmatter.title ?? "",
	);
	const resolved = resolveNarrationV2({ ...input, pages });
	const warnings = selfCheckNarrationAdvice(input.read, resolved);
	const lesson = input.sidecar.lessons[input.lessonId];
	for (const [index, page] of pages.entries()) {
		const boundary = input.read.blocks.find(
			(block) => block.type === "pageBreak" && block.data.id === page.id,
		);
		if (!boundary) throw new Error(`Narration page has no grammar 4 boundary: ${page.id}`);
		boundary.data._narrationEnabled = resolved.pages[index].enabled;
		boundary.data._narrationSegments = resolved.pages[index].segments;
	}
	return {
		warnings,
		blocks: input.read.blocks,
		frontmatter: {
			...input.read.frontmatter,
			narrationEnabled: resolveNarrationEnabled(input.enabled, lesson?.enabled),
		} as GrammarFrontmatter,
		pages,
		items: resolved.pages.flatMap((page, index) =>
			page.segments.map((segment) => ({
				pageNumber: index + 1,
				segment,
				entry: Object.values(input.sidecar.lessons)
					.flatMap((lesson) => lesson.segments)
					.find(
						(entry) =>
							entry.target.id === segment.target.id && entry.target.role === segment.target.role,
					),
			})),
		),
		unlinked: resolved.unresolved,
	};
}

export interface NarrationPanelDocument {
	source: string;
	courseTargets: string[];
	lessonId: string;
	courseId: string;
	pages: PraxityPage[];
	locale: string;
	revisions: Record<string, string>;
	blockLines: Record<string, number>;
	warnings?: SelfCheckNarrationWarning[];
}
export interface NarrationPanelItem {
	pageTitle: string;
	key: string;
	pageNumber: number;
	segment: import("@praxity/shared-blocks/narration").NarrationSegmentV2;
	entry?: NarrationEntryV2;
	ownerLessonId?: string;
	entryIndex?: number;
}
/** Revisions come from the admitted host snapshot. UI edits only change sidecar fields. */
export function resolveNarrationPanel(
	document: NarrationPanelDocument,
	sidecar: NarrationSidecarV2,
	enabled?: boolean,
) {
	const resolution = resolveNarrationV2({
		...document,
		sidecar,
		enabled,
		digest: (text) => {
			const revision = document.revisions[text];
			if (!revision) throw new Error("Narration source changed; reload the authoring snapshot");
			return revision;
		},
	});
	const owners = new Map<
		string,
		{ entry: NarrationEntryV2; entryIndex: number; ownerLessonId: string }
	>(
		Object.entries(sidecar.lessons).flatMap(([ownerLessonId, lesson]) =>
			lesson.segments.map(
				(entry, entryIndex) =>
					[
						`${entry.target.id}:${entry.target.role}`,
						{ entry, entryIndex, ownerLessonId },
					] as const,
			),
		),
	);
	const items: NarrationPanelItem[] = resolution.pages.flatMap((page, index) =>
		page.segments.map((segment) => ({
			key: segment.id,
			pageTitle: document.pages[index].title,
			pageNumber: index + 1,
			segment,
			...owners.get(segment.id),
		})),
	);
	return {
		items,
		unlinked: resolution.unresolved.filter(
			({ entry }) => !document.courseTargets.includes(`${entry.target.id}:${entry.target.role}`),
		),
	};
}

export function updateNarrationPanelEntry(
	sidecar: NarrationSidecarV2,
	lessonId: string,
	item: NarrationPanelItem,
	patch: { [K in keyof Omit<NarrationEntryV2, "target">]?: NarrationEntryV2[K] | null },
): NarrationSidecarV2 {
	const initialized = {
		...sidecar,
		lessons: { ...sidecar.lessons, [lessonId]: sidecar.lessons[lessonId] ?? { segments: [] } },
	};
	return updateNarrationV2Entry(initialized, lessonId, item.segment.target, {
		reviewedRevision: item.segment.revision,
		...Object.fromEntries(
			Object.entries(patch).map(([key, value]) => [key, value === null ? undefined : value]),
		),
	});
}
export function updateNarrationPanelLesson(
	sidecar: NarrationSidecarV2,
	lessonId: string,
	patch: Partial<NarrationLessonV2>,
): NarrationSidecarV2 {
	return {
		...sidecar,
		lessons: {
			...sidecar.lessons,
			[lessonId]: { ...(sidecar.lessons[lessonId] ?? { segments: [] }), ...patch },
		},
	};
}
export function removeNarrationV2Entry(
	sidecar: NarrationSidecarV2,
	ownerLessonId: string,
	index: number,
): NarrationSidecarV2 {
	const lesson = sidecar.lessons[ownerLessonId];
	if (!lesson?.segments[index]) throw new Error("Unknown narration entry");
	return {
		...sidecar,
		lessons: {
			...sidecar.lessons,
			[ownerLessonId]: {
				...lesson,
				segments: lesson.segments.filter((_entry, entryIndex) => entryIndex !== index),
			},
		},
	};
}
