import { createHash } from "node:crypto";
import {
	createLearnerState,
	parseLearnerState,
	serializeLearnerState,
} from "@praxity/shared-blocks/learner-state";

const PREVIEW_ATTEMPT_ID = "studio-preview";

export interface CoursePreviewStateStorage {
	get(key: string): unknown;
	set(key: string, value: string): void;
}

export class CoursePreviewStateStore {
	constructor(private readonly storage: CoursePreviewStateStorage) {}

	read(courseId: string, revision: string): string {
		return serializeLearnerState(this.readValue(courseId, revision));
	}

	persist(courseId: string, raw: string): boolean {
		const next = parseLearnerState(raw, { courseId, attemptId: PREVIEW_ATTEMPT_ID });
		if (!next) return false;
		const current = this.readValue(courseId, next.revision);
		if (raw === serializeLearnerState(current)) return true;
		if (
			next.generation < current.generation ||
			(next.generation === current.generation && next.sequence <= current.sequence)
		) {
			return false;
		}
		this.storage.set(this.key(courseId), serializeLearnerState(next));
		return true;
	}

	reset(courseId: string, revision: string): string {
		const current = this.readValue(courseId, revision);
		if (
			current.generation === Number.MAX_SAFE_INTEGER ||
			current.sequence === Number.MAX_SAFE_INTEGER
		) {
			throw new Error("Course preview state counter is exhausted");
		}
		const reset = createLearnerState({
			courseId,
			attemptId: PREVIEW_ATTEMPT_ID,
			revision,
			generation: current.generation + 1,
			sequence: current.sequence + 1,
		});
		const serialized = serializeLearnerState(reset);
		this.storage.set(this.key(courseId), serialized);
		return serialized;
	}

	private readValue(courseId: string, revision: string | null) {
		const key = this.key(courseId);
		const raw = this.storage.get(key);
		const state =
			typeof raw === "string"
				? parseLearnerState(raw, { courseId, attemptId: PREVIEW_ATTEMPT_ID })
				: null;
		if (state) return state;
		const fresh = createLearnerState({ courseId, attemptId: PREVIEW_ATTEMPT_ID, revision });
		this.storage.set(key, serializeLearnerState(fresh));
		return fresh;
	}

	private key(courseId: string): string {
		return createHash("sha256").update(courseId).digest("hex");
	}
}
