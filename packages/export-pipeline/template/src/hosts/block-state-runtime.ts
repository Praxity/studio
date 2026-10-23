import type {
	LearnerBlockSaveResult,
	LearnerBlockStateRuntime,
} from "@praxity/shared-blocks/learner-block-state";
import type { LearnerStateValue } from "@praxity/shared-blocks/learner-state";
import type { SCORMRuntime } from "../../../src/scorm/types";
import { isRecord, parseJsonRecord } from "./host-json";

const BLOCK_STATE_KEY = "blockState";

export function blockReportingDestination(
	runtime: SCORMRuntime,
	policy: "device" | "lms",
): "device" | "lms" {
	return policy === "device" ? "device" : runtime.destinations.reporting;
}

export function createBlockStateRuntime(runtime: SCORMRuntime): LearnerBlockStateRuntime {
	const results = new Map<string, LearnerBlockSaveResult>();
	return {
		getSavedBuildRevision: () => runtime.getSavedBuildRevision?.() ?? null,
		stageSubmission: runtime.stageSubmission
			? (blockId, write) => {
					results.delete(blockId);
					return runtime.stageSubmission?.(blockId, write) ?? false;
				}
			: undefined,
		getSaveResult: runtime.stageSubmission
			? (blockId) => {
					const runtimeResult = runtime.getBlockSaveResult?.(blockId);
					if (runtimeResult?.status === "not-saved" && runtimeResult.code === "unreadable-state")
						return runtimeResult;
					const local = results.get(blockId);
					return local?.status === "not-saved"
						? local
						: (runtime.getBlockSaveResult?.(blockId) ?? local);
				}
			: undefined,
		get(blockId) {
			if (!blockId) return undefined;
			const held = runtime.getBlockSaveResult?.(blockId);
			if (held?.status === "not-saved" && held.code === "unreadable-state")
				return runtime.getUnsavedBlockState?.(blockId);
			try {
				if (runtime.getBlockState) return runtime.getBlockState(blockId);
				const blockState = parseJsonRecord(runtime.getSuspendData())?.[BLOCK_STATE_KEY];
				return isRecord(blockState) && Object.hasOwn(blockState, blockId)
					? (blockState[blockId] as LearnerStateValue)
					: undefined;
			} catch {
				return undefined;
			}
		},
		set(blockId, value) {
			if (!blockId) return;
			const held = runtime.getBlockSaveResult?.(blockId);
			if (held?.status === "not-saved" && held.code === "unreadable-state") {
				runtime.setUnsavedBlockState?.(blockId, value);
				return;
			}
			try {
				if (runtime.setBlockState) {
					const saved = runtime.setBlockState(blockId, value);
					if (!runtime.stageSubmission)
						return globalThis.__praxityPrivateState !== false
							? saved === false
								? { status: "not-saved", code: "storage-unavailable" }
								: { status: "saved", destination: "device" }
							: undefined;
					results.set(
						blockId,
						saved === false
							? { status: "not-saved", code: "storage-unavailable" }
							: { status: "saved", destination: runtime.destinations.state },
					);
					return results.get(blockId);
				}
				const suspendData = parseJsonRecord(runtime.getSuspendData()) ?? {};
				const blockState = suspendData[BLOCK_STATE_KEY];
				suspendData[BLOCK_STATE_KEY] = {
					...(isRecord(blockState) ? blockState : {}),
					[blockId]: value,
				};
				const saved = runtime.setSuspendData(JSON.stringify(suspendData));
				if (!runtime.stageSubmission) return;
				if (saved === false) throw new Error("EBLOCKSAVE");
				results.set(blockId, { status: "saved", destination: runtime.destinations.state });
			} catch {
				if (runtime.stageSubmission)
					results.set(blockId, { status: "not-saved", code: "runtime-write-failed" });
			}
			return results.get(blockId);
		},
	};
}
