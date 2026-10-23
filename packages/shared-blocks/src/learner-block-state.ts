import type { ChoiceDependencyEvidence } from "./choice-learner-state";
import type { LearnerStateValue } from "./learner-state";
import type { SelfCheckTicket } from "./self-check-session";
import { finishRuntimeCourse } from "./tracking";

export { type CourseOutcome, writeCourseOutcome } from "./tracking";

export type LearnerBlockSaveResult =
	| { status: "pending" }
	| { status: "saved"; destination: "device" | "lms" }
	| {
			status: "not-saved";
			code:
				| "identity-unavailable"
				| "storage-unavailable"
				| "runtime-write-failed"
				| "unreadable-state"
				| "runtime-loading";
	  };

export interface LearnerBlockStateRuntime {
	get(blockId: string): LearnerStateValue | undefined;
	/** Optional evidence capability, installed only when reporting and recovery admit it. */
	getChoiceDependencyView?(): ChoiceDependencyEvidence | undefined;
	/** Read-only saved envelope revision; null cannot establish preview build evidence. */
	getSavedBuildRevision?(blockId: string): string | null;
	set(blockId: string, value: LearnerStateValue): void;
	/** Accept state provisionally; a bounded host commits it with the following interaction. */
	stageSubmission?(blockId: string, write: () => boolean): boolean;
	getSaveResult?(blockId: string): LearnerBlockSaveResult | undefined;
	getPolicy?(blockId: string): "device" | "lms";
	/** Effective reporting destination, independent of where drafts are stored. */
	getReportingDestination?(blockId: string): "device" | "lms";
	/** The session owner calls this after variables and gate effects finalize. */
	finalizeLearner?(ticket: SelfCheckTicket): void;
}

declare global {
	interface Window {
		__praxityBlockState?: LearnerBlockStateRuntime;
		__praxityFinishCourse?: (current?: () => boolean) => boolean;
		__praxityTracker?: {
			trackPageVisit?: (pageId: string, bookmark?: string) => void;
			getOutcome?: () => { score: number; passed: boolean } | undefined;
		};
		__praxityRuntime?: {
			trackNavigation?: (fromPageId: string, toPageId: string, trigger: string) => void;
			getVisitedPages?: () => string[];
			getScore?: () => { raw: number; min: number; max: number } | null;
			getSuspendData?: () => string | null;
			setSuspendData?: (data: string) => void;
			getValue?: (key: string) => string | null;
			setCompletion?: (status: string) => void;
			commit?: () => void;
		};
	}
}

/** Reads pass through; writes retain the ticket of their cause. */
export function learnerRuntime(
	current: () => boolean,
	doc: Document | undefined = globalThis.document,
) {
	const runtime = doc?.defaultView?.__praxityRuntime;
	return runtime && withLearnerStateAuthority(runtime, current);
}

export function learnerTracker(
	current: () => boolean,
	doc: Document | undefined = globalThis.document,
) {
	const tracker = doc?.defaultView?.__praxityTracker;
	return tracker && withLearnerStateAuthority(tracker, current);
}

export function finishLearnerCourse(
	current: () => boolean,
	doc: Document | undefined = globalThis.document,
): boolean {
	if (!current()) return false;
	const finish = doc?.defaultView?.__praxityFinishCourse;
	if (finish) return finish(current);
	const runtime = learnerRuntime(current, doc);
	finishRuntimeCourse(runtime);
	return current();
}

/** Tracker state and reporting methods retain their admitted adapter and refuse revocation. */
export function withLearnerStateAuthority<T extends object>(
	provider: T,
	current: () => boolean,
): T {
	return new Proxy(provider, {
		get(target, name) {
			const value = Reflect.get(target, name, target);
			if (typeof value === "object") return undefined;
			if (typeof value !== "function") return value;
			const reads = typeof name === "string" && /^(?:get|has|calculateScore$)/.test(name);
			return (...args: unknown[]) =>
				!reads && !current() ? false : Reflect.apply(value, target, args);
		},
	});
}

export function readLearnerBlockState(blockId: string): LearnerStateValue | undefined {
	return typeof window === "undefined" ? undefined : window.__praxityBlockState?.get(blockId);
}

/** All learner writes retain the caller's authority, including across reentrant callbacks. */
export function writeLearnerBlockState(
	blockId: string,
	value: LearnerStateValue,
	current: () => boolean,
	doc: Document | undefined = typeof document === "undefined" ? undefined : document,
): boolean {
	const provider = doc?.defaultView?.__praxityBlockState;
	if (!provider || !current()) return false;
	provider.set(blockId, value);
	return current();
}

export function readLearnerBlockSaveResult(blockId: string): LearnerBlockSaveResult | undefined {
	return typeof window === "undefined"
		? undefined
		: window.__praxityBlockState?.getSaveResult?.(blockId);
}

export function readLearnerBlockPolicy(blockId: string): "device" | "lms" | undefined {
	return typeof window === "undefined"
		? undefined
		: window.__praxityBlockState?.getPolicy?.(blockId);
}

/** A session retains one admitted provider. Replacement can never redirect its writes. */
export function captureLearnerBlockState(
	provider: LearnerBlockStateRuntime | undefined,
	lifetime: () => boolean,
) {
	return {
		read(blockId: string, ticket: { current(): boolean }) {
			if (!lifetime() || !ticket.current() || !provider) throw new Error("EACTIVITYPROVIDER");
			const before = provider.getSaveResult?.(blockId);
			const noStore = before?.status === "not-saved" && before.code === "storage-unavailable";
			if (!lifetime() || !ticket.current()) throw new Error("EACTIVITYPROVIDER");
			const value = provider.get(blockId);
			if (!lifetime() || !ticket.current()) throw new Error("EACTIVITYPROVIDER");
			const result = provider.getSaveResult?.(blockId);
			// An absent device store reports unavailable before get. The host also
			// catches failed reads and reports unavailable afterward; that transition
			// cannot establish an empty store or authorize overwriting unread bytes.
			if (
				value === undefined &&
				result?.status === "not-saved" &&
				(!noStore || result.code !== "storage-unavailable")
			)
				throw new Error(result.code);
			return { value, result };
		},
		write(blockId: string, value: LearnerStateValue, ticket: { current(): boolean }) {
			if (!lifetime() || !ticket.current() || !provider) return undefined;
			provider.set(blockId, value);
			// A saved receipt is also evidence of stored bytes, even if an injected set
			// queued a newer edit. The session must not certify that newer draft with it.
			return lifetime() ? provider.getSaveResult?.(blockId) : undefined;
		},
	};
}
