/**
 * Course tracking logic that sits on top of a SCORMRuntime implementation.
 *
 * Handles page-visit tracking, interaction scoring, and automatic completion
 * detection based on configurable criteria (all pages, percentage, or quiz).
 */

import type { ChoiceDependencyEvidence } from "@praxity/shared-blocks/choice-learner-state";
import { DEFAULT_COMPLETION_THRESHOLD } from "@praxity/shared-blocks/constants";
import {
	type CourseOutcome,
	captureLearnerBlockState,
	type GroupObjectiveWriter,
	type LearnerBlockStateRuntime,
	withLearnerStateAuthority,
	writeCourseOutcome,
} from "@praxity/shared-blocks/learner-block-state";
import {
	isChoiceContentSignature,
	isGroupObjectiveScore,
	type LearnerStateValue,
	prepareGroupObjectiveRetirement,
	prepareGroupObjectiveSave,
	readSavedAssessmentGroupState,
	readSubmittedAssessmentGroup,
} from "@praxity/shared-blocks/learner-state";
import {
	claimGroupObjective,
	dirtyGroupObjectiveReplay,
	type GroupObjectiveReplayLedger,
	settleGroupObjective,
	withGroupObjectiveReplay,
} from "./api/session";
import type { InteractionRecord, SCORMRuntime, TrackInteractionOptions } from "./types.ts";

/** The pass mark as the manifest declares it, so the LMS and the SCO agree at the boundary. */
export function passMarkPercent(value: number): number {
	return Math.min(100, Math.round(value * 100) / 100);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface TrackingConfig {
	/** Total number of pages in the course. */
	totalPages: number;
	/** How completion is determined. */
	completionMethod: "allPages" | "percentage" | "quiz";
	/**
	 * For "percentage" method: the minimum percentage of pages (0-100) that
	 * must be visited to trigger completion.
	 */
	completionThreshold?: number;
	/**
	 * Minimum score (0-100) required to pass: for the "quiz" method, or the
	 * course pass mark when `scoredAssessmentIds` is set.
	 */
	passMark?: number;
	/**
	 * Required, automatically scored questions and groups that make up the course
	 * score. With `passMark`, pass/fail is decided once every one has a submitted
	 * answer, from the average of their latest scores.
	 */
	scoredAssessmentIds?: string[];
	/** Legacy page slugs mapped to their durable page IDs. */
	pageAliases?: Record<string, string>;
	/** Required scored questions/groups that must pass as well as the page rule. */
	requiredAssessmentIds?: string[];
	/** SCORM keeps a score-changing authored retry incomplete while reporting the score. */
	deferRetryableFailure?: boolean;
	/** Hosts may display the outcome without persisting or reporting it. */
	reportOutcome?: boolean;
	/** Finality comes from the host's existing saved answers, including authored retries. */
	isAssessmentFinal?: (id: string) => boolean;
	/** Hosts supply saved answers; the tracker owns their finality decision. */
	getAssessmentState?: (id: string) => unknown;
	/** Absent until the host admits evidence-aware reporting. */
	getChoiceDependencyView?: () => ChoiceDependencyEvidence | undefined;
	/** Dormant SCORM submission handoff; replay is admitted separately. */
	writeObjectives?: GroupObjectiveWriter;
}

interface CourseResult {
	score: number;
	passed: boolean;
	retryable: boolean;
}

type TrackerOutcome = CourseOutcome & { result?: CourseResult | null };

/** The provider owns capture saves; the SCORM launch owns replay acknowledgement. */
export function createDeferredGroupObjectiveWriter(
	provider: LearnerBlockStateRuntime,
	current: () => boolean,
	ledger?: GroupObjectiveReplayLedger,
): GroupObjectiveWriter | undefined {
	const handoff = provider.admitGroupObjectives?.(current, {
		read: readSubmittedAssessmentGroup,
		prepare: prepareGroupObjectiveSave,
	});
	if (!handoff) return undefined;
	dirtyGroupObjectiveReplay(ledger ?? null);
	const clear = (id: string, uuid: string) =>
		provider.clearGroupObjective?.(
			id,
			(saved) =>
				readSubmittedAssessmentGroup(saved)?.objective?.id === uuid
					? prepareGroupObjectiveSave(saved, saved as LearnerStateValue, undefined, uuid)
					: undefined,
			current,
		);
	const writer: GroupObjectiveWriter = (runtime, outcome, view, intent, readReplay) => {
		if (intent && intent !== "prepareCommit" && ledger && !ledger.objectiveReplay)
			return withGroupObjectiveReplay(ledger, current, () =>
				writer(runtime, outcome, view, intent, readReplay),
			);
		const reporting = runtime && withLearnerStateAuthority(runtime, current);
		if (!intent || intent === "prepareCommit") {
			if (!ledger || !readReplay) {
				const initial = readReplay?.();
				return writeCourseOutcome(reporting, initial?.outcome ?? outcome) && current();
			}
			const running = ledger.objectiveReplay;
			if (running) {
				running.dirty = true;
				if (!running.current())
					running.retry = () => writer(runtime, outcome, view, intent, readReplay);
				// Ordinary preparation must cancel queued credit before the adapter flushes it.
				if (intent === "prepareCommit")
					return writeCourseOutcome(reporting, readReplay().outcome) && current();
				return current();
			}
			return withGroupObjectiveReplay(ledger, current, (flight) => {
				let evidence = view;
				let latestOutcome = outcome;
				const confirmations = new Map<string, boolean>();
				const cleared = new Set<string>();
				const originalIds = new Map<string, string>();
				let refresh = false;
				do {
					flight.dirty = false;
					if (!evidence) {
						const initial = readReplay();
						evidence = initial.view;
						latestOutcome = initial.outcome;
					}
					// Read captures before rebuilding evidence. No callback-capable read follows admission.
					const captures = Object.keys(evidence?.groups ?? {}).map(
						(id) => [id, readSubmittedAssessmentGroup(provider.get(id))] as const,
					);
					if (!refresh)
						for (const [id, saved] of captures)
							if (saved?.objective) originalIds.set(id, saved.objective.id);
					if (refresh) {
						const fresh = readReplay();
						evidence = fresh.view;
						latestOutcome = fresh.outcome;
					}
					refresh = true;
					if (!current()) return false;
					if (flight.dirty) continue;
					for (const [id, saved] of captures) {
						const objective = saved?.objective;
						if (!objective || originalIds.get(id) !== objective.id) continue;
						const key = JSON.stringify([id, objective.id]);
						if (ledger.objectives?.get(key) === "written") {
							if (!cleared.has(key)) {
								// Clear also Commits; cancel queued credit while preserving the final Finish intent.
								if (latestOutcome.kind === "waiting")
									writeCourseOutcome(reporting, { kind: "waiting" });
								cleared.add(key);
								clear(id, objective.id);
								flight.dirty = true;
								break;
							}
							continue;
						}
						const eligible =
							!saved.retired &&
							latestOutcome.kind === "decided" &&
							evidence?.status(id) === "current";
						if (flight.dirty) break;
						if (!eligible) continue;
						const claim = claimGroupObjective(ledger, key);
						if (!claim) continue;
						const capture = JSON.stringify([id, saved]);
						let accepted = false;
						try {
							if (!confirmations.has(capture)) {
								confirmations.set(
									capture,
									provider.confirmGroupObjective?.(
										id,
										(state) =>
											JSON.stringify(readSubmittedAssessmentGroup(state)) === JSON.stringify(saved),
										current,
									) === true,
								);
								flight.dirty = true;
							} else if (confirmations.get(capture)) {
								accepted =
									writeCourseOutcome(reporting, {
										kind: "decided",
										objective: { id, score: objective.score, passed: objective.passed },
									}) && current();
								if (!accepted) return false;
								handoff(id, null, objective.id);
								flight.dirty = true;
							}
						} finally {
							settleGroupObjective(ledger, key, claim, accepted);
						}
						if (flight.dirty) break;
					}
					if (!flight.dirty) {
						if (!writeCourseOutcome(reporting, latestOutcome) || !current()) return false;
					}
				} while (flight.dirty);
				return true;
			});
		}
		dirtyGroupObjectiveReplay(ledger ?? null);
		if (!Object.hasOwn(view?.groups ?? {}, intent.id))
			return writeCourseOutcome(reporting, outcome) && current();
		const { id, score, passed, contentSignature } = intent;
		handoff(id, null);
		if (
			!isGroupObjectiveScore(score) ||
			typeof passed !== "boolean" ||
			!isChoiceContentSignature(contentSignature)
		)
			return false;
		const previous = provider.get(id);
		if (!current()) return false;
		// Unreadable old groups must remain replaceable through the ordinary submission path.
		if (previous !== undefined && !readSavedAssessmentGroupState(previous))
			return writeCourseOutcome(reporting, outcome) && current();
		const pending =
			outcome.kind === "waiting" ? { id: crypto.randomUUID(), score, passed } : undefined;
		const submitted = readSubmittedAssessmentGroup(previous);
		const clearId = pending ? undefined : submitted?.objective?.id;
		const key = clearId && JSON.stringify([id, clearId]);
		const previousClaim = key ? ledger?.objectives?.get(key) : undefined;
		const claim = key && ledger ? claimGroupObjective(ledger, key) : undefined;
		if (
			clearId &&
			!provider.retireGroupObjective?.(
				id,
				(saved) => prepareGroupObjectiveRetirement(saved, clearId),
				current,
			)
		) {
			if (key && ledger) settleGroupObjective(ledger, key, claim, false);
			return false;
		}
		let accepted = false;
		try {
			accepted = writeCourseOutcome(reporting, outcome) && current();
		} finally {
			// The replay attempt owns its in-flight claim; a decided submission reports acceptance to it.
			if (accepted && previousClaim && previousClaim !== "written")
				previousClaim.acknowledged = true;
			if (key && ledger) settleGroupObjective(ledger, key, claim, accepted);
		}
		if (!accepted) return false;
		if (pending || clearId) {
			handoff(id, { contentSignature, pending, clearId });
			// SCORM 1.2 already holds the capture provisionally before its aggregate interaction.
			if (provider.getSaveResult?.(id)?.status === "pending") {
				const saved = readSubmittedAssessmentGroup(provider.get(id));
				if (!saved || saved.submitted.contentSignature !== contentSignature) {
					handoff(id, null);
					return false;
				}
				captureLearnerBlockState(provider, current).write(id, saved.state, { current });
			}
		}
		return true;
	};
	writer.discard = (id) => {
		handoff(id, null);
	};
	return writer;
}

// ---------------------------------------------------------------------------
// CourseTracker
// ---------------------------------------------------------------------------

export class CourseTracker {
	private runtime: SCORMRuntime;
	private config: TrackingConfig;

	constructor(runtime: SCORMRuntime, config: TrackingConfig) {
		this.runtime = runtime;
		this.config = config;
	}

	/**
	 * Record a page visit and re-evaluate completion.
	 */
	trackPageVisit(pageId: string, bookmark = pageId): void {
		this.runtime.trackPageVisit(pageId);
		this.runtime.setBookmark(bookmark);
		this.checkCompletion();
	}

	/**
	 * Record an interaction (e.g. quiz answer), recalculate the score,
	 * persist it to the runtime, and re-evaluate completion.
	 */
	trackInteraction(
		id: string,
		response: string,
		correct?: boolean,
		score?: number,
		options?: TrackInteractionOptions,
		view?: ChoiceDependencyEvidence,
	): void {
		this.runtime.trackInteraction(id, response, correct, score, options);

		if (score !== undefined) this.writeOutcome("score", this.runtime, view);

		this.checkCompletion(view);
	}

	/**
	 * Average the latest scored attempt for each interaction ID.
	 * Returns 0 when there are no interactions with scores.
	 */
	calculateScore(): number {
		return this.average([...this.latestScored().values()]);
	}

	/** Recompute the authored outcome; pending answers have no learner-visible result. */
	getOutcome(): { score: number; passed: boolean } | undefined {
		const { result } = this.outcome("display");
		return result ? { score: result.score, passed: result.passed } : undefined;
	}

	isAssessmentFinal(id: string): boolean {
		const view = this.config.getChoiceDependencyView?.();
		if (view && view.status(id) !== "current") return false;
		if (this.config.isAssessmentFinal) return this.config.isAssessmentFinal(id);
		const saved = this.config.getAssessmentState?.(id) ?? view?.readState(id);
		const state =
			view && Object.hasOwn(view.questions, id) ? view.admitQuestionState?.(id, saved) : saved;
		return (
			typeof state === "object" &&
			state !== null &&
			!Array.isArray(state) &&
			(state as Record<string, unknown>).completed === true
		);
	}

	/** History changes in-course display only; ordinary launches retain the recorded score. */
	getCurrentScore(): { raw: number; min: number; max: number } | null {
		const view = this.config.getChoiceDependencyView?.();
		if (
			!view ||
			![
				...Object.keys(view.questions),
				...Object.keys(view.groups ?? {}),
				...(view.invalidIds ?? []),
			].some((id) => view.status(id) === "history")
		)
			return this.runtime.getScore();
		const rows = [...this.latestScored().values()].filter(
			(row) => view.status(row.id) === "current",
		);
		return rows.length ? { raw: this.average(rows), min: 0, max: 100 } : null;
	}

	trackGroupObjective(
		id: string,
		score: number,
		passed: boolean,
		runtime = this.runtime,
		view?: ChoiceDependencyEvidence,
		contentSignature?: unknown,
	): boolean {
		const ordinary = this.config.getChoiceDependencyView?.();
		const evidence = view ?? ordinary;
		const outcome = this.outcome({ id, score, passed: passed === true }, evidence ?? null);
		return this.config.writeObjectives
			? this.config.writeObjectives(runtime, outcome, evidence, {
					id,
					score,
					passed,
					contentSignature,
				})
			: writeCourseOutcome(runtime, outcome);
	}

	discardGroupObjective(id: string): void {
		this.config.writeObjectives?.discard(id);
	}

	finish(explicitFinish = false, runtime = this.runtime): boolean {
		return this.writeOutcome(explicitFinish ? "finish" : "end", runtime);
	}

	private writeOutcome(
		intent: "check" | "score" | "prepareCommit" | "finish" | "end",
		runtime = this.runtime,
		candidate?: ChoiceDependencyEvidence,
	): boolean {
		if (this.config.writeObjectives && !candidate)
			return this.config.writeObjectives(
				runtime,
				{ kind: "decided" },
				undefined,
				intent === "prepareCommit" ? intent : undefined,
				() => {
					const view = this.config.getChoiceDependencyView?.();
					return { view, outcome: this.outcome(intent, view ?? null) };
				},
			);
		const view = this.config.getChoiceDependencyView?.();
		return writeCourseOutcome(runtime, this.outcome(intent, candidate ?? view ?? null));
	}

	private average(scores: InteractionRecord[]): number {
		return scores.length
			? scores.reduce((sum, interaction) => sum + (interaction.score as number), 0) / scores.length
			: 0;
	}

	private latestScored(
		interactions = this.runtime.getInteractions(),
	): Map<string, InteractionRecord> {
		const latest = new Map<string, InteractionRecord>();
		for (const interaction of interactions) {
			if (Number.isFinite(interaction.score)) {
				latest.set(interaction.id, interaction);
			}
		}
		return latest;
	}

	private historyIsWaiting(view: ChoiceDependencyEvidence | undefined): boolean {
		if (!view) return false;
		const ids = new Set(this.config.requiredAssessmentIds ?? []);
		const hasPassMark = this.hasPassMark();
		if (hasPassMark) for (const id of this.config.scoredAssessmentIds ?? []) ids.add(id);
		// One set covers every intent, including standalone's legacy quiz completion.
		if (
			this.config.completionMethod === "quiz" &&
			(!hasPassMark || this.config.reportOutcome === false)
		) {
			for (const [id, question] of Object.entries(view.questions)) if (question.graded) ids.add(id);
			const rows = this.runtime.getInteractions();
			for (const row of rows) if (row.id !== "*" && Number.isFinite(row.score)) ids.add(row.id);
		}
		return [...ids].some((id) => view.status(id) === "history");
	}

	/**
	 * Evaluate whether the course should be marked as completed, passed, or
	 * failed based on the configured completion method.
	 */
	checkCompletion(view?: ChoiceDependencyEvidence): void {
		this.writeOutcome("check", this.runtime, view);
	}

	/** A decided commit preserves the adapter's existing write log. */
	prepareCommit(): void {
		this.writeOutcome("prepareCommit");
	}

	// ---- private completion strategies ------------------------------------

	private pageRuleMet(): boolean {
		const aliases = this.config.pageAliases ?? {};
		const visited = new Set(this.runtime.getVisitedPages().map((id) => aliases[id] ?? id)).size;
		if (this.config.completionMethod === "allPages") return visited >= this.config.totalPages;
		const threshold = this.config.completionThreshold ?? DEFAULT_COMPLETION_THRESHOLD * 100;
		return (visited / this.config.totalPages) * 100 >= threshold;
	}

	private hasPassMark(): boolean {
		return (
			typeof this.config.passMark === "number" && (this.config.scoredAssessmentIds?.length ?? 0) > 0
		);
	}

	private courseResult(
		score: number,
		passMark: number,
		ids: string[],
		interactions: InteractionRecord[],
	): CourseResult | null {
		const latest = new Map(interactions.map((record) => [record.id, record]));
		let pending = false;
		let retryable = false;
		for (const id of ids) {
			const result = latest.get(id);
			for (const member of result?.memberIds ?? [id]) {
				const record = latest.get(member);
				if (!record) continue;
				// Member submissions commit before their delayed aggregate event. A newer
				// member makes that aggregate pending, including its last successful retry.
				if (
					interactions.lastIndexOf(record) > interactions.lastIndexOf(result as InteractionRecord)
				)
					pending = true;
				if (record.correct === true) continue;
				const limit = record.maxAttempts ?? 1;
				// A finite limit without a saved count cannot establish an available retry.
				const used = record.attemptsUsed ?? limit;
				if (limit === 0 || used < limit) retryable = true;
			}
		}
		if (this.config.deferRetryableFailure && pending) return null;
		return {
			score,
			passed: score >= passMark,
			retryable,
		};
	}

	private retryPending(outcome: CourseResult | null): boolean {
		return (
			this.config.deferRetryableFailure === true &&
			(!outcome || (!outcome.passed && outcome.retryable))
		);
	}

	/**
	 * Completion follows the page rule; pass/fail follows the score. Runtimes with a
	 * separate success status report both. SCORM 1.2 has one status, and "completed"
	 * would end the attempt before a result exists, so it stays "incomplete" until
	 * the course has a final failure, or passes with the page rule met.
	 */
	outcome(
		intent:
			| "check"
			| "score"
			| "display"
			| "prepareCommit"
			| "end"
			| "finish"
			| { id: string; score: number; passed: boolean } = "check",
		view: ChoiceDependencyEvidence | null = this.config.getChoiceDependencyView?.() ?? null,
	): TrackerOutcome {
		if (this.historyIsWaiting(view ?? undefined))
			return {
				kind: "waiting",
				...(intent === "end"
					? { finish: "complete" as const }
					: intent === "finish"
						? { finish: "terminate" as const }
						: {}),
			};
		if (intent === "prepareCommit") return { kind: "decided" };
		if (typeof intent === "object") return { kind: "decided", objective: intent };
		if (intent === "finish") return { kind: "decided", finish: "terminate" };
		if (intent === "end")
			return {
				kind: "decided",
				completion: "completed",
				forceCompletion: true,
				finish: "complete",
			};
		const hasPassMark = this.hasPassMark();
		if (intent === "display") {
			if (!hasPassMark || !(this.config.isAssessmentFinal || this.config.getAssessmentState))
				return { kind: "decided" };
			const required = new Set([
				...(this.config.scoredAssessmentIds ?? []),
				...(this.config.requiredAssessmentIds ?? []),
			]);
			if (![...required].every((id) => this.isAssessmentFinal(id))) return { kind: "decided" };
		}
		const interactions = this.runtime.getInteractions();
		const latest = this.latestScored(interactions);
		const authored = hasPassMark && (intent !== "check" || this.config.reportOutcome !== false);
		const legacyQuiz = !authored && this.config.completionMethod === "quiz";
		if (intent === "score" && !hasPassMark)
			return {
				kind: "decided",
				score: legacyQuiz ? this.average([...latest.values()]) : undefined,
			};
		const requiredMet = (this.config.requiredAssessmentIds ?? []).every(
			(id) => latest.get(id)?.correct === true,
		);
		if (intent === "check" && !authored) {
			if (!requiredMet) return { kind: "decided", completion: "incomplete", forceCompletion: true };
			if (!legacyQuiz)
				return this.pageRuleMet()
					? { kind: "decided", completion: "completed", forceCompletion: true }
					: { kind: "decided" };
			if (!interactions.length) return { kind: "decided" };
		}
		const ids = authored
			? (this.config.scoredAssessmentIds ?? [])
			: [...new Set(interactions.map((record) => record.id))];
		// Undefined while unanswered; null while a newer group member awaits its aggregate.
		const result = authored
			? ids.every((id) => latest.has(id))
				? this.courseResult(
						this.average(ids.map((id) => latest.get(id) as InteractionRecord)),
						passMarkPercent(this.config.passMark ?? 100),
						ids,
						interactions,
					)
				: undefined
			: legacyQuiz && interactions.length
				? this.courseResult(
						this.average([...latest.values()]),
						this.config.passMark ?? 80,
						ids,
						interactions,
					)
				: undefined;
		if (intent === "display") return { kind: "decided", result };
		if (intent === "score")
			return {
				kind: "decided",
				// A partial authored score would let the LMS judge pass/fail early.
				score: this.config.reportOutcome !== false ? result?.score : undefined,
			};
		const completionMet = authored ? requiredMet && this.pageRuleMet() : true;
		const success = result ? (result.passed ? "passed" : "failed") : "unknown";
		// Combined-status Finish retains failure; separate-success Finish retains
		// only retryable incomplete, preserving its final-failure completion override.
		const courseFailure = result
			? !result.passed && (!this.runtime.setSuccess || this.retryPending(result))
			: undefined;
		let completion: "completed" | "incomplete" | "passed" | "failed";
		const separateSuccess =
			!!this.runtime.setSuccess && (!legacyQuiz || this.config.deferRetryableFailure);
		if (separateSuccess) {
			// Success first, so a completion report carries the current result. Reporting it on
			// every check also tells the runtime a pass mark is active (see SCORM 2004 exit).
			completion =
				completionMet && !(result !== undefined && this.retryPending(result))
					? "completed"
					: "incomplete";
		} else {
			completion =
				result && !result.passed
					? this.retryPending(result)
						? "incomplete"
						: "failed"
					: result?.passed && completionMet
						? "passed"
						: "incomplete";
		}
		return {
			kind: "decided",
			result,
			courseFailure,
			success: separateSuccess ? success : undefined,
			completion,
			forceCompletion: legacyQuiz,
		};
	}
}
