import type {
	GroupObjectiveHandoff,
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
	function saveBlockState(
		blockId: string,
		value: LearnerStateValue,
	): {
		accepted: boolean;
		result?: LearnerBlockSaveResult;
	} {
		if (!blockId) return { accepted: false };
		const held = runtime.getBlockSaveResult?.(blockId);
		if (held?.status === "not-saved" && held.code === "unreadable-state") {
			runtime.setUnsavedBlockState?.(blockId, value);
			return { accepted: false };
		}
		try {
			if (runtime.setBlockState) {
				const saved = runtime.setBlockState(blockId, value);
				if (!runtime.stageSubmission)
					return {
						accepted: saved !== false,
						result:
							globalThis.__praxityPrivateState !== false
								? saved === false
									? { status: "not-saved", code: "storage-unavailable" }
									: { status: "saved", destination: "device" }
								: undefined,
					};
				results.set(
					blockId,
					saved === false
						? { status: "not-saved", code: "storage-unavailable" }
						: { status: "saved", destination: runtime.destinations.state },
				);
				return { accepted: saved !== false, result: results.get(blockId) };
			}
			const suspendData = parseJsonRecord(runtime.getSuspendData()) ?? {};
			const blockState = suspendData[BLOCK_STATE_KEY];
			suspendData[BLOCK_STATE_KEY] = {
				...(isRecord(blockState) ? blockState : {}),
				[blockId]: value,
			};
			const saved = runtime.setSuspendData(JSON.stringify(suspendData));
			if (!runtime.stageSubmission) return { accepted: saved === true };
			if (saved === false) throw new Error("EBLOCKSAVE");
			results.set(blockId, { status: "saved", destination: runtime.destinations.state });
		} catch {
			if (runtime.stageSubmission)
				results.set(blockId, { status: "not-saved", code: "runtime-write-failed" });
		}
		return { accepted: results.get(blockId)?.status === "saved", result: results.get(blockId) };
	}

	const provider: LearnerBlockStateRuntime = {
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
		set: (blockId, value) => saveBlockState(blockId, value).result,
	};
	if ("trackObjective" in runtime && runtime.destinations.state === "lms") {
		const handoffs = new Map<
			string,
			{
				proposal: NonNullable<Parameters<GroupObjectiveHandoff>[1]>;
				current: () => boolean;
			}
		>();
		provider.saveGroupObjective = (id, value, current) => {
			const queued = handoffs.get(id);
			const authorized = () => current() && (!queued || queued.current());
			return authorized() && saveBlockState(id, value).accepted && authorized();
		};
		provider.admitGroupObjectives = (current, schema) => {
			provider.prepareGroupState ??= (id, next) => {
				const previous = provider.get(id);
				const result = provider.getSaveResult?.(id);
				// Reads can submit and save a newer handoff before returning.
				const queued = handoffs.get(id);
				const retire = () => {
					if (handoffs.get(id) === queued) handoffs.delete(id);
				};
				const saved = schema.read(previous)?.objective;
				const adopted =
					queued &&
					result?.status !== "pending" &&
					(queued.proposal.pending ? saved?.id === queued.proposal.pending.id : !saved);
				if (adopted) retire();
				const active = adopted ? undefined : queued;
				if (active && !active.current()) {
					retire();
					return null;
				}
				const matches =
					active?.proposal.contentSignature === schema.read(next)?.submitted.contentSignature;
				if (active && !matches) retire();
				const proposal = active && matches ? active.proposal : undefined;
				const prepared = schema.prepare(
					previous,
					next,
					proposal?.pending && { ...proposal.pending, contentSignature: proposal.contentSignature },
					proposal?.clearId,
				);
				return prepared;
			};
			return (id, proposal) => {
				if (!current()) return false;
				if (proposal) handoffs.set(id, { proposal, current });
				else handoffs.delete(id);
				return true;
			};
		};
	}
	return provider;
}
