import type { SelfCheckCommand, SelfCheckTicket, SelfCheckView } from "./self-check-session";

const eventTicketKey = Symbol.for("praxity.self-check.event-ticket");

/** The first dispatch stamp survives owner disposal and separately bundled publishers. */
export function captureSelfCheckEvent(event: Event, current: () => boolean): void {
	if (!(eventTicketKey in event)) Object.defineProperty(event, eventTicketKey, { value: current });
}

export function selfCheckEventTicket(event: Event): (() => boolean) | undefined {
	return (event as Event & { [eventTicketKey]?: () => boolean })[eventTicketKey];
}

/** Content-free handoff from the permanent document owner to its consumers. */
export interface SelfCheckConsumers {
	read(blockId: string): (SelfCheckView & { ready: boolean }) | undefined;
	forwardReady(): boolean;
	validateForward?(): boolean;
	settled(): boolean;
	epoch(): number;
	subscribe(
		effect: (ticket: SelfCheckTicket, command?: SelfCheckCommand) => void,
		phase?: "effects" | "settled" | "tracking",
	): () => void;
	finalize(): void;
	presentLogicGate(blocked: boolean, reasons: string[]): void;
}

export function selfCheckConsumers(doc: Document = document): SelfCheckConsumers | undefined {
	return (
		doc.defaultView as
			| (Window & {
					__praxitySelfCheckDocument?: { consumers: SelfCheckConsumers };
			  })
			| null
	)?.__praxitySelfCheckDocument?.consumers;
}

export function isSelfCheckForwardBlocked(doc: Document = document): boolean {
	return (
		doc.documentElement.hasAttribute("data-self-check-dependencies") &&
		selfCheckConsumers(doc)?.forwardReady() !== true
	);
}

/** Deferred display work retains the document/provider authority that scheduled it. */
export function selfCheckEpochTicket(
	doc: Document | undefined = typeof document === "undefined" ? undefined : document,
	event?: Event,
): () => boolean {
	if (!doc) return () => false;
	const documentOwner = (
		doc.defaultView as
			| (Window & {
					__praxitySelfCheckDocument?: {
						loadTicket?(): () => boolean;
						eventTicket?(event: Event): (() => boolean) | undefined;
					};
			  })
			| null
	)?.__praxitySelfCheckDocument;
	const captured = event && (selfCheckEventTicket(event) ?? documentOwner?.eventTicket?.(event));
	if (captured) return captured;
	if (event && documentOwner) return () => false;
	if (documentOwner?.loadTicket) return documentOwner.loadTicket();
	const owner = selfCheckConsumers(doc);
	const epoch = owner?.epoch();
	const provider = doc.defaultView?.__praxityBlockState;
	return () =>
		selfCheckConsumers(doc) === owner &&
		owner?.epoch() === epoch &&
		doc.defaultView?.__praxityBlockState === provider;
}

/** A reentrant listener cannot turn an old dispatch into a fresh learner effect. */
export function dispatchSelfCheckEvent(
	event: Event,
	current: () => boolean,
	doc: Document = document,
	target: EventTarget = doc,
	cancellation?: () => boolean,
): boolean {
	// Cancellation still notifies UI observers, with a revoked write stamp.
	const cancelling = () =>
		cancellation?.() === true &&
		event.type === "praxity:self-check-completion" &&
		(event as CustomEvent<{ completed?: boolean }>).detail?.completed === false;
	if (!current() && !cancelling()) return false;
	const owner = (
		doc.defaultView as
			| (Window & {
					__praxitySelfCheckDocument?: {
						captureEvent?(event: Event, current: () => boolean): void;
					};
			  })
			| null
	)?.__praxitySelfCheckDocument;
	captureSelfCheckEvent(event, current);
	owner?.captureEvent?.(event, current);
	const dispatched = selfCheckEpochTicket(doc, event);
	if ((!current() || !dispatched()) && !cancelling()) return false;
	const accepted = target.dispatchEvent(event);
	return current() && dispatched() && accepted;
}

/** Scheduling captures authority once; callback delivery cannot borrow a later lifetime. */
export function requestSelfCheckFrame(
	effect: FrameRequestCallback,
	current: () => boolean,
): number {
	return window.requestAnimationFrame((time) => {
		if (current()) effect(time);
	});
}

export function setSelfCheckTimeout(
	effect: () => void,
	delay: number,
	current: () => boolean,
): number {
	return window.setTimeout(() => {
		if (current()) effect();
	}, delay);
}

export function createSelfCheckResizeObserver(
	current: () => boolean,
	effect: ResizeObserverCallback,
): ResizeObserver {
	return new ResizeObserver((entries, observer) => {
		if (current()) effect(entries, observer);
	});
}

export function createSelfCheckMutationObserver(
	current: () => boolean,
	effect: MutationCallback,
): MutationObserver {
	return new MutationObserver((entries, observer) => {
		if (current()) effect(entries, observer);
	});
}

export function createSelfCheckIntersectionObserver(
	current: () => boolean,
	effect: IntersectionObserverCallback,
	options?: IntersectionObserverInit,
): IntersectionObserver {
	return new IntersectionObserver((entries, observer) => {
		if (current()) effect(entries, observer);
	}, options);
}

/** Observers are recreated per lifetime; a retained delivery never acquires successor authority. */
export function observeSelfCheckLifetime(
	attach: (current: () => boolean) => () => void,
	doc: Document = document,
): () => void {
	let current: (() => boolean) | undefined;
	let release: (() => void) | undefined;
	const sync = () => {
		if (current?.()) return;
		const previous = release;
		release = undefined;
		previous?.();
		if (current?.()) return;
		const lifetime = selfCheckEpochTicket(doc);
		let revoked = false;
		const captured = () => !revoked && lifetime();
		current = captured;
		if (captured()) {
			const detach = attach(captured);
			const cancel = () => {
				revoked = true;
				detach();
			};
			if (current !== captured || !captured()) cancel();
			else release = cancel;
		}
	};
	doc.addEventListener("praxity:self-check-owner", sync);
	doc.defaultView?.addEventListener("pagehide", sync);
	doc.defaultView?.addEventListener("praxity:runtime-ready", sync);
	sync();
	return () => {
		doc.removeEventListener("praxity:self-check-owner", sync);
		doc.defaultView?.removeEventListener("pagehide", sync);
		doc.defaultView?.removeEventListener("praxity:runtime-ready", sync);
		release?.();
	};
}

/** Completion is known only after admission; self-check has no correctness or score fields. */
export function readSelfCheckField(
	owner: Pick<SelfCheckConsumers, "read"> | undefined,
	id: string,
	field: string,
) {
	const activity = owner?.read(id);
	return activity?.ready &&
		activity.available &&
		(field === "isAttempted" || field === "isCompleted")
		? activity.completed
		: undefined;
}

/** Self-check artifacts attach through their captured bootstrap, including after owner disposal. */
export function shouldAttachIslandAutomatically(): boolean {
	return (
		!(window as Window & { __praxitySelfCheckDocument?: unknown }).__praxitySelfCheckDocument &&
		!document.documentElement.dataset.praxityIslands?.split(",").includes("selfCheck")
	);
}
