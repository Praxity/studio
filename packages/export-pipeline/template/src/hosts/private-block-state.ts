import type {
	LearnerBlockSaveResult,
	LearnerBlockStateRuntime,
} from "@praxity/shared-blocks/learner-block-state";
import type { LearnerStateValue } from "@praxity/shared-blocks/learner-state";
import {
	LocalStorageRuntime,
	removeOtherLocalAttempts,
} from "../../../src/scorm/local-storage-runtime";
import type { SCORMRuntime } from "../../../src/scorm/types";
import { blockReportingDestination } from "./block-state-runtime";
import type { CourseHostConfig, CourseHostFormat } from "./course-host";
import { isRecord, parseJsonRecord } from "./host-json";

const BLOCK_STATE_KEY = "blockState";
export function createPrivateBlockStateRuntime(
	runtime: SCORMRuntime,
	page: CourseHostConfig,
	win: Window,
	deviceStateRuntime?: SCORMRuntime,
	format?: CourseHostFormat,
): LearnerBlockStateRuntime {
	const memory = new Map<string, LearnerStateValue>();
	const blockStatePolicy = { ...page.blockStatePolicy };
	const results = new Map<string, LearnerBlockSaveResult>();
	let device = deviceStateRuntime;
	const reportDestination = runtime.destinations.state;
	let unavailable: LearnerBlockSaveResult = { status: "not-saved", code: "storage-unavailable" };
	if (!device && Object.values(page.blockStatePolicy ?? {}).includes("device")) {
		try {
			const identity = runtime.getLearnerIdentity?.();
			// Tuple encoding keeps unidentified device state separate from real learner IDs.
			const scope = identity?.learnerId
				? JSON.stringify([page.courseId, identity.learnerId])
				: JSON.stringify([page.courseId, null]);
			const attempt = identity?.attemptId ?? "default";
			const storage = win.localStorage;
			if (identity?.learnerId && identity.attemptId && (identity.newAttempt || format === "xapi"))
				removeOtherLocalAttempts(storage, scope, attempt, format === "xapi");
			device = new LocalStorageRuntime(storage, scope, attempt);
		} catch {
			unavailable = { status: "not-saved", code: "storage-unavailable" };
		}
	}
	const policy = (blockId: string) => (blockStatePolicy[blockId] === "device" ? "device" : "lms");
	return {
		getSavedBuildRevision: (blockId) =>
			(policy(blockId) === "device" ? device : runtime)?.getSavedBuildRevision?.() ?? null,
		stageSubmission: runtime.stageSubmission
			? (blockId, write) => {
					results.delete(blockId);
					return (
						(policy(blockId) === "lms" ? runtime.stageSubmission?.(blockId, write) : undefined) ??
						write()
					);
				}
			: undefined,
		getPolicy: policy,
		getReportingDestination(blockId) {
			return blockReportingDestination(runtime, policy(blockId));
		},
		getSaveResult(blockId) {
			const held = policy(blockId) === "lms" ? runtime.getBlockSaveResult?.(blockId) : undefined;
			if (held?.status === "not-saved" && held.code === "unreadable-state") return held;
			const local = results.get(blockId);
			const result =
				local?.status === "not-saved"
					? local
					: ((policy(blockId) === "lms" ? runtime.getBlockSaveResult?.(blockId) : undefined) ??
						local);
			return (
				result ??
				(policy(blockId) === "device" && (!device || device.hasPersistentStorage?.() === false)
					? unavailable
					: undefined)
			);
		},
		get(blockId) {
			if (!blockId) return undefined;
			const held = policy(blockId) === "lms" ? runtime.getBlockSaveResult?.(blockId) : undefined;
			if (held?.status === "not-saved" && held.code === "unreadable-state") {
				const recovered = runtime.getUnsavedBlockState?.(blockId);
				return recovered === undefined ? memory.get(blockId) : recovered;
			}
			if (memory.has(blockId)) return memory.get(blockId);
			try {
				if (policy(blockId) === "device") return device?.getBlockState?.(blockId);
				if (runtime.getBlockState) return runtime.getBlockState(blockId);
				const blockState = parseJsonRecord(runtime.getSuspendData())?.[BLOCK_STATE_KEY];
				return isRecord(blockState) && Object.hasOwn(blockState, blockId)
					? (blockState[blockId] as LearnerStateValue)
					: undefined;
			} catch {
				results.set(blockId, {
					status: "not-saved",
					code: policy(blockId) === "device" ? "storage-unavailable" : "runtime-write-failed",
				});
				return undefined;
			}
		},
		set(blockId, value) {
			const destination = policy(blockId);
			const held = destination === "lms" ? runtime.getBlockSaveResult?.(blockId) : undefined;
			if (held?.status === "not-saved" && held.code === "unreadable-state") {
				memory.set(blockId, value);
				runtime.setUnsavedBlockState?.(blockId, value);
				return held;
			}
			let result: LearnerBlockSaveResult;
			memory.set(blockId, value);
			try {
				if (!blockId) throw new Error("EBLOCKID");
				if (destination === "device") {
					result =
						device?.setBlockState?.(blockId, value) === true
							? { status: "saved", destination }
							: unavailable;
				} else {
					if (runtime.setBlockState) {
						if (runtime.setBlockState(blockId, value) === false) throw new Error("EBLOCKSAVE");
					} else {
						const suspendData = parseJsonRecord(runtime.getSuspendData()) ?? {};
						const blockState = suspendData[BLOCK_STATE_KEY];
						// Never carry a private block forward from old or untrusted suspend data.
						const reportable = Object.fromEntries(
							Object.entries(isRecord(blockState) ? blockState : {}).filter(
								([id]) => policy(id) !== "device",
							),
						);
						suspendData[BLOCK_STATE_KEY] = { ...reportable, [blockId]: value };
						if (runtime.setSuspendData(JSON.stringify(suspendData)) === false)
							throw new Error("EBLOCKSAVE");
					}
					result = { status: "saved", destination: reportDestination };
				}
			} catch {
				result = {
					status: "not-saved",
					code:
						destination === "device" || reportDestination === "device"
							? "storage-unavailable"
							: "runtime-write-failed",
				};
			}
			if (result.status === "saved") memory.delete(blockId);
			results.set(blockId, result);
			return result;
		},
	};
}
