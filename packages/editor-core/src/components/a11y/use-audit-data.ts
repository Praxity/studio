"use client";

import {
	type BlockSpan,
	getDesignSettingWarnings,
	mergeTypography,
	normalizeTypography,
	readLesson,
} from "@praxity/grammar";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import {
	type A11yIssue,
	checkCourseAccessibility,
	checkDesignSystemAccessibility,
	collectAllBlocksDeep,
} from "../../lib/a11y/checker";
import { resolveDesignSystemConfig } from "../../lib/a11y/design-system-config";
import { findFlashingGifSources, type GifFlashAnalysis } from "../../lib/a11y/gif-flash-detector";
import { buildA11yOccurrenceId } from "../../lib/a11y/occurrence-id";
import {
	DISPLAY_CATEGORY_ORDER,
	type DisplayCategory,
	getRuleMetadata,
} from "../../lib/a11y/rule-metadata";
import type { SelfCheckAuditSource } from "../../lib/a11y/self-check-advice";
import type { AuditIssue, SeverityCountMap } from "../audit/types";
import { useGrammarDocumentStore } from "../grammar-document-store";

export type AuditDataState = "noContent" | "parseError" | "ready";

export interface AuditDocument {
	id: string;
	title: string;
	blocks: PraxityBlock[];
	spans?: ReadonlyMap<string, BlockSpan>;
	/** Bind source positions to their exact authoring snapshot without exposing source in issues. */
	isCurrentSource?: (source: string) => boolean;
	selfCheckSource?: SelfCheckAuditSource;
}

export interface UseAuditDataResult {
	state: AuditDataState;
	mediaAnalysisPending: boolean;
	issues: AuditIssue[];
	issuesByCategory: Record<DisplayCategory, AuditIssue[]>;
	counts: SeverityCountMap;
}

function humanizeRuleName(rule: string): string {
	return rule.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function stripHtml(value: string): string {
	return value
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function getBlockIdentifier(block: PraxityBlock): string | null {
	const data = block.data as Record<string, unknown>;
	const fields = ["title", "name", "label", "question", "term", "src", "url", "id"];

	for (const field of fields) {
		const value = data[field];
		if (typeof value === "string" && value.trim().length > 0) {
			return field === "src" || field === "url"
				? (value.split("/").at(-1) ?? value)
				: stripHtml(value);
		}
	}

	if (block.type === "heading") {
		const content = data.content;
		if (typeof content === "string") {
			const stripped = stripHtml(content);
			if (stripped) return stripped;
		}
	}

	return null;
}

function getGuidance(t: ReturnType<typeof useTranslations>, rule: string): AuditIssue["guidance"] {
	const topicKey = `rules.${rule}.guidance.topic`;
	if (!t.has(topicKey)) return undefined;

	const bullets: string[] = [];
	for (let i = 1; i <= 5; i++) {
		const bulletKey = `rules.${rule}.guidance.bullet${i}`;
		if (!t.has(bulletKey)) break;
		bullets.push(t(bulletKey));
	}

	if (bullets.length === 0) return undefined;
	return {
		topic: t(topicKey),
		bullets,
	};
}

function createEmptyCategoryMap(): Record<DisplayCategory, AuditIssue[]> {
	const map = {} as Record<DisplayCategory, AuditIssue[]>;
	for (const category of DISPLAY_CATEGORY_ORDER) {
		map[category] = [];
	}
	return map;
}

export interface GifFlashAnalysisOptions {
	cacheKey: string;
	readAsset: (relativePath: string) => Promise<Uint8Array>;
}

interface UseAuditDataOptions {
	lessonFilename?: string;
	courseDesign?: Record<string, unknown>;
	documents?: AuditDocument[];
	gifFlashAnalysis?: GifFlashAnalysisOptions;
	dismissedIds?: ReadonlySet<string>;
}

const gifAnalysisCaches = new Map<string, Map<string, Promise<GifFlashAnalysis>>>();
const EMPTY_DISMISSED_IDS = new Set<string>();

function gifReferenceKey(value: unknown, references = new Set<string>()): string {
	if (typeof value === "string" && value.split(/[?#]/, 1)[0]?.toLowerCase().endsWith(".gif")) {
		references.add(value);
	} else if (Array.isArray(value)) {
		for (const item of value) gifReferenceKey(item, references);
	} else if (value && typeof value === "object") {
		for (const item of Object.values(value)) gifReferenceKey(item, references);
	}
	return [...references].sort().join("|");
}

export function useAuditData(options: UseAuditDataOptions = {}): UseAuditDataResult {
	const t = useTranslations("a11yAudit");
	const diagnostic = useTranslations("op.diagnostic");
	const parsedBlocks = useGrammarDocumentStore((s) => s.parsedBlocks);
	const grammarSource = useGrammarDocumentStore((s) => s.grammarSource);
	const parsedSpans = useGrammarDocumentStore((s) => s.parsedSpans);
	const selfCheckRead = useMemo(
		() => (grammarSource ? readLesson(grammarSource) : undefined),
		[grammarSource],
	);
	const parseError = useGrammarDocumentStore((s) => s.parseError);
	const frontmatter = useGrammarDocumentStore((s) => s.frontmatter);
	const designVariants = useGrammarDocumentStore((s) => s.designVariants);
	const courseDesign = options.courseDesign;
	const designSettingIssues = useMemo<A11yIssue[]>(() => {
		const courseTypography = courseDesign?.typography;
		const lessonTypography = frontmatter.design?.typography;
		const normalized = normalizeTypography(mergeTypography(courseTypography, lessonTypography));
		return (
			[
				["course.yaml", courseDesign],
				["frontmatter", frontmatter.design],
			] as const
		).flatMap(([file, design]) =>
			getDesignSettingWarnings(design, normalized).map((warning) => ({
				severity: "minor" as const,
				rule: warning.code,
				outcome: "failed" as const,
				message: t(`rules.${warning.code}.description`, {
					path: warning.path,
					...("pairing" in warning ? { pairing: warning.pairing } : {}),
				}),
				messageValues: {
					path: warning.path,
					...("pairing" in warning ? { pairing: warning.pairing } : {}),
				},
				blockId: "designSystem",
				sourceLocation: `${file}:${warning.path}`,
			})),
		);
	}, [courseDesign, frontmatter.design, t]);
	const dismissedIds = options.dismissedIds ?? EMPTY_DISMISSED_IDS;
	const defaultDocuments = useMemo(
		() => [
			{
				id: options.lessonFilename ?? "grammar-page",
				title: (frontmatter.title as string) || t("syntheticPageTitle"),
				blocks: parsedBlocks,
				spans: parsedSpans,
				isCurrentSource: (source: string) => source === grammarSource,
				selfCheckSource: selfCheckRead ? { read: selfCheckRead, spans: parsedSpans } : undefined,
			},
		],
		[
			options.lessonFilename,
			frontmatter.title,
			grammarSource,
			parsedBlocks,
			parsedSpans,
			selfCheckRead,
			t,
		],
	);
	const documents = options.documents ?? defaultDocuments;
	const authorSources = useMemo(
		() =>
			new Map(
				documents.flatMap((document) =>
					document.selfCheckSource ? [[document.id, document.selfCheckSource] as const] : [],
				),
			),
		[documents],
	);
	const pages = useMemo<PraxityPage[]>(
		() =>
			documents.map((document) => ({
				id: document.id,
				title: document.title,
				blocks: document.blocks,
			})),
		[documents],
	);
	const [flashingGifSources, setFlashingGifSources] = useState<Set<string>>(new Set());
	const [completedAnalysisKey, setCompletedAnalysisKey] = useState<string>();
	const gifCacheKey = options.gifFlashAnalysis?.cacheKey;
	const readGifAsset = options.gifFlashAnalysis?.readAsset;
	const referencedGifs = useMemo(() => gifReferenceKey(pages), [pages]);
	const analysisKey =
		gifCacheKey && readGifAsset && referencedGifs ? `${gifCacheKey}:${referencedGifs}` : undefined;
	const mediaAnalysisPending = Boolean(analysisKey && analysisKey !== completedAnalysisKey);
	const designSystemIssues = useMemo(
		() => checkDesignSystemAccessibility(resolveDesignSystemConfig(designVariants)),
		[designVariants],
	);

	useEffect(() => {
		if (!analysisKey || !gifCacheKey || !readGifAsset || parseError) {
			setFlashingGifSources(new Set());
			return;
		}
		let cancelled = false;
		let cache = gifAnalysisCaches.get(gifCacheKey);
		if (!cache) {
			cache = new Map();
			gifAnalysisCaches.set(gifCacheKey, cache);
		}
		void findFlashingGifSources(pages, readGifAsset, cache).then((sources) => {
			if (!cancelled) {
				setFlashingGifSources(sources);
				setCompletedAnalysisKey(analysisKey);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [analysisKey, gifCacheKey, pages, parseError, readGifAsset]);

	const result = useMemo<UseAuditDataResult>(() => {
		if (parseError) {
			return {
				state: "parseError",
				mediaAnalysisPending: false,
				issues: [],
				issuesByCategory: createEmptyCategoryMap(),
				counts: { critical: 0, recommended: 0, minor: 0, dismissed: 0, total: 0 },
			};
		}

		if (documents.every((document) => document.blocks.length === 0)) {
			return {
				state: "noContent",
				mediaAnalysisPending: false,
				issues: [],
				issuesByCategory: createEmptyCategoryMap(),
				counts: { critical: 0, recommended: 0, minor: 0, dismissed: 0, total: 0 },
			};
		}

		const report = checkCourseAccessibility(
			pages,
			{
				flashingGifSources,
			},
			authorSources,
		);
		const reportIssues = [...report.issues, ...designSystemIssues, ...designSettingIssues];

		const blockLookup = new Map<string, PraxityBlock>();
		for (const document of documents) {
			for (const block of collectAllBlocksDeep(document.blocks)) {
				blockLookup.set(`${document.id}:${block.id}`, block);
			}
		}
		const documentLookup = new Map(documents.map((document) => [document.id, document]));
		const isMultiDocumentAudit = documents.length > 1;

		const issues: AuditIssue[] = reportIssues.map((issue) => {
			const metadata = getRuleMetadata(issue.rule);
			const titleKey = `rules.${issue.rule}.title`;
			const descriptionKey = `rules.${issue.rule}.description`;
			const hasTitle = t.has(titleKey);
			const hasGrammarDiagnostic =
				issue.grammarDiagnostic !== undefined && diagnostic.has(issue.grammarDiagnostic);
			const hasDescription = hasGrammarDiagnostic || t.has(descriptionKey);
			const document = issue.pageId ? documentLookup.get(issue.pageId) : undefined;
			const block =
				issue.blockId && issue.pageId
					? blockLookup.get(`${issue.pageId}:${issue.blockId}`)
					: undefined;
			const blockTypeLabel =
				block && t.has(`blockTypes.${block.type}`)
					? t(`blockTypes.${block.type}`)
					: block
						? humanizeRuleName(block.type)
						: undefined;
			const blockIdentifier = block ? getBlockIdentifier(block) : null;
			const blockReference = blockTypeLabel
				? `${blockTypeLabel} - ${blockIdentifier ?? t("references.unnamed")}`
				: issue.blockId === "designSystem"
					? t("references.designSystem")
					: issue.pageId === "course"
						? t("references.courseWide")
						: issue.pageId
							? t("references.page", { pageId: issue.pageId })
							: t("references.courseWide");
			const documentReference =
				isMultiDocumentAudit && document
					? t("references.lesson", { lesson: document.title })
					: null;
			const annotationId = buildA11yOccurrenceId(issue);
			const isDismissed = dismissedIds.has(annotationId);

			return {
				...issue,
				annotationId,
				category: metadata.category,
				displaySeverity: metadata.displaySeverity,
				fixDomain: metadata.fixDomain,
				kind: metadata.kind,
				confidence: metadata.confidence,
				title: hasTitle ? t(titleKey) : humanizeRuleName(issue.rule),
				description:
					hasGrammarDiagnostic && issue.grammarDiagnostic
						? diagnostic(issue.grammarDiagnostic, issue.messageValues)
						: hasDescription
							? t(descriptionKey, issue.messageValues)
							: issue.message,
				guidance: getGuidance(t, issue.rule),
				blockReference: documentReference
					? `${documentReference} · ${blockReference}`
					: blockReference,
				isDismissed,
				isFallback: !(hasTitle && hasDescription),
				documentId: document?.id,
				documentTitle: document?.title,
				sourceLine: issue.blockId ? document?.spans?.get(issue.blockId)?.startLine : undefined,
				isCurrentSource: document?.isCurrentSource,
			};
		});

		const issuesByCategory = createEmptyCategoryMap();
		for (const issue of issues) {
			const category = issue.category as DisplayCategory;
			if (issuesByCategory[category]) {
				issuesByCategory[category].push(issue);
			}
		}

		const counts: SeverityCountMap = {
			critical: 0,
			recommended: 0,
			minor: 0,
			dismissed: 0,
			total: issues.length,
		};
		for (const issue of issues) {
			if (issue.isDismissed) {
				counts.dismissed += 1;
			} else {
				counts[issue.displaySeverity] += 1;
			}
		}

		return {
			state: "ready",
			mediaAnalysisPending,
			issues,
			issuesByCategory,
			counts,
		};
	}, [
		parseError,
		designSystemIssues,
		designSettingIssues,
		documents,
		flashingGifSources,
		mediaAnalysisPending,
		pages,
		authorSources,
		dismissedIds,
		t,
		diagnostic,
	]);

	return result;
}
