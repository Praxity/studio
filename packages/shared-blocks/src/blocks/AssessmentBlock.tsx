"use client";

import {
	ActionIcon,
	Button,
	Card,
	Checkbox,
	Group,
	MantineThemeProvider,
	Paper,
	Radio,
	Select,
	Stack,
	Table,
	Text,
	Textarea,
	TextInput,
	VisuallyHidden,
} from "@mantine/core";
import {
	assessmentStatePolicy,
	decodeEscapes,
	escapeLength,
	fillBlankChoices,
	fillBlankParts,
	resolveAssessmentDontKnow,
	validFillBlankSelections,
} from "@praxity/content-model";
import { IconCheck, IconQuestionMark, IconX } from "@tabler/icons-react";
import {
	blocksToText,
	optionFeedbackHtml,
	optionLabelHtml,
	prepareAssessmentContent,
	prepareAssessmentDescriptionHtml,
	prepareAssessmentOptionHtml,
} from "../assessment-content";
import { reportLearnerBlockResponse } from "../learner-block-response";
import { dispatchSelfCheckEvent, selfCheckEpochTicket } from "../self-check-consumers";
import { preservePrintFocus } from "../viewer/print-focus-return";
import "./shared-blocks.css";
import {
	type ChangeEvent,
	type CSSProperties,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	assessmentShuffle,
	choiceAnswerResult,
	choiceContentSignature,
	choiceInteractionReport,
	choiceStateQuestion,
	DONT_KNOW,
} from "../assessment-choice";
import {
	prepareChoiceAssessmentState,
	restoreChoiceAssessmentState,
} from "../choice-learner-state";
import type { ChoiceAssessmentFacts } from "../choice-state-facts";
import { RequiredIndicator } from "../components";
import { hotspotGeometry } from "../hotspot-geometry";
import { assessmentAttemptsLabel, assessmentPointsLabel } from "../i18n/assessment-labels";
import { useLocale } from "../i18n/locale-context";
import { getChoiceRecoveryStrings, interpolate } from "../i18n/strings";
import { useStrings } from "../i18n/use-strings";
import { inlineMarkdown } from "../inline-markdown";
import { isJournal, journalSavedDate, readJournalSavedAt } from "../journal";
import {
	readLearnerBlockSaveResult,
	readLearnerBlockState,
	writeLearnerBlockState,
} from "../learner-block-state";
import {
	choiceEvidenceSignature,
	type LearnerStateValue,
	type SavedAssessmentState,
} from "../learner-state";
import { processMathSpans } from "../math/process-math-spans";
import { htmlToPlainText, sanitizeHtml } from "../sanitize";
import { SceneHeader } from "../scene-header";
import type {
	AssessmentBlockData,
	BlockProps,
	CategorizeResponse,
	ChoiceResponse,
	FileUploadResponse,
	FillBlankResponse,
	HotspotResponse,
	MatchingResponse,
	MatrixResponse,
	SequenceResponse,
	TextResponseConfig,
} from "../types";
import { scrollElementIntoView } from "../viewer/scroll-into-view";
import { ContainerContext } from "./container-context";
import { InlineContent } from "./InlineContent";

/**
 * Validates text-response input before submission.
 * Exported for unit testing.
 */
export function isTextResponseValid(
	value: string,
	inputType: "short" | "long" | "numeric",
	options?: { maxLength?: number; numericRange?: { min: number; max: number } },
): boolean {
	const trimmed = value.trim();
	if (inputType === "numeric") {
		if (trimmed === "") return false;
		const num = Number(trimmed);
		if (!Number.isFinite(num)) return false;
		if (options?.numericRange) {
			if (num < options.numericRange.min || num > options.numericRange.max) return false;
		}
		return true;
	}
	if (trimmed === "") return false;
	if (options?.maxLength != null && trimmed.length > options.maxLength) return false;
	return true;
}

function normalizeFillBlankAnswer(value: unknown): string {
	return typeof value === "string"
		? value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase()
		: "";
}

function fillBlankExpectedAnswers(blank: FillBlankResponse["blanks"][number]): string[] {
	return [blank.answer, ...(Array.isArray(blank.alternatives) ? blank.alternatives : [])]
		.map(normalizeFillBlankAnswer)
		.filter(Boolean);
}

export function isFillBlankAnswerCorrect(
	value: unknown,
	blank: FillBlankResponse["blanks"][number],
	style?: FillBlankResponse["style"],
): boolean {
	if (style === "dropdown" || style === "word-bank")
		return (
			typeof value === "string" &&
			value !== "" &&
			[blank.answer, ...(Array.isArray(blank.alternatives) ? blank.alternatives : [])].includes(
				value,
			)
		);
	const normalized = normalizeFillBlankAnswer(value);
	const answerSources =
		Array.isArray(blank.answerSources) &&
		blank.answerSources.every((source) => typeof source === "string")
			? blank.answerSources
			: undefined;
	const hasSources = answerSources !== undefined;
	const expectedAnswers = answerSources
		? answerSources.map(normalizeFillBlankAnswer).filter(Boolean)
		: fillBlankExpectedAnswers(blank);
	return (
		normalized !== "" &&
		expectedAnswers.some((expected) => {
			if (!expected.startsWith("~"))
				return (hasSources ? decodeEscapes(expected) : expected) === normalized;
			// ponytail: O(pattern × answer) matching avoids regex backtracking; cap input sizes if long-form blanks are added.
			const characters = Array.from(normalized);
			let matches = [true, ...characters.map(() => false)];
			const tokens = Array.from(expected.slice(1));
			for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
				let token = tokens[tokenIndex];
				const escaped = hasSources && escapeLength(token + (tokens[tokenIndex + 1] ?? ""), 0) > 0;
				if (escaped) token = tokens[++tokenIndex];
				const previous = matches;
				matches = [!escaped && token === "*" && previous[0]];
				for (let i = 0; i < characters.length; i++) {
					matches.push(
						!escaped && token === "*"
							? matches[i] || previous[i + 1]
							: previous[i] && ((!escaped && token === "?") || token === characters[i]),
					);
				}
			}
			return matches[characters.length];
		})
	);
}

/**
 * Mantine's `Input` builds its own aria attributes and spreads them *after*
 * `...rest`, so an `aria-describedby` passed as a prop is silently replaced by
 * `undefined` (@mantine/core 9.0.0, components/Input/Input.mjs). Native
 * elements like `<fieldset>` take the prop fine; Mantine-rendered controls need
 * the attribute set on the node. Returns one stable callback ref, so it also
 * works for the controls we render inside a `.map()`.
 */
function useDescribedByRef(describedBy: string | undefined) {
	return useCallback(
		(node: HTMLElement | null) => {
			if (!node) return;
			if (describedBy) {
				node.setAttribute("aria-describedby", describedBy);
			} else {
				node.removeAttribute("aria-describedby");
			}
		},
		[describedBy],
	);
}

/** Join optional ids into an aria-describedby value, dropping the empty ones. */
function joinIds(...ids: Array<string | undefined>): string | undefined {
	const present = ids.filter((id): id is string => Boolean(id));
	return present.length > 0 ? present.join(" ") : undefined;
}

function assessmentElementId(blockId: string, kind: string, index: number): string {
	const scope = blockId.replace(
		/[^A-Za-z0-9-]/gu,
		(character) => `_${character.codePointAt(0)?.toString(16)}_`,
	);
	return `rs-${kind}-${scope}-${index}`;
}

function shuffleArray<T>(arr: T[]): T[] {
	const shuffled = [...arr];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown, validKeys: Set<string>): value is Record<string, string> {
	return (
		isRecord(value) &&
		Object.entries(value).every(([key, item]) => validKeys.has(key) && typeof item === "string")
	);
}

interface CategorizeItem {
	key: string;
	nodeId?: string;
	index: number;
	text: string;
	correctCategoryId: string;
}

function categorizeItems(categories: CategorizeResponse["categories"]): CategorizeItem[] {
	const occurrences = new Map<string, number>();
	let index = 0;
	return categories.flatMap((category) =>
		category.items.map((text, itemIndex) => {
			const occurrence = occurrences.get(text) ?? 0;
			occurrences.set(text, occurrence + 1);
			return {
				key: JSON.stringify([text, occurrence]),
				nodeId: (category as { itemIds?: string[] }).itemIds?.[itemIndex],
				index: index++,
				text,
				correctCategoryId: category.id,
			};
		}),
	);
}

// Surveys without an answer key have no correctness verdict. Keyed matrices
// compare sets, including multiple selections, without changing SCORM grading.
function matrixRowCorrect(
	statement: MatrixResponse["statements"][number],
	selected: number[] = [],
): boolean | null {
	if (!statement.correctValues?.length) return null;
	const expected = new Set(statement.correctValues);
	const actual = new Set(selected);
	return expected.size === actual.size && [...expected].every((value) => actual.has(value));
}

function AssessmentRowResult({ correct, category }: { correct: boolean; category?: string }) {
	const s = useStrings(useLocale());
	return (
		<span data-content-reveal="open">
			<span className="praxity-reveal-clip">
				<span
					className="praxity-assessment-result"
					data-result={correct ? "correct" : "incorrect"}
					data-row-result={correct ? "correct" : "incorrect"}
				>
					{correct ? (
						<IconCheck size={16} aria-hidden="true" />
					) : (
						<IconX size={16} aria-hidden="true" />
					)}
					{correct ? s.correct : interpolate(s.rowShouldBe, { category: category ?? "" })}
				</span>
			</span>
		</span>
	);
}

function restoreAssessmentState(
	blockId: string,
	assessmentType: string,
	response: AssessmentBlockData["response"],
	dontKnow: boolean,
): SavedAssessmentState | null {
	const value = readLearnerBlockState(blockId);
	if (
		!isRecord(value) ||
		value.version !== 1 ||
		value.kind !== "assessment" ||
		value.assessmentType !== assessmentType ||
		!Number.isSafeInteger(value.attemptCount) ||
		(value.attemptCount as number) < 0 ||
		typeof value.checked !== "boolean" ||
		typeof value.correct !== "boolean" ||
		typeof value.completed !== "boolean" ||
		typeof value.interacted !== "boolean"
	) {
		return null;
	}

	const answer = value.answer;
	switch (assessmentType) {
		case "choice": {
			const choice = response as ChoiceResponse | undefined;
			const validIds = new Set(choice?.options?.map(({ id }) => id));
			if (dontKnow) validIds.add(DONT_KNOW);
			if (
				(value.reviewedChoiceIds !== undefined &&
					(!Array.isArray(value.reviewedChoiceIds) ||
						!value.reviewedChoiceIds.every((id) => typeof id === "string" && validIds.has(id)))) ||
				!Array.isArray(answer) ||
				!answer.every((id) => typeof id === "string" && validIds.has(id)) ||
				new Set(answer).size !== answer.length ||
				(choice?.selectionMode !== "multiple" && answer.length > 1)
			) {
				return null;
			}
			break;
		}
		case "hotspot": {
			const hotspotResponse = response as HotspotResponse | undefined;
			const validIds = new Set(
				(
					hotspotResponse?.hotspots ??
					(hotspotResponse as unknown as { regions?: HotspotResponse["hotspots"] })?.regions ??
					[]
				).map(({ id }) => id),
			);
			if (
				!Array.isArray(answer) ||
				!answer.every((id) => typeof id === "string" && validIds.has(id)) ||
				new Set(answer).size !== answer.length ||
				((hotspotResponse?.selectionMode ?? "single") === "single" && answer.length > 1)
			) {
				return null;
			}
			break;
		}
		case "matching": {
			const matching = response as MatchingResponse | undefined;
			const pairs = matching?.pairs ?? [];
			const validKeys = new Set(pairs.map(({ id }) => id));
			const validValues = new Set([
				...pairs.map(({ correctMatch }) => correctMatch),
				...(matching?.distractors ?? []),
			]);
			if (
				!isStringRecord(answer, validKeys) ||
				!Object.values(answer).every((item) => validValues.has(item)) ||
				(value.checked && Object.keys(answer).length !== validKeys.size)
			) {
				return null;
			}
			break;
		}
		case "sequence": {
			const itemIds = (response as SequenceResponse | undefined)?.items?.map(({ id }) => id) ?? [];
			if (
				!Array.isArray(answer) ||
				answer.length !== itemIds.length ||
				!answer.every((id) => typeof id === "string" && itemIds.includes(id)) ||
				new Set(answer).size !== answer.length
			) {
				return null;
			}
			break;
		}
		case "categorize": {
			const categories = (response as CategorizeResponse | undefined)?.categories ?? [];
			const validKeys = new Set(categorizeItems(categories).map(({ key }) => key));
			const validValues = new Set(categories.map(({ id }) => id));
			if (
				!isStringRecord(answer, validKeys) ||
				!Object.values(answer).every((item) => validValues.has(item)) ||
				(value.checked && Object.keys(answer).length !== validKeys.size)
			) {
				return null;
			}
			break;
		}
		case "fillBlank": {
			const config = response as FillBlankResponse | undefined;
			if (!config || !validFillBlankSelections(config, {})) return null;
			const validKeys = new Set(config.blanks.map(({ id }) => id));
			if (
				!isStringRecord(answer, validKeys) ||
				!validFillBlankSelections(response as FillBlankResponse, answer) ||
				(value.checked &&
					(Object.keys(answer).length !== validKeys.size ||
						Object.values(answer).some((item) => !item.trim())))
			) {
				return null;
			}
			break;
		}
		case "textResponse": {
			const config = response as TextResponseConfig | undefined;
			if (
				typeof answer !== "string" ||
				(config?.maxLength !== undefined && answer.length > config.maxLength)
			) {
				return null;
			}
			break;
		}
		case "matrix":
		case "likert": {
			const matrix = response as MatrixResponse | undefined;
			const validKeys = new Set((matrix?.statements ?? []).map(({ id }) => id));
			const validValues = new Set((matrix?.scalePoints ?? []).map(({ value: item }) => item));
			const entries = isRecord(answer) ? Object.entries(answer) : [];
			if (
				!isRecord(answer) ||
				validKeys.size === 0 ||
				(value.checked && entries.length !== validKeys.size) ||
				!entries.every(
					([key, values]) =>
						validKeys.has(key) &&
						Array.isArray(values) &&
						(!value.checked || values.length > 0) &&
						values.every((item) => typeof item === "number" && validValues.has(item)) &&
						new Set(values).size === values.length &&
						(matrix?.selectionMode === "multiple" || values.length === 1),
				)
			) {
				return null;
			}
			break;
		}
		case "fileUpload":
			if (answer !== null) return null;
			break;
		default:
			return null;
	}

	return value as unknown as SavedAssessmentState;
}

function isSavedAnswerCorrect(
	assessmentType: string,
	response: AssessmentBlockData["response"],
	answer: LearnerStateValue,
): boolean {
	switch (assessmentType) {
		case "choice": {
			const choice = response as ChoiceResponse;
			return choiceAnswerResult(choice, answer as string[]) === "correct";
		}
		case "hotspot": {
			const hotspot = response as HotspotResponse;
			const regions =
				hotspot.hotspots ??
				(hotspot as unknown as { regions?: HotspotResponse["hotspots"] }).regions ??
				[];
			const selected = new Set(answer as string[]);
			const correct = new Set(regions.filter((item) => item.isCorrect).map(({ id }) => id));
			return (
				selected.size > 0 &&
				selected.size === correct.size &&
				[...selected].every((id) => correct.has(id))
			);
		}
		case "matching": {
			const pairs = (response as MatchingResponse).pairs;
			return (
				pairs.length > 0 &&
				pairs.every((pair) => (answer as Record<string, string>)[pair.id] === pair.correctMatch)
			);
		}
		case "sequence": {
			const items = (response as SequenceResponse).items;
			if (items.length === 0) return false;
			const byId = new Map(items.map((item) => [item.id, item]));
			return (answer as string[]).every((id, index) => byId.get(id)?.correctPosition === index);
		}
		case "categorize": {
			const categories = (response as CategorizeResponse).categories;
			const items = categorizeItems(categories);
			return (
				items.length > 0 &&
				items.every(
					(item) => (answer as Record<string, string>)[item.key] === item.correctCategoryId,
				)
			);
		}
		case "fillBlank": {
			const known = (response as FillBlankResponse).blanks.filter(
				(blank) => fillBlankExpectedAnswers(blank).length > 0,
			);
			return (
				validFillBlankSelections(response as FillBlankResponse, answer as Record<string, string>) &&
				known.every((blank) =>
					isFillBlankAnswerCorrect(
						(answer as Record<string, string>)[blank.id],
						blank,
						(response as FillBlankResponse).style,
					),
				)
			);
		}
		default:
			return false;
	}
}

/** Resolve and render an option label from string or ProseMirror content. */
function resolveOptionLabel(option: Record<string, unknown>) {
	return (
		<span
			// biome-ignore lint/security/noDangerouslySetInnerHtml: inline markup is sanitized via sanitizeHtml
			dangerouslySetInnerHTML={{
				__html: prepareAssessmentOptionHtml(option),
			}}
		/>
	);
}

function ChoicePreview({
	response,
	dontKnow,
	onSelect,
	shuffle,
	selectedValue,
	selectedValues,
	disabled,
	revealAnswers,
	reviewedIds,
	showVerdict,
	showAuthoredFeedback,
	data,
	stemText,
	feedbackDescribedBy,
	describedBy,
	required,
}: {
	response: ChoiceResponse;
	dontKnow: boolean;
	onSelect: (optionId: string) => void;
	shuffle?: boolean;
	selectedValue?: string;
	selectedValues?: Set<string>;
	disabled?: boolean;
	revealAnswers?: boolean;
	reviewedIds: Set<string>;
	showVerdict: boolean;
	showAuthoredFeedback: boolean;
	data: AssessmentBlockData;
	stemText?: string;
	feedbackDescribedBy?: string;
	describedBy?: string;
	required?: boolean;
}) {
	const locale = useLocale();
	const s = useStrings(locale);
	const rawOptions = response.options ?? [];
	const isSingle = response.selectionMode === "single";
	const selected = selectedValue ?? null;
	const radioGroupName = useRef(`rs-choice-${Math.random().toString(36).slice(2, 8)}`).current;

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional — shuffle once per mount, option IDs are stable
	const authoredOptions = useMemo(
		() => (shuffle ? shuffleArray(rawOptions) : rawOptions),
		[shuffle, rawOptions.map((o) => o.id).join(",")],
	);
	const options: ChoiceResponse["options"] = dontKnow
		? [...authoredOptions, { id: DONT_KNOW, label: s.dontKnow, isCorrect: false }]
		: authoredOptions;
	return (
		// biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-required is set only with the radiogroup role
		<fieldset
			role={isSingle ? "radiogroup" : undefined}
			aria-required={isSingle && required ? true : undefined}
			aria-describedby={joinIds(describedBy, feedbackDescribedBy)}
			className="praxity-fieldset-reset praxity-assessment-choice"
		>
			<legend className="praxity-sr-only">
				{stemText
					? `${stemText}. ${isSingle ? s.selectAnAnswer : s.selectAllThatApply}`
					: isSingle
						? s.selectAnAnswer
						: s.selectAllThatApply}
				{required ? ` ${s.required}` : ""}
			</legend>
			<div className="praxity-assessment-choice-options">
				{options.map((option) => {
					const unknown = option.id === DONT_KNOW;
					const MarkIcon = unknown ? IconQuestionMark : option.isCorrect ? IconCheck : IconX;
					const marked =
						showVerdict && (reviewedIds.has(option.id) || (revealAnswers && option.isCorrect));
					const feedback = showAuthoredFeedback && reviewedIds.has(option.id) && option.feedback;
					const optionId = `${radioGroupName}-${option.id}`;
					return (
						<label
							key={option.id}
							data-node-id={option.id}
							data-dont-know={unknown ? "" : undefined}
							className="praxity-assessment-choice-option"
							data-correct-answer={revealAnswers ? String(option.isCorrect === true) : undefined}
							data-choice-result={
								marked
									? unknown
										? "unknown"
										: option.isCorrect
											? "correct"
											: "incorrect"
									: undefined
							}
						>
							<input
								type={isSingle ? "radio" : "checkbox"}
								value={option.id}
								name={radioGroupName}
								checked={
									isSingle ? selected === option.id : (selectedValues?.has(option.id) ?? false)
								}
								aria-labelledby={`${optionId}-label`}
								aria-describedby={joinIds(
									disabled && marked ? `${optionId}-feedback` : undefined,
									disabled && feedback ? `${optionId}-authored` : undefined,
								)}
								onChange={() => onSelect(option.id)}
								disabled={disabled}
							/>
							{isSingle && (
								<span
									className={unknown ? "praxity-choice-key-spacer" : "praxity-choice-key"}
									aria-hidden="true"
								/>
							)}
							<span className="praxity-choice-text">
								<span id={`${optionId}-label`} className="praxity-choice-label">
									{resolveOptionLabel(option as unknown as Record<string, unknown>)}
								</span>
								{marked && (
									<span data-content-reveal="open">
										<span className="praxity-reveal-clip">
											<span
												id={`${optionId}-feedback`}
												data-option-feedback
												className="praxity-choice-status"
												data-result={
													unknown ? "unknown" : option.isCorrect ? "correct" : "incorrect"
												}
											>
												<MarkIcon aria-hidden="true" />
												{unknown
													? s.dontKnowChosen
													: option.isCorrect
														? reviewedIds.has(option.id)
															? s.correct
															: s.correctAnswer
														: s.notQuite}
											</span>
											{feedback && (
												<span
													id={`${optionId}-authored`}
													className="praxity-choice-feedback"
													// biome-ignore lint/security/noDangerouslySetInnerHtml: authored feedback is sanitized
													dangerouslySetInnerHTML={{
														__html: processMathSpans(
															sanitizeHtml(optionFeedbackHtml(data, option)),
														),
													}}
												/>
											)}
										</span>
									</span>
								)}
							</span>
						</label>
					);
				})}
			</div>
		</fieldset>
	);
}

function MatchingPreview({
	blockId,
	response,
	shuffle,
	onInteract,
	stemText,
	selections,
	onSelectionsChange,
	describedBy,
	required,
	checked,
}: {
	blockId: string;
	response: MatchingResponse;
	shuffle?: boolean;
	onInteract?: () => void;
	stemText?: string;
	selections: Record<string, string | null>;
	onSelectionsChange: (selections: Record<string, string | null>) => void;
	describedBy?: string;
	required?: boolean;
	checked?: boolean;
}) {
	const locale = useLocale();
	const s = useStrings(locale);
	const rawPairs = Array.isArray(response.pairs)
		? response.pairs.filter((pair): pair is MatchingResponse["pairs"][number] =>
				Boolean(
					pair &&
						typeof pair === "object" &&
						typeof pair.id === "string" &&
						typeof pair.prompt === "string" &&
						typeof pair.correctMatch === "string",
				),
			)
		: [];
	const [openedPairId, setOpenedPairId] = useState<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional — shuffle once per mount
	const pairs = useMemo(() => {
		const indexedPairs = rawPairs.map((pair, index) => ({ pair, index }));
		return shuffle ? shuffleArray(indexedPairs) : indexedPairs;
	}, [shuffle, rawPairs.length]);

	// Build stable dropdown options from all matches + distractors.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional — shuffle once per mount
	const matchOptions = useMemo(() => {
		const options = rawPairs.map((p) => p.correctMatch).filter(Boolean);
		const distractors = Array.isArray(response.distractors)
			? response.distractors.filter((value): value is string => typeof value === "string")
			: [];
		const deduped = [...new Set([...options, ...distractors])];
		const ordered = shuffle ? shuffleArray(deduped) : deduped;
		return ordered;
	}, [shuffle, rawPairs.length, response.distractors?.length]);
	const placeholder =
		typeof response.placeholder === "string" && response.placeholder.trim()
			? response.placeholder
			: s.selectAMatch;

	return (
		<fieldset className="praxity-fieldset-reset" aria-describedby={describedBy}>
			<legend className="praxity-sr-only">{stemText || s.selectAMatch}</legend>
			<div className="praxity-matching-grid">
				{pairs.map(({ pair, index }) => {
					const selectId = assessmentElementId(blockId, "match", index);
					const optionsId = `${selectId}-options`;
					const result = checked ? selections[pair.id] === pair.correctMatch : null;
					const resultId = `${selectId}-result`;
					const opened = openedPairId === pair.id;
					return (
						<div key={pair.id} data-node-id={pair.id} className="praxity-matching-row">
							<Text id={`${selectId}-prompt`} className="praxity-matching-prompt">
								<InlineContent owner={pair} field="prompt" />
							</Text>
							<label htmlFor={selectId} className="praxity-sr-only">
								{interpolate(s.matchFor, { prompt: pair.prompt })}
							</label>
							<div
								className="praxity-matching-answer"
								data-result={result === null ? undefined : result ? "correct" : "incorrect"}
							>
								{/* Options ids must be props: Mantine overrides attributes.options.id. */}
								<div className="praxity-matching-control">
									{/* The input keeps its keyboard/ARIA behavior; this copy can wrap. */}
									<span className="praxity-matching-value" aria-hidden="true">
										{selections[pair.id] ?? placeholder}
									</span>
									<MantineThemeProvider
										theme={{ components: { ComboboxOptions: { defaultProps: { id: optionsId } } } }}
									>
										<Select
											id={selectId}
											data={matchOptions}
											placeholder={placeholder}
											aria-required={required || undefined}
											disabled={checked}
											value={selections[pair.id] ?? null}
											dropdownOpened={opened}
											onDropdownOpen={() => setOpenedPairId(pair.id)}
											onDropdownClose={() => setOpenedPairId(null)}
											onChange={(value) => {
												onSelectionsChange({
													...selections,
													[pair.id]: value,
												});
												onInteract?.();
											}}
											className="praxity-matching-select"
											classNames={{
												input: "praxity-assessment-select-input",
												dropdown: "praxity-assessment-select-dropdown",
												option: "praxity-assessment-select-option",
											}}
											attributes={{
												input: {
													"aria-controls": opened ? optionsId : undefined,
													"aria-describedby": joinIds(
														describedBy,
														result === null ? undefined : resultId,
													),
													"aria-expanded": opened,
												},
											}}
										/>
									</MantineThemeProvider>
								</div>
								{result !== null && (
									<span
										id={resultId}
										className="praxity-matching-result praxity-assessment-result"
										data-result={result ? "correct" : "incorrect"}
									>
										{result ? (
											<IconCheck aria-hidden="true" size={16} stroke={2} />
										) : (
											<IconX aria-hidden="true" size={16} stroke={2} />
										)}
										{result ? s.correct : s.incorrect}
									</span>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</fieldset>
	);
}

function SequencePreview({
	response,
	onInteract,
	items,
	onItemsChange,
	describedBy,
	stemText,
	disabled,
}: {
	response: SequenceResponse;
	onInteract?: () => void;
	items: SequenceResponse["items"];
	onItemsChange: (items: SequenceResponse["items"]) => void;
	describedBy?: string;
	stemText?: string;
	disabled?: boolean;
}) {
	const locale = useLocale();
	const s = useStrings(locale);
	const actionButtonSize = "var(--target-size)";
	// Announcing the move, not the score. This region used to read "N of M in
	// correct order" on every keystroke, which handed the learner the answer while
	// they were still working it out and fired on every single move.
	const [announcement, setAnnouncement] = useState("");
	const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
	const [dropIndex, setDropIndex] = useState<number | null>(null);
	const focusAfterMove = useRef<{
		button: HTMLButtonElement;
		controls: HTMLElement;
		id: string;
		position: number;
	} | null>(null);

	useLayoutEffect(() => {
		const pending = focusAfterMove.current;
		if (!pending || items[pending.position]?.id !== pending.id) return;
		(pending.button.isConnected
			? pending.button
			: pending.controls.querySelector<HTMLButtonElement>("button")
		)?.focus();
		focusAfterMove.current = null;
	}, [items]);

	const commit = (updated: SequenceResponse["items"], label: string, position: number) => {
		if (disabled) return;
		onItemsChange(updated);
		onInteract?.();
		setAnnouncement(
			interpolate(s.orderItemMoved, {
				label,
				position: position + 1,
				total: updated.length,
			}),
		);
	};

	const moveItem = (index: number, direction: "up" | "down", button: HTMLButtonElement) => {
		if (disabled) return;
		const newIndex = direction === "up" ? index - 1 : index + 1;
		if (newIndex < 0 || newIndex >= items.length) return;
		if (button.parentElement)
			focusAfterMove.current = {
				button,
				controls: button.parentElement,
				id: items[index].id,
				position: newIndex,
			};
		const updated = [...items];
		[updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
		commit(updated, items[index].label, newIndex);
	};

	/** Drag is the enhancement; the arrow buttons stay the single-pointer path WCAG 2.5.7 requires. */
	const dropItem = (from: number, to: number) => {
		// Dropping just below yourself lands you where you already were — no move, and
		// no announcement claiming one.
		const target = from < to ? to - 1 : to;
		if (target === from) return;
		const updated = [...items];
		const [moved] = updated.splice(from, 1);
		updated.splice(target, 0, moved);
		commit(updated, moved.label, target);
	};

	return (
		<Stack gap={0} role="group" aria-label={stemText || undefined} aria-describedby={describedBy}>
			<VisuallyHidden aria-live="polite">{announcement}</VisuallyHidden>
			{items.map((item, index) => (
				<Group
					key={item.id}
					gap="xs"
					wrap="nowrap"
					align="center"
					className="praxity-order-item"
					data-node-id={item.id}
					data-dragging={draggingIndex === index ? "" : undefined}
					data-drop-before={dropIndex === index ? "" : undefined}
					draggable={!disabled}
					aria-roledescription={s.orderSortableItem}
					onDragStart={(event) => {
						setDraggingIndex(index);
						event.dataTransfer.effectAllowed = "move";
						event.dataTransfer.setData("text/plain", String(index));
					}}
					onDragOver={(event) => {
						if (draggingIndex === null) return;
						event.preventDefault();
						event.dataTransfer.dropEffect = "move";
						const rect = event.currentTarget.getBoundingClientRect();
						const after = event.clientY > rect.top + rect.height / 2;
						setDropIndex(after ? index + 1 : index);
					}}
					onDrop={(event) => {
						event.preventDefault();
						if (draggingIndex !== null && dropIndex !== null) dropItem(draggingIndex, dropIndex);
						setDraggingIndex(null);
						setDropIndex(null);
					}}
					onDragEnd={() => {
						setDraggingIndex(null);
						setDropIndex(null);
					}}
				>
					<Text component="span" size="xs" className="praxity-order-position" aria-hidden="true">
						{index + 1}
					</Text>
					<Text size="sm" className="praxity-order-label">
						<InlineContent owner={item} field="label" />
						<VisuallyHidden>
							{` — ${interpolate(s.orderItemPosition, {
								position: index + 1,
								total: items.length,
							})}`}
						</VisuallyHidden>
					</Text>
					{/*
					 * Controls sit side by side after the label, not stacked before it.
					 * Stacked, two 34px buttons set the row height to ~86px for one line
					 * of text and pushed the ordinal, the arrows and the label onto three
					 * different optical baselines.
					 */}
					<Group gap={4} wrap="nowrap" className="praxity-order-controls">
						{index > 0 ? (
							<ActionIcon
								variant="subtle"
								size={actionButtonSize}
								onClick={(event) => moveItem(index, "up", event.currentTarget)}
								disabled={disabled}
								aria-label={interpolate(s.moveUp, { label: item.label })}
								style={{
									color: "var(--praxity-color-accent-text, var(--praxity-color-accent, #228be6))",
									"--ai-hover": "var(--praxity-color-background-alt, #f5f5f5)",
									"--ai-hover-color":
										"var(--praxity-color-accent-text, var(--praxity-color-accent, #228be6))",
								}}
							>
								&#8593;
							</ActionIcon>
						) : (
							<div style={{ width: actionButtonSize, height: actionButtonSize }} />
						)}
						{index < items.length - 1 ? (
							<ActionIcon
								variant="subtle"
								size={actionButtonSize}
								onClick={(event) => moveItem(index, "down", event.currentTarget)}
								disabled={disabled}
								aria-label={interpolate(s.moveDown, { label: item.label })}
								style={{
									color: "var(--praxity-color-accent-text, var(--praxity-color-accent, #228be6))",
									"--ai-hover": "var(--praxity-color-background-alt, #f5f5f5)",
									"--ai-hover-color":
										"var(--praxity-color-accent-text, var(--praxity-color-accent, #228be6))",
								}}
							>
								&#8595;
							</ActionIcon>
						) : (
							<div style={{ width: actionButtonSize, height: actionButtonSize }} />
						)}
					</Group>
				</Group>
			))}
		</Stack>
	);
}

function TextResponsePreview({
	response,
	onInteract,
	value,
	onValueChange,
	stemText,
	describedBy,
	required,
	savedAt,
}: {
	response: TextResponseConfig;
	onInteract?: () => void;
	value: string;
	onValueChange?: (val: string) => void;
	stemText?: string;
	describedBy?: string;
	required?: boolean;
	savedAt?: string | null;
}) {
	const locale = useLocale();
	const s = useStrings(locale);
	const savedDate = journalSavedDate(savedAt, document.documentElement.lang || locale);
	const inputType = response.inputType ?? "short";
	const maxLength = response.maxLength;
	const remaining = maxLength != null ? maxLength - value.length : null;
	// A placeholder is never a label — the accessible name still comes from the
	// stem, and an unset override falls back to the localized default.
	const defaultPlaceholder = inputType === "numeric" ? s.enterANumber : s.typeYourAnswer;
	const placeholder = response.placeholder || defaultPlaceholder;
	const describedByRef = useDescribedByRef(describedBy);
	const downloadFormats: Array<"txt" | "docx"> =
		response.downloadAs === "both"
			? ["txt", "docx"]
			: response.downloadAs
				? [response.downloadAs]
				: [];
	const downloadControls =
		downloadFormats.length > 0 ? (
			<Stack gap="xs" className="praxity-text-response-downloads">
				<Text component="span" size="sm" fw={600}>
					{s.downloadResponseAs}
				</Text>
				<Group gap="xs" role="group" aria-label={s.downloadResponseAs}>
					{downloadFormats.map((format) => (
						<Button
							key={format}
							type="button"
							variant="subtle"
							size="sm"
							aria-label={format === "txt" ? s.downloadTxt : s.downloadDocx}
							disabled={!value.trim()}
							onClick={() => {
								void import("../lib/text-response-download").then(({ downloadTextResponse }) =>
									downloadTextResponse(format, stemText || s.yourAnswer, value, savedDate),
								);
							}}
						>
							{format === "txt" ? s.downloadTxt : s.downloadDocx}
						</Button>
					))}
				</Group>
			</Stack>
		) : null;

	if (inputType === "long") {
		return (
			<Stack gap={4}>
				<Textarea
					ref={describedByRef}
					aria-label={stemText || s.yourAnswer}
					aria-required={required || undefined}
					placeholder={placeholder}
					autosize
					minRows={3}
					maxLength={maxLength}
					value={value}
					onChange={(e) => {
						onValueChange?.(e.currentTarget.value);
						onInteract?.();
					}}
				/>
				{remaining != null && (
					<span
						className={remaining < 0 ? "praxity-text-error" : "praxity-text-dimmed"}
						style={{ textAlign: "right", display: "block" }}
					>
						{remaining >= 0
							? `${remaining} characters remaining`
							: `${Math.abs(remaining)} characters over limit`}
					</span>
				)}
				{savedDate && (
					<p
						className="praxity-text-dimmed praxity-journal-date"
						data-journal-saved-date
						data-saved-at={savedAt}
					>
						{savedDate}
					</p>
				)}
				{downloadControls}
			</Stack>
		);
	}

	return (
		<Stack gap={4}>
			<TextInput
				ref={describedByRef}
				aria-label={stemText || s.yourAnswer}
				aria-required={required || undefined}
				placeholder={placeholder}
				type={inputType === "numeric" ? "number" : "text"}
				maxLength={inputType !== "numeric" ? maxLength : undefined}
				value={value}
				onChange={(e) => {
					onValueChange?.(e.currentTarget.value);
					onInteract?.();
				}}
			/>
			{remaining != null && inputType !== "numeric" && (
				<span
					className={remaining < 0 ? "praxity-text-error" : "praxity-text-dimmed"}
					style={{ textAlign: "right", display: "block" }}
				>
					{remaining >= 0
						? `${remaining} characters remaining`
						: `${Math.abs(remaining)} characters over limit`}
				</span>
			)}
			{downloadControls}
		</Stack>
	);
}

function FillBlankPreview({
	blockId,
	response,
	onInteract,
	values,
	onValuesChange,
	stemText,
	describedBy,
	required,
	checked,
}: {
	blockId: string;
	response: FillBlankResponse;
	onInteract?: () => void;
	values: Record<string, string>;
	onValuesChange?: (values: Record<string, string>) => void;
	stemText?: string;
	describedBy?: string;
	required?: boolean;
	checked?: boolean;
}) {
	const locale = useLocale();
	const s = useStrings(locale);
	const blanks = Array.isArray(response.blanks)
		? response.blanks.filter((blank): blank is FillBlankResponse["blanks"][number] =>
				Boolean(blank && typeof blank === "object" && typeof blank.id === "string"),
			)
		: [];
	if (blanks.length === 0) {
		return null;
	}

	const input = (
		blank: FillBlankResponse["blanks"][number],
		index: number,
		context = stemText || s.assessmentQuestion,
	) => {
		const expectedAnswers = fillBlankExpectedAnswers(blank);
		const result =
			checked && expectedAnswers.length > 0
				? isFillBlankAnswerCorrect(values[blank.id], blank, response.style)
				: null;
		const resultId = `${assessmentElementId(blockId, "blank", index)}-result`;
		const choices = fillBlankChoices(response, blank);
		const controlProps = {
			className: "praxity-fill-blank-input",
			"aria-label": interpolate(s.assessmentBlankLabel, {
				current: index + 1,
				total: blanks.length,
				context,
			}),
			"aria-describedby":
				[describedBy, result !== null ? resultId : undefined].filter(Boolean).join(" ") ||
				undefined,
			"aria-invalid": result === false || undefined,
			"aria-required": required || undefined,
			value: values[blank.id] ?? "",
			onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
				const next = { ...values, [blank.id]: event.currentTarget.value };
				if (!validFillBlankSelections(response, next)) return;
				onValuesChange?.(next);
				onInteract?.();
			},
		};
		return (
			<span key={blank.id} data-node-id={blank.id} className="praxity-fill-blank-response">
				{choices ? (
					<select {...controlProps} disabled={checked || undefined}>
						<option value="">{response.placeholder || s.selectAnAnswer}</option>
						{[...new Set(choices)].map((choice) => (
							<option
								key={choice}
								value={choice}
								disabled={!validFillBlankSelections(response, { ...values, [blank.id]: choice })}
							>
								{choice}
							</option>
						))}
					</select>
				) : (
					<input
						{...controlProps}
						type="text"
						placeholder={response.placeholder || undefined}
						readOnly={checked || undefined}
						size={Math.max(
							8,
							Math.min(32, typeof blank.answer === "string" ? blank.answer.length || 12 : 12),
						)}
					/>
				)}
				{result !== null && (
					<span
						id={resultId}
						className="praxity-fill-blank-status"
						data-result={result ? "correct" : "incorrect"}
					>
						{result ? s.correct : s.incorrect}
					</span>
				)}
			</span>
		);
	};

	if (response.template) {
		const parts = fillBlankParts(response.template);
		let blankIndex = 0;
		let precedingText = "";
		const contextualInput = (blank: FillBlankResponse["blanks"][number], index: number) => {
			const clause = precedingText
				.split(/[.!?;]\s*/)
				.at(-1)
				?.trim()
				.split(/\s+/)
				.slice(-10)
				.join(" ");
			return input(blank, index, clause || stemText || s.assessmentQuestion);
		};
		return (
			<div className="praxity-fill-blank-template">
				{response.style === "word-bank" && (
					<p className="praxity-word-bank">
						{interpolate(s.assessmentWordBank, {
							words: (fillBlankChoices(response, blanks[0]) ?? []).join(", "),
						})}
					</p>
				)}
				{parts.map((segment, partIndex) => {
					const part = decodeEscapes(segment.text);
					const isBlank = segment.blank;
					if (isBlank) {
						if (partIndex > 0 && !parts[partIndex - 1].blank) {
							return null;
						}
						const index = blankIndex++;
						const blank = blanks[index];
						return blank ? contextualInput(blank, index) : part;
					}

					precedingText += part;
					if (!parts[partIndex + 1]?.blank) return part;

					const index = blankIndex++;
					const blank = blanks[index];
					if (!blank) return part;
					const trailingWord = part.match(/^(.*?)(\S+\s*)$/s);
					if (!trailingWord)
						return <span key={`${blank.id}-segment`}>{contextualInput(blank, index)}</span>;
					return (
						<span key={`${blank.id}-segment`}>
							{trailingWord[1]}
							<span className="praxity-fill-blank-unit">
								{trailingWord[2]}
								{contextualInput(blank, index)}
							</span>
						</span>
					);
				})}
			</div>
		);
	}

	return <Stack gap="xs">{blanks.map((blank, index) => input(blank, index))}</Stack>;
}

function CategorizePreview({
	blockId,
	response,
	shuffle,
	onInteract,
	stemText,
	assignments,
	onAssignmentsChange,
	transformImageUrl,
	disabled,
	describedBy,
	required,
}: {
	blockId: string;
	response: CategorizeResponse;
	shuffle?: boolean;
	onInteract?: () => void;
	stemText?: string;
	assignments: Record<string, string | null>;
	onAssignmentsChange: (assignments: Record<string, string | null>) => void;
	transformImageUrl?: (url: string) => string;
	disabled?: boolean;
	describedBy?: string;
	required?: boolean;
}) {
	const locale = useLocale();
	const s = useStrings(locale);
	const categories = response.categories ?? [];

	if (categories.length === 0) {
		return null;
	}

	// Stable fingerprint for categories content — drives re-shuffle when items change.
	const categoriesKey = useMemo(
		() => JSON.stringify(categories.map(({ id, items }) => [id, items])),
		[categories],
	);

	// Pool all items from all categories into a flat list with stable keys.
	// biome-ignore lint/correctness/useExhaustiveDependencies: shuffle once per mount or content change
	const items: CategorizeItem[] = useMemo(() => {
		const flat = categorizeItems(categories);
		return shuffle ? shuffleArray(flat) : flat;
	}, [shuffle, categoriesKey]);

	return (
		<fieldset className="praxity-fieldset-reset praxity-categorize" aria-describedby={describedBy}>
			<legend className="praxity-sr-only">
				{stemText || s.selectACategory}
				{required ? ` ${s.required}` : ""}
			</legend>
			<div className="praxity-categorize-table-wrap">
				<Table withTableBorder className="praxity-categorize-table">
					<Table.Thead>
						<Table.Tr>
							<Table.Th scope="col" className="praxity-categorize-item-heading">
								<span className="praxity-sr-only">{s.categorizeItemsColumn}</span>
							</Table.Th>
							{categories.map((category) => (
								<Table.Th key={category.id} data-node-id={category.id} ta="center" scope="col">
									<div className="praxity-categorize-category-header">
										{category.image ? (
											<img
												src={transformImageUrl ? transformImageUrl(category.image) : category.image}
												alt={category.imageAlt ?? ""}
												className="praxity-categorize-category-image"
											/>
										) : null}
										<span>{category.name}</span>
									</div>
								</Table.Th>
							))}
						</Table.Tr>
					</Table.Thead>
					<Table.Tbody>
						{items.map((item) => (
							<Table.Tr key={item.key} data-node-id={item.nodeId}>
								<Table.Th scope="row" id={assessmentElementId(blockId, "cat", item.index)}>
									{item.text}
									{disabled && (
										<AssessmentRowResult
											correct={assignments[item.key] === item.correctCategoryId}
											category={
												categories.find((category) => category.id === item.correctCategoryId)?.name
											}
										/>
									)}
								</Table.Th>
								{categories.map((category) => (
									<Table.Td key={category.id} data-category={category.name}>
										<Group
											component="label"
											className="praxity-assessment-table-control"
											justify="center"
											align="center"
											h="100%"
										>
											<Radio
												aria-label={interpolate(s.categoryChoiceFor, {
													item: item.text,
													category: category.name,
												})}
												value={category.id}
												name={assessmentElementId(blockId, "cat", item.index)}
												checked={assignments[item.key] === category.id}
												disabled={disabled}
												onChange={() => {
													onAssignmentsChange({ ...assignments, [item.key]: category.id });
													onInteract?.();
												}}
											/>
										</Group>
									</Table.Td>
								))}
							</Table.Tr>
						))}
					</Table.Tbody>
				</Table>
			</div>
		</fieldset>
	);
}

function HotspotPreview({
	response,
	transformImageUrl,
	onInteract,
	selectedIds,
	onSelectionChange,
	onReset,
	disabled,
	describedBy,
	stemText,
}: {
	response: HotspotResponse;
	transformImageUrl?: (url: string) => string;
	onInteract?: () => void;
	selectedIds: Set<string>;
	onSelectionChange?: (ids: Set<string>) => void;
	onReset?: (resetFn: () => void) => void;
	disabled?: boolean;
	describedBy?: string;
	stemText?: string;
}) {
	const locale = useLocale();
	const s = useStrings(locale);
	const [labelId, setLabelId] = useState<string | null>(null);
	const isSingle = (response.selectionMode ?? "single") === "single";

	// Expose reset function to parent via ref callback (stable, no re-render churn)
	const onResetRef = useRef(onReset);
	onResetRef.current = onReset;
	useEffect(() => {
		onResetRef.current?.(() => {
			setLabelId(null);
		});
	}, []);
	if (!response.image) {
		return (
			<Text size="sm" c="dimmed">
				No image configured
			</Text>
		);
	}

	const hotspots =
		response.hotspots ??
		(response as unknown as { regions?: HotspotResponse["hotspots"] }).regions ??
		[];

	const toggleHotspot = (id: string) => {
		if (disabled) return;
		let nextIds: Set<string>;
		if (isSingle) {
			nextIds = selectedIds.has(id) ? new Set() : new Set([id]);
		} else {
			nextIds = new Set(selectedIds);
			if (nextIds.has(id)) {
				nextIds.delete(id);
			} else {
				nextIds.add(id);
			}
		}
		onSelectionChange?.(nextIds);
		// Toggle label: show on select, dismiss on deselect
		setLabelId((prev) => (prev === id ? null : id));
		onInteract?.();
	};

	const labelHotspot = labelId ? hotspots.find((h) => h.id === labelId) : null;

	return (
		<Stack
			gap="xs"
			align="flex-start"
			role="group"
			aria-label={
				stemText || (typeof response.imageAlt === "string" ? response.imageAlt : undefined)
			}
			aria-describedby={describedBy}
		>
			{/* biome-ignore lint/a11y/useSemanticElements: this names the image scroller inside the existing question group */}
			<div
				role="group"
				className="praxity-hotspot-scroll"
				aria-label={interpolate(s.hotspotSelectionPrompt, { total: hotspots.length })}
				// biome-ignore lint/a11y/noNoninteractiveTabindex: named image scroll region must be keyboard reachable
				tabIndex={0}
			>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: event delegation — Escape key bubbles from hotspot buttons */}
				<div
					className="praxity-hotspot-image"
					onKeyDown={(e) => {
						if (e.key === "Escape" && labelId) {
							e.preventDefault();
							setLabelId(null);
						}
					}}
					style={{
						position: "relative",
						display: "inline-block",
						maxWidth: "100%",
					}}
				>
					<img
						src={transformImageUrl ? transformImageUrl(response.image) : response.image}
						alt={response.imageAlt || "Hotspot assessment image"}
						style={{
							display: "block",
							maxWidth: "100%",
							borderRadius: 0,
						}}
					/>
					{hotspots.map((hotspot, i) => {
						const shape = hotspot.shape ?? "ellipse";
						const geometry = hotspotGeometry(shape, hotspot.coords);
						if (!geometry) return null;
						const indicatorType = hotspot.indicator?.type ?? "number";
						const content =
							indicatorType === "emoji"
								? (hotspot.indicator?.emoji ?? "📍")
								: indicatorType === "number"
									? String(i + 1)
									: "";

						return (
							<span
								key={hotspot.id}
								data-node-id={hotspot.id}
								className="praxity-hotspot-region"
								data-shape={shape}
								data-point={geometry.point ? "true" : undefined}
								style={{
									left: `${geometry.point ? geometry.left + geometry.width / 2 : geometry.left}%`,
									top: `${geometry.point ? geometry.top + geometry.height / 2 : geometry.top}%`,
									width: geometry.point ? "var(--target-size)" : `${geometry.width}%`,
									height: geometry.point ? "var(--target-size)" : `${geometry.height}%`,
									transform: geometry.point ? "translate(-50%, -50%)" : undefined,
								}}
							>
								<button
									type="button"
									aria-label={hotspot.label || interpolate(s.hotspotLabel, { index: i + 1 })}
									aria-pressed={selectedIds.has(hotspot.id)}
									aria-disabled={disabled}
									onClick={() => toggleHotspot(hotspot.id)}
									onMouseEnter={() => setLabelId(hotspot.id)}
									onMouseLeave={() => setLabelId(null)}
									onFocus={() => setLabelId(hotspot.id)}
									onBlur={() => setLabelId(null)}
									style={{
										borderRadius: "var(--radius-control)",
										clipPath: geometry.clipPath,
										fontSize:
											indicatorType === "emoji"
												? "var(--praxity-hotspot-font-size, 0.875em)"
												: "var(--praxity-hotspot-font-size, 0.75em)",
									}}
								></button>
								{/* Outside the clipped button so a concave polygon cannot hide the number or check. */}
								<span aria-hidden="true">
									{selectedIds.has(hotspot.id) ? `✓ ${content}` : content}
								</span>
							</span>
						);
					})}
					{/* Label tooltip — smart positioning to stay inside image */}
					{labelHotspot?.label &&
						(() => {
							const xPct = labelHotspot.coords[0];
							const yPct = labelHotspot.coords[1];
							const placeBelow = yPct < 15;
							const alignLeft = xPct > 85;
							const alignRight = xPct < 15;
							const hAlign = alignLeft ? "-90%" : alignRight ? "-10%" : "-50%";
							const vAlign = placeBelow ? "24px" : "calc(-100% - 24px)";
							return (
								// biome-ignore lint/a11y/noStaticElementInteractions: tooltip label — hover events are supplementary, hotspot buttons provide keyboard access
								<div
									onMouseEnter={() => setLabelId(labelHotspot.id)}
									onMouseLeave={() => setLabelId(null)}
									style={{
										position: "absolute",
										left: `${xPct}%`,
										top: `${yPct}%`,
										transform: `translate(${hAlign}, ${vAlign})`,
										background: "color-mix(in oklab, var(--praxity-color-text) 85%, transparent)",
										color: "var(--praxity-color-text-inverted)",
										fontSize: "var(--praxity-hotspot-label-font-size, 0.75em)",
										fontWeight: "var(--weight-strong)",
										padding: "4px 8px",
										borderRadius: "var(--praxity-radius-action, var(--praxity-border-radius, 4px))",
										whiteSpace: "nowrap",
										maxWidth: 200,
										overflow: "hidden",
										textOverflow: "ellipsis",
										zIndex: 10,
									}}
								>
									{labelHotspot.label}
								</div>
							);
						})()}
				</div>
			</div>
			<Text className="praxity-hotspot-caption" size="xs" c="dimmed">
				{selectedIds.size > 0
					? interpolate(s.hotspotSelectionCount, {
							selected: selectedIds.size,
							total: hotspots.length,
						})
					: interpolate(s.hotspotSelectionPrompt, { total: hotspots.length })}
			</Text>
		</Stack>
	);
}

function MatrixPreview({
	response,
	labelledBy,
	shuffle,
	onInteract,
	selections,
	onSelectionsChange,
	disabled,
}: {
	response: MatrixResponse;
	labelledBy: string;
	shuffle?: boolean;
	onInteract?: () => void;
	selections: Record<string, number[]>;
	onSelectionsChange: (selections: Record<string, number[]>) => void;
	disabled?: boolean;
}) {
	const rawStatements = response.statements ?? [];
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional — shuffle once per mount
	const statements = useMemo(
		() => (shuffle ? shuffleArray(rawStatements) : rawStatements),
		[shuffle, rawStatements.length],
	);
	const scalePoints = response.scalePoints ?? [];
	const isMultiple = response.selectionMode === "multiple";
	const radioGroupScope = useRef(`rs-matrix-${Math.random().toString(36).slice(2, 8)}`).current;
	const controlLabel = (statement: string, point: string) => `${statement}: ${point}`;

	if (statements.length === 0 || scalePoints.length === 0) {
		return (
			<Text size="sm" c="dimmed">
				No statements or scale points configured
			</Text>
		);
	}

	return (
		<div className="praxity-matrix-table-wrap">
			<Table
				aria-labelledby={labelledBy}
				withTableBorder
				className="praxity-matrix-table"
				style={
					{
						"--praxity-matrix-min-width": `${14 + scalePoints.length * 7.5}rem`,
					} as CSSProperties
				}
			>
				<colgroup>
					<col className="praxity-matrix-statement-column" />
					{scalePoints.map((point) => (
						<col key={point.value} />
					))}
				</colgroup>
				<Table.Thead>
					<Table.Tr>
						<Table.Th scope="col" />
						{scalePoints.map((point) => (
							<Table.Th key={point.value} data-node-id={point.id} ta="center" scope="col">
								{point.label}
							</Table.Th>
						))}
					</Table.Tr>
				</Table.Thead>
				<Table.Tbody>
					{statements.map((statement) => (
						<Table.Tr key={statement.id} data-node-id={statement.id}>
							<Table.Th scope="row">
								{statement.text}
								{disabled && matrixRowCorrect(statement, selections[statement.id]) !== null && (
									<AssessmentRowResult
										correct={matrixRowCorrect(statement, selections[statement.id]) === true}
										category={scalePoints
											.filter((point) => statement.correctValues?.includes(point.value))
											.map((point) => point.label)
											.join(", ")}
									/>
								)}
							</Table.Th>
							{scalePoints.map((point) => (
								<Table.Td key={point.value} data-category={point.label}>
									<Group
										component="label"
										className="praxity-assessment-table-control"
										justify="center"
										align="center"
										h="100%"
									>
										{isMultiple ? (
											<Checkbox
												aria-label={controlLabel(statement.text, point.label)}
												disabled={disabled}
												checked={selections[statement.id]?.includes(point.value) ?? false}
												onChange={(event) => {
													const current = new Set(selections[statement.id] ?? []);
													if (event.currentTarget.checked) current.add(point.value);
													else current.delete(point.value);
													onSelectionsChange({
														...selections,
														[statement.id]: [...current],
													});
													onInteract?.();
												}}
											/>
										) : (
											<Radio
												aria-label={controlLabel(statement.text, point.label)}
												disabled={disabled}
												value={String(point.value)}
												name={`${radioGroupScope}-${statement.id}`}
												checked={selections[statement.id]?.[0] === point.value}
												onChange={() => {
													onSelectionsChange({
														...selections,
														[statement.id]: [point.value],
													});
													onInteract?.();
												}}
											/>
										)}
									</Group>
								</Table.Td>
							))}
						</Table.Tr>
					))}
				</Table.Tbody>
			</Table>
		</div>
	);
}

function FileUploadPreview({ response }: { response: FileUploadResponse }) {
	return (
		<Stack
			gap="xs"
			align="center"
			justify="center"
			p="xl"
			style={{
				border: "2px dashed var(--praxity-color-border)",
				borderRadius:
					"var(--praxity-radius-container, var(--praxity-border-radius, var(--mantine-radius-md)))",
			}}
		>
			<Text size="xl" c="dimmed">
				&#8593;
			</Text>
			<Text size="sm" c="dimmed">
				Drop files here or click to upload
			</Text>
			{response.instructions && (
				<Text size="xs" c="dimmed">
					{response.instructions}
				</Text>
			)}
			<Text size="xs" c="dimmed">
				Accepted: {(response.acceptedTypes ?? []).join(", ") || "any"} | Max size:{" "}
				{response.maxFileSize ?? 10}MB | Max files: {response.maxFiles ?? 1}
			</Text>
		</Stack>
	);
}

export function PreviewAssessmentBlock({
	data,
	blockId,
	transformImageUrl,
	groupedDownloadSubmit = false,
	reportTitle,
	choiceResponseLimit,
	compiledChoiceFacts,
	passGate = false,
}: BlockProps<AssessmentBlockData> & {
	transformImageUrl?: (url: string) => string;
	groupedDownloadSubmit?: boolean;
	/** Plain group or page title supplied by the publisher. */
	reportTitle?: string;
	/** Total reporting budget for runtimes with a bounded serialized choice response. */
	choiceResponseLimit?: number;
	/** Published facts are computed once; recovery requires the optional evidence capability. */
	compiledChoiceFacts?: ChoiceAssessmentFacts;
	passGate?: boolean;
}) {
	const [mountCurrent] = useState(() => selfCheckEpochTicket());
	const writeCurrent = useRef(mountCurrent);
	const locale = useLocale();
	const s = useStrings(locale);
	const assessmentType = data.assessmentType ?? "choice";
	const recoveryStrings = getChoiceRecoveryStrings(locale);
	const response = data.response;
	const dontKnow =
		compiledChoiceFacts?.question.dontKnow ??
		data._dontKnow ??
		resolveAssessmentDontKnow(
			[{ id: blockId, type: "assessment", data: data as unknown as Record<string, unknown> }],
			passGate ? { gates: { [blockId]: "pass" } } : undefined,
		)[0].data._dontKnow === true;
	const feedbackOptionIds = (
		data as AssessmentBlockData & { _feedbackOptionIds?: { correct?: string; incorrect?: string } }
	)._feedbackOptionIds;
	const fillBlankBlanks =
		assessmentType === "fillBlank" &&
		response?.type === "fillBlank" &&
		Array.isArray(response.blanks)
			? response.blanks.filter((blank): blank is FillBlankResponse["blanks"][number] =>
					Boolean(blank && typeof blank === "object" && typeof blank.id === "string"),
				)
			: [];
	const hasKnownFillBlankAnswer = fillBlankBlanks.some(
		(blank) => fillBlankExpectedAnswers(blank).length > 0,
	);
	const { gradingMode, graded } = assessmentStatePolicy(data, hasKnownFillBlankAnswer);
	const isGraded = compiledChoiceFacts?.question.graded ?? graded;
	const points =
		typeof data.points === "number" && Number.isFinite(data.points) ? data.points : null;
	const journal = isJournal(data);
	const isReflection =
		assessmentType === "textResponse" && gradingMode === "none" && data.private === true;
	const assessmentDisplay =
		(data as AssessmentBlockData & { display?: string }).display === "scenario"
			? "scenario"
			: isReflection
				? "reflection"
				: "standard";
	const required = data.required ?? isGraded;
	const shuffle = assessmentShuffle(data);
	const { stemHtml, stemContent, stemPlainText, descriptionHtml } = prepareAssessmentContent(
		data,
		s.questionLabel,
	);
	const questionStemId = `assessment-question-${blockId}`;
	const choiceHasKnownAnswer =
		assessmentType === "choice" &&
		response?.type === "choice" &&
		response.options?.some((option) => option.isCorrect === true);
	const canAutoScore =
		(compiledChoiceFacts?.question.canAutoScore ?? choiceHasKnownAnswer) ||
		assessmentType === "hotspot" ||
		assessmentType === "matching" ||
		assessmentType === "sequence" ||
		assessmentType === "categorize" ||
		(assessmentType === "fillBlank" && hasKnownFillBlankAnswer);
	const { revealAnswers, maxAttempts: localMaxAttempts } = assessmentStatePolicy(
		data,
		canAutoScore,
	);
	const maxAttempts = compiledChoiceFacts
		? compiledChoiceFacts.question.maxAttempts || Infinity
		: localMaxAttempts;

	// Resolve shuffled defaults and any durable answer before the first render so
	// learner controls never flash empty while state is being restored.
	// biome-ignore lint/correctness/useExhaustiveDependencies: shuffle once per mounted response
	const sequenceItems = useMemo(() => {
		if (assessmentType !== "sequence" || !response) return [];
		const rawItems = (response as SequenceResponse).items ?? [];
		return rawItems.length > 0 ? shuffleArray(rawItems) : rawItems;
	}, [assessmentType, (response as SequenceResponse)?.items?.length]);
	const choiceStateProvider =
		typeof window === "undefined" ? undefined : window.__praxityBlockState;
	const choiceFacts = useMemo(
		() =>
			data.response?.type === "choice" && choiceStateProvider?.getChoiceDependencyView?.()
				? (compiledChoiceFacts ?? {
						question: choiceStateQuestion(data, dontKnow),
						signature: choiceContentSignature(data, dontKnow),
					})
				: undefined,
		[compiledChoiceFacts, choiceStateProvider, data, dontKnow],
	);
	const choiceRestore = useMemo(() => {
		if (!choiceFacts) return null;
		const view =
			typeof window === "undefined"
				? undefined
				: window.__praxityBlockState?.getChoiceDependencyView?.();
		const restored = restoreChoiceAssessmentState(readLearnerBlockState(blockId), choiceFacts);
		const recovering =
			restored.current?.checked === false &&
			restored.history.some((entry) => isRecord(entry) && entry.checked === true);
		return view && view.status(blockId) === "history" && !recovering
			? { ...restored, status: "review" as const, current: null }
			: restored;
	}, [blockId, choiceFacts]);
	const restoredCandidate = useMemo(
		() =>
			choiceRestore
				? choiceRestore.current
				: restoreAssessmentState(blockId, assessmentType, response, dontKnow),
		[assessmentType, blockId, response, dontKnow, choiceRestore],
	);
	const [newChoiceAttempt, setNewChoiceAttempt] = useState(false);
	const choiceReviewPending = choiceRestore?.status === "review" && !newChoiceAttempt;
	const restoredCorrect = choiceRestore
		? (choiceRestore.current?.correct ?? false)
		: Boolean(restoredCandidate?.checked) &&
			canAutoScore &&
			response !== undefined &&
			isSavedAnswerCorrect(assessmentType, response, restoredCandidate?.answer ?? null);
	const restoredCompleted = Boolean(
		restoredCandidate?.checked &&
			(!canAutoScore || restoredCorrect || restoredCandidate.attemptCount >= maxAttempts),
	);
	const restored = choiceRestore
		? choiceRestore.current
		: restoredCandidate?.correct === restoredCorrect &&
				restoredCandidate.completed === restoredCompleted &&
				(!restoredCandidate.checked || restoredCandidate.attemptCount > 0) &&
				(maxAttempts === Number.POSITIVE_INFINITY || restoredCandidate.attemptCount <= maxAttempts)
			? restoredCandidate
			: null;
	const restoredAnswer = restored?.answer;
	const restoredIds = Array.isArray(restoredAnswer)
		? restoredAnswer.filter((item): item is string => typeof item === "string")
		: [];
	const restoredRecord = isRecord(restoredAnswer) ? restoredAnswer : {};
	const restoredSequence =
		assessmentType === "sequence" && restoredIds.length > 0
			? restoredIds
					.map((id) => (response as SequenceResponse).items.find((item) => item.id === id))
					.filter((item): item is SequenceResponse["items"][number] => item !== undefined)
			: sequenceItems;

	const [selectedOption, setSelectedOption] = useState(
		assessmentType === "choice" &&
			(response as ChoiceResponse | undefined)?.selectionMode !== "multiple"
			? (restoredIds[0] ?? "")
			: "",
	);
	const [choiceSelectedIds, setChoiceSelectedIds] = useState<Set<string>>(
		new Set(
			assessmentType === "choice" &&
				(response as ChoiceResponse | undefined)?.selectionMode === "multiple"
				? restoredIds
				: [],
		),
	);
	const [hotspotSelectedIds, setHotspotSelectedIds] = useState<Set<string>>(
		new Set(assessmentType === "hotspot" ? restoredIds : []),
	);
	const hotspotResetRef = useRef<(() => void) | null>(null);
	const [matchingSelections, setMatchingSelections] = useState<Record<string, string | null>>(
		assessmentType === "matching" ? (restoredRecord as Record<string, string>) : {},
	);
	const [categorizeAssignments, setCategorizeAssignments] = useState<Record<string, string | null>>(
		assessmentType === "categorize" ? (restoredRecord as Record<string, string>) : {},
	);
	const [sequenceOrder, setSequenceOrder] = useState<SequenceResponse["items"]>(restoredSequence);
	const [textResponseValue, setTextResponseValue] = useState(
		assessmentType === "textResponse" && typeof restoredAnswer === "string" ? restoredAnswer : "",
	);
	const [fillBlankValues, setFillBlankValues] = useState<Record<string, string>>(
		assessmentType === "fillBlank" ? (restoredRecord as Record<string, string>) : {},
	);
	const [matrixSelections, setMatrixSelections] = useState<Record<string, number[]>>(
		assessmentType === "matrix" || assessmentType === "likert"
			? (restoredRecord as Record<string, number[]>)
			: {},
	);
	const [hasInteracted, setHasInteracted] = useState(restored?.interacted ?? false);
	const [isChecked, setIsChecked] = useState(restored?.checked ?? false);
	const [journalSavedAt, setJournalSavedAt] = useState(() =>
		journal && restored?.checked ? readJournalSavedAt(restored.savedAt) : null,
	);
	const [isCorrectAnswer, setIsCorrectAnswer] = useState(restoredCorrect);
	const unknownAnswer = dontKnow && selectedOption === DONT_KNOW;
	const [attemptCount, setAttemptCount] = useState(restored?.attemptCount ?? 0);
	const [reviewedChoiceIds, setReviewedChoiceIds] = useState<Set<string>>(
		() =>
			new Set(
				restored?.reviewedChoiceIds ??
					(assessmentType === "choice" && restored?.checked ? (restored.answer as string[]) : []),
			),
	);
	const reviewedUnknown = dontKnow && reviewedChoiceIds.has(DONT_KNOW);
	const buttonLabel =
		data.buttonLabel?.trim() ||
		(isGraded || assessmentType === "textResponse"
			? isReflection
				? s.completeReflection
				: s.submit
			: s.check);
	const cardRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const card = cardRef.current;
		const doc = card?.ownerDocument;
		const view = doc?.defaultView;
		if (assessmentType !== "choice" || !card || !doc || !view) return;
		return preservePrintFocus(card);
	}, [assessmentType]);
	const [continueTarget, setContinueTarget] = useState<HTMLElement | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Resolve before Check and refresh the next visible block on submission/retry.
	useLayoutEffect(() => {
		const card = cardRef.current;
		if (!card || card.closest("[data-assessment-group]")) {
			setContinueTarget(null);
			return;
		}
		const content = card.closest(".deck-slide, #main-content");
		const next = Array.from(content?.querySelectorAll<HTMLElement>("[data-block-type]") ?? []).find(
			(block) =>
				!card.contains(block) &&
				Boolean(card.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING) &&
				!block.closest("[hidden], [inert]"),
		);
		setContinueTarget(next ?? document.querySelector<HTMLElement>("#deck-next, .praxity-nav-next"));
	}, [isChecked]);
	const responseRef = useRef<HTMLDivElement>(null);
	const feedbackRef = useRef<HTMLDivElement>(null);
	const containerCtx = useContext(ContainerContext);
	const restoredCompletionSent = useRef(false);
	useEffect(() => {
		if (!containerCtx || !restored?.completed || restoredCompletionSent.current) return;
		restoredCompletionSent.current = true;
		containerCtx.onChildComplete(blockId, { restored: true });
	}, [blockId, containerCtx, restored?.completed]);
	const effectiveRequired = containerCtx?.required ?? required;
	const feedbackId = `feedback-${blockId}`;
	const descriptionId = `assessment-description-${blockId}`;
	// The description explains the question, so it must be announced with the
	// response controls rather than only sitting next to them.
	const describedBy = descriptionHtml ? descriptionId : undefined;
	const descriptionMarkup = useMemo(
		() =>
			descriptionHtml ? (
				<div
					id={descriptionId}
					className="praxity-assessment-description"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: content is sanitized via sanitizeHtml
					dangerouslySetInnerHTML={{
						__html: prepareAssessmentDescriptionHtml(descriptionHtml),
					}}
				/>
			) : null,
		[descriptionHtml, descriptionId],
	);

	const focusFeedbackAfterSubmit = useRef(false);
	const submitScroll = useRef<
		Array<{ element: HTMLElement; top: number; left: number; anchor: string }>
	>([]);

	const [retryFocusPending, setRetryFocusPending] = useState(false);
	useLayoutEffect(() => {
		if (!isChecked && retryFocusPending) {
			const responseArea = responseRef.current;
			const controls = responseArea?.querySelectorAll<HTMLElement>(
				'input:not([type="hidden"]), select, textarea, button, a[href], [tabindex]',
			);
			// Retry returns to an answer control, not its keyboard-scrollable region.
			// Wait until the response is enabled again, and stay inside this question.
			const firstControl = Array.from(controls ?? []).find(
				(control) =>
					control.tabIndex >= 0 &&
					!control.matches('section, [role="region"], [role="group"]') &&
					!control.matches(":disabled") &&
					!control.closest('[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"]'),
			);
			// Responses without an enabled control (file upload) fall back to the question.
			const focusTarget = firstControl ?? document.getElementById(questionStemId);
			focusTarget?.focus();
			// WebKit can focus a hotspot outside its nested scroller after retry reflows.
			if (focusTarget?.closest(".praxity-hotspot-scroll")) {
				focusTarget.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
			}
			// Keep Try again mounted until focus has left it, avoiding a stop on body.
			setRetryFocusPending(false);
		}
	}, [isChecked, questionStemId, retryFocusPending]);

	function handleOptionSelect(optionId: string) {
		const current = selfCheckEpochTicket();
		writeCurrent.current = current;
		const choiceResp = response as ChoiceResponse;
		const isMulti = choiceResp?.selectionMode === "multiple";
		if (isMulti) {
			setChoiceSelectedIds((prev) => {
				const next = new Set(prev);
				if (next.has(optionId)) {
					next.delete(optionId);
				} else {
					next.add(optionId);
				}
				return next;
			});
		} else {
			setSelectedOption(optionId);
		}
		setHasInteracted(true);
		dispatchSelfCheckEvent(
			new CustomEvent("praxity:block-interaction", {
				detail: { blockId, blockType: "assessment" },
			}),
			current,
			document,
		);
	}

	function handleNonChoiceInteraction() {
		const current = selfCheckEpochTicket();
		writeCurrent.current = current;
		if (!hasInteracted) setHasInteracted(true);
	}

	function choiceReport() {
		if (response?.type !== "choice") return null;
		return choiceInteractionReport(
			response.options.map((option) => ({
				id: option.id,
				label: htmlToPlainText(optionLabelHtml(option as unknown as Record<string, unknown>)),
			})),
			response.selectionMode === "multiple"
				? choiceSelectedIds
				: new Set(selectedOption ? [selectedOption] : []),
			locale,
			choiceResponseLimit,
			dontKnow,
		);
	}

	function currentResponseText(): string | null {
		switch (assessmentType) {
			case "choice":
				return choiceReport()?.responseText ?? "";
			case "textResponse":
				return textResponseValue;
			case "hotspot":
				return [...hotspotSelectedIds].sort().join(",");
			case "matching":
				return JSON.stringify(matchingSelections);
			case "sequence":
				return sequenceOrder.map((item) => item.id).join(",");
			case "categorize":
				return JSON.stringify(categorizeAssignments);
			case "fillBlank":
				return JSON.stringify(fillBlankValues);
			case "matrix":
			case "likert":
				return JSON.stringify(matrixSelections);
			default:
				return null;
		}
	}

	const completed = isChecked && (!canAutoScore || isCorrectAnswer || attemptCount >= maxAttempts);
	const savedAnswer: LearnerStateValue = (() => {
		switch (assessmentType) {
			case "choice":
				return (response as ChoiceResponse | undefined)?.selectionMode === "multiple"
					? [...choiceSelectedIds].sort()
					: selectedOption
						? [selectedOption]
						: [];
			case "hotspot":
				return [...hotspotSelectedIds].sort();
			case "matching":
				return Object.fromEntries(
					Object.entries(matchingSelections).filter(
						(entry): entry is [string, string] => typeof entry[1] === "string",
					),
				);
			case "sequence":
				return sequenceOrder.map(({ id }) => id);
			case "categorize":
				return Object.fromEntries(
					Object.entries(categorizeAssignments).filter(
						(entry): entry is [string, string] => typeof entry[1] === "string",
					),
				);
			case "fillBlank":
				return fillBlankValues;
			case "textResponse":
				return textResponseValue;
			case "matrix":
			case "likert":
				return matrixSelections;
			default:
				return null;
		}
	})();

	const serializedBlockState = JSON.stringify({
		version: 1,
		kind: "assessment",
		assessmentType,
		attemptCount,
		checked: isChecked,
		correct: isCorrectAnswer,
		completed,
		interacted: hasInteracted,
		answer: savedAnswer,
		...(journal && journalSavedAt ? { savedAt: journalSavedAt } : {}),
		...(assessmentType === "choice" ? { reviewedChoiceIds: [...reviewedChoiceIds] } : {}),
	});
	const lastPersistedState = useRef({ blockId, serialized: serializedBlockState });
	const [saveResult, setSaveResult] = useState(() => readLearnerBlockSaveResult(blockId));
	function persistAssessmentState(next: SavedAssessmentState, current: () => boolean) {
		const prepared = choiceFacts
			? prepareChoiceAssessmentState(readLearnerBlockState(blockId), next, choiceFacts, {
					writtenAt: Date.now(),
				})
			: next;
		const written = writeLearnerBlockState(
			blockId,
			prepared as unknown as LearnerStateValue,
			current,
		);
		if (!current()) return false;
		const result = readLearnerBlockSaveResult(blockId);
		setSaveResult(result);
		return written && result?.status !== "not-saved";
	}
	// biome-ignore lint/correctness/useExhaustiveDependencies: the serialized state covers the persistence helper.
	useEffect(() => {
		if (lastPersistedState.current.blockId !== blockId) {
			lastPersistedState.current = { blockId, serialized: serializedBlockState };
			return;
		}
		if (lastPersistedState.current.serialized === serializedBlockState) return;
		lastPersistedState.current.serialized = serializedBlockState;
		persistAssessmentState(JSON.parse(serializedBlockState), writeCurrent.current);
	}, [blockId, serializedBlockState]);

	function handleCheck() {
		const current = selfCheckEpochTicket();
		writeCurrent.current = current;
		const provider = window.__praxityBlockState;
		const atomicSubmission =
			assessmentType === "choice" && data.private !== true && !!provider?.stageSubmission;
		if (isChecked) return;
		const receipt = readLearnerBlockSaveResult(blockId);
		if (receipt?.status === "not-saved" && receipt.code === "unreadable-state") {
			persistAssessmentState(JSON.parse(serializedBlockState), current);
			return;
		}
		// Guard: block empty/invalid text-response submissions
		if (assessmentType === "textResponse" && response) {
			const textResp = response as TextResponseConfig;
			if (
				!isTextResponseValid(textResponseValue, textResp.inputType ?? "short", {
					maxLength: textResp.maxLength,
					numericRange: textResp.numericRange,
				})
			) {
				return;
			}
		}

		const nextAttempt = attemptCount + 1;
		if (journal) setJournalSavedAt(new Date().toISOString());
		if (assessmentType === "choice") setReviewedChoiceIds(new Set(savedAnswer as string[]));
		for (let element = cardRef.current?.parentElement; element; element = element.parentElement) {
			if (element.scrollHeight <= element.clientHeight && element !== document.scrollingElement)
				continue;
			submitScroll.current.push({
				element,
				top: element.scrollTop,
				left: element.scrollLeft,
				anchor: element.style.overflowAnchor,
			});
			element.style.overflowAnchor = "none";
		}
		setAttemptCount(nextAttempt);
		// Group submission delivers one focus announcement from its shared action.
		focusFeedbackAfterSubmit.current =
			cardRef.current
				?.querySelector("[data-assessment-submit]")
				?.getAttribute("data-assessment-group-focus") !== "true";
		setIsChecked(true);

		const card = cardRef.current;
		if (!card) return;
		const priorAttributes = [
			"data-attempted",
			"data-result",
			"data-score",
			"data-passed",
			"data-completed",
		].map((name) => [name, card.getAttribute(name)] as const);
		const refuseSubmission = () => {
			setSaveResult(readLearnerBlockSaveResult(blockId));
			setAttemptCount(attemptCount);
			setIsChecked(false);
			setIsCorrectAnswer(isCorrectAnswer);
			setReviewedChoiceIds(reviewedChoiceIds);
			focusFeedbackAfterSubmit.current = false;
			lastPersistedState.current.serialized = serializedBlockState;
			for (const [name, value] of priorAttributes) {
				if (value === null) card.removeAttribute(name);
				else card.setAttribute(name, value);
			}
		};
		let submittedCorrect: boolean | undefined;
		let submittedScore: number | undefined;

		card.setAttribute("data-attempted", "true");

		if (canAutoScore && response) {
			// Auto-score for choice and hotspot (both graded and knowledge checks)
			let isCorrect = false;

			if (assessmentType === "choice") {
				const choiceResp = response as ChoiceResponse;
				isCorrect = choiceAnswerResult(choiceResp, savedAnswer as string[]) === "correct";
			} else if (assessmentType === "hotspot") {
				const hotspotResp = response as HotspotResponse;
				const correctIds = new Set(
					hotspotResp.hotspots?.filter((h) => h.isCorrect).map((h) => h.id) ?? [],
				);
				const selectedCorrect = [...hotspotSelectedIds].every((id) => correctIds.has(id));
				const allCorrectSelected = [...correctIds].every((id) => hotspotSelectedIds.has(id));
				isCorrect = selectedCorrect && allCorrectSelected && hotspotSelectedIds.size > 0;
			} else if (assessmentType === "matching") {
				const matchResp = response as MatchingResponse;
				const pairs = matchResp.pairs ?? [];
				isCorrect =
					pairs.length > 0 &&
					pairs.every((pair) => matchingSelections[pair.id] === pair.correctMatch);
			} else if (assessmentType === "sequence") {
				const seqResp = response as SequenceResponse;
				const expectedItems = seqResp.items ?? [];
				isCorrect =
					expectedItems.length > 0 &&
					sequenceOrder.every((item, index) => item.correctPosition === index);
			} else if (assessmentType === "categorize") {
				const catResp = response as CategorizeResponse;
				const allItems = categorizeItems(catResp.categories ?? []);
				isCorrect =
					allItems.length > 0 &&
					allItems.every((item) => categorizeAssignments[item.key] === item.correctCategoryId);
			} else if (assessmentType === "fillBlank") {
				const knownBlanks = fillBlankBlanks.filter(
					(blank) => fillBlankExpectedAnswers(blank).length > 0,
				);
				isCorrect =
					validFillBlankSelections(response as FillBlankResponse, fillBlankValues) &&
					knownBlanks.every((blank) =>
						isFillBlankAnswerCorrect(
							fillBlankValues[blank.id],
							blank,
							(response as FillBlankResponse).style,
						),
					);
			}

			setIsCorrectAnswer(isCorrect);
			submittedCorrect = isCorrect;
			card.setAttribute(
				"data-result",
				unknownAnswer ? "unknown" : isCorrect ? "correct" : "incorrect",
			);
			if (isGraded) {
				submittedScore = isCorrect ? (data.points ?? 100) : 0;
				card.setAttribute("data-score", String(submittedScore));
				card.setAttribute("data-passed", String(isCorrect));
			}

			if (isCorrect || nextAttempt >= maxAttempts) {
				card.setAttribute("data-completed", "true");
				if (!atomicSubmission) containerCtx?.onChildComplete(blockId);
			}
		} else {
			if (unknownAnswer) {
				submittedCorrect = false;
				card.setAttribute("data-result", "unknown");
			}
			// Open and survey responses are submitted without inventing a score.
			card.setAttribute("data-completed", "true");
			if (!atomicSubmission) containerCtx?.onChildComplete(blockId);
		}

		const responseText = currentResponseText();
		if (atomicSubmission || choiceRestore) {
			const next = {
				...JSON.parse(serializedBlockState),
				attemptCount: nextAttempt,
				checked: true,
				correct: submittedCorrect ?? false,
				completed: !canAutoScore || submittedCorrect === true || nextAttempt >= maxAttempts,
				reviewedChoiceIds: savedAnswer as string[],
			} as SavedAssessmentState;
			// The reporting event reads the same owner state synchronously.
			const write = () => persistAssessmentState(next, current);
			const written =
				data.private !== true && responseText !== null && provider?.stageSubmission
					? provider.stageSubmission(blockId, write)
					: write();
			if (written) lastPersistedState.current.serialized = JSON.stringify(next);
			else if (atomicSubmission && readLearnerBlockSaveResult(blockId)?.status === "not-saved") {
				refuseSubmission();
				return;
			}
			if (!current()) return;
		}
		if (responseText !== null && data.private !== true) {
			reportLearnerBlockResponse(
				{
					blockId,
					responseText,
					questionText: [
						stemPlainText || reportTitle,
						assessmentType === "textResponse" ? htmlToPlainText(descriptionHtml) : "",
					]
						.filter(Boolean)
						.join(" ")
						.replace(/\s+/gu, " ")
						.trim(),
					language: locale,
					assessmentType,
					...(choiceFacts
						? { contentSignature: choiceEvidenceSignature(choiceFacts.signature) }
						: {}),
					choiceDefinition: choiceReport()?.choiceDefinition,
					correct: submittedCorrect,
					...(unknownAnswer ? { result: "neutral" } : {}),
					submitted: true,
					attemptsUsed: nextAttempt,
					maxAttempts,
					score: submittedScore,
					maxScore: isGraded && canAutoScore ? (data.points ?? 100) : undefined,
				},
				{ document, provider, current },
			);
			if (!current()) return;
			const result = readLearnerBlockSaveResult(blockId);
			if (
				result?.status === "not-saved" &&
				(atomicSubmission || result.code === "unreadable-state")
			) {
				refuseSubmission();
				return;
			}
			setSaveResult(result);
		}
		if (atomicSubmission && current() && card.getAttribute("data-completed") === "true")
			containerCtx?.onChildComplete(blockId);

		dispatchSelfCheckEvent(
			new CustomEvent("praxity:block-interaction", {
				detail: { blockId, blockType: "assessment" },
			}),
			current,
			document,
		);
	}

	const renderResponse = () => {
		if (!response) {
			return null;
		}

		switch (assessmentType) {
			case "choice":
				return (
					<ChoicePreview
						response={response as ChoiceResponse}
						dontKnow={dontKnow}
						onSelect={handleOptionSelect}
						shuffle={shuffle}
						selectedValue={selectedOption}
						selectedValues={choiceSelectedIds}
						disabled={isChecked || choiceReviewPending}
						revealAnswers={Boolean(
							isChecked &&
								!isCorrectAnswer &&
								(unknownAnswer || revealAnswers || attemptCount >= maxAttempts),
						)}
						reviewedIds={reviewedChoiceIds}
						data={data}
						showVerdict={
							reviewedUnknown ||
							(canAutoScore && ((data.feedbackEnabled ?? isGraded) || revealAnswers))
						}
						showAuthoredFeedback={authoredFeedbackEnabled}
						stemText={stemPlainText}
						describedBy={joinIds(
							describedBy,
							choiceReviewPending ? `${blockId}-choice-history-notice` : undefined,
						)}
						required={effectiveRequired}
						feedbackDescribedBy={
							isChecked && (revealAnswers || (data.feedbackEnabled ?? isGraded))
								? feedbackId
								: undefined
						}
					/>
				);
			case "matching":
				return (
					<MatchingPreview
						blockId={blockId}
						response={response as MatchingResponse}
						shuffle={shuffle}
						stemText={stemPlainText}
						describedBy={describedBy}
						required={effectiveRequired}
						selections={matchingSelections}
						onSelectionsChange={(value) => {
							handleNonChoiceInteraction();
							setMatchingSelections(value);
						}}
						checked={isChecked}
					/>
				);
			case "sequence":
				return (
					<SequencePreview
						response={response as SequenceResponse}
						items={sequenceOrder}
						onItemsChange={(value) => {
							handleNonChoiceInteraction();
							setSequenceOrder(value);
						}}
						stemText={stemPlainText}
						describedBy={describedBy}
						disabled={Boolean(revealAnswers && isChecked)}
					/>
				);
			case "textResponse":
				return (
					<TextResponsePreview
						response={response as TextResponseConfig}
						value={textResponseValue}
						onValueChange={(value) => {
							handleNonChoiceInteraction();
							setTextResponseValue(value);
							if (journal && isChecked) {
								setJournalSavedAt(null);
								setIsChecked(false);
								setAttemptCount(0);
							}
						}}
						stemText={stemPlainText}
						describedBy={describedBy}
						required={effectiveRequired}
						savedAt={journal ? journalSavedAt : undefined}
					/>
				);
			case "fillBlank":
				return (
					<FillBlankPreview
						blockId={blockId}
						response={response as FillBlankResponse}
						values={fillBlankValues}
						onValuesChange={(value) => {
							handleNonChoiceInteraction();
							setFillBlankValues(value);
						}}
						stemText={stemPlainText}
						describedBy={describedBy}
						required={effectiveRequired}
						checked={isChecked}
					/>
				);
			case "categorize":
				return (
					<CategorizePreview
						blockId={blockId}
						response={response as CategorizeResponse}
						shuffle={shuffle}
						stemText={stemPlainText}
						describedBy={describedBy}
						required={effectiveRequired}
						assignments={categorizeAssignments}
						onAssignmentsChange={(value) => {
							handleNonChoiceInteraction();
							setCategorizeAssignments(value);
						}}
						transformImageUrl={transformImageUrl}
						disabled={isChecked}
					/>
				);
			case "hotspot":
				return (
					<HotspotPreview
						response={response as HotspotResponse}
						transformImageUrl={transformImageUrl}
						selectedIds={hotspotSelectedIds}
						onSelectionChange={(value) => {
							handleNonChoiceInteraction();
							setHotspotSelectedIds(value);
						}}
						onReset={(fn) => {
							hotspotResetRef.current = fn;
						}}
						disabled={isChecked}
						stemText={stemPlainText}
						describedBy={describedBy}
					/>
				);
			case "matrix":
			case "likert":
				return (
					<MatrixPreview
						response={response as MatrixResponse}
						labelledBy={questionStemId}
						shuffle={shuffle}
						selections={matrixSelections}
						onSelectionsChange={(value) => {
							handleNonChoiceInteraction();
							setMatrixSelections(value);
						}}
						disabled={isChecked}
					/>
				);
			case "fileUpload":
				return <FileUploadPreview response={response as FileUploadResponse} />;
			default:
				return (
					<Text size="sm" c="dimmed">
						{s.previewNotAvailable}
					</Text>
				);
		}
	};

	const isTextResponseSubmitDisabled =
		assessmentType === "textResponse" &&
		response != null &&
		!isTextResponseValid(textResponseValue, (response as TextResponseConfig).inputType ?? "short", {
			maxLength: (response as TextResponseConfig).maxLength,
			numericRange: (response as TextResponseConfig).numericRange,
		});
	const textResponseHasDownloads =
		assessmentType === "textResponse" &&
		response != null &&
		["txt", "docx", "both"].includes((response as TextResponseConfig).downloadAs ?? "");
	const responseIsAnswered = (() => {
		if (!response) return false;
		switch (assessmentType) {
			case "choice":
				return (response as ChoiceResponse).selectionMode === "multiple"
					? choiceSelectedIds.size > 0
					: selectedOption !== "";
			case "matching": {
				const pairs = Array.isArray((response as MatchingResponse).pairs)
					? (response as MatchingResponse).pairs
					: [];
				return pairs.length > 0 && pairs.every((pair) => Boolean(matchingSelections[pair.id]));
			}
			case "categorize": {
				const categories = Array.isArray((response as CategorizeResponse).categories)
					? (response as CategorizeResponse).categories
					: [];
				const itemKeys = categorizeItems(categories).map(({ key }) => key);
				return itemKeys.length > 0 && itemKeys.every((key) => Boolean(categorizeAssignments[key]));
			}
			case "fillBlank": {
				const blanks = Array.isArray((response as FillBlankResponse).blanks)
					? (response as FillBlankResponse).blanks
					: [];
				return (
					blanks.length > 0 &&
					validFillBlankSelections(response as FillBlankResponse, fillBlankValues) &&
					blanks.every((blank) =>
						typeof blank?.id === "string" ? Boolean(fillBlankValues[blank.id]?.trim()) : false,
					)
				);
			}
			case "textResponse":
				return !isTextResponseSubmitDisabled;
			case "hotspot":
				return hotspotSelectedIds.size > 0;
			case "matrix":
			case "likert": {
				const statements = (response as MatrixResponse).statements ?? [];
				return (
					statements.length > 0 &&
					statements.every((statement) => (matrixSelections[statement.id]?.length ?? 0) > 0)
				);
			}
			default:
				return hasInteracted;
		}
	})();
	const correctFeedback = blocksToText(data.feedback?.correct);
	const incorrectFeedback = blocksToText(data.feedback?.incorrect);
	const overallFeedback = canAutoScore
		? isCorrectAnswer
			? correctFeedback
			: incorrectFeedback
		: correctFeedback || incorrectFeedback;
	// Grammar's compatibility projection also promotes option feedback into the
	// overall field. Once shown beside that option, do not repeat it below.
	const feedbackHtml =
		assessmentType === "choice" &&
		(reviewedChoiceIds.has(feedbackOptionIds?.[isCorrectAnswer ? "correct" : "incorrect"] ?? "") ||
			(response as ChoiceResponse).options.some(
				(option) =>
					reviewedChoiceIds.has(option.id) &&
					option.feedback &&
					htmlToPlainText(sanitizeHtml(inlineMarkdown(option.feedback))) ===
						htmlToPlainText(overallFeedback),
			))
			? ""
			: overallFeedback;
	// Keep focused descendants when later renders update the surrounding controls.
	const feedbackMarkup = useMemo(
		() => ({ __html: processMathSpans(sanitizeHtml(feedbackHtml)) }),
		[feedbackHtml],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Replaced authored HTML needs fresh description references after commit.
	useLayoutEffect(() => {
		const feedback = feedbackRef.current;
		const selectedChoice = responseRef.current
			?.querySelector<HTMLInputElement>("input:checked")
			?.closest(".praxity-assessment-choice-option");
		let summary =
			feedback?.querySelector<HTMLElement>("[data-row-summary], .praxity-assessment-result") ??
			selectedChoice?.querySelector<HTMLElement>("[data-option-feedback]");
		if (summary?.textContent === s.assessmentReviewReady) summary = undefined;
		const explanation =
			feedback?.querySelector<HTMLElement>("[data-feedback-explanation]") ??
			selectedChoice?.querySelector<HTMLElement>(".praxity-choice-feedback");
		const elements = Array.from(
			(explanation ?? feedback)?.querySelectorAll<HTMLElement>(
				"p, h1, h2, h3, h4, h5, h6, li, dt, dd",
			) ?? [],
		).filter((element) => element.textContent?.trim());
		const text = [summary, explanation].filter((element): element is HTMLElement =>
			Boolean(element),
		);
		const visibleText = text.filter((element) => element.textContent?.trim());
		const descriptions = visibleText.map((element, index) => {
			element.id ||= `${feedbackId}-text-${index}`;
			return element.id;
		});
		const action = isChecked
			? (feedback?.querySelector<HTMLButtonElement>("[data-assessment-retry]") ??
				cardRef.current?.querySelector<HTMLButtonElement>("[data-assessment-continue]"))
			: null;
		// NVDA reads the button and its feedback description once in browse and focus modes.
		if (action && descriptions.length)
			action.setAttribute("aria-describedby", descriptions.join(" "));
		let focusedAfterSubmit: HTMLElement | null = null;
		if (isChecked && focusFeedbackAfterSubmit.current) {
			focusFeedbackAfterSubmit.current = false;
			const target =
				action ??
				feedback?.querySelector<HTMLElement>(
					"[data-row-summary], .praxity-assessment-result, [data-assessment-status]",
				) ??
				elements[0] ??
				explanation ??
				visibleText[0] ??
				document.getElementById(questionStemId);
			if (target && !action) target.tabIndex = -1;
			target?.focus({
				preventScroll: true,
			});
			focusedAfterSubmit = target ?? null;
		}
		if (isChecked && submitScroll.current.length > 0) {
			const positions = submitScroll.current;
			submitScroll.current = [];
			for (const { element, top, left } of positions) element.scrollTo(left, top);
			// The summary and row reveals share one timing; keep the scroll anchor off until it finishes.
			requestAnimationFrame(() =>
				requestAnimationFrame(async () => {
					await feedback
						?.closest("[data-content-reveal]")
						?.getAnimations?.()[0]
						?.finished.catch(() => {});
					for (const { element, anchor } of positions) {
						// A group may submit several tables together. The first submission
						// owns restoration; later submissions already see "none".
						if (anchor !== "none") element.style.overflowAnchor = anchor;
					}
					if (focusedAfterSubmit && document.activeElement === focusedAfterSubmit) {
						const optionFeedback =
							selectedChoice?.querySelector<HTMLElement>("[data-content-reveal]");
						scrollElementIntoView(optionFeedback ?? feedback ?? focusedAfterSubmit, {
							block: "nearest",
						});
						scrollElementIntoView(focusedAfterSubmit, { block: "nearest" });
					}
				}),
			);
		}
		return () => action?.removeAttribute("aria-describedby");
	}, [continueTarget, feedbackId, feedbackMarkup, isChecked, questionStemId]);
	const authoredFeedbackEnabled = unknownAnswer || (data.feedbackEnabled ?? isGraded);
	const isCompletionOnly =
		gradingMode !== "none" && assessmentType === "fillBlank" && !hasKnownFillBlankAnswer;
	const showResultStatus =
		unknownAnswer ||
		revealAnswers ||
		isGraded ||
		isCompletionOnly ||
		!canAutoScore ||
		(authoredFeedbackEnabled && canAutoScore);
	const showFeedback =
		isChecked && (showResultStatus || (authoredFeedbackEnabled && Boolean(feedbackHtml)));
	const showInlineReviewSummary = isChecked && assessmentType === "fillBlank" && !showFeedback;
	const rowSummary = (() => {
		if (!isChecked || !response) return null;
		if (assessmentType === "categorize") {
			const items = categorizeItems((response as CategorizeResponse).categories);
			return interpolate(s.rowsCorrect, {
				correct: items.filter((item) => categorizeAssignments[item.key] === item.correctCategoryId)
					.length,
				total: items.length,
			});
		}
		if (assessmentType === "matrix") {
			const keyed = (response as MatrixResponse).statements.filter(
				(statement) => statement.correctValues?.length,
			);
			if (keyed.length)
				return interpolate(s.rowsCorrect, {
					correct: keyed.filter((statement) =>
						matrixRowCorrect(statement, matrixSelections[statement.id]),
					).length,
					total: keyed.length,
				});
		}
		return null;
	})();
	const revealedAnswerLabels = (() => {
		if (!revealAnswers || !isChecked || isCorrectAnswer || !response) return [];
		switch (response.type) {
			case "choice":
				return response.options.filter((option) => option.isCorrect).map((option) => option.label);
			case "matching":
				return response.pairs
					.filter((pair) => matchingSelections[pair.id] !== pair.correctMatch)
					.map((pair) => `${pair.prompt}: ${pair.correctMatch}`);
			case "sequence":
				return [...response.items]
					.sort((a, b) => a.correctPosition - b.correctPosition)
					.map((item) => item.label);
			case "fillBlank":
				return response.blanks.map((blank) => blank.answer);
			case "categorize":
				return response.categories.flatMap((category) =>
					category.items.map((item) => `${item}: ${category.name}`),
				);
			default:
				return [];
		}
	})();
	const hasFeedbackDetails =
		Boolean(authoredFeedbackEnabled && feedbackHtml) || revealedAnswerLabels.length > 0;
	const AnswerList = assessmentType === "sequence" ? "ol" : "ul";

	const questionMeta = (
		<>
			{/* Keep metadata outside the question text. */}
			{(assessmentDisplay === "reflection" || (isGraded && points !== null)) && (
				<div className="praxity-assessment-question-meta">
					{assessmentDisplay === "reflection" && (
						<Text component="div" className="praxity-assessment-reflection-label" size="xs">
							{s.reflectionPrivateLabel}
						</Text>
					)}
					{isGraded && points !== null && (
						<Text component="span" className="praxity-assessment-points" size="xs" c="dimmed">
							{assessmentPointsLabel(points, locale, s)}
						</Text>
					)}
				</div>
			)}
		</>
	);

	const questionHeader = (
		<div className="praxity-assessment-question-header">
			<p id={questionStemId} className="praxity-assessment-stem" tabIndex={-1}>
				{stemHtml ? (
					<>
						<span
							className="praxity-assessment-stem-content"
							// biome-ignore lint/security/noDangerouslySetInnerHtml: content is sanitized via sanitizeHtml
							dangerouslySetInnerHTML={{
								__html: stemContent.heading,
							}}
						/>
						{effectiveRequired && <RequiredIndicator />}
					</>
				) : (
					<>
						{assessmentType !== "hotspot" && (
							<Text component="span" size="sm" c="dimmed" fw={600}>
								{s.noQuestionText}
							</Text>
						)}
						{effectiveRequired && <RequiredIndicator />}
					</>
				)}
			</p>
			{response?.type === "choice" && response.selectionMode === "multiple" && (
				<p className="praxity-assessment-choice-hint">{s.selectAllThatApply}</p>
			)}
			{stemContent.body && (
				<div
					className="praxity-assessment-stem-body"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: assessment content is sanitized by its owner
					dangerouslySetInnerHTML={{ __html: stemContent.body }}
				/>
			)}
			{!journal && questionMeta}
		</div>
	);

	return (
		<Card
			ref={cardRef}
			withBorder
			padding="lg"
			className="praxity-block-assessment"
			data-block-id={blockId}
			data-node-id={blockId}
			data-assessment-display={assessmentDisplay}
			data-attempted={attemptCount > 0 ? "true" : undefined}
			data-result={
				isChecked
					? unknownAnswer
						? "unknown"
						: canAutoScore
							? isCorrectAnswer
								? "correct"
								: "incorrect"
							: undefined
					: undefined
			}
			data-completed={completed ? "true" : undefined}
			{...(isGraded && canAutoScore
				? {
						"data-score": String(isChecked && isCorrectAnswer ? (data.points ?? 100) : 0),
						"data-passed": String(isChecked && isCorrectAnswer),
						"data-max-score": String(data.points ?? 100),
					}
				: {})}
			data-selected-option={selectedOption}
			data-assessment-answered={responseIsAnswered ? "true" : "false"}
		>
			<Stack gap="md" data-assessment-display={assessmentDisplay}>
				{assessmentDisplay === "scenario" && descriptionMarkup}

				{journal ? <SceneHeader icon="notebook">{questionHeader}</SceneHeader> : questionHeader}
				{journal && questionMeta}

				{assessmentDisplay !== "scenario" && descriptionMarkup}
				{typeof window !== "undefined" &&
					window.__praxityBlockState?.stageSubmission &&
					saveResult?.status === "not-saved" &&
					((assessmentType === "choice" && data.private !== true) ||
						saveResult.code === "unreadable-state") && (
						<Text size="sm" role="status" c="dimmed">
							{s.assessmentStorageNotice}
						</Text>
					)}

				{(choiceReviewPending || (newChoiceAttempt && retryFocusPending)) && (
					<Stack gap="xs">
						<Text id={`${blockId}-choice-history-notice`} size="sm" c="dimmed">
							{recoveryStrings.choiceHistoryNotice}
						</Text>
						<Button
							className="praxity-assessment-new-attempt"
							variant="outline"
							size="md"
							aria-describedby={`${blockId}-choice-history-notice`}
							onClick={() => {
								writeCurrent.current = selfCheckEpochTicket();
								setNewChoiceAttempt(true);
								setRetryFocusPending(true);
							}}
						>
							{recoveryStrings.choiceNewAttempt}
						</Button>
					</Stack>
				)}
				<div ref={responseRef}>{renderResponse()}</div>

				<div
					data-content-reveal={isChecked || retryFocusPending ? "open" : "closed"}
					data-assessment-reveal
				>
					<div className="praxity-reveal-clip">
						<div ref={feedbackRef} id={feedbackId} data-assessment-feedback>
							{isChecked && assessmentType === "choice" && !hasFeedbackDetails && (
								<Text size="sm" c="dimmed" data-assessment-status>
									{maxAttempts < Number.POSITIVE_INFINITY
										? assessmentAttemptsLabel(attemptCount, maxAttempts, locale, s)
										: s.assessmentReviewReady}
								</Text>
							)}
							{rowSummary && (
								<Text className="praxity-assessment-row-summary" data-row-summary>
									{rowSummary}
								</Text>
							)}
							{showInlineReviewSummary && (
								<Text size="sm" className="praxity-assessment-result">
									{s.assessmentReviewReady}
								</Text>
							)}
							{showFeedback && (!rowSummary || hasFeedbackDetails) && (
								<div data-feedback-details={hasFeedbackDetails ? "true" : undefined}>
									{showResultStatus && !rowSummary && assessmentType !== "choice" && (
										<Text
											size="sm"
											fw={600}
											mb={authoredFeedbackEnabled && feedbackHtml ? 4 : undefined}
											className="praxity-assessment-result"
											data-result={
												canAutoScore ? (isCorrectAnswer ? "correct" : "incorrect") : undefined
											}
										>
											{canAutoScore && !isCorrectAnswer ? (
												<IconX size={18} aria-hidden="true" />
											) : (
												<IconCheck size={18} aria-hidden="true" />
											)}
											{canAutoScore ? (isCorrectAnswer ? s.correct : s.notQuite) : s.completed}
										</Text>
									)}
									{authoredFeedbackEnabled && feedbackHtml && (
										<>
											{/* Keep separator whitespace inside the label's single text run. */}
											<span className="praxity-sr-only">
												{`${showResultStatus && assessmentType !== "choice" ? ". " : ""}${s.feedbackLabel}: `}
											</span>
											<span
												data-feedback-explanation
												// biome-ignore lint/security/noDangerouslySetInnerHtml: content is sanitized via sanitizeHtml
												dangerouslySetInnerHTML={feedbackMarkup}
											/>
										</>
									)}
									{revealedAnswerLabels.length > 0 && (
										<div data-assessment-correct-answers>
											<Text size="sm" fw={600}>
												{revealedAnswerLabels.length === 1 ? s.correctAnswer : s.correctAnswers}
											</Text>
											<AnswerList>
												{revealedAnswerLabels.map((label, index) => (
													// biome-ignore lint/suspicious/noArrayIndexKey: answer order is fixed after submission
													<li key={index}>{resolveOptionLabel({ label })}</li>
												))}
											</AnswerList>
										</div>
									)}
								</div>
							)}
							{((isChecked && !isCorrectAnswer && attemptCount < maxAttempts) ||
								retryFocusPending) && (
								<Group gap="var(--space-3)" className="praxity-assessment-retry">
									<Button
										data-assessment-retry
										onClick={() => {
											const current = selfCheckEpochTicket();
											writeCurrent.current = current;
											setRetryFocusPending(true);
											setIsChecked(false);
											setSelectedOption("");
											setChoiceSelectedIds(new Set());
											setHotspotSelectedIds(new Set());
											hotspotResetRef.current?.();
											setMatchingSelections({});
											setCategorizeAssignments({});
											if (response && assessmentType === "sequence")
												setSequenceOrder(
													shuffleArray([...((response as SequenceResponse).items ?? [])]),
												);
											setHasInteracted(false);
										}}
										variant="outline"
										size="md"
									>
										{s.tryAgain}
									</Button>
									{assessmentType !== "choice" && maxAttempts < Number.POSITIVE_INFINITY && (
										<Text size="xs" c="dimmed">
											{interpolate(s.assessmentAttemptOf, { n: attemptCount, total: maxAttempts })}
										</Text>
									)}
								</Group>
							)}
						</div>
					</div>
				</div>
				<div className="praxity-assessment-actions">
					{isChecked && continueTarget && (completed || !effectiveRequired) && (
						<Button
							data-assessment-continue
							variant="filled"
							size="md"
							onClick={() => {
								if (continueTarget.matches("button, a")) continueTarget.click();
								else {
									const target =
										continueTarget.querySelector<HTMLElement>(
											'input:not([type="hidden"]):not(:disabled), button:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
										) ?? continueTarget;
									if (target === continueTarget) target.tabIndex = -1;
									target.focus();
								}
							}}
						>
							{s.continueActivity}
						</Button>
					)}
					{(journal || !textResponseHasDownloads || groupedDownloadSubmit) &&
						(hasInteracted ||
							(assessmentType === "hotspot" && hotspotSelectedIds.size > 0) ||
							assessmentType === "fileUpload" ||
							(assessmentType === "textResponse" && textResponseValue.trim() !== "")) &&
						!isChecked && (
							<>
								<Button
									onClick={handleCheck}
									variant="filled"
									size="sm"
									data-assessment-submit="true"
									style={
										textResponseHasDownloads && groupedDownloadSubmit
											? { display: "none" }
											: undefined
									}
									disabled={isTextResponseSubmitDisabled}
									aria-describedby={
										isTextResponseSubmitDisabled ? `${blockId}-submit-hint` : undefined
									}
								>
									{buttonLabel}
								</Button>
								{isTextResponseSubmitDisabled && (
									<span id={`${blockId}-submit-hint`} className="praxity-sr-only">
										{s.assessmentEnterResponse}
									</span>
								)}
							</>
						)}
				</div>
			</Stack>
		</Card>
	);
}
