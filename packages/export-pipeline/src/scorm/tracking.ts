import { DEFAULT_COMPLETION_THRESHOLD } from "@praxity/shared-blocks/constants";
import { type CourseOutcome, writeCourseOutcome } from "@praxity/shared-blocks/learner-block-state";
import type { InteractionRecord, SCORMRuntime, TrackInteractionOptions } from "./types.ts";

export function passMarkPercent(value: number): number {
	return Math.min(100, Math.round(value * 100) / 100);
}

export interface TrackingConfig {
	totalPages: number;
	completionMethod: "allPages" | "percentage" | "quiz";
	completionThreshold?: number;
	passMark?: number;
	scoredAssessmentIds?: string[];
	pageAliases?: Record<string, string>;
	requiredAssessmentIds?: string[];
	deferRetryableFailure?: boolean;
	reportOutcome?: boolean;
	isAssessmentFinal?: (id: string) => boolean;
	getAssessmentState?: (id: string) => unknown;
}

interface CourseResult {
	score: number;
	passed: boolean;
	retryable: boolean;
}

type TrackerOutcome = CourseOutcome & { result?: CourseResult | null };

export class CourseTracker {
	private runtime: SCORMRuntime;
	private config: TrackingConfig;

	constructor(runtime: SCORMRuntime, config: TrackingConfig) {
		this.runtime = runtime;
		this.config = config;
	}

	trackPageVisit(pageId: string, bookmark = pageId): void {
		this.runtime.trackPageVisit(pageId);
		this.runtime.setBookmark(bookmark);
		this.checkCompletion();
	}

	trackInteraction(
		id: string,
		response: string,
		correct?: boolean,
		score?: number,
		options?: TrackInteractionOptions,
	): void {
		this.runtime.trackInteraction(id, response, correct, score, options);

		if (score !== undefined) writeCourseOutcome(this.runtime, this.outcome("score"));

		this.checkCompletion();
	}

	calculateScore(): number {
		return this.average([...this.latestScored().values()]);
	}

	getOutcome(): { score: number; passed: boolean } | undefined {
		const { result } = this.outcome("display");
		return result ? { score: result.score, passed: result.passed } : undefined;
	}

	isAssessmentFinal(id: string): boolean {
		if (this.config.isAssessmentFinal) return this.config.isAssessmentFinal(id);
		const state = this.config.getAssessmentState?.(id);
		return (
			typeof state === "object" &&
			state !== null &&
			!Array.isArray(state) &&
			(state as Record<string, unknown>).completed === true
		);
	}

	trackGroupObjective(id: string, score: number, passed: boolean, runtime = this.runtime): void {
		writeCourseOutcome(runtime, this.outcome({ id, score, passed }));
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

	checkCompletion(): void {
		writeCourseOutcome(this.runtime, this.outcome("check"));
	}

	prepareCommit(): void {
		writeCourseOutcome(this.runtime, this.outcome("prepareCommit"));
	}

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
				if (
					interactions.lastIndexOf(record) > interactions.lastIndexOf(result as InteractionRecord)
				)
					pending = true;
				if (record.correct === true) continue;
				const limit = record.maxAttempts ?? 1;
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

	outcome(
		intent:
			| "check"
			| "score"
			| "display"
			| "prepareCommit"
			| "end"
			| "finish"
			| { id: string; score: number; passed: boolean } = "check",
	): TrackerOutcome {
		if (intent === "prepareCommit") return {};
		if (typeof intent === "object") return { objective: intent };
		if (intent === "finish") return { finish: "terminate" };
		if (intent === "end")
			return {
				completion: "completed",
				forceCompletion: true,
				finish: "complete",
			};
		const hasPassMark = this.hasPassMark();
		if (intent === "display") {
			if (!hasPassMark || !(this.config.isAssessmentFinal || this.config.getAssessmentState))
				return {};
			const required = new Set([
				...(this.config.scoredAssessmentIds ?? []),
				...(this.config.requiredAssessmentIds ?? []),
			]);
			if (![...required].every((id) => this.isAssessmentFinal(id))) return {};
		}
		const interactions = this.runtime.getInteractions();
		const latest = this.latestScored(interactions);
		const authored = hasPassMark && (intent !== "check" || this.config.reportOutcome !== false);
		const legacyQuiz = !authored && this.config.completionMethod === "quiz";
		if (intent === "score" && !hasPassMark)
			return {
				score: legacyQuiz ? this.average([...latest.values()]) : undefined,
			};
		const requiredMet = (this.config.requiredAssessmentIds ?? []).every(
			(id) => latest.get(id)?.correct === true,
		);
		if (intent === "check" && !authored) {
			if (!requiredMet) return { completion: "incomplete", forceCompletion: true };
			if (!legacyQuiz)
				return this.pageRuleMet() ? { completion: "completed", forceCompletion: true } : {};
			if (!interactions.length) return {};
		}
		const ids = authored
			? (this.config.scoredAssessmentIds ?? [])
			: [...new Set(interactions.map((record) => record.id))];
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
		if (intent === "display") return { result };
		if (intent === "score")
			return {
				score: this.config.reportOutcome !== false ? result?.score : undefined,
			};
		const completionMet = authored ? requiredMet && this.pageRuleMet() : true;
		const success = result ? (result.passed ? "passed" : "failed") : "unknown";
		const courseFailure = result
			? !result.passed && (!this.runtime.setSuccess || this.retryPending(result))
			: undefined;
		let completion: "completed" | "incomplete" | "passed" | "failed";
		const separateSuccess =
			!!this.runtime.setSuccess && (!legacyQuiz || this.config.deferRetryableFailure);
		if (separateSuccess) {
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
			result,
			courseFailure,
			success: separateSuccess ? success : undefined,
			completion,
			forceCompletion: legacyQuiz,
		};
	}
}
