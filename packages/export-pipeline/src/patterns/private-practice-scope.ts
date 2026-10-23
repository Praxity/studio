import type { LearnerBlockStateRuntime } from "@praxity/shared-blocks/learner-block-state";

type PrivatePracticeProvider = LearnerBlockStateRuntime & {
	getDeviceScope?(blockId: string): "identified" | "shared-device";
};

/** Private activity scope follows admitted storage, independently of a first save. */
export function privatePracticeState(
	provider: PrivatePracticeProvider | undefined,
	blockId: string,
) {
	const result = provider?.getSaveResult?.(blockId);
	const pending =
		!provider || (result?.status === "not-saved" && result.code === "runtime-loading");
	const failed = !pending && result?.status === "not-saved";
	const identified =
		!pending &&
		provider?.getPolicy?.(blockId) === "device" &&
		provider.getDeviceScope?.(blockId) === "identified";
	return { pending, failed, identified };
}
