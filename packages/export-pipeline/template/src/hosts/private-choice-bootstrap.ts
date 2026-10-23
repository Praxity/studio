import { installPrivateChoiceNotices } from "../../../src/patterns/choice/enhance";
import type { privacySupport } from "./privacy-support";

type Create = typeof privacySupport.createPrivateBlockStateRuntime;
type Args = Parameters<Create>;

/** Observe the existing store's identity admission, without a second identity
 * lookup that could mint an attempt early or consume its new-attempt cleanup. */
export function createPrivateChoiceProvider(args: Args, create: Create) {
	let identified = false;
	const runtime = new Proxy(args[0], {
		get(target, key) {
			const value = Reflect.get(target, key, target);
			if (typeof value !== "function") return value;
			if (key !== "getLearnerIdentity") return value.bind(target);
			return () => {
				const identity = value.call(target);
				identified = !!identity?.learnerId && !!identity.attemptId;
				return identity;
			};
		},
	});
	const provider = create(runtime, args[1], args[2], args[3], args[4]);
	let scope: "identified" | "shared-device" | undefined;
	return Object.assign(provider, {
		getDeviceScope(id: string): "identified" | "shared-device" {
			const result = provider.getSaveResult?.(id);
			if (!scope && !(result?.status === "not-saved" && result.code === "runtime-loading"))
				scope = identified && result?.status !== "not-saved" ? "identified" : "shared-device";
			return scope ?? "shared-device";
		},
	});
}

if (typeof document !== "undefined" && document.currentScript) {
	installPrivateChoiceNotices(document);
	const create = window.__praxityPrivacyBootstrap;
	if (create)
		window.__praxityPrivacyBootstrap = (...args) => createPrivateChoiceProvider(args, create);
}
