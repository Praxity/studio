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

const BLOCK_STATE_ALLOWANCE = 512;

const ESTIMATED_RESPONSE_LENGTH = 32;
const ESTIMATED_TIMESTAMP = 1_800_000_000_000;

export interface Scorm12StorageEstimate {
	atRisk: boolean;
	estimatedLength: number;
	limit: number;
	reportingSelfCheckCount: number;
}

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
