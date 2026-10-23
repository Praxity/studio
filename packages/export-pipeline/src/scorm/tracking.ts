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
	prepareGroupObjectiveSave,
	readSavedAssessmentGroupState,
	readSubmittedAssessmentGroup,
} from "@praxity/shared-blocks/learner-state";
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

/** Snapshot only the incoming submission. Saved obligations are never replayed here. */
export function createDeferredGroupObjectiveWriter(
	provider: LearnerBlockStateRuntime,
	current: () => boolean,
): GroupObjectiveWriter | undefined {
	const handoff = provider.admitGroupObjectives?.(current, {
		read: readSubmittedAssessmentGroup,
		prepare: prepareGroupObjectiveSave,
	});
	if (!handoff) return undefined;
	const writer: GroupObjectiveWriter = (runtime, outcome, view, intent) => {
		const reporting = runtime && withLearnerStateAuthority(runtime, current);
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
		const clearId = pending ? undefined : readSubmittedAssessmentGroup(previous)?.objective?.id;
		// Outcome callbacks can revoke authority before a waiting handoff is queued.
		if (!writeCourseOutcome(reporting, outcome) || !current()) return false;
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

		if (score !== undefined) writeCourseOutcome(this.runtime, this.outcome("score", view));

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
		const evidence = view ?? this.config.getChoiceDependencyView?.();
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
		return writeCourseOutcome(runtime, this.outcome(explicitFinish ? "finish" : "end"));
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
		writeCourseOutcome(this.runtime, this.outcome("check", view));
	}

	/** A decided commit preserves the adapter's existing write log. */
	prepareCommit(): void {
		writeCourseOutcome(this.runtime, this.outcome("prepareCommit"));
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
