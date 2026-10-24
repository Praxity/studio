import { filterPrivateSuspendData } from "@praxity/shared-blocks/block-state-policy";
import type { XapiStatement } from "./api/xapi";
import type { InteractionEvidence } from "./types";

export function applyXapiPrivatePolicy(
	policy: Readonly<Record<string, "device" | "lms">>,
	interactions: InteractionEvidence[],
	suspendData: string | null,
	outbox: XapiStatement[],
) {
	const privateActivities = Object.entries(policy)
		.filter(([, mode]) => mode === "device")
		.map(([id]) => `/interaction/${id}`);
	return {
		interactions: interactions.filter((entry) => policy[entry.id] !== "device"),
		suspendData: suspendData ? filterPrivateSuspendData(suspendData, policy) : suspendData,
		// The persisted queue spans launches with different activity_id prefixes.
		// XapiRuntime produces interactions, not objective statements.
		outbox: outbox.filter(
			(statement) =>
				!privateActivities.some(
					(suffix) =>
						typeof statement.object?.id === "string" && statement.object.id.endsWith(suffix),
				),
		),
	};
}
