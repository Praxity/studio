import { deviceAttemptId, resolveLaunchAttempt } from "../../../src/scorm/api/device-attempt";
import { appendPrivateScorm12Interaction } from "../../../src/scorm/private-scorm12-policy";
import { createPrivateBlockStateRuntime } from "./private-block-state";

export const privacySupport = {
	appendPrivateScorm12Interaction,
	createPrivateBlockStateRuntime,
	deviceAttemptId,
	resolveLaunchAttempt,
};

// The same entry is built as a module and as the file-origin classic fallback.
if (typeof window !== "undefined") window.__praxityPrivacySupport = privacySupport;

declare global {
	interface Window {
		__praxityPrivacySupport?: typeof privacySupport;
	}
}
