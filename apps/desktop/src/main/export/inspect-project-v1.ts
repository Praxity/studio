import { createHash } from "node:crypto";
import path from "node:path";
import { serializeIdentity } from "@praxity/content-identity";
import { collectGlossaryTerms } from "@praxity/export-pipeline/glossary-page";
import { formatDialogueWarning, normalizeLineEndings } from "@praxity/grammar";
import {
	adaptGrammarPreviewBlocks,
	decodeEscapes,
	fillBlankParts,
} from "@praxity/shared-blocks/grammar-adapter";
import { isInlineProjectionMetadataKey } from "@praxity/shared-blocks/inline-markdown";
import { narrationScriptText } from "@praxity/shared-blocks/narration";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { decodeHtmlEntities } from "@praxity/shared-blocks/viewer/page-slug";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { isNode, isSeq, LineCounter, parseDocument } from "yaml";
import {
	emptyNarrationReadView,
	parseNarrationSidecarV2,
	resolveLessonNarration,
} from "../../shared/narration-sidecar";
import { type ResolvedSettings, resolveDesignSettings } from "../../shared/settings-inheritance";
import { readCourseManifestData } from "../course-manifest-io";
import { loadIdentityStore } from "../identity-store";
import { parseLessonSource, resolveLessonSources } from "../lesson-source";
import { readFileWithin } from "../path-security";
import { withProjectFileTransaction } from "../project-file-transactions";
import { lessonTitleWarnings } from "./accessibility-enforcement";
import type { CourseInspection } from "./inspect-project";
import {
	type AssessmentEvidence,
	assessmentEvidence,
	assetInspector,
	type InspectionAsset,
	records,
	refuseUnsupportedDescriptions,
	strings,
} from "./inspection-evidence";

export interface InspectionLocation {
	file: string;
	/** Original file lines, 1-based and inclusive. Never character or byte offsets. */
	startLine: number;
	endLine: number;
}

export interface InspectionText {
	ref: string;
	role:
		| "heading"
		| "body"
		| "prompt"
		| "option"
		| "feedback"
		| "glossary-term"
		| "glossary-definition";
	value: string;
	format: "html" | "markdown" | "plain";
	location: InspectionLocation | null;
}

export interface InspectionBlockV1 {
	ref: string;
	parentRef: string | null;
	/** Display identity; runtime tokens cannot anchor durable notes. Use ref within this snapshot. */
	id: string;
	entityId: string;
	revision: string;
	type: string;
	coverage: "text" | "container" | "unsupported";
	location: InspectionLocation | null;
	texts: InspectionText[];
	assessment?: AssessmentEvidence;
	assessmentGroup?: {
		mode: "all" | "oneOf";
		memberRefs: string[];
		unresolvedMemberCount: number;
		requireAll: boolean;
		passingScore: number | null;
		aggregation: "mean-of-scored-member-percentages";
		pointsOverride: number | null;
	};
	style?: "bubbles" | "script";
	speakers?: Array<{
		key: string;
		name: string;
		avatar: boolean;
		voice: boolean;
		side?: "start" | "end";
	}>;
	turns?: Array<{ speaker?: string; side?: "start" | "end"; text: string; line: number | null }>;
	media?: InspectionMedia[];
}

export interface InspectionMedia {
	kind: string;
	source: InspectionAsset | null;
	alt: string | null;
	decorative: boolean;
	description: { value: string; format: "plain" } | null;
	caption: { value: string; format: "markdown" } | null;
	transcript: { value: string; format: "plain" } | null;
	captionTracks: Array<{
		source: InspectionAsset | null;
		language: string | null;
		label: string | null;
		kind: string;
		default: boolean;
	}>;
}

export interface InspectionNarration {
	ref: string;
	role: "narration";
	value: string;
	format: "plain";
	blockRef: string | null;
	pageRef: string | null;
	origin: "sidecar" | "derived";
	disabled: boolean;
	location: InspectionLocation | null;
	audio: InspectionAsset | null;
	timings: InspectionAsset | null;
	duration: {
		seconds: number;
		provenance: "sidecar-recorded";
		measurement: "unknown";
		isFullFileDuration: false;
	} | null;
	audioProvenance: { script: string; language: string; voice: string; speed: number } | null;
	/** Retained schema-1 field; grammar 4 uses UUID targets below. */
	unresolvedAnchor?: {
		kind: string;
		type?: string;
		containerPart?: string;
		itemSide?: "back";
		occurrence?: number;
		page: number;
		label: string;
		source: string;
	};
	unresolvedTarget?: { id: string; role: string };
}

export interface CourseInspectionV1 {
	schema: "praxity-inspect/1";
	projectionVersion: 2;
	studioVersion: string;
	revision: string;
	warnings: CourseInspection["warnings"];
	course: CourseInspection["course"] & {
		language: {
			declared: string | null;
			source: "manifest" | "default";
			workspaceContext: "unavailable";
		};
	};
	lessons: Array<{
		file: string;
		id: string | null;
		entityId: string;
		revision: string;
		title: string;
		sha256: string;
		language: { value: string; source: ResolvedSettings["localeSource"] };
		pages: Array<{
			ref: string;
			id: string;
			entityId: string;
			revision: string;
			number: number;
			title: string;
			/** Flat preorder, including nested blocks; parentRef reconstructs the tree. */
			blocks: InspectionBlockV1[];
		}>;
		narration: InspectionNarration[];
		unlinkedNarration: InspectionNarration[];
		unlinkedNarrationCount: number;
	}>;
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Structural paths survive identity overlays and removal of legacy ID rows. */
function walkBlocks(
	value: unknown,
	visit: (block: PraxityBlock, key: string, parent: string | null) => void,
	key = "blocks",
	parent: string | null = null,
): void {
	if (Array.isArray(value)) {
		value.forEach((child, index) => walkBlocks(child, visit, `${key}/${index}`, parent));
	} else if (record(value)) {
		if (typeof value.id === "string" && typeof value.type === "string" && record(value.data)) {
			visit(value as unknown as PraxityBlock, key, parent);
			parent = key;
		}
		for (const [field, child] of Object.entries(value)) {
			if (isInlineProjectionMetadataKey(field, { keepDisplay: true })) continue;
			// Assessment prose is classified by its owning assessment projection.
			// Rewalking renderer fragments would turn prompts and feedback into body text.
			if (field === "data" && value.type === "assessment" && record(child)) {
				for (const [name, item] of Object.entries(child)) {
					if (!["stem", "description", "feedback"].includes(name))
						walkBlocks(item, visit, `${key}/${field}/${name}`, parent);
				}
				continue;
			}
			walkBlocks(child, visit, `${key}/${field}`, parent);
		}
	}
}

export function projectText(
	block: PraxityBlock,
	ref: string,
	location: InspectionLocation | null,
	componentDefaults?: Record<string, Record<string, unknown>>,
) {
	const texts: InspectionText[] = [];
	const add = (
		role: InspectionText["role"],
		field: string,
		value: unknown,
		format: InspectionText["format"] = "html",
	) => {
		if (typeof value !== "string" || !value.trim()) return;
		const textRef = `${ref}/text/${field}`;
		texts.push({ ref: textRef, role, value, format, location });
		if (format === "plain") return;
		for (const [index, term] of collectGlossaryTerms([
			{ id: ref, title: "", blocks: value },
		]).entries()) {
			texts.push(
				{
					ref: `${textRef}/glossary/${index}/term`,
					role: "glossary-term",
					value: term.term,
					format: "plain",
					location,
				},
				{
					ref: `${textRef}/glossary/${index}/definition`,
					role: "glossary-definition",
					value: decodeHtmlEntities(term.definition),
					format: "html",
					location,
				},
			);
		}
	};
	const data =
		block.type === "assessmentGroup"
			? adaptGrammarPreviewBlocks([block], componentDefaults)[0].data
			: block.data;
	let coverage: InspectionBlockV1["coverage"] = "unsupported";
	if (block.type === "heading" || block.type === "text") {
		coverage = "text";
		add(block.type === "heading" ? "heading" : "body", "content", data.content);
		if (block.type === "heading") {
			add("body", "kicker", data.kicker, "markdown");
			add("body", "subtitle", data.subtitle, "plain");
		}
	} else if (block.type === "highlight") {
		coverage = "text";
		const content = record(data.content) ? data.content : {};
		add("heading", "content/title", content.title, "plain");
		add("prompt", "content/question", content.question, "plain");
		const paragraphs = Array.isArray(content.paragraphs) ? content.paragraphs : [];
		paragraphs.forEach((paragraph, p) => {
			if (!Array.isArray(paragraph)) return;
			paragraph.forEach((chunk, c) => {
				if (!record(chunk)) return;
				add("body", `content/paragraphs/${p}/${c}/text`, chunk.text, "plain");
				add("body", `content/paragraphs/${p}/${c}/note`, chunk.note, "plain");
			});
		});
	} else if (block.type === "retrievalSheet") {
		coverage = "text";
		const content = record(data.content) ? data.content : {};
		add("heading", "content/title", content.title, "plain");
		const questions = Array.isArray(content.questions) ? content.questions.filter(record) : [];
		questions.forEach((question, index) => {
			add("prompt", `content/questions/${index}/question`, question.question, "plain");
			add("body", `content/questions/${index}/answer`, question.answer, "plain");
		});
	} else if (block.type === "writeDistractors") {
		coverage = "text";
		add(
			"prompt",
			"content/question",
			record(data.content) ? data.content.question : undefined,
			"plain",
		);
	} else if (block.type === "selfCheck") {
		// Learners see only the literal task until the runtime exists; the model and criteria stay out.
		coverage = "text";
		add("prompt", "content/task", record(data.content) ? data.content.task : undefined, "plain");
	} else if (["card", "columns", "accordion", "tabs", "sequence"].includes(block.type)) {
		coverage = "container";
		const items = Array.isArray(data.items) ? data.items.filter(record) : [];
		// CardBlock suppresses a group title only when its sole item repeats it.
		const duplicateCardTitle =
			block.type === "card" &&
			items.length === 1 &&
			typeof items[0].label === "string" &&
			typeof data.title === "string" &&
			items[0].label.trim() === data.title.trim();
		if (!duplicateCardTitle) add("heading", "title", data.title, "markdown");
		items.forEach((item, index) => {
			add("heading", `items/${index}/label`, item.label ?? item.title, "markdown");
		});
	} else if (block.type === "assessment") {
		const adapted = adaptGrammarPreviewBlocks([block], componentDefaults)[0].data;
		coverage =
			record(adapted.response) &&
			[
				"choice",
				"matching",
				"sequence",
				"categorize",
				"fillBlank",
				"textResponse",
				"hotspot",
				"matrix",
				"fileUpload",
				"audioRecording",
				"videoRecording",
				"speech",
				"dictation",
			].includes(String(adapted.response.type))
				? "text"
				: "unsupported";
		const addChildren = (role: InspectionText["role"], field: string, children: unknown) => {
			if (Array.isArray(children))
				children.forEach((child, index) => {
					if (record(child) && record(child.data))
						add(role, `${field}/${index}`, child.data.content);
				});
		};
		addChildren("prompt", "stem", adapted.stem);
		addChildren("body", "description", adapted.description);
		if (record(adapted.response) && Array.isArray(adapted.response.options)) {
			adapted.response.options.forEach((option, index) => {
				if (!record(option)) return;
				add("option", `options/${index}/label`, option.label, "markdown");
				add("feedback", `options/${index}/feedback`, option.feedback, "markdown");
			});
		}
		const response = record(adapted.response) ? adapted.response : {};
		const list = (
			field: string,
			keys: string[],
			role: InspectionText["role"] = "option",
			format: InspectionText["format"] = "markdown",
		) => {
			records(response[field]).forEach((item, index) =>
				keys.forEach((key) => add(role, `${field}/${index}/${key}`, item[key], format)),
			);
		};
		list("pairs", ["prompt"]);
		list("pairs", ["correctMatch"], "option", "plain");
		strings(response.distractors).forEach((value, index) =>
			add("option", `distractors/${index}`, value, "plain"),
		);
		list("items", ["label"]);
		list("statements", ["text"], "prompt", "plain");
		list("scalePoints", ["label"], "option", "plain");
		list("hotspots", ["label"], "option", "plain");
		for (const field of ["pairs", "items", "hotspots"]) list(field, ["feedback"], "feedback");
		records(response.categories).forEach((category, index) => {
			add("option", `categories/${index}/name`, category.name, "plain");
			strings(category.items).forEach((value, item) =>
				add("option", `categories/${index}/items/${item}`, value, "plain"),
			);
		});
		if (response.type === "fillBlank") {
			const template = typeof response.template === "string" ? response.template : "";
			add(
				"prompt",
				"template",
				fillBlankParts(template)
					.map((part) => (part.blank ? "____" : decodeEscapes(part.text)))
					.join(""),
				"plain",
			);
			records(response.blanks).forEach((blank, index) =>
				strings(blank.choices).forEach((value, choice) =>
					add("option", `blanks/${index}/choices/${choice}`, value, "plain"),
				),
			);
			strings(response.wordBank).forEach((value, index) =>
				add("option", `wordBank/${index}`, value, "plain"),
			);
		}
		add("body", "instructions", response.instructions, "plain");
		add("body", "placeholder", response.placeholder, "plain");
		add("option", "buttonLabel", adapted.buttonLabel, "plain");
		if (record(adapted.feedback)) {
			addChildren("feedback", "feedback/correct", adapted.feedback.correct);
			addChildren("feedback", "feedback/incorrect", adapted.feedback.incorrect);
		}
	} else if (block.type === "dialogue") {
		coverage = "text";
		add("body", "caption", data.caption, "markdown");
		records(data.turns).forEach((turn, index) =>
			add("body", `turns/${index}`, strings(turn.paragraphs).join("\n\n"), "markdown"),
		);
	} else {
		const fields: Record<
			string,
			Array<[InspectionText["role"], string, InspectionText["format"]]>
		> = {
			note: [
				["heading", "title", "markdown"],
				["body", "content", "html"],
			],
			quote: [
				["body", "text", "html"],
				["body", "speaker", "plain"],
				["body", "work", "plain"],
			],
			button: [["option", "text", "markdown"]],
			code: [
				["heading", "title", "plain"],
				["body", "code", "plain"],
			],
			equation: [["body", "latex", "plain"]],
			divider: [["body", "label", "plain"]],
			rating: [["prompt", "label", "plain"]],
			signature: [
				["prompt", "label", "plain"],
				["body", "sublabel", "plain"],
			],
			assessmentGroup: [
				["heading", "groupName", "markdown"],
				["option", "buttonLabel", "plain"],
			],
			document: [
				["heading", "title", "plain"],
				["body", "description", "plain"],
			],
			resourceEntry: [
				["heading", "title", "plain"],
				["body", "description", "plain"],
			],
			heroCover: [
				["heading", "title", "plain"],
				["body", "subtitle", "plain"],
			],
		};
		const mediaTypes = ["image", "video", "audio", "embed"];
		const tableTypes = ["table", "chart", "stats", "checklist", "labeledGraphic"];
		if (fields[block.type] || mediaTypes.includes(block.type) || tableTypes.includes(block.type))
			coverage = "text";
		for (const [role, field, format] of fields[block.type] ?? [])
			add(role, field, data[field], format);
		if (mediaTypes.includes(block.type) || tableTypes.includes(block.type)) {
			add("heading", "title", data.title, "markdown");
			if (data.captionEnabled !== false) add("body", "caption", data.caption, "markdown");
		}
		if (block.type === "table" || block.type === "chart") {
			if (Array.isArray(data.rows))
				data.rows.forEach((row, i) => {
					if (Array.isArray(row))
						row.forEach((value, j) => add("body", `rows/${i}/${j}`, value, "markdown"));
				});
			strings(data.headers).forEach((value, i) => add("body", `headers/${i}`, value, "markdown"));
			for (const field of ["subtitle", "xLabel", "yLabel"])
				add("body", field, data[field], "plain");
		}
		const itemFields =
			block.type === "checklist" ? ["text"] : block.type === "stats" ? ["value", "label"] : [];
		records(data.items).forEach((item, index) =>
			itemFields.forEach((field) =>
				add(
					"body",
					`items/${index}/${field}`,
					item[field],
					field === "value" ? "plain" : "markdown",
				),
			),
		);
		records(data.scale).forEach((item, index) => {
			if (block.type === "rating") add("option", `scale/${index}/label`, item.label, "plain");
		});
		if (block.type === "labeledGraphic")
			records(data.labels).forEach((item, index) => {
				add("heading", `labels/${index}/title`, item.title, "plain");
				add("body", `labels/${index}/body`, item.body, "html");
			});
	}
	return { coverage, texts };
}

async function projectMedia(
	block: PraxityBlock,
	assets: ReturnType<typeof assetInspector>,
): Promise<InspectionMedia[]> {
	const data = block.data;
	const entries: Array<{
		kind: string;
		data: Record<string, unknown>;
		source: unknown;
		alt?: unknown;
	}> = [];
	if (["image", "video", "audio", "embed", "document"].includes(block.type))
		entries.push({
			kind: block.type,
			data,
			source: data.src ?? data.url ?? (record(data.source) ? data.source.src : undefined),
			alt: data.altText ?? data.alt,
		});
	if (
		block.type === "heading" &&
		typeof data.background === "string" &&
		/[/.]/.test(data.background)
	)
		entries.push({ kind: "image", data: {}, source: data.background, alt: data.backgroundAlt });
	if (block.type === "heroCover" || block.type === "labeledGraphic")
		entries.push({ kind: "image", data, source: data.imageSrc, alt: data.imageAlt });
	if (block.type === "imageComparison")
		for (const field of ["beforeImage", "afterImage"]) {
			const image = data[field];
			if (record(image))
				entries.push({ kind: "image", data: image, source: image.src, alt: image.altText });
		}
	if (block.type === "assessment") {
		const response = adaptGrammarPreviewBlocks([block])[0].data.response;
		if (record(response)) {
			if (response.type === "hotspot")
				entries.push({ kind: "image", data: {}, source: response.image, alt: response.imageAlt });
			if (response.type === "dictation")
				entries.push({ kind: "audio", data: {}, source: response.audioSrc });
			for (const item of [...records(response.options), ...records(response.categories)])
				if (typeof item.image === "string")
					entries.push({ kind: "image", data: {}, source: item.image, alt: item.imageAlt });
		}
	}
	return Promise.all(
		entries.map(async (entry) => {
			const data = entry.data;
			const tracks = records(data.captionTracks);
			if (typeof data.captions === "string" && !tracks.some((track) => track.src === data.captions))
				tracks.push({ src: data.captions, kind: "captions" });
			if (
				typeof data.captionsSrc === "string" &&
				!tracks.some((track) => track.src === data.captionsSrc)
			)
				tracks.push({ src: data.captionsSrc, kind: "captions" });
			return {
				kind: entry.kind,
				source: await assets.read(entry.source),
				alt: typeof entry.alt === "string" ? entry.alt : null,
				decorative: data.decorative === true,
				description:
					typeof data.description === "string"
						? { value: data.description, format: "plain" as const }
						: null,
				caption:
					typeof data.caption === "string"
						? { value: data.caption, format: "markdown" as const }
						: null,
				transcript:
					typeof (data.transcriptOverride ?? data.transcript) === "string"
						? {
								value: String(data.transcriptOverride ?? data.transcript),
								format: "plain" as const,
							}
						: null,
				captionTracks: await Promise.all(
					tracks.map(async (track) => ({
						source: await assets.read(track.src),
						language: typeof track.language === "string" ? track.language : null,
						label: typeof track.label === "string" ? track.label : null,
						kind: typeof track.kind === "string" ? track.kind : "captions",
						default: track.default === true,
					})),
				),
			};
		}),
	);
}

/** YAML node ranges refer to actual authored sidecar entries, including multiline scripts. */
function narrationLocations(source: string, file: string): Array<InspectionLocation | null> {
	const lineCounter = new LineCounter();
	const document = parseDocument(normalizeLineEndings(source), { lineCounter });
	const segments = document.getIn(["lessons", file, "segments"], true);
	if (!isSeq(segments)) return [];
	return segments.items.flatMap((node) => {
		if (!isNode(node) || !node.range) return [];
		return [
			{
				file: "narration.yaml",
				startLine: lineCounter.linePos(node.range[0]).line,
				endLine: lineCounter.linePos(Math.max(node.range[0], node.range[1] - 1)).line,
			},
		];
	});
}

async function optionalSource(projectDir: string, file: string): Promise<string | null> {
	try {
		return (await readFileWithin(projectDir, path.join(projectDir, file), "utf-8")) as string;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

/** Inspect a resolved dialogue model, including legacy adapter turns without a
 * speaker. Source coordinates come from the authored G4 fence, not model ranks. */
export function projectDialogue(
	block: PraxityBlock,
	location: InspectionLocation | null,
	source: string,
): Pick<InspectionBlockV1, "style" | "turns" | "speakers"> {
	const sourceLines = normalizeLineEndings(source).split("\n");
	const turns = records(block.data.turns);
	const speakers = new Map<string, NonNullable<InspectionBlockV1["speakers"]>[number]>();
	const start = location?.startLine;
	const end = location?.endLine;
	const indent = start == null ? 0 : /^\s*/.exec(sourceLines[start - 1] ?? "")?.[0].length;
	const lines = start == null || end == null ? [] : sourceLines.slice(start - 1, end);
	const turnLines = lines.flatMap((line, index) => {
		const match = /^(\s*)-\s+/.exec(line);
		return match && match[1].length === indent && start != null ? [start + index] : [];
	});
	const style = block.data.style === "script" ? "script" : "bubbles";
	const projectedTurns = turns.map<NonNullable<InspectionBlockV1["turns"]>[number]>(
		(turn, index) => {
			const speaker = typeof turn.speaker === "string" ? turn.speaker : undefined;
			if (speaker && !speakers.has(speaker.toLowerCase()))
				speakers.set(speaker.toLowerCase(), {
					key: speaker,
					name: typeof turn.name === "string" ? turn.name : speaker,
					avatar: typeof turn.avatar === "string" && !!turn.avatar,
					voice: typeof turn.voice === "string" && !!turn.voice,
					...(turn.side === "start" || turn.side === "end" ? { side: turn.side } : {}),
				});
			return {
				...(speaker ? { speaker } : {}),
				...(turn.side === "start" || turn.side === "end" ? { side: turn.side } : {}),
				text: strings(turn.paragraphs).join("\n\n"),
				line: turnLines[index] ?? null,
			};
		},
	);

	return { style, turns: projectedTurns, speakers: [...speakers.values()] };
}

export async function inspectProjectV1(
	projectDir: string,
	studioVersion: string,
): Promise<CourseInspectionV1> {
	return withProjectFileTransaction(projectDir, (root) =>
		inspectProjectSnapshot(root, studioVersion),
	);
}

async function inspectProjectSnapshot(
	projectDir: string,
	studioVersion: string,
): Promise<CourseInspectionV1> {
	const { manifest, orderedLessons } = await readCourseManifestData(projectDir, {
		requireManifest: true,
	});
	const narrationSource = await optionalSource(projectDir, "narration.yaml");
	const identity = await resolveLessonSources(projectDir);
	// A read-only identity overlay allocates runtime tokens. Only persisted
	// identity contributes to the fingerprint of an unchanged authored project.
	const storedIdentity = await loadIdentityStore(projectDir);
	const identitySource = serializeIdentity(storedIdentity);
	const sidecar =
		narrationSource === null
			? emptyNarrationReadView(identity.identity.course.courseId)
			: parseNarrationSidecarV2(narrationSource, identity.identity.course.courseId);
	const assets = assetInspector(projectDir);
	const lessons: CourseInspectionV1["lessons"] = [];
	const warnings: CourseInspectionV1["warnings"] = (manifest.castWarnings ?? []).map((message) => ({
		blockId: "course.yaml",
		message,
	}));
	for (const file of orderedLessons) {
		const sourceBytes = (await readFileWithin(projectDir, path.join(projectDir, file))) as Buffer;
		const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(sourceBytes);
		const parsed = await parseLessonSource(projectDir, file, source, {
			cast: manifest.cast,
			identity,
		});
		refuseUnsupportedDescriptions(parsed, file);
		const original = parsed;
		const snapshot = identity.identity.snapshots.find(
			(snapshot) =>
				snapshot.sourceHash === parsed.revision && snapshot.lessonId === parsed.lessonId,
		);
		const nodeRevision = (id: string) => {
			const node = snapshot?.nodes[id];
			if (!node) throw new Error(`Inspection identity missing: ${id}`);
			return node.revision;
		};
		const resolved = resolveDesignSettings(null, manifest, parsed.frontmatter);
		warnings.push(...lessonTitleWarnings(parsed.frontmatter, file, resolved.locale));
		for (const { source, ...warning } of resolved.designWarnings) {
			const blockId = source === "course" ? "course.yaml" : file;
			if (
				!warnings.some(
					(existing) =>
						"blockId" in existing &&
						existing.blockId === blockId &&
						existing.code === warning.code &&
						existing.path === warning.path,
				)
			)
				warnings.push({ ...warning, blockId });
		}
		warnings.push(
			...parsed.dialogueWarnings.map((warning) => formatDialogueWarning(warning, resolved.locale)),
		);
		const componentDefaults = record(resolved.design.componentDefaults)
			? Object.fromEntries(
					Object.entries(resolved.design.componentDefaults).filter(
						(entry): entry is [string, Record<string, unknown>] => record(entry[1]),
					),
				)
			: undefined;
		const bodyStartLine = 1;
		const locations = new Map<string, { type: string; location: InspectionLocation | null }>();
		walkBlocks(original.blocks, (block, key) => {
			const span =
				original.containerRanges.find((range) => range.blockId === block.id) ??
				original.spans.get(block.id);
			locations.set(key, {
				type: block.type,
				location: span
					? {
							file,
							startLine: bodyStartLine + span.startLine,
							endLine: bodyStartLine + span.endLine,
						}
					: null,
			});
		});
		const byId = new Map<string, InspectionBlockV1>();
		const sourceById = new Map<string, PraxityBlock>();
		const lessonRef = `lesson/${encodeURIComponent(file)}`;
		walkBlocks(parsed.blocks, (block, key, parent) => {
			const originalBlock = locations.get(key);
			if (!originalBlock || originalBlock.type !== block.type)
				throw new Error(`Inspection source mapping mismatch: ${file}/${key}`);
			const ref = `${lessonRef}/${key}`;
			const result = {
				ref,
				parentRef: parent ? `${lessonRef}/${parent}` : null,
				id: block.id,
				entityId: block.id,
				revision: nodeRevision(block.id),
				type: block.type,
				location: originalBlock.location,
				...projectText(block, ref, originalBlock.location, componentDefaults),
			};
			byId.set(block.id, result);
			sourceById.set(block.id, block);
		});
		for (const [id, block] of sourceById) {
			const result = byId.get(id);
			if (!result) continue;
			if (block.type === "dialogue")
				Object.assign(result, projectDialogue(block, result.location, source));
			const media = await projectMedia(block, assets);
			if (media.length) result.media = media;
			if (block.type === "assessment")
				result.assessment = assessmentEvidence(
					adaptGrammarPreviewBlocks([block], componentDefaults)[0].data,
					result.ref,
				);
			if (block.type === "assessmentGroup") {
				const data = adaptGrammarPreviewBlocks([block], componentDefaults)[0].data;
				const members = strings(data.memberBlockIds);
				result.assessmentGroup = {
					mode: data.mode === "oneOf" ? "oneOf" : "all",
					memberRefs: members.flatMap((id) => {
						const member = byId.get(id);
						return member ? [member.ref] : [];
					}),
					unresolvedMemberCount: members.filter((id) => !byId.has(id)).length,
					requireAll: data.requireAll === true,
					passingScore:
						typeof data.passingScore === "number" && Number.isFinite(data.passingScore)
							? Math.max(0, Math.min(100, data.passingScore))
							: null,
					aggregation: "mean-of-scored-member-percentages",
					pointsOverride: typeof data.pointsOverride === "number" ? data.pointsOverride : null,
				};
			}
		}
		const sidecarLocations = narrationLocations(narrationSource ?? "", parsed.lessonId);
		const locale = resolved.locale;
		const title =
			typeof parsed.frontmatter.title === "string" && parsed.frontmatter.title.trim()
				? parsed.frontmatter.title.trim()
				: file.replace(/\.prax$/i, "");
		const pages = splitBlocksIntoPages(parsed.blocks, title);
		const narration = resolveLessonNarration({
			read: parsed,
			courseId: parsed.courseId,
			lessonId: parsed.lessonId,
			sidecar,
			locale,
			enabled: manifest.narrationEnabled,
			digest: (text) => createHash("sha256").update(text).digest("hex"),
		});
		warnings.push(...narration.warnings.map((warning) => ({ ...warning, file })));
		lessons.push({
			file,
			id: parsed.lessonId,
			entityId: parsed.lessonId,
			revision: parsed.revision,
			title,
			sha256: createHash("sha256").update(sourceBytes).digest("hex"),
			language: { value: resolved.locale, source: resolved.localeSource },
			pages: pages.map((page) => {
				const blocks: InspectionBlockV1[] = [];
				walkBlocks(page.blocks, (block) => {
					const entry = byId.get(block.id);
					if (entry) blocks.push(entry);
				});
				return {
					ref: `${lessonRef}/page/${page.pageNumber}`,
					id: page.id,
					entityId: page.id,
					revision: nodeRevision(page.id),
					number: page.pageNumber,
					title: page.title,
					blocks,
				};
			}),
			narration: await Promise.all(
				narration.items.map(async (item, index): Promise<InspectionNarration> => {
					const block = item.segment.blockId ? byId.get(item.segment.blockId) : undefined;
					const entry = item.entry;
					const entryIndex = sidecar.lessons[parsed.lessonId]?.segments.findIndex(
						(candidate) =>
							candidate.target.id === item.segment.target.id &&
							candidate.target.role === item.segment.target.role,
					);
					const fromSidecar = entry?.script !== undefined;
					return {
						ref: `${lessonRef}/narration/${index}`,
						role: "narration",
						value: narrationScriptText(item.segment.script),
						format: "plain",
						blockRef: block?.ref ?? null,
						pageRef: `${lessonRef}/page/${item.pageNumber}`,
						origin: fromSidecar ? "sidecar" : "derived",
						disabled: item.segment.disabled,
						location:
							fromSidecar && entryIndex !== undefined && entryIndex >= 0
								? (sidecarLocations[entryIndex] ?? null)
								: (block?.location ?? null),
						audio: await assets.read(entry?.audio ?? item.segment.audioUrl),
						timings: await assets.read(entry?.timings ?? item.segment.timingsUrl),
						duration:
							entry?.duration !== undefined
								? {
										seconds: entry.duration,
										provenance: "sidecar-recorded",
										measurement: "unknown",
										isFullFileDuration: false,
									}
								: null,
						audioProvenance: entry?.audioFor ?? null,
					};
				}),
			),
			unlinkedNarration: await Promise.all(
				narration.unlinked.map(
					async ({ entry, entryIndex }): Promise<InspectionNarration> => ({
						ref: `${lessonRef}/unlinked-narration/${entryIndex}`,
						role: "narration",
						value: entry.script === undefined ? "" : narrationScriptText(entry.script),
						format: "plain",
						blockRef: null,
						pageRef: null,
						origin: "sidecar",
						disabled: entry.disabled === true,
						location: sidecarLocations[entryIndex] ?? null,
						unresolvedTarget: entry.target,
						audio: await assets.read(entry.audio),
						timings: await assets.read(entry.timings),
						duration:
							entry.duration !== undefined
								? {
										seconds: entry.duration,
										provenance: "sidecar-recorded",
										measurement: "unknown",
										isFullFileDuration: false,
									}
								: null,
						audioProvenance: entry.audioFor ?? null,
					}),
				),
			),
			unlinkedNarrationCount: narration.unlinked.length,
		});
	}
	await assets.finish();
	const course: CourseInspectionV1["course"] = {
		id: identity.identity.course.courseId,
		title: manifest.title || path.basename(projectDir),
		locale: manifest.locale ?? "en",
		language: {
			declared: manifest.locale ?? null,
			source: manifest.locale != null ? "manifest" : "default",
			workspaceContext: "unavailable",
		},
		description: manifest.description ?? null,
	};
	return {
		schema: "praxity-inspect/1",
		projectionVersion: 2,
		studioVersion,
		warnings,
		course,
		lessons,
		revision: createHash("sha256")
			.update(
				JSON.stringify([
					"praxity-inspect/1",
					2,
					[...assets.assets.values()].sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0)),
					studioVersion,
					manifest,
					{ ...course, id: storedIdentity.course?.courseId ?? null },
					narrationSource ?? "",
					identitySource,
					lessons.map(({ file, sha256 }) => [file, sha256]),
				]),
			)
			.digest("hex"),
	};
}
