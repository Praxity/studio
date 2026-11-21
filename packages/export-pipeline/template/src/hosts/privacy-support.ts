import { createPrivateBlockStateRuntime } from "./private-block-state";

export const privacySupport = {
	createPrivateBlockStateRuntime,
};

if (typeof window !== "undefined") window.__praxityPrivacySupport = privacySupport;

declare global {
	interface Window {
		__praxityPrivacySupport?: typeof privacySupport;
	}
}
