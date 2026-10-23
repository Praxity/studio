import type { LearnerBlockStateRuntime } from "@praxity/shared-blocks/learner-block-state";
import {
	captureSelfCheckEvent,
	type SelfCheckConsumers,
	selfCheckEventTicket,
} from "@praxity/shared-blocks/self-check-consumers";
import type { SelfCheckRuntime } from "./self-check-runtime";

declare const __PRAXITY_SELF_CHECK_BUILD__: string;

type PendingRating = { value: string; current: () => boolean };

export interface SelfCheckLifetime {
	readonly reason: "initial" | "provider" | "reset" | "return";
	readonly provider: LearnerBlockStateRuntime | undefined;
	current(): boolean;
}
export interface SelfCheckAttachment {
	readonly current: SelfCheckRuntime;
	consumers: SelfCheckConsumers;
	activate(): void;
	revoke(reason: "hide" | "provider" | "reset" | "dispose", complete?: () => void): void;
	destroy(): void;
	mount(listener: (runtime?: SelfCheckRuntime) => void): () => void;
	printFocus(replacement?: HTMLElement): HTMLElement | null;
}

declare global {
	interface Window {
		__praxitySelfCheckDocument?: ReturnType<typeof createSelfCheckDocument>;
	}
}

/** One provider activation owns every continuation, including work before the runtime attaches. */
function createSelfCheckDocument(doc: Document, build: string, waitForHost: boolean) {
	const view = doc.defaultView;
	if (!view) throw new Error("ESELFCHECKDOCUMENT");
	const descriptor = Object.getOwnPropertyDescriptor(view, "__praxityBlockState");
	if (descriptor?.configurable === false || (descriptor?.get && !descriptor.set))
		throw new Error("ESELFCHECKPROVIDER");
	let provider = view.__praxityBlockState;
	let providerInstalled = provider !== undefined;
	let disposed = false,
		suspended = false,
		epoch = 0;
	let attachment: SelfCheckAttachment | undefined;
	let admitted = false;
	let revocationDone = true;
	let pendingActivation:
		| { reason: SelfCheckLifetime["reason"]; ratings: Array<[HTMLElement, PendingRating]> }
		| undefined;
	const listeners = new Set<(lifetime?: SelfCheckLifetime) => void>();
	const pendingRatings = new Map<HTMLElement, PendingRating>();
	const clickControls = new Set<Element>();
	const clickSelector = "input, textarea, button, select, a[href]";
	let lifetime: SelfCheckLifetime | undefined;
	const notify = () => {
		const captured = lifetime;
		doc.dispatchEvent(new Event("praxity:self-check-owner"));
		for (const listener of listeners) {
			if (lifetime !== captured) return;
			listener(captured);
		}
	};
	const revoke = (reason: Parameters<SelfCheckAttachment["revoke"]>[0], complete?: () => void) => {
		lifetime = undefined;
		admitted = false;
		pendingActivation = undefined;
		revocationDone = false;
		++epoch;
		pendingRatings.clear();
		const drained = () => {
			revocationDone = true;
			complete?.();
			if (pendingActivation) activate(pendingActivation.reason, pendingActivation.ratings);
		};
		if (attachment) attachment.revoke(reason, drained);
		else drained();
		notify();
	};
	const activate = (
		reason: SelfCheckLifetime["reason"],
		ratings: Array<[HTMLElement, PendingRating]> = [],
	) => {
		if (disposed || suspended) return;
		if (!revocationDone) {
			pendingActivation = { reason, ratings };
			return;
		}
		pendingActivation = undefined;
		const activation: SelfCheckLifetime = {
			reason,
			provider,
			current: () =>
				lifetime === activation &&
				!disposed &&
				!suspended &&
				view.__praxitySelfCheckDocument === owner &&
				view.__praxityBlockState === activation.provider,
		};
		lifetime = activation;
		for (const [root, gesture] of ratings)
			pendingRatings.set(root, { value: gesture.value, current: activation.current });
		admitted = !waitForHost;
		if (admitted) attachment?.activate();
		notify();
	};
	const assign = (
		replacement: LearnerBlockStateRuntime | undefined,
		force = false,
		writeThrough = false,
	) => {
		if (disposed || (!force && replacement === provider)) return;
		// The first host install admits input made before any provider owned learner state.
		const initialRatings =
			!force && !providerInstalled && provider === undefined && replacement
				? Array.from(pendingRatings).filter(([, gesture]) => gesture.current())
				: [];
		const transition = epoch + 1;
		revoke(force ? "reset" : "provider");
		if (epoch !== transition || disposed) return;
		if (writeThrough) descriptor?.set?.call(view, replacement);
		if (epoch !== transition || disposed) return;
		provider = writeThrough && descriptor?.get ? descriptor.get.call(view) : replacement;
		providerInstalled ||= provider !== undefined;
		activate(force ? "reset" : "provider", initialRatings);
	};
	const installProvider = () =>
		Object.defineProperty(view, "__praxityBlockState", {
			configurable: true,
			enumerable: descriptor?.enumerable ?? true,
			get: () => provider,
			set: (replacement: LearnerBlockStateRuntime | undefined) => {
				// Revoke before an injected setter can call back into learner effects.
				assign(replacement, false, true);
			},
		});
	const hide = () => {
		if (disposed || suspended) return;
		suspended = true;
		revoke("hide");
	};
	const show = (event: PageTransitionEvent) => {
		if (!event.persisted || disposed || !suspended) return;
		suspended = false;
		provider = view.__praxityBlockState;
		activate("return");
	};
	const inspect = (event: Event) => {
		if (disposed || suspended) return;
		const answer = event.target;
		if (answer instanceof view.Element && answer.closest("[data-write-distractors]"))
			captureSelfCheckEvent(event, owner.loadTicket());
		else if (event.type === "change") return;
		if (
			(event.type === "focusin" || event.type === "pointerdown") &&
			answer instanceof view.Element
		) {
			const label = answer.closest("label");
			const control =
				answer.closest(clickSelector) ??
				(label instanceof view.HTMLLabelElement ? label.control : null);
			if (control) bindClick(control);
		}
		if (
			event.type === "input" &&
			answer instanceof view.HTMLTextAreaElement &&
			answer.closest("[data-self-check], [data-write-distractors]") &&
			(!admitted ||
				view.__praxityBlockState !== provider ||
				attachment?.current?.ticket().current() !== true)
		)
			answer.setAttribute("data-self-check-edited", "");
		owner.sync();
		if (
			(event.type === "input" || event.type === "click") &&
			answer instanceof view.HTMLInputElement &&
			((answer.type === "radio" && answer.checked) ||
				(answer.type === "range" && event.type === "input"))
		) {
			const rating = answer.closest<HTMLElement>('[data-island="rating"]');
			if (rating && rating.dataset.ratingEnhanced !== "true")
				pendingRatings.set(rating, { value: answer.value, current: owner.loadTicket() });
		}
	};
	const bindClick = (control: Element) => {
		if (!control.matches(clickSelector) || clickControls.has(control)) return;
		clickControls.add(control);
		control.addEventListener("click", inspect, true);
	};
	const pending: SelfCheckConsumers = {
		epoch: () => epoch,
		read: () => undefined,
		forwardReady: () => false,
		settled: () => false,
		subscribe: () => () => {},
		finalize: () => {},
		presentLogicGate: () => {},
	};
	const owner = {
		build,
		get consumers() {
			return admitted ? (attachment?.consumers ?? pending) : pending;
		},
		get current() {
			if (!attachment) throw new Error("ESELFCHECKPENDING");
			return attachment.current;
		},
		epoch: () => epoch,
		active: () => !disposed && !suspended,
		lifetime: () => lifetime,
		isAdmitted: () => admitted && lifetime?.current() === true,
		admit(captured: SelfCheckLifetime) {
			if (!captured.current() || admitted) return;
			admitted = true;
			attachment?.activate();
			notify();
		},
		loadTicket() {
			const captured = lifetime;
			return () => captured?.current() === true;
		},
		takePendingRating(root: HTMLElement) {
			const gesture = pendingRatings.get(root);
			pendingRatings.delete(root);
			return gesture?.current() ? gesture : undefined;
		},
		captureEvent: captureSelfCheckEvent,
		eventTicket: selfCheckEventTicket,
		observe(listener: (lifetime?: SelfCheckLifetime) => void) {
			listeners.add(listener);
			listener(lifetime);
			return () => {
				listeners.delete(listener);
			};
		},
		attach(factory: () => SelfCheckAttachment) {
			if (!attachment) {
				attachment = factory();
				if (admitted) attachment.activate();
				notify();
			}
		},
		reset() {
			assign(provider, true);
		},
		sync() {
			if (disposed) return;
			const replacement = view.__praxityBlockState;
			if (replacement !== provider) {
				installProvider();
				assign(replacement);
			}
		},
		mount(listener: (runtime?: SelfCheckRuntime) => void) {
			if (!attachment) throw new Error("ESELFCHECKPENDING");
			return attachment.mount(listener);
		},
		printFocus: (replacement?: HTMLElement) => attachment?.printFocus(replacement) ?? null,
		dispose() {
			if (disposed) return;
			disposed = true;
			if (view.__praxitySelfCheckDocument === owner)
				Object.defineProperty(
					view,
					"__praxityBlockState",
					descriptor?.get || descriptor?.set
						? descriptor
						: {
								configurable: true,
								enumerable: true,
								writable: true,
								...descriptor,
								value: provider,
							},
				);
			// Cancellation drains through the session FIFO before the registry is released.
			revoke("dispose", () => {
				listeners.clear();
				view.removeEventListener("pagehide", hide);
				view.removeEventListener("pageshow", show);
				for (const type of ["input", "change", "focusin", "pointerdown", "keydown"])
					doc.removeEventListener(type, inspect, true);
				for (const control of clickControls) control.removeEventListener("click", inspect, true);
				clickControls.clear();

				if (view.__praxitySelfCheckDocument === owner) delete view.__praxitySelfCheckDocument;
			});
		},
	};
	view.__praxitySelfCheckDocument = owner;
	installProvider();
	view.addEventListener("pagehide", hide);
	view.addEventListener("pageshow", show);
	for (const type of ["input", "change", "focusin", "pointerdown", "keydown"])
		doc.addEventListener(type, inspect, true);
	for (const control of doc.querySelectorAll(clickSelector)) bindClick(control);
	activate("initial");
	return owner;
}

export type SelfCheckDocument = ReturnType<typeof createSelfCheckDocument>;

export function selfCheckDocument(
	doc: Document = document,
	waitForHost = false,
): SelfCheckDocument {
	const view = doc.defaultView;
	if (!view) throw new Error("ESELFCHECKDOCUMENT");
	const owner = view.__praxitySelfCheckDocument;
	if (owner?.build === __PRAXITY_SELF_CHECK_BUILD__) {
		owner.sync();
		return owner;
	}
	owner?.dispose();
	return createSelfCheckDocument(doc, __PRAXITY_SELF_CHECK_BUILD__, waitForHost);
}
