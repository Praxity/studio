import { getSelfCheckActivationStrings } from "@praxity/shared-blocks/i18n/self-check-host-strings";
import { installSelfCheckControls } from "../self-check-controls";
import { selfCheckDocument } from "../self-check-document";
import {
	disposeSelfCheckDocument,
	mountSelfCheckRuntime,
	selfCheckRuntime,
} from "../self-check-runtime";
import type * as island from "./island-self-check";

declare const __PRAXITY_SELF_CHECK_BUILD__: string;
declare const __PRAXITY_SELF_CHECK_DOCUMENT__: string;
const selfCheckBuild = __PRAXITY_SELF_CHECK_BUILD__;
declare global {
	interface Window {
		PraxitySelfCheckIsland?: typeof island;
		__praxitySelfCheckLoads?: Map<string, Promise<typeof island>>;
		__praxitySelfCheckCore: typeof core;
	}
}
const failed = new WeakMap<Document, boolean>();
/** Cache the attempt before insertion. Only explicit Retry clears a rejected attempt. */
export function loadSelfCheckImplementation(
	entry: string,
	doc = document,
	retry = false,
): Promise<typeof island> {
	const view = doc.defaultView;
	if (!view) return Promise.reject(new Error("ESELFCHECKDOCUMENT"));
	const identity = selfCheckBuild;
	const loads = (view.__praxitySelfCheckLoads ??= new Map());
	if (retry && failed.get(doc)) {
		loads.delete(identity);
		failed.delete(doc);
	}
	const pending = loads.get(identity);
	if (pending) return pending;
	const existing = view.PraxitySelfCheckIsland;
	if (existing?.build === identity) return Promise.resolve(existing);
	const current = view.__praxitySelfCheckDocument?.loadTicket() ?? (() => true);
	const loading = Promise.resolve().then(
		() =>
			new Promise<typeof island>((resolve, reject) => {
				if (!current()) {
					if (loads.get(identity) === loading) loads.delete(identity);
					reject(new Error("ESELFCHECKCANCELLED"));
					return;
				}
				const script = doc.createElement("script");
				const cleanup = () => {
					script.remove();
					script.onload = null;
					script.onerror = null;
					view.removeEventListener("pagehide", cancel);
					doc.removeEventListener("praxity:self-check-owner", changed);
				};
				const cancel = () => {
					cleanup();
					if (loads.get(identity) === loading) loads.delete(identity);
					reject(new Error("ESELFCHECKCANCELLED"));
				};
				const changed = () => {
					if (!current()) cancel();
				};
				script.src = new URL(__PRAXITY_SELF_CHECK_DOCUMENT__, entry).href;
				script.onload = () => {
					if (!current()) {
						cancel();
						return;
					}
					cleanup();
					const implementation = view.PraxitySelfCheckIsland;
					if (implementation?.build === identity) resolve(implementation);
					else {
						failed.set(doc, true);
						reject(new Error("ESELFCHECKBUILD"));
					}
				};
				script.onerror = () => {
					if (!current()) {
						cancel();
						return;
					}
					cleanup();
					failed.set(doc, true);
					reject(new Error("ESELFCHECKLOAD"));
				};
				view.addEventListener("pagehide", cancel, { once: true });
				doc.addEventListener("praxity:self-check-owner", changed);
				doc.head.append(script);
			}),
	);
	loads.set(identity, loading);
	return loading;
}
const started = new WeakMap<
	Document,
	{
		owner: Window["__praxitySelfCheckDocument"];
		loading: Promise<typeof island>;
		implementation?: typeof island;
		release(): void;
		retry?(): void;
	}
>();
export function startSelfCheckDocument(entry: string, doc = document) {
	const view = doc.defaultView;
	if (!view) throw new Error("ESELFCHECKDOCUMENT");
	if (
		started.get(doc)?.owner === view.__praxitySelfCheckDocument &&
		view.__praxitySelfCheckDocument?.active()
	)
		return;
	selfCheckDocument(doc);
	core.entry ??= entry;
	const loading = loadSelfCheckImplementation(entry, doc);
	const record: NonNullable<ReturnType<typeof started.get>> = {
		owner: view.__praxitySelfCheckDocument,
		loading,
		release: () => {},
	};
	started.set(doc, record);
	const pendingControls = new Map<HTMLElement, { cleanup(): void; unavailable(): void }>();
	const clear = () => {
		for (const controls of pendingControls.values()) controls.cleanup();
		pendingControls.clear();
	};
	let attachment: (() => void) | undefined;
	let attempt = 0,
		announced = false;
	const request = (retry = false) => {
		const owner = view.__praxitySelfCheckDocument;
		if (!owner?.active()) return;
		const generation = ++attempt;
		const owned = owner.loadTicket();
		const current = () => generation === attempt && owned();
		owner.current.session.startup("pending");
		if (!current()) return;
		record.loading = loadSelfCheckImplementation(entry, doc, retry);
		for (const root of doc.querySelectorAll<HTMLElement>("[data-self-check]")) {
			const recovery = root.querySelector<HTMLElement>("[data-self-check-recovery]");
			if (recovery)
				recovery.textContent = getSelfCheckActivationStrings(root.lang).selfCheckRestoring;
		}
		void record.loading
			.then(
				(implementation) => {
					if (!current()) return;
					const focused = doc.activeElement === doc.body ? owner.printFocus() : doc.activeElement;
					const focusedRetry = focused?.matches('[data-self-check-action="retry"]')
						? focused.closest<HTMLElement>("[data-self-check]")
						: null;
					clear();
					if (!current()) return;
					attachment ??= implementation.initSelfCheckEnhancements(doc);
					if (current()) {
						record.implementation = implementation;
						owner.current.session.startup("ready");
					}
					if (focusedRetry && current() && doc.activeElement === doc.body) {
						const retry = focusedRetry.querySelector<HTMLButtonElement>(
							'[data-self-check-action="retry"]',
						);
						const check = focusedRetry.querySelector<HTMLButtonElement>(
							'[data-self-check-action="check"]',
						);
						if (retry && check) {
							retry.hidden = false;
							check.hidden = true;
							retry.focus();
						}
					}
					// A document with only later-module dependencies has no activity mount to retain it.
					if (current() && doc.querySelector("[data-self-check]")) record.release();
					if (retry && current())
						for (const root of doc.querySelectorAll<HTMLElement>("[data-self-check]")) {
							const blockId = root.dataset.selfCheckId ?? "";
							const runtime = selfCheckRuntime(doc);
							if (runtime.session.read(blockId)?.outcome === "unavailable")
								void runtime.session.dispatch({ type: "retry", blockId });
							if (!current()) return;
						}
				},
				() => {
					if (!current()) return;
					owner.current.session.startup("unavailable");
					if (!current()) return;
					for (const root of doc.querySelectorAll<HTMLElement>("[data-self-check]")) {
						if (!current()) return;
						pendingControls.get(root)?.unavailable();
						if (!current()) return;
						const ui = getSelfCheckActivationStrings(root.lang);
						const notice = root.querySelector<HTMLElement>("[data-self-check-notice]");
						const recovery = root.querySelector<HTMLElement>("[data-self-check-recovery]");
						const check = root.querySelector<HTMLButtonElement>('[data-self-check-action="check"]');
						const retry = root.querySelector<HTMLButtonElement>('[data-self-check-action="retry"]');
						if (notice) {
							notice.hidden = false;
							notice.textContent = ui.selfCheckUnavailable;
						}
						if (recovery) recovery.textContent = ui.selfCheckContact;
						if (retry && check) {
							retry.hidden = false;
							retry.removeAttribute("aria-disabled");
							if (owner.printFocus() === check) owner.printFocus(retry);
							if (doc.activeElement === check) {
								retry.focus();
								if (!current()) return;
							}
							check.hidden = true;
						}
					}
					if (current() && !announced) {
						announced = true;
						const root = doc.querySelector<HTMLElement>("[data-self-check]");
						const region = doc.getElementById("praxity-live-region");
						if (root && region)
							region.textContent = getSelfCheckActivationStrings(root.lang).selfCheckUnavailable;
					}
				},
			)
			.catch((error) => view.reportError(error));
	};
	record.retry = () => request(true);
	record.release = mountSelfCheckRuntime(doc, (runtime) => {
		clear();
		if (!runtime) return;
		// The canonical adapter takes over these controls only after its current load succeeds.
		if (!attachment)
			for (const root of doc.querySelectorAll<HTMLElement>("[data-self-check]")) {
				const answer = root.querySelector("textarea"),
					notice = root.querySelector<HTMLElement>("[data-self-check-notice]");
				const check = root.querySelector<HTMLButtonElement>('[data-self-check-action="check"]');
				const reset = root.querySelector<HTMLButtonElement>(
					'[data-self-check-action="start-over"]',
				);
				if (!answer || !notice || !check || !reset) continue;
				const blockId = root.dataset.selfCheckId ?? "";
				const controls = installSelfCheckControls(root, answer, notice, runtime);
				const ui = getSelfCheckActivationStrings(root.lang);
				const retry = doc.createElement("button"),
					recovery = doc.createElement("p");
				retry.type = "button";
				retry.className = check.className;
				retry.style.inlineSize = "auto";
				retry.dataset.selfCheckAction = "retry";
				retry.textContent = ui.selfCheckRetry;
				retry.hidden = true;
				recovery.dataset.selfCheckRecovery = "";
				recovery.id = `${answer.id}-recovery`;
				recovery.textContent = ui.selfCheckRestoring;
				for (const control of [retry, check, reset])
					control.setAttribute("aria-describedby", recovery.id);
				check.parentElement?.prepend(retry);
				retry.hidden = view.__praxitySelfCheckDocument?.printFocus() !== retry;
				notice.after(recovery);
				check.removeAttribute("data-praxity-js-control");
				reset.removeAttribute("data-praxity-js-control");
				reset.hidden = true;
				check.hidden = !retry.hidden;
				const click = () => {
					const pass = runtime.ticket();
					pass.call(() => retry.focus());
					if (pass.current()) request(true);
				};
				const startOver = () => {
					if (runtime.ticket().current())
						void runtime.session.dispatch({
							type: "start-over",
							blockId,
						});
				};
				const input = () => controls.clearError();
				const validate = () => {
					if (!controls.validAnswer()) return;
					const pass = runtime.ticket();
					void record.loading.then(
						() => {
							if (pass.current()) check.click();
						},
						() => {},
					);
				};
				retry.addEventListener("click", click);
				reset.addEventListener("click", startOver);
				answer.addEventListener("input", input);
				check.addEventListener("click", validate);
				let unsubscribe = () => {};
				const cleanup = () => {
					unsubscribe();
					controls.cleanup();
					retry.remove();
					recovery.remove();
					retry.removeEventListener("click", click);
					reset.removeEventListener("click", startOver);
					answer.removeEventListener("input", input);
					check.removeEventListener("click", validate);
				};
				pendingControls.set(root, { cleanup, unavailable: controls.unavailable });
				unsubscribe = runtime.subscribe((pass, command) => {
					if (command?.type === "start-over" && command.blockId === blockId) {
						const message = recovery.textContent;
						controls.reset(pass);
						if (pass.current()) recovery.textContent = message;
						return;
					}
					controls.saveStatus(pass);
					if (!pass.current()) return;
					const state = runtime.session.read(blockId);
					if (state?.origin !== "fresh") reset.hidden = false;
				});
				if (pendingControls.get(root)?.cleanup !== cleanup || !runtime.ticket().current()) {
					unsubscribe();
					return;
				}
			}
		request();
	});
}
const core: {
	build: string;
	entry?: string;
	start: typeof startSelfCheckDocument;
	getSelfCheckActivationStrings: typeof getSelfCheckActivationStrings;
	installSelfCheckControls: typeof installSelfCheckControls;
	mountSelfCheckRuntime: typeof mountSelfCheckRuntime;
	selfCheckRuntime: typeof selfCheckRuntime;
	disposeSelfCheckDocument: typeof disposeSelfCheckDocument;
	implementation(doc: Document): Promise<typeof island>;
	retry(doc: Document): void;
	initSelfCheckEnhancements: typeof island.initSelfCheckEnhancements;
	loadSelfCheckAsset: typeof island.loadSelfCheckAsset;
} = {
	build: selfCheckBuild,
	start: startSelfCheckDocument,
	getSelfCheckActivationStrings,
	installSelfCheckControls,
	mountSelfCheckRuntime,
	selfCheckRuntime,
	disposeSelfCheckDocument,
	retry: (doc) => started.get(doc)?.retry?.(),
	implementation: (doc: Document) => {
		const record = started.get(doc);
		if (record?.owner === doc.defaultView?.__praxitySelfCheckDocument)
			return record?.loading ?? Promise.reject(new Error("ESELFCHECKLOAD"));
		return window.PraxitySelfCheckIsland?.build === selfCheckBuild
			? Promise.resolve(window.PraxitySelfCheckIsland)
			: Promise.reject(new Error("ESELFCHECKLOAD"));
	},
	initSelfCheckEnhancements: (scope: ParentNode = document) => {
		const doc = scope.nodeType === 9 ? (scope as Document) : (scope.ownerDocument ?? document);
		// Scope leases use the admitted adapter, never a later evaluation of its global.
		const implementation =
			started.get(doc)?.implementation ??
			(window.PraxitySelfCheckIsland?.build === selfCheckBuild
				? window.PraxitySelfCheckIsland
				: undefined);
		if (implementation?.build === selfCheckBuild)
			return implementation.initSelfCheckEnhancements(scope);
		const startedOwner = started.get(doc)?.owner;
		const release = mountSelfCheckRuntime(doc, () => {});
		if (core.entry && startedOwner !== doc.defaultView?.__praxitySelfCheckDocument) {
			core.start(core.entry, doc);
			// Explicit scope leases own cold startup; releasing the last scope cancels it.
			started.get(doc)?.release();
		}
		const current = doc.defaultView?.__praxitySelfCheckDocument?.loadTicket();
		let released = false,
			cleanup: (() => void) | undefined;
		void core
			.implementation(doc)
			.then(
				(implementation) => {
					if (!released && current?.()) {
						cleanup = implementation.initSelfCheckEnhancements(scope);
						release();
					}
				},
				() => {},
			)
			.catch((error) => doc.defaultView?.reportError(error));
		return () => {
			released = true;
			cleanup?.();
			release();
		};
	},
	loadSelfCheckAsset: async (...args: Parameters<typeof island.loadSelfCheckAsset>) =>
		(await selfCheckRuntime(args[1] ?? document).support()).loadSelfCheckAsset(...args),
};
if (window.__praxitySelfCheckCore?.build !== core.build) window.__praxitySelfCheckCore = core;
