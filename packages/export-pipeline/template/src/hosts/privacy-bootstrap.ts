import { filterPrivateSuspendData } from "@praxity/shared-blocks/block-state-policy";
import { getSelfCheckHostStrings } from "@praxity/shared-blocks/i18n/self-check-host-strings";
import type { LearnerBlockStateRuntime } from "@praxity/shared-blocks/learner-block-state";
import type { LearnerStateValue } from "@praxity/shared-blocks/learner-state";
import { applyXapiPrivatePolicy } from "../../../src/scorm/private-xapi-policy";
import { loadBrowserModule } from "../island-loader";
import { blockReportingDestination, createBlockStateRuntime } from "./block-state-runtime";
import { readCourseHostConfig } from "./course-config";
import { readJsonElement } from "./host-json";
import type { privacySupport } from "./privacy-support";

/** Install a closed provider synchronously. Persistence can arrive after islands start. */
export function bufferPrivateBlockState(
	args: Parameters<typeof privacySupport.createPrivateBlockStateRuntime>,
	loaded: Promise<typeof privacySupport>,
): LearnerBlockStateRuntime {
	Object.assign(args[1].strings, getSelfCheckHostStrings(args[2].document.documentElement.lang));
	const ordinary = createBlockStateRuntime(args[0]);
	const isPrivate = (id: string) => args[1].blockStatePolicy?.[id] === "device";
	const pending = new Map<string, LearnerStateValue>();
	let provider: LearnerBlockStateRuntime | undefined;
	let failed = false;
	const unavailable = () => ({
		status: "not-saved" as const,
		code: failed ? ("runtime-write-failed" as const) : ("runtime-loading" as const),
	});
	const owner = () => args[2].__praxitySelfCheckDocument;
	const requiresLifetime = !!owner();
	let buffered!: LearnerBlockStateRuntime;
	let cachedSupport: typeof privacySupport | undefined;
	const adopt = (support: typeof privacySupport, lifetime = owner()?.lifetime()) => {
		if (provider || (requiresLifetime && (!lifetime?.current() || lifetime.provider !== buffered)))
			return;
		const admitted = support.createPrivateBlockStateRuntime(...args);
		if (requiresLifetime && !lifetime?.current()) return;
		provider = admitted;
		for (const [id, value] of pending) {
			if (requiresLifetime && !lifetime?.current()) return;
			provider.set(id, value);
		}
		pending.clear();
	};
	const install = (lifetime = owner()?.lifetime()) => {
		if (requiresLifetime && lifetime?.provider !== buffered) return;
		if (cachedSupport) {
			adopt(cachedSupport, lifetime);
			return;
		}
		void loaded
			.then((support) => {
				// Immutable code can finish caching while the requesting lifetime is suspended.
				cachedSupport = support;
				adopt(support, lifetime);
			})
			.catch(() => {
				if (!requiresLifetime || lifetime?.current()) failed = true;
			});
	};
	buffered = {
		stageSubmission: args[0].stageSubmission
			? (id, write) => (provider ?? ordinary).stageSubmission?.(id, write) ?? write()
			: undefined,
		getPolicy: (id) => (isPrivate(id) ? "device" : "lms"),
		getReportingDestination: (id) =>
			blockReportingDestination(args[0], isPrivate(id) ? "device" : "lms"),
		get(id) {
			if (!provider && cachedSupport) install();
			return provider ? provider.get(id) : isPrivate(id) ? pending.get(id) : ordinary.get(id);
		},
		set(id, value) {
			if (
				requiresLifetime &&
				(!owner()?.lifetime()?.current() || owner()?.lifetime()?.provider !== buffered)
			)
				return unavailable();
			if (provider) return provider.set(id, value);
			if (!isPrivate(id)) return ordinary.set(id, value);
			pending.set(id, value);
			return unavailable();
		},
		getSaveResult: (id) =>
			provider
				? provider.getSaveResult?.(id)
				: isPrivate(id)
					? unavailable()
					: ordinary.getSaveResult?.(id),
	};
	if (owner()) {
		let current = owner()?.lifetime();
		const activate = () => {
			const lifetime = owner()?.lifetime();
			if (current === lifetime) return;
			current = lifetime;
			if (!lifetime) pending.clear();
			else if (!provider) install(lifetime);
		};
		args[2].document.addEventListener("praxity:self-check-owner", activate);
		install(current);
	} else install();
	return buffered;
}

const script =
	typeof document === "undefined" ? null : (document.currentScript as HTMLScriptElement | null);
if (script) {
	const config = readCourseHostConfig(document);
	if (config?.blockStatePolicy && Object.keys(config.blockStatePolicy).length) {
		window.__praxityPrivacyGuard = {
			filterPrivateSuspendData,
			applyXapiPrivatePolicy,
			readCourseHostConfig,
		};
		const url = new URL(script.dataset.privacySupport as string, script.src).href;
		const loaded = loadBrowserModule(url, location.protocol === "file:").then((module) => {
			const support =
				location.protocol === "file:"
					? window.__praxityPrivacySupport
					: (module as { privacySupport?: typeof privacySupport })?.privacySupport;
			if (!support) throw new Error("EPRIVACYLOAD");
			return support;
		});
		// Existing islands restore their state once, at runtime-ready. Hold that
		// event until the loaded provider has flushed; otherwise mixed courses
		// would initialize ordinary blocks from an empty buffer.
		// Electron owns the pending state only after admitting its parent session.
		if (readJsonElement(document, "praxity-deployment-config")?.format !== "electron-preview")
			document.documentElement.dataset.praxityLearnerState = "pending";
		window.addEventListener(
			"praxity:runtime-ready",
			() => delete document.documentElement.dataset.praxityLearnerState,
		);
		window.__praxityPrivacyReady = loaded.then(
			() => {},
			() => {},
		);
		// Handle rejection even if a host fails before asking for a provider.
		void loaded.catch(() => console.error("EPRIVACYLOAD"));
		window.__praxityPrivacyBootstrap = (...args) => bufferPrivateBlockState(args, loaded);
	}
}

declare global {
	interface Window {
		__praxityPrivacyReady?: Promise<void>;
		__praxityPrivacyGuard?: {
			filterPrivateSuspendData: typeof filterPrivateSuspendData;
			applyXapiPrivatePolicy: typeof applyXapiPrivatePolicy;
			readCourseHostConfig: typeof readCourseHostConfig;
		};
		__praxityPrivacyBootstrap?: typeof privacySupport.createPrivateBlockStateRuntime;
	}
}
