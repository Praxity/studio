import { deckPageGates, hasAutomaticAnswer } from "@praxity/shared-blocks/assessment-choice";

export { deckPageGates } from "@praxity/shared-blocks/assessment-choice";

import { supportsDeckPassGate } from "@praxity/shared-blocks/constants";
import { flattenLogicBlocks } from "@praxity/shared-blocks/logic/flatten-blocks";
import {
	extractNarrationSegments,
	hasNarrationContent,
	type NarrationSegment,
	plainNarrationText,
} from "@praxity/shared-blocks/narration";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import { fullyDecodeEntities } from "./html-entities";
import { PracticeAdmissionError } from "./practice-admission";

export interface ModuleDeckOptions {
	gates?: Record<string, "attempt" | "pass">;
	/** Pause after these stable slide IDs. */
	stops?: string[];
}

export function validateModuleDeck(
	options: ModuleDeckOptions,
	pages: PraxityPage[],
	locale = "en",
): void {
	if (!options || typeof options !== "object" || Array.isArray(options))
		throw new Error("Invalid moduleDeck options");
	const pageIds = new Set<string>();
	const finishedModules = new Set<string>();
	let previousModule: string | undefined;
	for (const page of pages) {
		if (
			!page.id ||
			pageIds.has(page.id) ||
			page.id.startsWith("deck-") ||
			page.id === "main-content"
		)
			throw new Error(`Invalid or duplicate module deck page ID: ${page.id}`);
		pageIds.add(page.id);
		const module = page.lessonId ?? page.id;
		if (module !== previousModule) {
			if (finishedModules.has(module))
				throw new Error(`Module deck pages must be contiguous: ${module}`);
			if (previousModule) finishedModules.add(previousModule);
			previousModule = module;
		}
	}
	const blocks = pages.flatMap((page) => flattenLogicBlocks(page.blocks));
	for (const block of blocks) {
		if (
			!flattenLogicBlocks([block]).some((child) =>
				["retrievalSheet", "writeDistractors", "highlight"].includes(child.type),
			)
		)
			continue;
		if (
			Object.hasOwn(options.gates ?? {}, block.id) ||
			block.data.required === true ||
			block.data.deckGate !== undefined
		)
			throw new PracticeAdmissionError(
				"practice-no-tracking",
				block.id,
				Object.hasOwn(options.gates ?? {}, block.id)
					? `moduleDeck.gates.${block.id}`
					: `blocks.${block.id}.data.${block.data.required === true ? "required" : "deckGate"}`,
				locale,
			);
	}
	const ids = new Set<string>();
	for (const block of blocks) {
		if (ids.has(block.id)) throw new Error(`Module deck requires unique block IDs: ${block.id}`);
		ids.add(block.id);
		if (
			["logic", "variable"].includes(block.type) ||
			block.data.visible ||
			(block.type === "button" && block.data.action && block.data.action !== "link")
		) {
			throw new Error(
				`Module deck first slice does not support branching or conditional blocks: ${block.id}`,
			);
		}
		if (
			block.data.required === true &&
			!["assessment", "assessmentGroup", "selfCheck"].includes(block.type)
		)
			throw new Error(`Module deck requires an assessment gate: ${block.id}`);
	}
	if (
		options.gates !== undefined &&
		(!options.gates || typeof options.gates !== "object" || Array.isArray(options.gates))
	)
		throw new Error("Invalid moduleDeck gates");
	for (const [id, rule] of Object.entries(options.gates ?? {})) {
		if (
			!blocks.some(
				(block) =>
					block.id === id && ["assessment", "assessmentGroup", "selfCheck"].includes(block.type),
			) ||
			(rule !== "attempt" && rule !== "pass")
		)
			throw new Error(`Invalid module deck gate: ${id}`);
	}
	for (const page of pages) {
		const pageBlocks = flattenLogicBlocks(page.blocks);
		for (const group of pageBlocks.filter((block) => block.type === "assessmentGroup")) {
			const members = group.data.memberBlockIds;
			if (
				!Array.isArray(members) ||
				!members.length ||
				members.some(
					(id) => !pageBlocks.some((block) => block.id === id && block.type === "assessment"),
				)
			)
				throw new Error(
					`Module deck group members must be assessments on the same page: ${group.id}`,
				);
		}
		for (const gate of deckPageGates(pageBlocks, options)) {
			const block = pageBlocks.find((candidate) => candidate.id === gate.id);
			if (!block) continue;
			if (block.type === "selfCheck") {
				if (gate.rule === "pass")
					throw new Error(`Pass gates need an automatically checked answer: ${block.id}`);
				continue;
			}
			const members =
				block.type === "assessmentGroup"
					? (Array.isArray(block.data.memberBlockIds) ? block.data.memberBlockIds : []).map((id) =>
							pageBlocks.find((candidate) => candidate.id === id),
						)
					: [block];
			const groupPass = block.type === "assessmentGroup" && gate.rule === "pass";
			if (groupPass && !members.some((member) => member && hasAutomaticAnswer(member)))
				throw new Error(`Pass gates need an automatically checked answer: ${block.id}`);
			for (const member of members) {
				if (!member) continue;
				if (member.data.private === true && member.data.assessmentType === "choice")
					throw new PracticeAdmissionError(
						"private-choice-practice-only",
						member.id,
						`moduleDeck.gates.${gate.id}`,
						locale,
					);
				if (member.data.private === true)
					throw new Error(`Private responses cannot release module deck gates: ${member.id}`);
				if (
					gate.rule === "pass" &&
					((block.type === "assessment" && !supportsDeckPassGate(member.data.assessmentType)) ||
						(groupPass && block.data.mode === "oneOf" && !hasAutomaticAnswer(member)))
				)
					throw new Error(`Pass gates need an automatically checked answer: ${member.id}`);
			}
		}
	}

	if (
		options.stops !== undefined &&
		(!Array.isArray(options.stops) ||
			options.stops.some((id) => !pages.some((page) => page.id === id)))
	)
		throw new Error("Invalid module deck stops");
}

export function deckPageData(
	page: PraxityPage,
	options: ModuleDeckOptions,
	slug: string,
	moduleSlug: string,
	locale: string,
	sequentialLessons = false,
) {
	const gates = deckPageGates(flattenLogicBlocks(page.blocks), options);
	const blocks = new Map(flattenLogicBlocks(page.blocks).map((block) => [block.id, block]));
	const segments = (
		Array.isArray(page.data?._narrationSegments)
			? (page.data._narrationSegments as NarrationSegment[])
			: extractNarrationSegments(
					page.title,
					page.data ?? {},
					page.blocks,
					page.narrationDefaults ?? {},
					locale,
				)
	)
		.filter((segment) => !segment.disabled && hasNarrationContent(segment))
		.map((segment) => {
			const block = segment.blockId ? blocks.get(segment.blockId) : undefined;
			const item =
				segment.containerPart === "item" &&
				segment.itemSide !== "back" &&
				segment.itemIndex !== undefined &&
				["card", "tabs", "sequence"].includes(block?.type ?? "") &&
				Array.isArray(block?.data.items)
					? block.data.items[segment.itemIndex]
					: undefined;
			const itemTitle =
				item && typeof item.label === "string" ? plainNarrationText(item.label) : "";
			const quoteAttribution =
				!segment.custom && block?.type === "quote"
					? plainNarrationText(block.data.attribution ?? block.data.speaker)
					: "";
			return {
				id: `${page.id}:${segment.id}`,
				kind: segment.kind,
				blockId: segment.blockId,
				...(segment.blockType === "dialogue" && segment.itemIndex !== undefined
					? { turnIndex: segment.itemIndex }
					: {}),
				...(segment.speaker ? { speaker: segment.speaker } : {}),
				...(segment.cardTargets ? { cardTargets: segment.cardTargets } : {}),
				script: segment.script,
				src: page.narrationEnabled === true ? segment.audioUrl : undefined,
				timings: page.narrationEnabled === true ? segment.timingsUrl : undefined,
				duration: page.narrationEnabled === true ? segment.duration : undefined,
				pauseAfter: segment.pauseAfter,
				...(itemTitle ? { itemTitle } : {}),
				...(quoteAttribution ? { quoteAttribution } : {}),
			};
		});
	return {
		id: page.id,
		title: fullyDecodeEntities(page.title),
		lessonTitle: page.lessonTitle ? fullyDecodeEntities(page.lessonTitle) : page.lessonTitle,
		slug,
		moduleSlug,
		sequentialLessons,
		gates,
		stop: options.stops?.includes(page.id) === true,
		narrationSilent: page.narrationEnabled !== true || segments.length === 0,
		segments,
	};
}
export type DeckPage = ReturnType<typeof deckPageData>;
