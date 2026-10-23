import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { withoutInlineProjectionMetadata } from "@praxity/shared-blocks/inline-markdown";
import {
	acceptNarrationV2Entry,
	type NarrationSidecarV2,
	type NarrationTarget,
	narrationRecordingInputs,
	narrationTargetKey,
	normalizeNarrationScript,
	updateNarrationV2Entry,
} from "@praxity/shared-blocks/narration";
import { isMap, isNode, isSeq } from "yaml";
import { moduleDeckOptions } from "../shared/module-deck";
import {
	NARRATION_SIDECAR_PATH,
	parseNarrationSidecarV2,
	resolveLessonNarration,
	serializeNarrationSidecarV2,
} from "../shared/narration-sidecar";
import { resolveDesignSettings } from "../shared/settings-inheritance";
import { readCourseManifestData } from "./course-manifest-io";
import { readNarrationSidecar } from "./export/build-export-input-from-project";
import { parseLessonSource, readLessonSource, resolveLessonSources } from "./lesson-source";
import { readFileWithin, resolveExistingPathWithin } from "./path-security";
import { applyPlainYamlEdits, plainYamlDocument, type YamlEdit } from "./plain-yaml-edit";
import { applyProjectFilePlan, withProjectFileTransaction } from "./project-file-transactions";

const digest = (source: string) => createHash("sha256").update(source).digest("hex");

async function snapshot(root: string, drafts: Readonly<Record<string, string>> = {}) {
	const { manifest, lessonFilesOnDisk } = await readCourseManifestData(root);
	for (const file of Object.keys(drafts))
		if (!lessonFilesOnDisk.includes(file)) throw new Error("Unknown narration lesson");
	const identity = await resolveLessonSources(root, drafts, {
		strict: Object.keys(drafts).length === 0,
	});
	const sidecar = await readNarrationSidecar(root, identity.identity.course.courseId);
	const documents = await Promise.all(
		lessonFilesOnDisk.map(async (filename) => {
			const source = drafts[filename] ?? (await readLessonSource(root, filename));
			const read = await parseLessonSource(root, filename, source, {
				identity,
				cast: manifest.cast,
			});
			const locale =
				typeof read.frontmatter.lang === "string"
					? read.frontmatter.lang
					: (manifest.locale ?? "en");
			const resolved = resolveLessonNarration({
				read,
				courseId: read.courseId,
				lessonId: read.lessonId,
				sidecar,
				locale,
				enabled: manifest.narrationEnabled,
				componentDefaults: resolveDesignSettings(null, manifest, read.frontmatter).design
					.componentDefaults as Record<string, Record<string, unknown>> | undefined,
				moduleDeck: moduleDeckOptions(manifest.moduleDeck, read.blocks, read.frontmatter),
				digest,
			});
			return {
				source,
				blockLines: Object.fromEntries([...read.spans].map(([id, span]) => [id, span.startLine])),
				filename,
				lessonId: read.lessonId,
				locale,
				frontmatter: resolved.frontmatter,
				pages: resolved.pages,
				items: resolved.items,
				unlinked: resolved.unlinked,
				warnings: resolved.warnings,
			};
		}),
	);
	// An entry stored under its old lesson may now resolve in a different lesson.
	const keys = new Set(
		documents.flatMap((doc) => doc.items.map((item) => narrationTargetKey(item.segment.target))),
	);
	const unresolved = Object.entries(sidecar.lessons).flatMap(([lessonId, lesson]) =>
		lesson.segments
			.filter((entry) => !keys.has(narrationTargetKey(entry.target)))
			.map((entry) => ({ lessonId, entry })),
	);
	return {
		identity,
		sidecar,
		source: await optionalSidecarSource(root),
		documents: documents.map((doc) => ({
			...doc,
			courseTargets: [...keys],
			courseId: sidecar.courseId,
			revisions: Object.fromEntries(
				doc.items.map((item) => [
					normalizeNarrationScript(item.segment.derivedScript).normalize("NFC"),
					item.segment.revision,
				]),
			),
		})),
		unresolved,
	};
}

export function readNarrationAuthoring(
	root: string,
	drafts: Readonly<Record<string, string>> = {},
) {
	return withProjectFileTransaction(
		root,
		async (root) => {
			const { identity: _identity, ...view } = await snapshot(root, drafts);
			return withoutInlineProjectionMetadata(view, { keepDisplay: true });
		},
		"read",
	);
}

/** Existing files only, rooted before any sidecar mutation, including Windows and link aliases. */
export async function validateNarrationAsset(root: string, asset: string): Promise<void> {
	if (
		!/^assets\/(?!.*(?:^|\/)\.\.?\/)[^\\:\x00-\x1f]+$/u.test(asset) ||
		asset.split("/").some((part) => !part || part === "." || part === "..")
	)
		throw new Error("Recording path must be inside project assets/");
	const path = await resolveExistingPathWithin(root, join(root, asset));
	if (!(await stat(path)).isFile()) throw new Error("Recording path must be an existing file");
}

async function optionalSidecarSource(root: string) {
	try {
		return (await readFileWithin(root, join(root, NARRATION_SIDECAR_PATH), "utf8")) as string;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

/** The command owns one target entry. Other entries, comments and line endings stay byte-identical. */
function targetReplacement(
	source: string | null,
	next: NarrationSidecarV2,
	target: NarrationTarget,
): string {
	if (source === null) return serializeNarrationSidecarV2(next);
	const document = plainYamlDocument(source);
	const key = narrationTargetKey(target);
	const owner = Object.entries(next.lessons).find(([, lesson]) =>
		lesson.segments.some((entry) => narrationTargetKey(entry.target) === key),
	);
	if (!owner) throw new Error("Unknown narration entry");
	const [lessonId, lesson] = owner;
	const index = lesson.segments.findIndex((entry) => narrationTargetKey(entry.target) === key);
	const sequence = document.getIn(["lessons", lessonId, "segments"], true);
	const entry = isSeq(sequence) ? sequence.items[index] : undefined;
	const ending = source.match(/\r\n|\r|\n/)?.[0] ?? "\n";
	const edits: YamlEdit[] = [];
	if (isNode(entry) && entry.range) {
		const [start, end] = entry.range;
		edits.push({
			start,
			end,
			text:
				JSON.stringify(lesson.segments[index]) +
				(/[\r\n]$/.test(source.slice(start, end)) ? ending : ""),
		});
	} else if (isSeq(sequence) && sequence.range) {
		if (sequence.flow || sequence.items.length === 0) {
			const [start, end] = sequence.range;
			edits.push({
				start,
				end,
				text:
					JSON.stringify(lesson.segments) +
					(/[\r\n]$/.test(source.slice(start, end)) ? ending : ""),
			});
		} else {
			const end = sequence.range[1];
			const first = sequence.items[0];
			if (!isNode(first) || !first.range) throw new Error("Narration sequence has no source range");
			const prefix = source.slice(source.lastIndexOf("\n", first.range[0]) + 1, first.range[0]);
			edits.push({
				start: end,
				end,
				text: `${/[\r\n]$/.test(source.slice(0, end)) ? "" : ending}${" ".repeat(Math.max(0, prefix.length - 2))}- ${JSON.stringify(lesson.segments[index])}${ending}`,
			});
		}
	} else {
		const lessons = document.getIn(["lessons"], true);
		if (!isMap(lessons) || !lessons.range)
			throw new Error("Narration lessons have no source range");
		const end = lessons.range[1] - (lessons.flow ? 1 : 0);
		edits.push({
			start: end,
			end,
			text: lessons.flow
				? `${lessons.items.length ? ", " : ""}${JSON.stringify(lessonId)}: ${JSON.stringify(lesson)}`
				: `${/[\r\n]$/.test(source.slice(0, end)) ? "" : ending}  ${JSON.stringify(lessonId)}: ${JSON.stringify(lesson)}${ending}`,
		});
	}
	return applyPlainYamlEdits(source, edits, JSON.parse(JSON.stringify(next)), (text) =>
		parseNarrationSidecarV2(text, next.courseId),
	);
}

export function writeNarrationAuthoring(
	root: string,
	sidecar: NarrationSidecarV2,
	expectedSource: string | null,
) {
	return withProjectFileTransaction(
		root,
		async (root) => {
			const current = await snapshot(root);
			if (sidecar.courseId !== current.sidecar.courseId)
				throw new Error("Narration course identity does not match");
			for (const lesson of Object.values(sidecar.lessons))
				for (const entry of lesson.segments)
					for (const asset of [entry.audio, entry.timings])
						if (asset) await validateNarrationAsset(root, asset);
			const matched = new Set(
				current.documents.flatMap((doc) =>
					doc.items.map((item) => narrationTargetKey(item.segment.target)),
				),
			);
			const previous = new Map(
				current.unresolved.map(({ entry }) => [
					narrationTargetKey(entry.target),
					JSON.stringify(entry),
				]),
			);
			for (const lesson of Object.values(sidecar.lessons))
				for (const entry of lesson.segments)
					if (
						!matched.has(narrationTargetKey(entry.target)) &&
						previous.get(narrationTargetKey(entry.target)) !== JSON.stringify(entry)
					)
						throw new Error("Unknown or unresolved new narration target");
			const source = serializeNarrationSidecarV2(sidecar);
			await applyProjectFilePlan(root, [
				{ path: NARRATION_SIDECAR_PATH, content: source, expectedContent: expectedSource },
			]);
			return source;
		},
		"write",
	);
}

export function changeNarrationTarget(
	root: string,
	target: NarrationTarget,
	action: "accept" | "attach",
	asset?: string,
) {
	return withProjectFileTransaction(
		root,
		async (root) => {
			if (action === "attach") {
				if (!asset) throw new Error("Missing recording path");
				await validateNarrationAsset(root, asset);
			}
			const current = await snapshot(root);
			if (current.identity.transientIds)
				throw new Error("Save the lesson in Studio before editing narration targets");
			const key = narrationTargetKey(target);
			const document = current.documents.find((doc) =>
				doc.items.some((item) => narrationTargetKey(item.segment.target) === key),
			);
			const item = document?.items.find((item) => narrationTargetKey(item.segment.target) === key);
			if (!document || !item) throw new Error(`Unknown or unresolved narration target: ${key}`);
			if (action === "accept" && !item.entry)
				throw new Error("Narration target has no entry to accept");
			const sidecar = {
				...current.sidecar,
				lessons: {
					...current.sidecar.lessons,
					[document.lessonId]: current.sidecar.lessons[document.lessonId] ?? { segments: [] },
				},
			};
			const acceptedFor = narrationRecordingInputs(
				item.segment.script,
				item.segment.settings,
				document.locale,
			);
			const next =
				action === "accept"
					? acceptNarrationV2Entry(sidecar, document.lessonId, item.segment, document.locale)
					: updateNarrationV2Entry(sidecar, document.lessonId, target, {
							reviewedRevision: item.segment.revision,
							acceptedFor,
							audio: asset,
							timings: undefined,
							duration: undefined,
							audioFor: undefined,
						});
			const expected = await optionalSidecarSource(root);
			await applyProjectFilePlan(root, [
				{
					path: NARRATION_SIDECAR_PATH,
					content: targetReplacement(expected, next, target),
					expectedContent: expected,
				},
			]);
			return { target: key, action };
		},
		"write",
	);
}

export async function narrationAuthoringStatus(root: string) {
	const view = await readNarrationAuthoring(root);
	return {
		courseId: view.sidecar.courseId,
		flagged: view.documents.flatMap((doc) =>
			doc.items
				.filter((item) => ["stale", "needsReview"].includes(item.segment.status))
				.map((item) => ({
					target: narrationTargetKey(item.segment.target),
					filename: doc.filename,
					status: item.segment.status,
					audio: item.entry?.audio,
				})),
		),
		unresolved: view.unresolved.map(({ lessonId, entry }) => ({
			lessonId,
			target: narrationTargetKey(entry.target),
			audio: entry.audio,
		})),
	};
}

/** Only reserved generated pairs can be retired; the committed sidecar always wins over a draft. */
export function cleanupNarrationRecordings(root: string, paths: string[], currentSource: string) {
	return withProjectFileTransaction(
		root,
		async (root) => {
			if (
				paths.some(
					(path) => !/^assets\/narration\/narration-[a-f0-9]{12}\.(?:mp3|vtt)$/u.test(path),
				)
			)
				throw new Error("Unknown generated narration path");
			const timing =
				paths.find((path) => path.endsWith(".vtt")) ??
				paths.find((path) => path.endsWith(".mp3"))?.replace(/\.mp3$/u, ".vtt");
			if (!timing) return;
			const pair = [timing.replace(/\.vtt$/u, ".mp3"), timing];
			const saved = await optionalSidecarSource(root);
			if (pair.some((path) => currentSource.includes(path) || saved?.includes(path))) return;
			await applyProjectFilePlan(
				root,
				pair.map((path) => ({ path, content: null })),
			);
		},
		"write",
	);
}
