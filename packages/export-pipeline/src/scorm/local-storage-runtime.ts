/**
 * localStorage-backed SCORMRuntime fallback.
 *
 * Extracted into its own module to keep the runtime factory small.
 */

import {
	createLearnerState,
	type LearnerStateV1,
	type LearnerStateValue,
	parseLearnerState,
	serializeLearnerState,
} from "@praxity/shared-blocks/learner-state";
import {
	DEVICE_DESTINATIONS,
	type InteractionRecord,
	prepareRuntimeCommit,
	type RuntimeCommitPreparation,
	type SCORMRuntime,
	type TrackInteractionOptions,
} from "./types.ts";

const PREFIX = "praxity_";

type RuntimeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * A localStorage-backed SCORMRuntime that works without any LMS.
 * Useful for previewing courses locally or running in standalone web mode.
 * Course builds namespace data by course and attempt; direct legacy callers
 * without a course ID retain the original `praxity_` keys.
 */
export class LocalStorageRuntime implements SCORMRuntime {
	readonly destinations = DEVICE_DESTINATIONS;
	private storage: RuntimeStorage;
	private prefix: string;
	private courseId?: string;
	private attemptId: string;
	private revision: string | null;
	private generation = 0;
	private persistent = true;
	private lastWriteSaved = false;
	private commitPreparation: RuntimeCommitPreparation = {};

	constructor(storage?: Storage, courseId?: string, attemptId = "default", revision?: string) {
		try {
			storage ??= globalThis.localStorage;
		} catch (error) {
			if ((error as DOMException | null)?.name !== "SecurityError") throw error;
			// Restricted browser contexts can deny the accessor itself. Keep the host
			// operational without persistence so navigation still receives runtime-ready.
		}
		this.persistent = !!storage;
		this.storage = storage ?? createNoopStorage();
		this.courseId = courseId;
		this.attemptId = attemptId;
		this.revision = revision ?? null;
		this.prefix = courseId
			? `${courseStoragePrefix(courseId)}${encodeURIComponent(attemptId)}:`
			: PREFIX;
		if (courseId) this.generation = this.readState().generation;
	}

	initialize(): boolean {
		return true;
	}

	terminate(): boolean {
		return prepareRuntimeCommit(this.commitPreparation);
	}

	trackPageVisit(pageId: string): void {
		if (
			this.updateState((state) => {
				if (!state.visitedPageIds.includes(pageId)) state.visitedPageIds.push(pageId);
			})
		) {
			return;
		}
		const pages = this.getVisitedPages();
		if (!pages.includes(pageId)) {
			pages.push(pageId);
			this.storage.setItem(this.prefix + "visited_pages", JSON.stringify(pages));
		}
	}

	getVisitedPages(): string[] {
		if (this.courseId) return [...this.readState().visitedPageIds];
		const raw = this.storage.getItem(this.prefix + "visited_pages");
		if (!raw) return [];
		try {
			return JSON.parse(raw) as string[];
		} catch {
			return [];
		}
	}

	trackInteraction(
		id: string,
		response: string,
		correct?: boolean,
		score?: number,
		_options?: TrackInteractionOptions,
	): void {
		if (
			this.updateState((state) => {
				state.interactions.push({ id, response, correct, score, timestamp: Date.now() });
			})
		) {
			return;
		}
		const interactions = this.getInteractions();
		const record: InteractionRecord = {
			id,
			response,
			correct,
			score,
			timestamp: Date.now(),
		};
		interactions.push(record);
		this.storage.setItem(this.prefix + "interactions", JSON.stringify(interactions));
	}

	getInteractions(): InteractionRecord[] {
		if (this.courseId) return [...this.readState().interactions];
		const raw = this.storage.getItem(this.prefix + "interactions");
		if (!raw) return [];
		try {
			return JSON.parse(raw) as InteractionRecord[];
		} catch {
			return [];
		}
	}

	setCompletion(status: "incomplete" | "completed" | "passed" | "failed"): void {
		if (this.updateState((state) => (state.completion = status))) return;
		this.storage.setItem(this.prefix + "completion", status);
	}

	getCompletion(): string {
		if (this.courseId) return this.readState().completion;
		return this.storage.getItem(this.prefix + "completion") ?? "incomplete";
	}

	setScore(raw: number, min: number, max: number): void {
		if (this.updateState((state) => (state.score = { raw, min, max }))) return;
		this.storage.setItem(this.prefix + "score", JSON.stringify({ raw, min, max }));
	}

	getScore(): { raw: number; min: number; max: number } | null {
		if (this.courseId) return this.readState().score;
		const raw = this.storage.getItem(this.prefix + "score");
		if (!raw) return null;
		try {
			return JSON.parse(raw) as { raw: number; min: number; max: number };
		} catch {
			return null;
		}
	}

	setBookmark(pageId: string): void {
		if (this.updateState((state) => (state.bookmark = pageId))) return;
		this.storage.setItem(this.prefix + "bookmark", pageId);
	}

	getBookmark(): string | null {
		if (this.courseId) return this.readState().bookmark;
		return this.storage.getItem(this.prefix + "bookmark") ?? null;
	}

	setSuspendData(data: string): void {
		if (this.updateState((state) => (state.custom = data))) return;
		this.storage.setItem(this.prefix + "suspend_data", data);
	}

	getSuspendData(): string | null {
		if (this.courseId) return this.readState().custom;
		return this.storage.getItem(this.prefix + "suspend_data") ?? null;
	}

	getBlockState(blockId: string): LearnerStateValue | undefined {
		const blocks = this.courseId ? this.readState().blockState : {};
		return Object.hasOwn(blocks, blockId) ? blocks[blockId] : undefined;
	}

	getSavedBuildRevision(): string | null {
		if (!this.courseId || !this.persistent) return null;
		// readState may migrate legacy keys. Evidence reads must leave every byte intact.
		const raw = this.storage.getItem(this.prefix + "state");
		return raw === null
			? null
			: (parseLearnerState(raw, { courseId: this.courseId, attemptId: this.attemptId })?.revision ??
					null);
	}

	setBlockState(blockId: string, value: LearnerStateValue): boolean {
		this.lastWriteSaved = false;
		if (!blockId) return false;
		this.updateState((state) => {
			state.blockState = { ...state.blockState, [blockId]: value };
		});
		return this.lastWriteSaved;
	}

	hasPersistentStorage(): boolean {
		return this.persistent;
	}

	/** Reset only this course attempt and revoke writers created before the reset. */
	resetState(): void {
		if (!this.courseId) return;
		const current = this.readState();
		this.generation = current.generation + 1;
		this.writeState(
			createLearnerState({
				courseId: this.courseId,
				attemptId: this.attemptId,
				revision: this.revision,
				generation: this.generation,
				sequence: current.sequence + 1,
			}),
		);
	}

	setCommitPreparation(prepare: () => void): void {
		this.commitPreparation.prepareCommit = prepare;
	}

	commit(): boolean {
		return prepareRuntimeCommit(this.commitPreparation);
	}

	private readState(): LearnerStateV1 {
		// Every caller selects the scoped branch before reading learner state.
		const identity = { courseId: this.courseId as string, attemptId: this.attemptId };
		try {
			const raw = this.storage.getItem(this.prefix + "state");
			if (raw !== null) return parseLearnerState(raw, identity) ?? createLearnerState(identity);

			const state = createLearnerState({ ...identity, revision: this.revision });
			const legacyKeys = [
				"visited_pages",
				"interactions",
				"completion",
				"score",
				"bookmark",
				"suspend_data",
			] as const;
			if (!legacyKeys.some((name) => this.storage.getItem(this.prefix + name) !== null))
				return state;

			state.visitedPageIds = readStringArray(this.storage.getItem(this.prefix + "visited_pages"));
			state.interactions = readInteractions(this.storage.getItem(this.prefix + "interactions"));
			const completion = this.storage.getItem(this.prefix + "completion");
			if (completion === "completed" || completion === "passed" || completion === "failed") {
				state.completion = completion;
			}
			state.score = readScore(this.storage.getItem(this.prefix + "score"));
			state.bookmark = this.storage.getItem(this.prefix + "bookmark") || null;
			state.custom = this.storage.getItem(this.prefix + "suspend_data");
			this.writeState(state);
			for (const name of legacyKeys) this.storage.removeItem(this.prefix + name);
			return state;
		} catch (error) {
			const name = (error as DOMException | null)?.name;
			if (name !== "SecurityError" && name !== "QuotaExceededError") throw error;
			// Reads and legacy migration can fail before Initialize. Start a fresh
			// in-memory attempt; failed migration leaves the stored legacy data intact.
			this.storage = createNoopStorage();
			this.persistent = false;
			this.generation = 0;
			return createLearnerState(identity);
		}
	}

	private updateState(update: (state: LearnerStateV1) => void): boolean {
		if (!this.courseId) return false;
		const state = this.readState();
		if (state.generation !== this.generation) return true;
		update(state);
		state.revision = this.revision;
		state.sequence += 1;
		try {
			this.writeState(state);
			this.lastWriteSaved = this.persistent;
		} catch {
			// Learner interaction must remain usable when storage is full or the
			// bounded state serializer rejects an oversized update.
		}
		return true;
	}

	private writeState(state: LearnerStateV1): void {
		this.storage.setItem(this.prefix + "state", serializeLearnerState(state));
	}
}

function courseStoragePrefix(courseId: string): string {
	return `praxity:${encodeURIComponent(courseId)}:`;
}

/** The caller supplies a private course/learner scope, never the general course store. */
export function removeOtherLocalAttempts(
	storage: Storage,
	courseId: string,
	attemptId: string,
	onlyIfUnseen = false,
): void {
	const scope = courseStoragePrefix(courseId);
	const current = `${scope}${encodeURIComponent(attemptId)}:`;
	if (onlyIfUnseen) {
		if (storage.getItem(`${current}seen`) !== null) return;
		if (storage.getItem(`${current}state`) !== null) {
			storage.setItem(`${current}seen`, "1");
			return;
		}
	}
	const obsolete: string[] = [];
	for (let index = 0; index < storage.length; index++) {
		const key = storage.key(index);
		if (key?.startsWith(scope) && !key.startsWith(current) && !key.endsWith(":seen"))
			obsolete.push(key);
	}
	for (const key of obsolete) storage.removeItem(key);
	// Keep registration history without answers, even after its drafts are removed.
	if (onlyIfUnseen) storage.setItem(`${current}seen`, "1");
}

function readStringArray(raw: string | null): string[] {
	try {
		const value = JSON.parse(raw ?? "null") as unknown;
		return Array.isArray(value)
			? value.filter((item): item is string => typeof item === "string" && item.length > 0)
			: [];
	} catch {
		return [];
	}
}

function readInteractions(raw: string | null): InteractionRecord[] {
	try {
		const value = JSON.parse(raw ?? "null") as unknown;
		if (!Array.isArray(value)) return [];
		const state = createLearnerState({ courseId: "migration", attemptId: "migration" });
		state.interactions = value as InteractionRecord[];
		return (
			parseLearnerState(serializeLearnerState(state), {
				courseId: "migration",
				attemptId: "migration",
			})?.interactions ?? []
		);
	} catch {
		return [];
	}
}

function readScore(raw: string | null): { raw: number; min: number; max: number } | null {
	try {
		const value = JSON.parse(raw ?? "null") as Record<string, unknown> | null;
		return value &&
			typeof value.raw === "number" &&
			Number.isFinite(value.raw) &&
			typeof value.min === "number" &&
			Number.isFinite(value.min) &&
			typeof value.max === "number" &&
			Number.isFinite(value.max)
			? { raw: value.raw, min: value.min, max: value.max }
			: null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// No-op Storage for environments where localStorage is unavailable
// ---------------------------------------------------------------------------

function createNoopStorage(): RuntimeStorage {
	const store = new Map<string, string>();
	return {
		getItem(key: string): string | null {
			return store.get(key) ?? null;
		},
		removeItem(key: string): void {
			store.delete(key);
		},
		setItem(key: string, value: string): void {
			store.set(key, value);
		},
	};
}
