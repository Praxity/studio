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
				| "commit-refused"
				| "unreadable-state"
				| "runtime-loading";
	  };

export interface LearnerBlockStateRuntime {
	getChoiceDependencyView?(): ChoiceDependencyEvidence | undefined;
	get(blockId: string): LearnerStateValue | undefined;
	set(blockId: string, value: LearnerStateValue): void;
	stageSubmission?(blockId: string, write: () => boolean): boolean;
	getSaveResult?(blockId: string): LearnerBlockSaveResult | undefined;
	getPolicy?(blockId: string): "device" | "lms";
	getReportingDestination?(blockId: string): "device" | "lms";
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
			return lifetime() ? provider.getSaveResult?.(blockId) : undefined;
		},
	};
}
