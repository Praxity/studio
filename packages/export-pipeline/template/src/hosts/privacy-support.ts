import { createPrivateBlockStateRuntime } from "./private-block-state";

export const privacySupport = {
	createPrivateBlockStateRuntime,
};

// The same entry is built as a module and as the file-origin classic fallback.
if (typeof window !== "undefined") window.__praxityPrivacySupport = privacySupport;

declare global {
	interface Window {
		__praxityPrivacySupport?: typeof privacySupport;
	}
}
