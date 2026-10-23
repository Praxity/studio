import { type ActivityEffectTicket, createActivityEffects } from "./activity-effects";
import type { LearnerStateValue } from "./learner-state";
import {
	createSelfCheckDraft,
	readSelfCheckDraftAnswer,
	updateSelfCheckDraftAnswer,
} from "./self-check-draft";
import type { SelfCheckState, SelfCheckStateResult } from "./self-check-state";

export interface SelfCheckReference {
	blockId: string;
	contentRevision: string;
	path: string;
	/** This activity has no dependent page or course gate; it settles independently. */
	independent?: boolean;
}
export type SelfCheckOutcome =
	| "pending"
	| "empty"
	| "draft"
	| "submitted"
	| "refused"
	| "unavailable"
	| "cancelled";
export type SelfCheckFailure =
	| "activity-changed"
	| "saved-state-invalid"
	| "comparison-unavailable";
export interface SelfCheckView {
	blockId: string;
	outcome: SelfCheckOutcome;
	completed: boolean;
	available: boolean;
	origin: "fresh" | "restore" | "interaction";
	generation: number;
	admitted: boolean;
	code?: SelfCheckFailure;
}
export interface SelfCheckSnapshot {
	ready: boolean;
	startup: "pending" | "ready" | "unavailable" | "cancelled";
	activities: readonly SelfCheckView[];
	failures: readonly { blockId: string; code: SelfCheckFailure }[];
}
/** Admission keeps full authored Content inside the lazy adapter. */
export interface SelfCheckOperations {
	restore(value: unknown): SelfCheckStateResult;
	edit(value: unknown, draft: SelfCheckState["draft"]): SelfCheckStateResult;
	submit(value: unknown): SelfCheckStateResult;
	reset(): SelfCheckStateResult;
}
export interface SelfCheckSessionDependencies {
	read(blockId: string): LearnerStateValue | undefined;
	write(blockId: string, value: SelfCheckState | LearnerStateValue): void;
	admit(reference: SelfCheckReference, retry: boolean): Promise<SelfCheckOperations>;
	// Private state reaches only the comparison adapter, never completion subscribers.
	project?(blockId: string, result: SelfCheckStateResult): void;
	current?(cancelled: boolean): boolean;
	deferStart?: boolean;
	startupPending?: boolean;
}
export type SelfCheckTicket = ActivityEffectTicket;
export type SelfCheckCommand =
	| { type: "edit"; blockId: string; answer: string; ticked?: string[] }
	| { type: "show-feedback" | "start-over" | "retry"; blockId: string };
export interface SelfCheckDispatch extends Promise<SelfCheckStateResult | undefined> {
	current(): boolean;
}
export type SelfCheckSession = ReturnType<typeof createSelfCheckSession>;

const unavailable = {
	outcome: "unavailable",
	completed: false,
	available: false,
	code: "comparison-unavailable",
} as const;

export function createSelfCheckSession(
	references: readonly SelfCheckReference[],
	dependencies: SelfCheckSessionDependencies,
) {
	type Entry = {
		reference: SelfCheckReference;
		value: unknown;
		view: SelfCheckView;
		operations?: SelfCheckOperations;
		result?: SelfCheckStateResult;
		edit?: { answer: string; ticked?: string[] };
		readDone: boolean;
		reset: boolean;
		projected?: SelfCheckStateResult;
	};
	const entries = new Map<string, Entry>();
	let disposed = false,
		started = false,
		commandIntent = 0;
	let readySettled = false,
		resolveReady!: (s: SelfCheckSnapshot) => void;
	let startup: SelfCheckSnapshot["startup"] = dependencies.startupPending ? "pending" : "ready";
	const ready = new Promise<SelfCheckSnapshot>((resolve) => (resolveReady = resolve));
	const current = () => dependencies.current?.(disposed) !== false;
	const snapshot = (): SelfCheckSnapshot => {
		const settled =
			startup !== "pending" &&
			[...entries.values()].every((e) => e.reference.independent || e.view.outcome !== "pending");
		const activities = [...entries.values()].map(({ view, reference }) => ({
			...view,
			...(startup === "unavailable" && view.outcome !== "cancelled" ? unavailable : {}),
			completed:
				startup === "ready" && (settled || reference.independent === true) && view.completed,
			available:
				startup === "ready" && (settled || reference.independent === true) && view.available,
		}));
		return {
			ready: settled,
			startup,
			activities,
			failures: activities.flatMap(({ blockId, code }) => (code ? [{ blockId, code }] : [])),
		};
	};
	const accept = (entry: Entry, result: SelfCheckStateResult) => {
		entry.result = result;
		if (result.status === "empty" || result.status === "valid") entry.value = result.state;
		const refused = result.status === "invalid" || result.status === "out-of-date";
		entry.view = {
			...entry.view,
			outcome: refused
				? "refused"
				: result.completed
					? "submitted"
					: result.status === "empty"
						? "empty"
						: "draft",
			completed: !refused && result.completed,
			available: !refused,
			code: refused
				? result.status === "out-of-date"
					? "activity-changed"
					: "saved-state-invalid"
				: undefined,
		};
	};
	const effects = createActivityEffects<SelfCheckCommand, SelfCheckSnapshot>({
		current,
		disposed: () => disposed,
		activities: () => entries.keys(),
		snapshot,
		write(blockId) {
			dependencies.write(blockId, entries.get(blockId)?.value as LearnerStateValue);
		},
		writeFailed(blockId) {
			const entry = entries.get(blockId);
			if (entry) {
				entry.view = { ...entry.view, ...unavailable };
				commit();
			}
		},
		project(pass) {
			if (!snapshot().ready) return;
			for (const entry of entries.values()) {
				if (!entry.result || entry.projected === entry.result) continue;
				try {
					dependencies.project?.(entry.reference.blockId, entry.result);
				} catch {
					if (pass.current()) {
						entry.projected = entry.result;
						entry.view = { ...entry.view, ...unavailable };
						commit();
					}
				}
				if (!pass.current()) return;
				entry.projected = entry.result;
			}
		},
		published(value) {
			if (value.ready && !readySettled) {
				readySettled = true;
				resolveReady(value);
			}
		},
	});
	const { ticket, enqueue } = effects;
	const commit = (command?: SelfCheckCommand, write?: Entry) =>
		effects.commit(command, write?.reference.blockId);

	const load = (
		entry: Entry,
		retry: boolean,
		command?: SelfCheckCommand,
		settle?: (r?: SelfCheckStateResult, pass?: SelfCheckTicket) => void,
	) => {
		const generation = ++entry.view.generation;
		entry.view = {
			...entry.view,
			outcome: "pending",
			completed: false,
			available: false,
			code: undefined,
		};
		const admission = () => !disposed && current() && entry.view.generation === generation;
		commit(command);
		const fail = () => {
			if (admission()) {
				entry.view = { ...entry.view, ...unavailable };
				commit();
			}
			if (settle) effects.settle(() => settle());
		};
		const complete = (operations: SelfCheckOperations) => {
			if (!admission()) {
				settle?.();
				return;
			}
			const pass = ticket();
			let result: SelfCheckStateResult;
			try {
				result = operations.restore(entry.value);
				if (!pass.current()) {
					if (admission()) effects.append(() => complete(operations));
					else settle?.();
					return;
				}
				const edited = entry.edit;
				if (edited)
					result = operations.edit(entry.value, {
						answer: edited.answer,
						ticked: edited.ticked ?? result.state?.draft.ticked ?? [],
						shown: false,
					});
				if (!pass.current()) {
					if (admission()) effects.append(() => complete(operations));
					else settle?.();
					return;
				}
				if (!admission()) {
					settle?.();
					return;
				}
				entry.operations = operations;
				entry.view.admitted = true;
				entry.edit = undefined;
				accept(entry, result);
				const committed = commit(undefined, edited && result.state ? entry : undefined);
				if (settle)
					effects.settle(() => settle(committed.current() ? result : undefined, committed));
			} catch {
				if (!pass.current() && admission()) effects.append(() => complete(operations));
				else fail();
			}
		};
		try {
			const promise = dependencies.admit(entry.reference, retry);
			Promise.resolve(promise).then(
				(operations) => {
					if (admission()) enqueue(() => complete(operations));
					else settle?.();
				},
				() => {
					if (admission()) enqueue(fail);
					else settle?.();
				},
			);
		} catch {
			fail();
		}
	};
	const initializeEntry = (entry: Entry) => {
		if (disposed || !current() || entry.readDone) return;
		const pass = ticket();
		let value: LearnerStateValue | undefined,
			failed = false;
		try {
			value = dependencies.read(entry.reference.blockId);
		} catch {
			failed = true;
		}
		if (!pass.current()) {
			if (!disposed && current()) effects.append(() => initializeEntry(entry));
			return;
		}
		entry.readDone = true;
		if (entry.reset) return;
		// A resumed read merges its captured provider state beneath the explicit draft.
		if (entry.edit) value = updateSelfCheckDraftAnswer(entry.edit.answer, value);
		entry.value = value;
		entry.view = {
			...entry.view,
			outcome: failed ? "unavailable" : value === undefined ? "empty" : "pending",
			available: !failed && value === undefined,
			origin: value === undefined ? "fresh" : "restore",
			code: failed ? "comparison-unavailable" : undefined,
		};
		commit();
		if (!failed && value !== undefined) load(entry, false);
	};
	const equivalent = (entry: Entry | undefined, command: SelfCheckCommand) => {
		if (
			command.type !== "edit" ||
			!entry ||
			entry.view.outcome === "pending" ||
			entry.result?.status !== "valid" ||
			entry.result.response !== null ||
			entry.value !== entry.result.state
		)
			return false;
		const draft = entry.result.state?.draft;
		return (
			draft?.answer === command.answer &&
			(command.ticked === undefined ||
				(command.ticked.length === draft.ticked.length &&
					command.ticked.every((id, index) => id === draft.ticked[index])))
		);
	};
	for (const reference of references) {
		if (entries.has(reference.blockId)) throw new Error("ESELFCHECKREFERENCE");
		entries.set(reference.blockId, {
			reference,
			value: undefined,
			readDone: false,
			reset: false,
			view: {
				blockId: reference.blockId,
				outcome: "pending",
				completed: false,
				available: false,
				origin: "fresh",
				generation: 0,
				admitted: false,
			},
		});
	}
	const session = {
		ready,
		ticket,
		startup(outcome?: "pending" | "ready" | "unavailable") {
			if (outcome && !disposed && current())
				enqueue(() => {
					if (disposed || !current() || outcome === startup) return;
					startup = outcome;
					commit();
				});
			return startup;
		},
		refresh() {
			if (!disposed && current()) effects.refresh();
		},
		initialize() {
			if (started || disposed || !current()) return;
			started = true;
			// Every member has independent progress; one reentrant read cannot abandon siblings.
			enqueue(() => {
				for (const entry of entries.values()) effects.append(() => initializeEntry(entry));
				commit();
			});
		},
		draftAnswer(blockId: string) {
			const entry = entries.get(blockId);
			return (
				entry?.edit?.answer ??
				entry?.result?.recoverableAnswer ??
				readSelfCheckDraftAnswer(entry?.value)
			);
		},
		read(blockId: string) {
			const value = snapshot(),
				view = value.activities.find((a) => a.blockId === blockId);
			return view ? { ...view, ready: value.ready, startup: value.startup } : undefined;
		},
		dispatch(command: SelfCheckCommand): SelfCheckDispatch {
			let completion: SelfCheckTicket | undefined;
			let issued = commandIntent;
			const receipt = (promise: Promise<SelfCheckStateResult | undefined>): SelfCheckDispatch =>
				Object.assign(promise, {
					current: () => issued === commandIntent && completion?.current() === true && !disposed,
				});
			if (disposed || !current()) return receipt(Promise.resolve(undefined));
			const existing = entries.get(command.blockId);
			if (!effects.busy && equivalent(existing, command)) {
				completion = ticket();
				return receipt(Promise.resolve(existing?.result));
			}
			issued = ++commandIntent;
			return receipt(
				new Promise((resolvePromise, reject) => {
					const resolve = (result?: SelfCheckStateResult, pass?: SelfCheckTicket) => {
						completion = pass;
						resolvePromise(result);
					};
					enqueue(() => {
						if (disposed || !current()) {
							resolve(undefined);
							return;
						}
						const entry = entries.get(command.blockId);
						if (!entry) {
							reject(new Error("ESELFCHECKREFERENCE"));
							return;
						}
						if (equivalent(entry, command)) {
							resolve(entry.result, ticket());
							return;
						}
						if (command.type === "retry") {
							entry.view.origin = entry.value === undefined ? "fresh" : "restore";
							load(entry, true, command, resolve);
							return;
						}
						const before = ticket();
						let result: SelfCheckStateResult | undefined;
						try {
							if (command.type === "start-over") {
								result = entry.operations?.reset() ?? {
									status: "empty",
									state: createSelfCheckDraft(),
									recoverableAnswer: "",
									attempted: false,
									completed: false,
									response: null,
								};
								if (!before.current()) {
									resolve(undefined);
									return;
								}
								++entry.view.generation;
								entry.view.origin = "interaction";
								entry.edit = undefined;
								entry.reset = true;
								accept(entry, result);
							} else if (command.type === "edit") {
								if (!entry.operations) {
									const freshValue = entry.value === undefined;
									entry.edit = {
										answer: command.answer,
										ticked: command.ticked ?? entry.edit?.ticked,
									};
									entry.value = updateSelfCheckDraftAnswer(
										command.answer,
										entry.value as LearnerStateValue | undefined,
									);
									if (entry.view.outcome === "empty" || entry.view.outcome === "draft") {
										result = {
											status: "valid",
											state: entry.value as SelfCheckState,
											recoverableAnswer: command.answer,
											attempted: false,
											completed: false,
											response: null,
										};
										accept(entry, result);
									} else if (
										entry.result?.state &&
										(entry.result.status === "empty" || entry.result.status === "valid")
									) {
										// Save failure does not freeze the last previously admitted draft projection.
										entry.result = {
											...entry.result,
											status: "valid",
											state: entry.value as SelfCheckState,
											recoverableAnswer: command.answer,
											response: null,
										};
									} else if (freshValue) {
										// A learner-created fresh draft is safe to project even when comparison loading failed.
										entry.result = {
											status: "valid",
											state: entry.value as SelfCheckState,
											recoverableAnswer: command.answer,
											attempted: false,
											completed: false,
											response: null,
										};
									}
								} else {
									result = entry.operations.edit(entry.value, {
										answer: command.answer,
										ticked:
											command.ticked ??
											entry.edit?.ticked ??
											entry.result?.state?.draft.ticked ??
											[],
										shown: false,
									});
									if (!before.current()) {
										resolve(undefined);
										return;
									}
									if (entry.view.outcome === "pending") {
										// Existing content validates the draft while Retry's replacement admission waits.
										entry.edit = { answer: command.answer, ticked: result.state?.draft.ticked };
										entry.result = result;
									} else {
										entry.edit = undefined;
										accept(entry, result);
									}
								}
							} else {
								if (
									!entry.operations ||
									["pending", "unavailable", "cancelled"].includes(entry.view.outcome)
								)
									throw new Error("ESELFCHECKNOTREADY");
								result = entry.operations.submit(entry.value);
								if (!before.current()) {
									resolve(undefined);
									return;
								}
								++entry.view.generation;
								entry.view.origin = "interaction";
								accept(entry, result);
							}
							if (result?.state) entry.value = result.state;
							const committed = commit(command, entry);
							effects.settle(() =>
								resolve(committed.current() && !disposed ? result : undefined, committed),
							);
						} catch (error) {
							reject(error);
						}
					});
				}),
			);
		},
		subscribe: effects.subscribe,
		dispose() {
			if (disposed) {
				// A cancellation listener can reenter before the owner handoff finishes.
				enqueue(() => {
					commit();
				});
				return;
			}
			// Revocation happens at call time, even inside an injected operation.
			disposed = true;
			enqueue(() => {
				startup = "cancelled";
				effects.clearWrites();
				for (const entry of entries.values()) {
					++entry.view.generation;
					entry.view = {
						...entry.view,
						outcome: "cancelled",
						completed: false,
						available: false,
						code: undefined,
					};
				}
				commit();
				if (!readySettled) {
					readySettled = true;
					resolveReady(snapshot());
				}
			});
		},
	};
	if (!dependencies.deferStart) session.initialize();
	return session;
}
