import { isInlineProjectionMetadataKey } from "./inline-fields";
import type { AssessmentBlockData, PraxityBlock } from "./types";

/** Group completion and score requirements retain their distinct fallback sets. */
export function assessmentGroupRequirements(members: readonly PraxityBlock[]) {
	const requiredIds = new Set(
		members
			.filter((block) => {
				const data = block.data as {
					required?: boolean;
					gradingMode?: string;
					graded?: boolean;
				} | null;
				return typeof data?.required === "boolean"
					? data.required
					: data?.gradingMode !== undefined
						? data.gradingMode !== "none"
						: data?.graded === true;
			})
			.map((block) => block.id),
	);
	const scoreRequiredIds = new Set(requiredIds);
	if (requiredIds.size === 0) members.forEach((block) => requiredIds.add(block.id));
	return { requiredIds, scoreRequiredIds };
}

/** One diagnostic format for source and effective-fact publication refusals. */
export function choiceFactError(blockId: string, field: string, locale = "en"): Error {
	return new Error(
		locale.toLowerCase().split(/[-_]/)[0] === "fr"
			? `Donnée de choix invalide pour le bloc "${blockId}" : ${field}`
			: `Invalid choice fact for block "${blockId}": ${field}`,
	);
}

/** Effective grading and attempts used by controls and material signatures. */
export function assessmentStatePolicy(
	data: Pick<
		AssessmentBlockData,
		"assessmentType" | "gradingMode" | "graded" | "attempts" | "feedbackMode"
	>,
	canAutoScore: boolean,
) {
	const assessmentType = data.assessmentType ?? "choice";
	const gradingMode = data.gradingMode ?? (data.graded ? "exact" : "none");
	const graded = gradingMode !== "none" && (assessmentType !== "fillBlank" || canAutoScore);
	const attempts = data.attempts ?? (!graded && canAutoScore ? 0 : 1);
	const revealAnswers =
		data.feedbackMode === "reveal" && canAutoScore && assessmentType !== "hotspot";
	return {
		gradingMode,
		graded,
		revealAnswers,
		maxAttempts: revealAnswers ? 1 : attempts === 0 ? Infinity : attempts,
	};
}

/** Authored/default scoring selects the canonical response grading mode. */
export function assessmentGradingMode(scored: unknown): "exact" | "none" {
	return scored === true ? "exact" : "none";
}

/** Normalization supplies effective pass gates, including group and deck overrides. */
export function assessmentOffersDontKnow(
	data: {
		assessmentType?: unknown;
		response?: unknown;
		dontKnow?: unknown;
		scored?: unknown;
		graded?: unknown;
		gradingMode?: unknown;
		deckGate?: unknown;
	},
	passGate = false,
): boolean {
	const response = data.response as { selectionMode?: unknown } | undefined;
	if (data.assessmentType !== "choice" || response?.selectionMode !== "single") return false;
	if (typeof data.dontKnow === "boolean") return data.dontKnow;
	return (
		!passGate &&
		data.deckGate !== "pass" &&
		data.scored !== true &&
		data.graded !== true &&
		(data.gradingMode === undefined || data.gradingMode === "none")
	);
}

export interface AssessmentDeckOptions {
	gates?: Record<string, "attempt" | "pass">;
}

export function hasAutomaticAnswer(block: PraxityBlock): boolean {
	const response = block.data.response as
		| {
				options?: Array<{ isCorrect?: boolean }>;
				blanks?: Array<{ alternatives?: string[]; answer?: string }>;
		  }
		| undefined;
	const type = block.data.assessmentType;
	if (type === "choice")
		return response?.options?.some((option) => option.isCorrect === true) === true;
	if (type === "fillBlank")
		return (
			response?.blanks?.some(
				(blank) =>
					Boolean(blank.answer?.trim()) || blank.alternatives?.some((answer) => answer.trim()),
			) === true
		);
	return ["hotspot", "matching", "sequence", "categorize"].includes(String(type));
}

function gateRule(
	block: PraxityBlock,
	options: AssessmentDeckOptions,
): "attempt" | "pass" | undefined {
	if (block.type === "selfCheck") {
		const explicit = options.gates?.[block.id] ?? block.data.deckGate;
		return explicit === "attempt" || explicit === "pass"
			? explicit
			: block.data.required === true
				? "attempt"
				: undefined;
	}
	if (block.type !== "assessment") return undefined;
	const graded =
		(block.data.gradingMode ?? (block.data.graded || block.data.scored ? "exact" : "none")) !==
		"none";
	return options.gates && Object.hasOwn(options.gates, block.id)
		? options.gates[block.id]
		: (block.data.required ?? graded)
			? graded || hasAutomaticAnswer(block)
				? "pass"
				: "attempt"
			: undefined;
}

/** Shared gate derivation for deck access and assessment defaults. Input is flattened. */
export function deckPageGates(blocks: readonly PraxityBlock[], options: AssessmentDeckOptions) {
	const grouped = new Set<string>();
	const gates: Array<{ id: string; rule: "attempt" | "pass" }> = [];
	for (const group of blocks.filter((block) => block.type === "assessmentGroup")) {
		const ids = Array.isArray(group.data.memberBlockIds) ? group.data.memberBlockIds : [];
		const rules = ids.map((id) => {
			grouped.add(String(id));
			const member = blocks.find((block) => block.id === id);
			return member && gateRule(member, options);
		});
		const rule =
			options.gates && Object.hasOwn(options.gates, group.id)
				? options.gates[group.id]
				: rules.includes("pass")
					? "pass"
					: rules.includes("attempt")
						? "attempt"
						: undefined;
		if (rule) gates.push({ id: group.id, rule });
	}
	for (const block of blocks) {
		const rule = gateRule(block, options);
		if (rule && !grouped.has(block.id)) gates.push({ id: block.id, rule });
	}
	return gates;
}

/** Resolve renderer metadata without replacing the author's optional setting. */
export function resolveAssessmentDontKnow(
	blocks: readonly PraxityBlock[],
	deck?: AssessmentDeckOptions,
	/** Source narration keeps its original block types and target roles. */
	source: readonly PraxityBlock[] = blocks,
): PraxityBlock[] {
	const assessments: PraxityBlock[] = [];
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			value.forEach(visit);
			return;
		}
		if (!value || typeof value !== "object") return;
		const record = value as Record<string, unknown>;
		if ((record.type === "assessment" || record.type === "assessmentGroup") && record.data)
			assessments.push(value as PraxityBlock);
		Object.entries(record).forEach(([key, child]) => {
			if (!isInlineProjectionMetadataKey(key, { keepDisplay: true })) visit(child);
		});
	};
	visit(blocks);
	const passIds = new Set(
		(deck ? deckPageGates(assessments, deck) : [])
			.filter((gate) => gate.rule === "pass")
			.map((gate) => gate.id),
	);
	for (const group of assessments) {
		if (group.type !== "assessmentGroup" || !Array.isArray(group.data.memberBlockIds)) continue;
		if (
			passIds.has(group.id) ||
			group.data.deckGate === "pass" ||
			typeof group.data.passingScore === "number"
		)
			for (const id of group.data.memberBlockIds) passIds.add(String(id));
	}
	const resolved = new Map(
		assessments
			.filter((block) => block.type === "assessment")
			.map((block) => [block.id, assessmentOffersDontKnow(block.data, passIds.has(block.id))]),
	);
	const project = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(project);
		if (!value || typeof value !== "object") return value;
		const record = value as Record<string, unknown>;
		const next = Object.fromEntries(
			Object.entries(record).map(([key, child]) => [
				key,
				isInlineProjectionMetadataKey(key, { keepDisplay: true }) ? child : project(child),
			]),
		);
		if (record.type === "assessment" && typeof record.id === "string" && resolved.has(record.id))
			next.data = { ...(next.data as Record<string, unknown>), _dontKnow: resolved.get(record.id) };
		return next;
	};
	return project(source) as PraxityBlock[];
}
