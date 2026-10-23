import { assessmentGroupRequirements } from "@praxity/content-model";
import {
	type ChoiceGroupSubmission,
	choiceDependencyStatus,
	prepareChoiceGroupSubmission,
} from "../choice-learner-state";
import { journalDownloadLabels } from "../i18n/journal-download-labels";
import {
	learnerRuntime,
	readLearnerBlockState,
	writeLearnerBlockState,
} from "../learner-block-state";
import {
	dispatchSelfCheckEvent,
	observeSelfCheckLifetime,
	requestSelfCheckFrame,
	selfCheckEpochTicket,
	setSelfCheckTimeout,
} from "../self-check-consumers";
import type { AssessmentGroupBlockData, BlockLayoutMode, PraxityBlock } from "../types";
import { scrollElementIntoView } from "./scroll-into-view";

export { assessmentGroupRequirements };

export interface AssessmentGroupLabels {
	untitledGroup: string;
	assessmentGroupProgress: string;
	assessmentGroupResultsSummary: string;
	assessmentGroupCorrect: string;
	assessmentGroupUnknown: string;
	assessmentGroupReview: string;
	assessmentGroupQuestionReview: string;
	assessmentGroupScore: string;
	assessmentGroupPassed: string;
	assessmentGroupNotPassed: string;
	assessmentGroupSubmitSelected: string;
	assessmentGroupCheckSelected: string;
	assessmentGroupSubmitAll: string;
	assessmentGroupCheckAll: string;
	assessmentGroupChooseOne: string;
	assessmentGroupQuestionFallback: string;
	assessmentGroupRequiredError: string;
	assessmentGroupSaved: string;
	downloadResponseAs: string;
	downloadTxt: string;
	downloadDocx: string;
	completed: string;
	assessmentStorageNotice: string;
}

const DEFAULT_LABELS: AssessmentGroupLabels = {
	untitledGroup: "Untitled group",
	assessmentGroupProgress: "Questions completed: {completed} of {total}",
	assessmentGroupResultsSummary: "Results",
	assessmentGroupCorrect: "{correct} of {total} correct",
	assessmentGroupUnknown: ', {unknown} "I don\'t know"',
	assessmentGroupReview: "Review questions",
	assessmentGroupQuestionReview: "Question {index}: {stem}",
	assessmentGroupScore: "Score: {score}%",
	assessmentGroupPassed: "Passed",
	assessmentGroupNotPassed: "Not passed",
	assessmentGroupSubmitSelected: "Submit selected",
	assessmentGroupCheckSelected: "Check selected",
	assessmentGroupSubmitAll: "Submit all",
	assessmentGroupCheckAll: "Check all",
	assessmentGroupChooseOne: "Choose one",
	assessmentGroupQuestionFallback: "Question {index}",
	assessmentGroupRequiredError: "Answer all required questions before submitting.",
	assessmentGroupSaved: "Responses saved",
	...journalDownloadLabels.en,
	completed: "Completed",
	assessmentStorageNotice:
		"This answer could not be saved. Your previously saved progress is kept.",
};

const LAYOUT_CLASSES = [
	"praxity-layout-narrow",
	"praxity-layout-wide",
	"praxity-layout-full",
	"praxity-layout-breakout",
] as const;

export interface AssessmentGroupMeta {
	id: string;
	groupName: string;
	mode: AssessmentGroupBlockData["mode"];
	memberBlockIds: string[];
	requireAll: boolean;
	showResultsSummary: boolean;
	passingScore: number | null;
	buttonLabel: string;
	isGraded: boolean;
	layout: BlockLayoutMode | null;
}

export function assessmentGroupHasProgress(members: readonly PraxityBlock[]): boolean {
	return members.some((member) => {
		const data =
			member.data && typeof member.data === "object"
				? (member.data as Record<string, unknown>)
				: {};
		if (
			data.gradingMode !== undefined
				? data.gradingMode !== "none"
				: data.scored === true || data.graded === true
		)
			return true;
		return (
			(data.assessmentType === "choice" &&
				Array.isArray((data.response as { options?: unknown[] } | undefined)?.options) &&
				(data.response as { options: Array<{ isCorrect?: unknown }> }).options.some(
					(option) => option?.isCorrect === true,
				)) ||
			["hotspot", "matching", "sequence", "categorize"].includes(String(data.assessmentType)) ||
			(data.assessmentType === "fillBlank" &&
				Array.isArray((data.response as { blanks?: unknown[] } | undefined)?.blanks) &&
				(data.response as { blanks: Array<{ answer?: unknown }> }).blanks.some(
					(blank) => typeof blank?.answer === "string" && blank.answer.length > 0,
				))
		);
	});
}

export function assessmentGroupSubmitLabel(
	group: AssessmentGroupMeta,
	labels: Pick<
		AssessmentGroupLabels,
		| "assessmentGroupSubmitSelected"
		| "assessmentGroupCheckSelected"
		| "assessmentGroupSubmitAll"
		| "assessmentGroupCheckAll"
	>,
): string {
	if (group.buttonLabel) return group.buttonLabel;
	if (group.mode === "oneOf")
		return group.isGraded
			? labels.assessmentGroupSubmitSelected
			: labels.assessmentGroupCheckSelected;
	return group.isGraded ? labels.assessmentGroupSubmitAll : labels.assessmentGroupCheckAll;
}

interface SavedAssessmentGroupState {
	version: 1;
	kind: "assessmentGroup";
	mode: AssessmentGroupBlockData["mode"];
	selectedMemberId: string | null;
	completed: boolean;
}

function readAssessmentGroupState(group: AssessmentGroupMeta): SavedAssessmentGroupState | null {
	const value = readLearnerBlockState(group.id);
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		value.version !== 1 ||
		value.kind !== "assessmentGroup" ||
		value.mode !== group.mode ||
		typeof value.completed !== "boolean" ||
		(group.mode === "all"
			? value.selectedMemberId !== null
			: typeof value.selectedMemberId !== "string" ||
				!group.memberBlockIds.includes(value.selectedMemberId))
	) {
		return null;
	}
	const view =
		typeof window === "undefined"
			? undefined
			: window.__praxityBlockState?.getChoiceDependencyView?.();
	return view && choiceDependencyStatus(group.id, view) !== "current"
		? ({ ...value, completed: false } as unknown as SavedAssessmentGroupState)
		: (value as unknown as SavedAssessmentGroupState);
}

function writeAssessmentGroupState(
	group: AssessmentGroupMeta,
	selectedMemberId: string | null,
	completed: boolean,
	current: () => boolean,
	submitted?: ChoiceGroupSubmission,
) {
	const previous = readLearnerBlockState(group.id);
	const retained =
		previous && typeof previous === "object" && !Array.isArray(previous)
			? previous.submitted
			: undefined;
	const snapshot = submitted
		? {
				payload: {
					mode: submitted.payload.mode,
					selectedMemberId: submitted.payload.selectedMemberId,
					dependencies: submitted.payload.dependencies,
				},
				contentSignature: submitted.contentSignature,
			}
		: retained;
	const next = {
		version: 1,
		kind: "assessmentGroup",
		mode: group.mode,
		selectedMemberId,
		completed,
		...(snapshot !== undefined ? { submitted: snapshot } : {}),
	};
	if (snapshot !== undefined && JSON.stringify(previous) === JSON.stringify(next)) return current();
	return writeLearnerBlockState(group.id, next, current);
}

function isLayoutMode(value: unknown): value is BlockLayoutMode {
	return value === "narrow" || value === "wide" || value === "full" || value === "breakout";
}

export function resolveAssessmentGroupLayout(
	group: PraxityBlock,
	blocks: readonly PraxityBlock[],
): BlockLayoutMode | null {
	const layoutOf = (block: PraxityBlock) => {
		const data = block.data && typeof block.data === "object" ? block.data : {};
		return isLayoutMode(data.layoutMode)
			? data.layoutMode
			: isLayoutMode(data.layout)
				? data.layout
				: null;
	};
	const explicit = layoutOf(group);
	if (explicit) return explicit;
	const memberIds =
		group.data && Array.isArray(group.data.memberBlockIds) ? group.data.memberBlockIds : [];
	const layouts = blocks.filter((block) => memberIds.includes(block.id)).map(layoutOf);
	return (
		(["full", "breakout", "wide"] as const).find((layout) => layouts.includes(layout)) ??
		(layouts.length > 0 && layouts.every((layout) => layout === "narrow") ? "narrow" : null)
	);
}

function getGroupName(group: AssessmentGroupMeta, root: HTMLElement, fallback: string): string {
	return (
		root
			.querySelector<HTMLElement>(
				`[data-assessment-group-header="${CSS.escape(group.id)}"] .praxity-assessment-group-title`,
			)
			?.textContent?.trim() ||
		group.groupName ||
		fallback
	);
}

function getQuestionLabel(
	memberEl: HTMLElement,
	index: number,
	fallback: string,
	reviewLabel?: string,
): string {
	const stem =
		memberEl.querySelector(".praxity-assessment-stem-content") ??
		memberEl.querySelector(".praxity-assessment-stem");
	const label = stem?.cloneNode(true) as HTMLElement | undefined;
	label?.querySelectorAll(".praxity-required-indicator").forEach((indicator) => indicator.remove());
	const stemText = label?.textContent?.trim() ?? "";
	return stemText
		? (reviewLabel?.replace("{index}", String(index + 1)).replace("{stem}", () => stemText) ??
				stemText)
		: fallback.replace("{index}", String(index + 1));
}

function clickHiddenSubmit(
	memberEl: HTMLElement,
	current: () => boolean,
	focusGroupResults = false,
) {
	for (const button of memberEl.querySelectorAll<HTMLButtonElement>(
		'[data-assessment-submit="true"]',
	)) {
		if (!current()) return;
		const previousDisplay = button.style.display;
		button.style.display = "";
		button.dataset.assessmentGroupFocus = String(focusGroupResults);
		button.click();
		if (!current()) return;
		delete button.dataset.assessmentGroupFocus;
		button.style.display = previousDisplay || "none";
	}
}

function getCommittedResult(memberEl: HTMLElement): HTMLElement {
	return (
		memberEl.querySelector<HTMLElement>(
			".praxity-block-assessment[data-block-id][data-assessment-display]",
		) ?? memberEl
	);
}

function focusRequiredMember(memberEl: HTMLElement, messageId: string) {
	const target =
		memberEl.querySelector<HTMLElement>(
			'input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]):not([aria-disabled="true"]),[role="radio"][tabindex],[role="checkbox"][tabindex],[role="combobox"],[tabindex]:not([tabindex="-1"])',
		) ?? memberEl;
	const previous = ["aria-invalid", "aria-required", "aria-describedby"].map(
		(attribute) => [attribute, target.getAttribute(attribute)] as const,
	);
	target.setAttribute("aria-invalid", "true");
	target.setAttribute("aria-required", "true");
	target.setAttribute(
		"aria-describedby",
		[target.getAttribute("aria-describedby"), messageId].filter(Boolean).join(" "),
	);
	if (!target.matches("input,select,textarea,button,[tabindex],a")) {
		target.tabIndex = -1;
	}
	scrollElementIntoView(target, { block: "center" });
	target.focus({ preventScroll: true });
	return () => {
		for (const [attribute, value] of previous) {
			if (value === null) target.removeAttribute(attribute);
			else target.setAttribute(attribute, value);
		}
	};
}

function showResults(
	group: AssessmentGroupMeta,
	members: Array<{ id: string; el: HTMLElement }>,
	root: HTMLElement,
	labels: AssessmentGroupLabels,
	emitCompletion = true,
	requiredIds = new Set(members.map((member) => member.id)),
	scoreRequiredIds = requiredIds,
	current = selfCheckEpochTicket(root.ownerDocument),
): boolean {
	if (!current()) return false;
	let totalScore = 0;
	let gradedCount = 0;
	let allMembersPassed = true;
	let hasCheckedMembers = false;
	let checkedCount = 0;
	let correctCount = 0;
	let unknownCount = 0;
	const scoredMemberIds: string[] = [];

	for (const member of members) {
		const card = getCommittedResult(member.el);
		if (
			!scoreRequiredIds.has(member.id) &&
			card.getAttribute("data-assessment-answered") === "false" &&
			!card.hasAttribute("data-result") &&
			card.getAttribute("data-completed") !== "true"
		)
			continue;
		if (card.hasAttribute("data-result") || card.hasAttribute("data-score")) {
			hasCheckedMembers = true;
			checkedCount += 1;
			if (
				card.getAttribute("data-result") === "correct" ||
				(!card.hasAttribute("data-result") && card.getAttribute("data-passed") === "true")
			)
				correctCount += 1;
		}
		if (card.getAttribute("data-result") === "unknown") unknownCount += 1;
		if (["incorrect", "unknown"].includes(card.getAttribute("data-result") ?? ""))
			allMembersPassed = false;
		if (!card.hasAttribute("data-score")) continue;
		const score = Number.parseFloat(card.getAttribute("data-score") || "0");
		const maxScore = Number.parseFloat(card.getAttribute("data-max-score") || "100");
		const passed = card.getAttribute("data-passed") === "true";
		totalScore += maxScore > 0 ? (score / maxScore) * 100 : 0;
		gradedCount += 1;
		scoredMemberIds.push(member.id);
		if (!passed) allMembersPassed = false;
	}

	const hasGradedMembers = gradedCount > 0;
	const percent = hasGradedMembers ? Math.round(totalScore / gradedCount) : 0;
	const passed = hasGradedMembers
		? group.passingScore === null
			? allMembersPassed
			: percent >= group.passingScore
		: allMembersPassed;
	const completedCount = members.filter(
		(member) => getCommittedResult(member.el).getAttribute("data-completed") === "true",
	).length;
	const allMembersFinished =
		completedCount === members.length &&
		members.every(
			(member) =>
				getCommittedResult(member.el).getAttribute("data-assessment-answered") !== "false",
		);
	const progress = root.querySelector<HTMLElement>(
		`[data-assessment-group-header="${CSS.escape(group.id)}"] [data-assessment-group-progress]`,
	);
	if (progress) {
		progress.textContent = labels.assessmentGroupProgress
			.replace("{completed}", String(completedCount))
			.replace("{total}", String(members.length));
	}
	const submitted = members
		.filter((member) => requiredIds.has(member.id))
		.every((member) => {
			const card = getCommittedResult(member.el);
			return card.getAttribute("data-completed") === "true" || card.hasAttribute("data-result");
		});
	if (!submitted) return false;
	const completed = members
		.filter((member) => requiredIds.has(member.id))
		.every((member) => getCommittedResult(member.el).getAttribute("data-completed") === "true");
	const container = root.querySelector<HTMLElement>(
		`[data-assessment-group-submit="${CSS.escape(group.id)}"]`,
	);
	if (!container) return false;
	const groupName = getGroupName(group, root, labels.untitledGroup);

	if (emitCompletion) {
		const provider = root.ownerDocument.defaultView?.__praxityBlockState;
		const view = provider?.getChoiceDependencyView?.();
		const selectedMemberId = group.mode === "oneOf" ? members[0].id : null;
		const selectedState = {
			version: 1,
			kind: "assessmentGroup",
			mode: group.mode,
			selectedMemberId,
			completed,
		};
		const submission =
			view?.groups && Object.hasOwn(view.groups, group.id)
				? prepareChoiceGroupSubmission(group.id, {
						...view,
						readState: (id) => (id === group.id ? selectedState : view.readState(id)),
					})
				: undefined;
		const restorePicker = () =>
			root
				.querySelectorAll<HTMLInputElement>(
					`.praxity-assessment-group-picker input[name="${CSS.escape(`ag-${group.id}`)}"]`,
				)
				.forEach((input) => {
					input.disabled = false;
				});
		if (submission === null) {
			restorePicker();
			return false;
		}
		const staged = submission && provider?.stageSubmission;
		if (
			staged &&
			!staged(
				group.id,
				() =>
					writeAssessmentGroupState(group, selectedMemberId, completed, current, submission) &&
					provider?.getSaveResult?.(group.id)?.status !== "not-saved",
			)
		) {
			restorePicker();
			return false;
		}
		dispatchSelfCheckEvent(
			new CustomEvent("praxity:assessment-group-complete", {
				detail: {
					groupId: group.id,
					groupName:
						root
							.querySelector<HTMLElement>(
								`[data-block-id="${CSS.escape(group.id)}"][data-assessment-report-title]`,
							)
							?.getAttribute("data-assessment-report-title") ?? groupName,
					language: root.ownerDocument.documentElement.lang,
					...(hasGradedMembers ? { score: percent, memberIds: scoredMemberIds } : {}),
					passed,
					correct: hasCheckedMembers ? passed : undefined,
					completed,
					...(submission
						? { contentSignature: submission.contentSignature, selectedMemberId }
						: {}),
					memberCount: members.length,
				},
				bubbles: true,
			}),
			current,
			root.ownerDocument,
		);
		if (submission && !staged)
			writeAssessmentGroupState(group, selectedMemberId, completed, current, submission);
		if (submission && provider?.getSaveResult?.(group.id)?.status === "not-saved") {
			const status = container.querySelector<HTMLElement>("[data-assessment-group-status]");
			if (status) status.textContent = labels.assessmentStorageNotice;
			restorePicker();
			return false;
		}
	}

	if (!current()) return false;
	if (!group.showResultsSummary && completed && allMembersFinished)
		container.querySelector(".praxity-ag-submit-btn")?.remove();
	if (!group.showResultsSummary) {
		if (completed && allMembersFinished) {
			if (!container.querySelector("[data-assessment-group-download]")) {
				container.remove();
				root
					.querySelector<HTMLElement>(
						`[data-assessment-group="${CSS.escape(group.id)}"][data-group-last]`,
					)
					?.removeAttribute("data-group-has-footer");
			}
		}
		return completed;
	}

	const results = container.querySelector<HTMLElement>("[data-assessment-group-results]");
	if (!results) return completed;
	results.className = "praxity-ag-results";

	const score =
		results.querySelector<HTMLElement>(".praxity-ag-results-score") ??
		root.ownerDocument.createElement("div");
	const scoreText = score.querySelector("span") ?? root.ownerDocument.createElement("span");
	scoreText.id = `praxity-ag-results-score-${group.id}`;
	score.append(scoreText);
	score.className = "praxity-ag-results-score";
	const verdict = passed ? labels.assessmentGroupPassed : labels.assessmentGroupNotPassed;
	scoreText.textContent = hasCheckedMembers
		? `${labels.assessmentGroupCorrect
				.replace("{correct}", String(correctCount))
				.replace(
					"{total}",
					String(checkedCount),
				)}${unknownCount ? labels.assessmentGroupUnknown.replace("{unknown}", String(unknownCount)) : ""} · ${hasGradedMembers ? `${labels.assessmentGroupScore.replace("{score}", String(percent))} - ${verdict}` : verdict}`
		: labels.completed;
	const review = root.ownerDocument.createElement("nav");
	review.className = "praxity-ag-review-links";
	review.setAttribute("aria-label", labels.assessmentGroupReview);
	for (const [index, member] of members.entries()) {
		const heading = member.el.querySelector<HTMLElement>(".praxity-assessment-stem");
		if (!heading) continue;
		if (!heading.id) heading.id = `praxity-ag-question-${member.id}`;
		heading.tabIndex = -1;
		const link = root.ownerDocument.createElement("a");
		link.href = `#${heading.id}`;
		link.textContent = getQuestionLabel(
			member.el,
			index,
			labels.assessmentGroupQuestionFallback,
			labels.assessmentGroupQuestionReview,
		);
		link.addEventListener("click", (event) => {
			if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
			event.preventDefault();
			// The stem, rather than its outer card, is the scroll and focus destination.
			heading.style.scrollMarginTop = "var(--space-2, 8px)";
			scrollElementIntoView(heading, { block: "start" });
			heading.focus({ preventScroll: true });
		});
		review.append(link);
	}
	if (!results.contains(score)) results.replaceChildren(score);
	results.querySelector(".praxity-ag-review-links")?.remove();
	results.append(review);
	if (emitCompletion) {
		const action = [
			...members.map(({ el }) => el.querySelector<HTMLElement>("[data-assessment-retry]")),
			...members.map(({ el }) => el.querySelector<HTMLElement>("[data-assessment-continue]")),
			completed && allMembersFinished
				? null
				: container.querySelector<HTMLElement>(".praxity-ag-submit-btn"),
			...root.ownerDocument.querySelectorAll<HTMLElement>("#deck-next, .praxity-nav-next"),
		].find(
			(element) =>
				element &&
				element.getClientRects().length > 0 &&
				!element.matches(':disabled, [aria-disabled="true"]') &&
				!element.closest('[hidden], [inert], [aria-hidden="true"]'),
		);
		if (action) {
			score.removeAttribute("tabindex");
			action.setAttribute("aria-describedby", scoreText.id);
			action.focus({ preventScroll: true });
		} else {
			score.tabIndex = -1;
			score.focus({ preventScroll: true });
		}
	}
	if (!current()) return false;
	if (completed && allMembersFinished) container.querySelector(".praxity-ag-submit-btn")?.remove();
	return completed;
}

export function buildAssessmentGroups(blocks: PraxityBlock[]): AssessmentGroupMeta[] {
	const blockById = new Map(blocks.map((block) => [block.id, block]));
	return blocks
		.filter((block) => block.type === "assessmentGroup")
		.map((block) => {
			const data =
				block.data && typeof block.data === "object"
					? (block.data as Partial<AssessmentGroupBlockData>)
					: {};
			const layout = resolveAssessmentGroupLayout(block, blocks);
			const memberBlockIds = Array.isArray(data.memberBlockIds)
				? data.memberBlockIds.filter((id): id is string => typeof id === "string")
				: [];
			const isGraded = memberBlockIds.some((id) => {
				const memberData = blockById.get(id)?.data as Record<string, unknown> | undefined;
				return memberData?.gradingMode !== undefined
					? memberData.gradingMode !== "none"
					: memberData?.scored === true || memberData?.graded === true;
			});
			return {
				id: block.id,
				groupName: typeof data.groupName === "string" ? data.groupName : "",
				mode: data.mode === "oneOf" ? ("oneOf" as const) : ("all" as const),
				memberBlockIds,
				requireAll: data.requireAll === true,
				showResultsSummary: data.showResultsSummary !== false,
				buttonLabel: typeof data.buttonLabel === "string" ? data.buttonLabel.trim() : "",
				layout,
				isGraded,
				passingScore:
					typeof data.passingScore === "number" && Number.isFinite(data.passingScore)
						? Math.max(0, Math.min(100, data.passingScore))
						: null,
			};
		})
		.filter((group) => group.memberBlockIds.length > 0);
}

export function initAssessmentGroups(options: {
	blocks: PraxityBlock[];
	root: HTMLElement;
	labels?: Partial<AssessmentGroupLabels>;
	readOnly?: boolean;
}): () => void {
	return observeSelfCheckLifetime(
		(current) => initAssessmentGroupLifetime(options, current),
		options.root.ownerDocument,
	);
}

function initAssessmentGroupLifetime(
	{
		blocks,
		root,
		labels: suppliedLabels,
		readOnly = false,
	}: Parameters<typeof initAssessmentGroups>[0],
	activation: () => boolean,
): () => void {
	const groups = buildAssessmentGroups(blocks);
	if (groups.length === 0) return () => {};

	const labels = { ...DEFAULT_LABELS, ...suppliedLabels };
	const cleanup: Array<() => void> = [];
	let disposed = false;
	const frame = requestSelfCheckFrame(() => {
		if (disposed || !activation()) return;
		for (const group of groups) {
			const restored = readOnly ? null : readAssessmentGroupState(group);
			const members = group.memberBlockIds
				.map((id) => {
					const el = root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`);
					return el ? { id, el } : null;
				})
				.filter((member): member is { id: string; el: HTMLElement } => member !== null);

			if (members.length === 0) continue;
			const memberBlocks = blocks.filter((block) => group.memberBlockIds.includes(block.id));
			const { requiredIds, scoreRequiredIds } = assessmentGroupRequirements(memberBlocks);
			const progress = root.querySelector<HTMLElement>(
				`[data-assessment-group-header="${CSS.escape(group.id)}"] [data-assessment-group-progress]`,
			);
			if (progress && !assessmentGroupHasProgress(memberBlocks)) {
				const previousHidden = progress.hidden;
				const header = progress.closest<HTMLElement>("[data-assessment-group-header]");
				const previousLabelledBy = header?.getAttribute("aria-labelledby") ?? null;
				progress.hidden = true;
				if (header && progress.id && previousLabelledBy !== null)
					header.setAttribute(
						"aria-labelledby",
						previousLabelledBy
							.split(/\s+/)
							.filter((id) => id !== progress.id)
							.join(" "),
					);
				cleanup.push(() => {
					progress.hidden = previousHidden;
					if (header && previousLabelledBy !== null)
						header.setAttribute("aria-labelledby", previousLabelledBy);
				});
			}
			const layoutClass = group.layout ? `praxity-layout-${group.layout}` : null;
			const inheritedLayoutWrappers = new Map<HTMLElement, string[]>();
			const applyGroupLayout = (el: HTMLElement, className = layoutClass) => {
				if (!layoutClass) return;
				if (!inheritedLayoutWrappers.has(el))
					inheritedLayoutWrappers.set(
						el,
						LAYOUT_CLASSES.filter((name) => el.classList.contains(name)),
					);
				el.classList.remove(...LAYOUT_CLASSES);
				if (className) el.classList.add(className);
			};
			const header = root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(group.id)}"]`);
			if (header) applyGroupLayout(header);
			const groupIndex = blocks.findIndex((block) => block.id === group.id);
			const lastMemberIndex = Math.max(
				...members.map((member) => blocks.findIndex((block) => block.id === member.id)),
			);
			const contextBlocks = blocks
				.slice(groupIndex + 1, lastMemberIndex)
				.filter((block) => !group.memberBlockIds.includes(block.id))
				.flatMap((block) => {
					const el = root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(block.id)}"]`);
					return el ? [el] : [];
				});
			// Frame the float's formatting context, which owns the image height and gutter.
			const contextElements = new Set(
				contextBlocks.map((el) => {
					const region = el.closest<HTMLElement>(".praxity-float-region");
					if (
						!region ||
						[...region.querySelectorAll<HTMLElement>(".praxity-block[data-block-id]")].some(
							(block) => !contextBlocks.includes(block),
						)
					)
						return el;
					applyGroupLayout(el, null);
					return region;
				}),
			);
			const groupAttributes = [
				"data-assessment-group",
				"data-assessment-group-context",
				"data-group-first",
				"data-group-last",
				"data-group-has-footer",
				"data-group-oneof-unselected",
			];
			const originalAttributes = new Map<HTMLElement, Map<string, string | null>>();
			for (const el of [...contextElements, ...members.map((member) => member.el)]) {
				originalAttributes.set(
					el,
					new Map(groupAttributes.map((name) => [name, el.getAttribute(name)])),
				);
			}
			for (const el of contextElements) {
				el.setAttribute("data-assessment-group-context", group.id);
				applyGroupLayout(el);
			}

			members.forEach((member, index) => {
				const wrapper = member.el.closest<HTMLElement>(".praxity-block") ?? member.el;
				applyGroupLayout(wrapper);
				member.el.setAttribute("data-assessment-group", group.id);
				if (group.mode === "oneOf")
					member.el.toggleAttribute("data-group-oneof-unselected", index !== 0);
				if (index === 0) member.el.setAttribute("data-group-first", "");
				if (index === members.length - 1) {
					member.el.setAttribute("data-group-last", "");
					member.el.setAttribute("data-group-has-footer", "");
				}
			});
			cleanup.push(() => {
				for (const [el, attributes] of originalAttributes) {
					for (const [name, value] of attributes) {
						if (value === null) el.removeAttribute(name);
						else el.setAttribute(name, value);
					}
				}
				if (layoutClass) {
					for (const [wrapper, original] of inheritedLayoutWrappers) {
						wrapper.classList.remove(layoutClass);
						wrapper.classList.add(...original);
					}
				}
			});

			const existingSubmit = root.querySelector<HTMLElement>(
				`[data-assessment-group-submit="${CSS.escape(group.id)}"]`,
			);
			const submitContainer = existingSubmit ?? root.ownerDocument.createElement("div");
			if (!existingSubmit) {
				submitContainer.className = `praxity-assessment-group-submit${layoutClass ? ` ${layoutClass}` : ""}`;
				submitContainer.dataset.assessmentGroupSubmit = group.id;
			}
			const requiredMessageId = `praxity-ag-required-${group.id}`;

			const submitButton =
				submitContainer.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn") ??
				root.ownerDocument.createElement("button");
			submitButton.type = "button";
			submitButton.className = "praxity-btn praxity-btn-filled praxity-ag-submit-btn";
			submitButton.disabled = readOnly;
			submitButton.textContent = assessmentGroupSubmitLabel(group, labels);
			const results =
				submitContainer.querySelector<HTMLElement>("[data-assessment-group-results]") ??
				root.ownerDocument.createElement("div");
			results.dataset.assessmentGroupResults = "";
			// Submit announces through summary focus; review links stay outside live regions.
			results.removeAttribute("role");
			results.removeAttribute("aria-live");
			results.removeAttribute("aria-atomic");
			// Partial journal saves announce separately; review submissions leave this region empty.
			const status =
				submitContainer.querySelector<HTMLElement>("[data-assessment-group-status]") ??
				root.ownerDocument.createElement("div");
			status.dataset.assessmentGroupStatus = "";
			status.className = "praxity-sr-only";
			status.setAttribute("role", "status");
			status.setAttribute("aria-atomic", "true");
			submitContainer.append(submitButton, results, status);
			cleanup.push(() => status.remove());
			const downloadable = members.flatMap((member) => {
				const block = memberBlocks.find((candidate) => candidate.id === member.id);
				const response = (block?.data as { response?: { downloadAs?: unknown } } | undefined)
					?.response;
				const format = response?.downloadAs;
				return format === "txt" || format === "docx" || format === "both"
					? [{ ...member, format }]
					: [];
			});
			if (downloadable.length >= 2) {
				const groupName = getGroupName(group, root, labels.untitledGroup);
				const controls = root.ownerDocument.createElement("div");
				controls.className = "praxity-text-response-downloads";
				controls.dataset.assessmentGroupDownload = group.id;
				controls.setAttribute("role", "group");
				controls.setAttribute("aria-label", `${labels.downloadResponseAs}: ${groupName}`);
				const formats = (["txt", "docx"] as const).filter((format) =>
					downloadable.some((member) => member.format === format || member.format === "both"),
				);
				const buttons = formats.map((format) => {
					const button = root.ownerDocument.createElement("button");
					button.type = "button";
					button.className = "praxity-btn praxity-btn-outline";
					button.textContent = format === "txt" ? labels.downloadTxt : labels.downloadDocx;
					button.setAttribute(
						"aria-label",
						`${format === "txt" ? labels.downloadTxt : labels.downloadDocx}: ${groupName}`,
					);
					button.addEventListener("click", () => {
						const current = selfCheckEpochTicket(root.ownerDocument);
						void import("../lib/text-response-download").then(({ downloadAssessmentGroup }) => {
							if (disposed || !current()) return;
							downloadAssessmentGroup(
								format,
								groupName,
								downloadable.map((member) => member.el),
								labels.assessmentGroupQuestionFallback,
							);
						});
					});
					return button;
				});
				const updateButtons = () => {
					const hasAnswer = downloadable.some((member) =>
						member.el
							.querySelector<HTMLInputElement | HTMLTextAreaElement>(
								"textarea,input:not([type=hidden])",
							)
							?.value.trim(),
					);
					buttons.forEach((button) => {
						button.disabled = !hasAnswer;
					});
				};
				controls.append(...buttons);
				submitContainer.insertBefore(controls, submitButton);
				for (const member of downloadable) {
					const itemControls = member.el.querySelector<HTMLElement>(
						".praxity-text-response-downloads",
					);
					if (itemControls) {
						const wasHidden = itemControls.hidden;
						itemControls.hidden = true;
						cleanup.push(() => {
							itemControls.hidden = wasHidden;
						});
					}
					member.el.addEventListener("input", updateButtons);
					cleanup.push(() => member.el.removeEventListener("input", updateButtons));
				}
				updateButtons();
				cleanup.push(() => controls.remove());
			}

			if (!existingSubmit) {
				const lastWrapper =
					members[members.length - 1]?.el.closest<HTMLElement>(".praxity-block") ??
					members[members.length - 1]?.el;
				lastWrapper?.after(submitContainer);
				cleanup.push(() => submitContainer.remove());
			} else {
				cleanup.push(() => {
					submitButton.disabled = true;
				});
			}

			if (group.mode === "oneOf") {
				const restoredSelectedId = members.some(
					(member) => member.id === restored?.selectedMemberId,
				)
					? restored?.selectedMemberId
					: null;
				let selectedId = restoredSelectedId ?? members[0]?.id ?? null;
				const header = root.querySelector<HTMLElement>(
					`[data-assessment-group-header="${CSS.escape(group.id)}"]`,
				);
				const existingPicker = header?.querySelector<HTMLFieldSetElement>(
					".praxity-assessment-group-picker",
				);
				const picker = existingPicker ?? root.ownerDocument.createElement("fieldset");
				if (!existingPicker) {
					picker.className = "praxity-assessment-group-picker";
					const legend = root.ownerDocument.createElement("legend");
					legend.className = "praxity-assessment-group-picker-legend";
					legend.textContent = labels.assessmentGroupChooseOne;
					picker.append(legend);
				}
				const options =
					picker.querySelector<HTMLElement>(".praxity-assessment-group-options") ??
					root.ownerDocument.createElement("div");
				options.className = "praxity-assessment-group-options";
				picker.append(options);

				const setSelected = (id: string) => {
					selectedId = id;
					picker.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
						input.checked = input.value === id;
					});
					members.forEach((member) => {
						const wrapper = member.el.closest<HTMLElement>(".praxity-block") ?? member.el;
						const selected = member.id === selectedId;
						wrapper.style.display = selected ? "" : "none";
						member.el.toggleAttribute("data-group-oneof-unselected", !selected);
						member.el.toggleAttribute("data-group-first", selected);
						member.el.toggleAttribute("data-group-last", selected);
						member.el.toggleAttribute("data-group-has-footer", selected);
					});
				};

				members.forEach((member, index) => {
					const wrapper = member.el.closest<HTMLElement>(".praxity-block") ?? member.el;
					const previousDisplay = wrapper.style.display;
					cleanup.push(() => {
						wrapper.style.display = previousDisplay;
					});

					const radioId = `ag-radio-${group.id}-${member.id}`;
					const existingRadio = options.querySelector<HTMLInputElement>(`#${CSS.escape(radioId)}`);
					const radio = existingRadio ?? root.ownerDocument.createElement("input");
					radio.type = "radio";
					radio.disabled = readOnly;
					radio.name = `ag-${group.id}`;
					radio.value = member.id;
					radio.id = radioId;
					radio.className = "praxity-ag-radio";
					radio.checked = member.id === selectedId;

					if (!existingRadio) {
						const label = root.ownerDocument.createElement("label");
						label.htmlFor = radio.id;
						label.className = "praxity-ag-radio-label";
						label.textContent = getQuestionLabel(
							member.el,
							index,
							labels.assessmentGroupQuestionFallback,
						);
						const row = root.ownerDocument.createElement("div");
						row.className = "praxity-ag-radio-row";
						row.append(radio, label);
						options.append(row);
					}
					if (readOnly) return;
					const onChange = () => {
						const current = selfCheckEpochTicket(root.ownerDocument);
						setSelected(member.id);
						writeAssessmentGroupState(group, member.id, false, current);
					};
					radio.addEventListener("change", onChange);
					cleanup.push(() => radio.removeEventListener("change", onChange));
				});
				if (selectedId) setSelected(selectedId);

				if (!existingPicker && header) {
					header.append(picker);
				} else if (!existingPicker) {
					if (layoutClass) picker.classList.add(layoutClass);
					const firstWrapper =
						members[0]?.el.closest<HTMLElement>(".praxity-block") ?? members[0]?.el;
					firstWrapper?.parentElement?.insertBefore(picker, firstWrapper);
				}
				if (existingPicker)
					cleanup.push(() =>
						picker.querySelectorAll<HTMLInputElement>("input").forEach((radio) => {
							radio.disabled = true;
						}),
					);
				else cleanup.push(() => picker.remove());
				if (readOnly) continue;

				const onSubmit = () => {
					const current = selfCheckEpochTicket(root.ownerDocument);
					if (!current() || disposed) return;
					if (!selectedId) return;
					const member = members.find((candidate) => candidate.id === selectedId);
					if (!member) return;
					picker.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
						input.disabled = true;
					});
					clickHiddenSubmit(member.el, current, group.showResultsSummary);
					if (!current()) return;
					setSelfCheckTimeout(
						() => {
							// A committed native action survives a React rerender within the same lifetime.
							if (!current()) return;
							if (!root.isConnected || !root.contains(member.el)) return;
							if (
								showResults(group, [member], root, labels, true, undefined, undefined, current) &&
								current()
							) {
								writeAssessmentGroupState(group, selectedId, true, current);
							}
						},
						100,
						current,
					);
				};
				submitButton.addEventListener("click", onSubmit);
				cleanup.push(() => submitButton.removeEventListener("click", onSubmit));
				if (restored?.completed && restoredSelectedId) {
					picker.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
						input.disabled = true;
					});
					const member = members.find((candidate) => candidate.id === selectedId);
					if (member && !showResults(group, [member], root, labels, false)) {
						picker.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
							input.disabled = false;
						});
						writeAssessmentGroupState(group, selectedId, false, activation);
					}
				} else if (restored?.completed) {
					writeAssessmentGroupState(group, selectedId, false, activation);
				}
				continue;
			}

			if (readOnly) continue;
			let clearMemberValidation: (() => void) | undefined;
			cleanup.push(() => clearMemberValidation?.());
			const onSubmit = () => {
				const current = selfCheckEpochTicket(root.ownerDocument);
				if (!current() || disposed) return;
				status.textContent = "";
				clearMemberValidation?.();
				clearMemberValidation = undefined;
				const unanswered = members.filter((member) => {
					const result = getCommittedResult(member.el);
					const hasSelected = result.getAttribute("data-assessment-answered") === "true";
					const hasCompleted = result.getAttribute("data-completed") === "true";
					return !hasSelected && !hasCompleted;
				});
				if (group.requireAll) {
					if (unanswered.length > 0) {
						submitContainer.querySelector(".praxity-ag-required-error")?.remove();
						const error = root.ownerDocument.createElement("p");
						error.id = requiredMessageId;
						error.className = "praxity-ag-required-error";
						error.setAttribute("role", "alert");
						error.textContent = labels.assessmentGroupRequiredError;
						submitContainer.prepend(error);
						unanswered.forEach((member) => {
							member.el.classList.add("praxity-required-ring");
						});
						clearMemberValidation = focusRequiredMember(unanswered[0].el, requiredMessageId);
						return;
					}
				}

				submitContainer.querySelector(".praxity-ag-required-error")?.remove();
				// Incomplete groups have no summary yet; their submitted member keeps focus.
				const focusGroupResults =
					group.showResultsSummary && unanswered.every((member) => !requiredIds.has(member.id));
				for (const member of members) {
					if (!current()) return;
					member.el.classList.remove("praxity-required-ring");
					member.el.removeAttribute("aria-invalid");
					if (
						scoreRequiredIds.has(member.id) ||
						getCommittedResult(member.el).getAttribute("data-assessment-answered") !== "false"
					)
						clickHiddenSubmit(member.el, current, focusGroupResults);
				}
				if (!current()) return;
				setSelfCheckTimeout(
					() => {
						if (!current()) return;
						if (!root.isConnected || members.some((member) => !root.contains(member.el))) return;
						if (
							showResults(
								group,
								members,
								root,
								labels,
								true,
								requiredIds,
								scoreRequiredIds,
								current,
							)
						) {
							writeAssessmentGroupState(group, null, true, current);
						} else if (
							current() &&
							!group.isGraded &&
							members.some(
								(member) => getCommittedResult(member.el).getAttribute("data-completed") === "true",
							)
						) {
							writeAssessmentGroupState(group, null, false, current);
							if (!current()) return;
							learnerRuntime(current)?.commit?.();
							if (current() && !results.querySelector(".praxity-ag-results-score")) {
								results.textContent = labels.assessmentGroupSaved;
								status.textContent = labels.assessmentGroupSaved;
							}
						}
					},
					100,
					current,
				);
			};
			submitButton.addEventListener("click", onSubmit);
			cleanup.push(() => submitButton.removeEventListener("click", onSubmit));
			if (
				restored?.completed &&
				!showResults(group, members, root, labels, false, requiredIds, scoreRequiredIds)
			) {
				writeAssessmentGroupState(group, null, false, activation);
			}
		}
	}, activation);

	return () => {
		disposed = true;
		window.cancelAnimationFrame(frame);
		cleanup.forEach((restore) => restore());
	};
}
