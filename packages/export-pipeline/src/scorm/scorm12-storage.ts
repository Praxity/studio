import { choiceContentSignature } from "@praxity/shared-blocks/assessment-choice";
import { compileBlockStatePolicy } from "@praxity/shared-blocks/block-state-policy";
import { flattenLogicBlocks } from "@praxity/shared-blocks/logic/flatten-blocks";
import type {
	AssessmentBlockData,
	ChoiceResponse,
	PraxityBlock,
} from "@praxity/shared-blocks/types";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import {
	SCORM12_SUSPEND_DATA_LIMIT,
	type Scorm12SuspendData,
	serializeScorm12SuspendData,
} from "./api/scorm12.ts";
import { SCORM2004_RESPONSE_LIMIT } from "./api/scorm2004.ts";
import { serializeScorm12CompactSuspendData } from "./scorm12-suspend-data";

/**
 * Room left for block state, variables and deck progress, which share the
 * `custom` field. Their size depends on what the learner does, so this is a
 * fixed allowance rather than a computed value.
 */
const BLOCK_STATE_ALLOWANCE = 512;

/**
 * Each submission stores the learner's response text, up to 250 characters.
 * The estimate assumes one short answer per question; open answers and retries
 * can use more.
 */
const ESTIMATED_RESPONSE_LENGTH = 32;
/** A 13-digit `Date.now()` value, the length the adapter writes for years to come. */
const ESTIMATED_TIMESTAMP = 1_800_000_000_000;

export interface Scorm12StorageEstimate {
	atRisk: boolean;
	/** Characters a learner who visits every page and answers every question would store. */
	estimatedLength: number;
	limit: number;
	reportingSelfCheckCount: number;
}

/**
 * Estimate whether SCORM 1.2 suspend_data can hold a full attempt at this
 * course. The adapter stores every visited page ID and every assessment
 * submission there. Lossless compression shares repeated metadata; varied open
 * answers and UUIDs can still exceed SCORM 1.2's 4,096-character limit.
 */
export function estimateScorm12Storage(course: { blocks: PraxityBlock[] }): Scorm12StorageEstimate {
	const pages = splitBlocksIntoPages(course.blocks, "");
	const policy = compileBlockStatePolicy(course.blocks);
	const choices = flattenLogicBlocks(course.blocks).filter(
		(block) =>
			block.type === "assessment" &&
			block.data.assessmentType === "choice" &&
			block.data.private !== true &&
			(block.data.response as ChoiceResponse | undefined)?.type === "choice",
	);
	const checks = flattenLogicBlocks(course.blocks).filter(
		(block) => block.type === "selfCheck" && policy[block.id] === "lms",
	);
	const selfCheckIds = new Set(checks.map((block) => block.id));
	const signatures = new Map(
		choices.map((block) => [
			block.id,
			choiceContentSignature(
				block.data as unknown as AssessmentBlockData,
				block.data._dontKnow === true,
			),
		]),
	);
	const interactionIds = pages.flatMap((page) =>
		flattenLogicBlocks(page.blocks).flatMap((block) =>
			// Course hosts record each submitted question and each completed group.
			(block.type === "assessment" && block.data.private !== true) ||
			(block.type === "selfCheck" && policy[block.id] === "lms") ||
			block.type === "assessmentGroup"
				? [block.id]
				: [],
		),
	);
	const fullAttempt: Scorm12SuspendData = {
		visitedPages: pages.map((page) => page.id),
		interactions: interactionIds.map((id) => ({
			id,
			response: "x".repeat(ESTIMATED_RESPONSE_LENGTH),
			...(selfCheckIds.has(id) ? {} : { correct: true, score: 100 }),
			timestamp: ESTIMATED_TIMESTAMP,
			...(signatures.has(id)
				? { attemptsUsed: 1, maxAttempts: 2, contentSignature: signatures.get(id) }
				: {}),
		})),
	};
	if (checks.length || choices.length) {
		// Self-check has no answer limit. Reserve the 2004 report length per
		// snapshot as a warning estimate, plus ticks and the comparison revision.
		fullAttempt.custom = JSON.stringify({
			blockState: Object.fromEntries([
				...checks.map((block) => {
					const answer = "x".repeat(SCORM2004_RESPONSE_LIMIT);
					const content = block.data.content as { parts?: Array<{ id: string }> } | undefined;
					const ticked = content?.parts?.map((part) => part.id) ?? [];
					return [
						block.id,
						{
							version: 1,
							kind: "self-check",
							draft: { answer, ticked, shown: false },
							submitted: {
								answer,
								ticked,
								shown: true,
								contentRevision: `sha256:${"0".repeat(64)}`,
							},
						},
					];
				}),
				...choices.map((block) => {
					const data = block.data as unknown as AssessmentBlockData;
					const response = data.response as ChoiceResponse;
					const correct = response.options
						.filter((option) => option.isCorrect)
						.map((option) => option.id);
					const answer = correct.length
						? correct
						: response.options.slice(0, 1).map((option) => option.id);
					return [
						block.id,
						{
							version: 1,
							kind: "assessment",
							assessmentType: "choice",
							contentSignature: signatures.get(block.id),
							writtenAt: ESTIMATED_TIMESTAMP,
							attemptCount: 1,
							checked: true,
							correct: correct.length > 0,
							completed: true,
							interacted: true,
							answer,
							reviewedChoiceIds: answer,
						},
					];
				}),
			]),
		});
	}
	// Reserve room before choosing the codec, so the allowance cannot trigger a
	// false overflow immediately below the runtime's compression threshold.
	let estimatedLength: number;
	try {
		estimatedLength =
			(choices.length ? serializeScorm12CompactSuspendData : serializeScorm12SuspendData)(
				fullAttempt,
				BLOCK_STATE_ALLOWANCE,
			).length + BLOCK_STATE_ALLOWANCE;
	} catch (error) {
		if (!(error instanceof Error) || !error.message.includes("ESCORM12STORAGE")) throw error;
		estimatedLength = SCORM12_SUSPEND_DATA_LIMIT + 1;
	}
	// Repeated placeholder text compresses far more than a learner's open answer.
	// Keep the existing non-choice warning budget when choices enable compression.
	if (choices.length && interactionIds.some((id) => !choices.some((block) => block.id === id))) {
		const choiceIds = new Set(choices.map((block) => block.id));
		const otherState = fullAttempt.custom ? JSON.parse(fullAttempt.custom).blockState : undefined;
		const otherAttempt = {
			...fullAttempt,
			interactions: fullAttempt.interactions.filter((row) => !choiceIds.has(row.id)),
			...(otherState
				? {
						custom: JSON.stringify({
							blockState: Object.fromEntries(
								Object.entries(otherState).filter(([id]) => !choiceIds.has(id)),
							),
						}),
					}
				: {}),
		};
		estimatedLength = Math.max(
			estimatedLength,
			JSON.stringify(otherAttempt).length + BLOCK_STATE_ALLOWANCE,
		);
	}
	return {
		atRisk: estimatedLength > SCORM12_SUSPEND_DATA_LIMIT,
		estimatedLength,
		limit: SCORM12_SUSPEND_DATA_LIMIT,
		reportingSelfCheckCount: checks.length,
	};
}
