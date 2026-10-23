import { type ActivityEffectTicket, createActivityEffects } from "./activity-effects";
import {
	captureLearnerBlockState,
	type LearnerBlockSaveResult,
	type LearnerBlockStateRuntime,
} from "./learner-block-state";
import type { LearnerStateValue } from "./learner-state";
import { validateDistractorAnswer, type WriteDistractorsRules } from "./write-distractors-content";
import {
	createDistractorMount,
	type DistractorCommand,
	type DistractorMount,
	type DistractorReduction,
	type DistractorReference,
	reduceWriteDistractors,
} from "./write-distractors-state";

export interface WriteDistractorsReference extends DistractorReference {
	blockId: string;
	path: string;
}
type UserCommand = Exclude<DistractorCommand, { generation: number } | { type: "flush" }>;
export type WriteDistractorsCommand = (UserCommand | { type: "retry" }) & { blockId: string };
type Notice = "selfCheckUnavailable" | "distractorsInvalid" | "distractorsChanged";
export interface WriteDistractorsView {
	blockId: string;
	mount: Omit<DistractorMount, "saved" | "pendingWrite">;
	loading: boolean;
	cancelled: boolean;
	notice: Notice | null;
	announcement:
		| "distractorsLoading"
		| "selfCheckUnavailable"
		| "practiceNotSaved"
		| "distractorsAnswerRevealed"
		| null;
}
export interface WriteDistractorsSnapshot {
	activities: readonly WriteDistractorsView[];
}
export interface WriteDistractorsSessionDependencies {
	/** Supplied by the existing document owner's captured lifetime, never a live global lookup. */
	provider: LearnerBlockStateRuntime | undefined;
	current(): boolean;
	admit(
		reference: WriteDistractorsReference,
		retry: boolean,
		ticket: ActivityEffectTicket,
	): Promise<WriteDistractorsRules>;
	deferStart?: boolean;
}

/** W09 attaches this adapter to the existing document lifetime. It owns no DOM or host lifecycle. */
export function createWriteDistractorsSession(
	references: readonly WriteDistractorsReference[],
	dependencies: WriteDistractorsSessionDependencies,
) {
	type Entry = {
		reference: WriteDistractorsReference;
		mount: DistractorMount;
		rules?: WriteDistractorsRules;
		loading: boolean;
		loadId: number;
		notice: Notice | null;
		announcement: WriteDistractorsView["announcement"];
		uncertainStorage: boolean;
		writeDeliberate: boolean;
		readNotSaved: boolean;
		notSavedAnnounced: boolean;
		settle?: () => void;
	};
	let disposed = false,
		started = false;
	const current = () => !disposed && dependencies.current();
	const access = captureLearnerBlockState(dependencies.provider, current);
	const entries = new Map<string, Entry>();
	for (const reference of references) {
		if (entries.has(reference.blockId)) throw new Error("EWRITEDISTRACTORSREFERENCE");
		entries.set(reference.blockId, {
			reference,
			mount: createDistractorMount(reference),
			loading: false,
			loadId: 0,
			notice: null,
			announcement: null,
			uncertainStorage: false,
			writeDeliberate: false,
			readNotSaved: false,
			notSavedAnnounced: false,
		});
	}
	const snapshot = (): WriteDistractorsSnapshot => ({
		activities: [...entries].map(([blockId, entry]) => {
			// Raw refused provider input remains opaque. Never traverse it for display.
			const { saved: _saved, pendingWrite: _pendingWrite, ...mount } = entry.mount;
			return {
				blockId,
				mount: structuredClone(mount),
				loading: entry.loading,
				cancelled: disposed,
				notice: entry.notice,
				announcement: entry.announcement,
			};
		}),
	});

	const effects = createActivityEffects<WriteDistractorsCommand, WriteDistractorsSnapshot>({
		current: () => disposed || dependencies.current(),
		disposed: () => disposed,
		activities: () => entries.keys(),
		snapshot,
		write(blockId) {
			const entry = entries.get(blockId);
			if (!entry?.mount.pendingWrite || !current()) return;
			const value = entry.mount.pendingWrite;
			const pass = effects.ticket(),
				generation = entry.mount.generation,
				writeId = entry.mount.writeSequence;
			let result: LearnerBlockSaveResult | undefined;
			try {
				result = access.write(blockId, value as unknown as LearnerStateValue, pass);
			} catch {
				result = undefined;
			}
			if (!current()) return;
			// Durable evidence is separate from the reducer receipt for the latest draft.
			// A missing receipt can mean execution without acknowledgement. Never infer
			// an empty store from it on a subsequent revision change.
			if (result?.status === "saved") {
				entry.readNotSaved = false;
				entry.mount = { ...entry.mount, saved: value };
				entry.uncertainStorage = false;
			} else if (!result) entry.uncertainStorage = true;
			if (!pass.current()) return;
			apply(
				entry,
				{
					type: "write-result",
					generation,
					writeId,
					outcome: result?.status === "saved" ? "saved" : "failed",
					ticket: pass,
				},
				pass,
				entry.writeDeliberate,
			);
		},
		writeFailed() {},
		project() {},
		published() {
			// Live keys are publication events. A sibling's later completion must not
			// announce them again; persistent save status remains on the mount.
			resetAnnouncements();
		},
	});
	const resetAnnouncements = () => {
		for (const entry of entries.values()) entry.announcement = null;
	};
	const apply = (
		entry: Entry,
		command: DistractorCommand,
		pass: ActivityEffectTicket,
		deliberate = false,
	): DistractorReduction | undefined => {
		// Every adapter outcome has a W06 ticket, including synchronous reset and
		// read delivery. The reducer's optional ticket remains only for pure callers.
		if (!current() || !pass.current()) return;
		const result = reduceWriteDistractors(entry.mount, command, entry.rules);
		if (!pass.current() || !current()) return;
		entry.mount = result.mount;
		if (entry.readNotSaved) entry.mount = { ...entry.mount, notSaved: true };
		if (result.write) entry.writeDeliberate = deliberate;
		const status = result.mount.restoreStatus;
		if (status === "invalid") entry.notice = "distractorsInvalid";
		else if (status === "out-of-date") entry.notice = "distractorsChanged";
		else if (status === "unavailable") entry.notice = "selfCheckUnavailable";
		else if (status !== "conflict" && status !== "pending" && !entry.loading) entry.notice = null;
		if (!entry.mount.notSaved) entry.notSavedAnnounced = false;
		// Only a pending initial read is silent. Queued flushes await their write receipt.
		if (
			deliberate &&
			entry.mount.notSaved &&
			!entry.notSavedAnnounced &&
			(command.type !== "flush" || !result.write) &&
			(entry.mount.readDone || entry.mount.restoreStatus !== "pending")
		) {
			entry.announcement = "practiceNotSaved";
			entry.notSavedAnnounced = true;
		}
		effects.commit(undefined, result.write ? entry.reference.blockId : undefined);
		return result;
	};
	const fail = (entry: Entry, deliberate: boolean) => {
		entry.loading = false;
		apply(
			entry,
			{
				type: "restore-unavailable",
				generation: entry.mount.generation,
				ticket: effects.ticket(),
			},
			effects.ticket(),
		);
		entry.notice = "selfCheckUnavailable";
		if (deliberate) entry.announcement = "selfCheckUnavailable";
		effects.commit();
	};
	const read = (entry: Entry, deliberate = false): boolean => {
		const pass = effects.ticket(),
			generation = entry.mount.generation;
		// FIFO interruptions keep Retry intent; a replacement generation does not.
		const stillDeliberate = () => deliberate && entry.mount.generation === generation;
		let observation: ReturnType<typeof access.read>;
		try {
			observation = access.read(entry.reference.blockId, pass);
		} catch {
			if (current() && pass.current()) {
				entry.uncertainStorage = true;
				fail(entry, deliberate);
			} else if (current())
				effects.append(() => {
					const again = stillDeliberate();
					if (read(entry, again)) restoreOrLoad(entry, again);
				});
			return false;
		}
		if (!current() || !pass.current()) {
			if (current())
				effects.append(() => {
					const again = stillDeliberate();
					if (read(entry, again)) restoreOrLoad(entry, again);
				});
			return false;
		}
		// A missing store is different from a store whose previously observed (or
		// unacknowledged) bytes still need admission. Never discard that evidence.
		if (
			observation.value === undefined &&
			observation.result?.status === "not-saved" &&
			(entry.mount.saved !== undefined || entry.uncertainStorage)
		) {
			fail(entry, deliberate);
			return false;
		}
		entry.readNotSaved = observation.result?.status === "not-saved";
		entry.uncertainStorage = entry.readNotSaved && observation.value !== undefined;
		// Retry after an unacknowledged write observes the store again. An older
		// confirmed receipt must not mask those newly read bytes in the reducer.
		entry.mount = { ...entry.mount, saved: observation.value };
		const held = entry.mount.heldEdits.length > 0;
		const result = apply(
			entry,
			{
				type: "restore",
				value: observation.value,
				generation: entry.mount.generation,
				ticket: pass,
			},
			pass,
		);
		// This is a new local draft, not a restore write. No next gesture is needed.
		if (result?.mount.restoreStatus === "empty" && held)
			apply(entry, { type: "flush" }, effects.ticket(), true);
		return result !== undefined;
	};
	const load = (
		entry: Entry,
		retry: boolean,
		action?: UserCommand,
		resolve: () => void = () => {},
		announce = false,
	) => {
		if (entry.settle !== resolve) entry.settle?.();
		entry.settle = resolve;
		const id = ++entry.loadId,
			generation = entry.mount.generation;
		const wasLoading = entry.loading;
		entry.loading = true;
		if (announce && !wasLoading) entry.announcement = "distractorsLoading";
		effects.commit();
		const eligible = () =>
			current() && entry.loadId === id && entry.mount.generation === generation;
		const pass = effects.activityTicket(eligible);
		let promise: Promise<WriteDistractorsRules>;
		try {
			promise = dependencies.admit(entry.reference, retry, pass);
		} catch (error) {
			promise = Promise.reject(error);
		}
		const complete = (rules?: WriteDistractorsRules) => {
			if (!eligible()) {
				resolve();
				return;
			}
			effects.enqueue(() => {
				if (!eligible() || !pass.current()) {
					resolve();
					return;
				}
				const matches =
					rules &&
					rules.contentRevision === entry.reference.contentRevision &&
					rules.count === entry.reference.count &&
					rules.itemIds.length === entry.reference.itemIds.length &&
					rules.itemIds.every((id, index) => id === entry.reference.itemIds[index]);
				if (!matches) fail(entry, announce);
				else {
					entry.rules = rules;
					entry.loading = false;
					if (entry.mount.restoreWriteHold)
						apply(
							entry,
							{ type: "restore", generation, value: entry.mount.saved, ticket: pass },
							pass,
						);
					if (!entry.mount.restoreWriteHold) {
						entry.notice = null;
						if (action) {
							const result = apply(entry, action, effects.ticket(), true);
							if (action.type === "check" && result?.mount.checkedAnswer)
								entry.announcement = "distractorsAnswerRevealed";
						} else entry.announcement = null;
					} else if (entry.mount.restoreStatus === "pending") fail(entry, announce);
				}
				entry.settle = undefined;
				effects.settle(resolve);
			}, false);
		};
		Promise.resolve(promise).then(
			(rules) => complete(rules),
			() => complete(),
		);
	};
	const restoreOrLoad = (entry: Entry, deliberate = false) => {
		if (entry.mount.restoreStatus === "pending" && entry.mount.readDone && current())
			load(entry, deliberate, undefined, undefined, deliberate);
	};
	const session = {
		ticket() {
			const pass = effects.ticket();
			return { revision: pass.revision, current: () => current() && pass.current() };
		},
		snapshot,
		read(blockId: string) {
			return snapshot().activities.find((entry) => entry.blockId === blockId);
		},
		subscribe(listener: Parameters<typeof effects.subscribe>[0]) {
			// Cancellation may publish a view so controls can detach, but that view's
			// ticket must never grant learner effects after this session is disposed.
			return effects.subscribe((value, pass, command) =>
				listener(
					value,
					{
						revision: pass.revision,
						current: () => current() && pass.current(),
					},
					command,
				),
			);
		},
		initialize() {
			if (started || !current()) return;
			started = true;
			effects.enqueue(() => {
				for (const entry of entries.values())
					effects.append(() => {
						if (read(entry)) restoreOrLoad(entry);
					});
			});
		},
		dispatch(command: WriteDistractorsCommand): Promise<void> {
			return new Promise((resolve, reject) => {
				if (!current()) {
					resolve();
					return;
				}
				effects.enqueue(() => {
					if (!current()) {
						resolve();
						return;
					}
					resetAnnouncements();
					const entry = entries.get(command.blockId);
					if (!entry) {
						reject(new Error("EWRITEDISTRACTORSREFERENCE"));
						return;
					}
					if (command.type === "retry") {
						if (
							entry.loading ||
							entry.notice !== "selfCheckUnavailable" ||
							entry.mount.restoreStatus === "conflict"
						) {
							resolve();
							return;
						}
						apply(
							entry,
							{
								type: "retry",
								generation: entry.mount.generation,
								ticket: effects.ticket(),
							},
							effects.ticket(),
						);
						if (!entry.mount.readDone || entry.uncertainStorage) {
							if (!read(entry, true) || entry.mount.restoreStatus !== "pending") {
								effects.settle(resolve);
								return;
							}
						}
						load(entry, true, undefined, resolve, true);
						return;
					}
					if (command.type === "revision-change") {
						entry.loadId++;
						entry.settle?.();
						entry.settle = undefined;
						entry.loading = false;
						entry.rules = undefined;
						if (entry.uncertainStorage) entry.mount = { ...entry.mount, storageUncertain: true };
						entry.reference = { ...entry.reference, ...command.reference };
					}
					if (command.type === "start-over") {
						entry.loadId++;
						entry.loading = false;
						entry.settle?.();
						entry.settle = undefined;
					}
					if (
						command.type === "check" &&
						!entry.mount.restoreWriteHold &&
						!entry.mount.checkedAnswer &&
						validateDistractorAnswer(entry.mount.value.answer).ok &&
						!entry.rules
					) {
						if (entry.loading) {
							resolve();
							return;
						}
						load(entry, false, command, resolve, true);
						return;
					}
					apply(entry, command, effects.ticket(), true);
					if (command.type === "revision-change") restoreOrLoad(entry);
					effects.settle(resolve);
				});
			});
		},
		flush() {
			if (current())
				effects.enqueue(() => {
					resetAnnouncements();
					for (const entry of entries.values())
						if (entry.mount.notSaved && !entry.mount.restoreWriteHold)
							apply(entry, { type: "flush" }, effects.ticket());
				});
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			effects.enqueue(() => {
				effects.clearWrites();
				resetAnnouncements();
				for (const entry of entries.values()) {
					entry.loadId++;
					entry.loading = false;
					entry.settle?.();
					entry.settle = undefined;
				}
				effects.commit();
			});
		},
	};
	if (!dependencies.deferStart) session.initialize();
	return session;
}
