import { afterEach, expect, it, vi } from "vitest";
import {
	createSelfCheckIntersectionObserver,
	createSelfCheckMutationObserver,
	createSelfCheckResizeObserver,
	dispatchSelfCheckEvent,
	observeSelfCheckLifetime,
	requestSelfCheckFrame,
	selfCheckEpochTicket,
	setSelfCheckTimeout,
} from "./self-check-consumers";

afterEach(() => {
	Reflect.deleteProperty(window, "__praxitySelfCheckDocument");
	Reflect.deleteProperty(window, "__praxityBlockState");
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

it("has no write authority during server rendering", () => {
	vi.stubGlobal("document", undefined);
	expect(selfCheckEpochTicket()()).toBe(false);
});

it("an owner refuses unstamped events and targeted dispatch retains the original ticket", () => {
	let active = true;
	const stamps = new WeakMap<Event, () => boolean>();
	Object.assign(window, {
		__praxitySelfCheckDocument: {
			loadTicket: () => () => active,
			eventTicket: (event: Event) => stamps.get(event),
			captureEvent: (event: Event, current: () => boolean) => stamps.set(event, current),
		},
	});
	const card = document.createElement("div"),
		event = new Event("praxity:card-playthrough");
	expect(selfCheckEpochTicket(document, event)()).toBe(false);
	const seen: boolean[] = [];
	card.addEventListener("praxity:card-playthrough", (received) =>
		seen.push(selfCheckEpochTicket(document, received)()),
	);
	expect(dispatchSelfCheckEvent(event, () => active, document, card)).toBe(true);
	active = false;
	card.dispatchEvent(event);
	expect(seen).toEqual([true, false]);
});

it("cancellation notifies UI with a revoked stamp that survives owner removal", () => {
	const seen: boolean[] = [];
	const read = (event: Event) => seen.push(selfCheckEpochTicket(document, event)());
	document.addEventListener("praxity:self-check-completion", read);
	const event = new CustomEvent("praxity:self-check-completion", {
		detail: { blockId: "a", completed: false },
	});
	try {
		expect(
			dispatchSelfCheckEvent(
				event,
				() => false,
				document,
				document,
				() => true,
			),
		).toBe(false);
		expect(seen).toEqual([false]);
		expect(selfCheckEpochTicket(document, event)()).toBe(false);
		expect(
			dispatchSelfCheckEvent(
				new CustomEvent("praxity:self-check-completion", { detail: { completed: true } }),
				() => false,
				document,
				document,
				() => true,
			),
		).toBe(false);
		expect(seen).toEqual([false]);
	} finally {
		document.removeEventListener("praxity:self-check-completion", read);
	}
});

it("returns a synchronous native refusal without revoking the dispatch authority", () => {
	const target = document.createElement("div");
	target.addEventListener("learner-test", (event) => event.preventDefault());
	const event = new Event("learner-test", { cancelable: true });
	expect(dispatchSelfCheckEvent(event, () => true, document, target)).toBe(false);
	expect(event.defaultPrevented).toBe(true);
	expect(selfCheckEpochTicket(document, event)()).toBe(true);
});

it("rearms pre-host consumers on initial runtime admission without an early document owner", () => {
	const tickets: (() => boolean)[] = [];
	const release = observeSelfCheckLifetime((current) => {
		tickets.push(current);
		return () => {};
	});
	Object.assign(window, { __praxityBlockState: {} });
	window.dispatchEvent(new Event("praxity:runtime-ready"));
	expect(tickets).toHaveLength(2);
	expect(tickets[0]()).toBe(false);
	expect(tickets[1]()).toBe(true);
	release();
	expect(tickets[1]()).toBe(false);
});

it("reentrant observer detachment cannot duplicate the successor attachment", () => {
	let epoch = 0;
	Object.assign(window, {
		__praxitySelfCheckDocument: {
			loadTicket() {
				const captured = epoch;
				return () => epoch === captured;
			},
		},
	});
	const deliveries: (() => void)[] = [];
	const status = document.createElement("p");
	document.body.append(status);
	const release = observeSelfCheckLifetime((current) => {
		deliveries.push(() => {
			if (current()) status.textContent += "delivered";
		});
		return () => {
			if (epoch === 1) {
				++epoch;
				document.dispatchEvent(new Event("praxity:self-check-owner"));
			}
		};
	});
	++epoch;
	document.dispatchEvent(new Event("praxity:self-check-owner"));
	deliveries.forEach((deliver) => deliver());
	expect(status.textContent).toBe("delivered");
	release();
	deliveries.forEach((deliver) => deliver());
	expect(status.textContent).toBe("delivered");
});

it.each(["Resize", "Mutation", "Intersection"] as const)(
	"refuses retained %s deliveries after revoke and disposal, and rearms once",
	(kind) => {
		let epoch = 0;
		Object.assign(window, {
			__praxitySelfCheckDocument: {
				loadTicket() {
					const captured = epoch;
					return () => epoch === captured;
				},
			},
		});
		const callbacks: (() => void)[] = [];
		vi.stubGlobal(
			`${kind}Observer`,
			class {
				constructor(callback: (entries: never[], observer: unknown) => void) {
					callbacks.push(() => callback([], this));
				}
				observe() {}
				disconnect() {}
			},
		);
		const factories = {
			Resize: createSelfCheckResizeObserver,
			Mutation: createSelfCheckMutationObserver,
			Intersection: createSelfCheckIntersectionObserver,
		};
		const status = document.createElement("p");
		document.body.append(status);
		const release = observeSelfCheckLifetime((current) => {
			const observer = factories[kind](current, () => {
				status.textContent += "delivered";
			});
			return () => observer.disconnect();
		});
		callbacks[0]();
		expect(status.textContent).toBe("delivered");
		++epoch;
		document.dispatchEvent(new Event("praxity:self-check-owner"));
		document.dispatchEvent(new Event("praxity:self-check-owner"));
		expect(callbacks).toHaveLength(2);
		callbacks[0]();
		expect(status.textContent).toBe("delivered");
		callbacks[1]();
		expect(status.textContent).toBe("delivereddelivered");
		release();
		callbacks[1]();
		expect(status.textContent).toBe("delivereddelivered");
	},
);

it("frames and timers refuse the captured revoked lifetime without caller guards", () => {
	let epoch = 0;
	Object.assign(window, {
		__praxitySelfCheckDocument: {
			loadTicket() {
				const captured = epoch;
				return () => epoch === captured;
			},
		},
	});
	const frames: FrameRequestCallback[] = [],
		timers: (() => void)[] = [];
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
		frames.push(callback);
		return frames.length;
	});
	vi.spyOn(window, "setTimeout").mockImplementation(((callback: () => void) => {
		timers.push(callback);
		return timers.length;
	}) as typeof window.setTimeout);
	const status = document.createElement("p");
	document.body.append(status);
	const current = selfCheckEpochTicket();
	requestSelfCheckFrame(() => {
		status.textContent += "obsolete frame";
	}, current);
	setSelfCheckTimeout(
		() => {
			status.textContent += "obsolete timer";
		},
		1,
		current,
	);
	++epoch;
	frames[0](0);
	timers[0]();
	expect(status.textContent).toBe("");
	const fresh = selfCheckEpochTicket();
	requestSelfCheckFrame(() => {
		status.textContent += "frame";
	}, fresh);
	setSelfCheckTimeout(
		() => {
			status.textContent += "timer";
		},
		1,
		fresh,
	);
	frames[1](0);
	timers[1]();
	expect(status.textContent).toBe("frametimer");
});

it("a reentrant attachment cannot replace the successor's disposal authority", () => {
	let epoch = 0;
	Object.assign(window, {
		__praxitySelfCheckDocument: {
			loadTicket() {
				const captured = epoch;
				return () => epoch === captured;
			},
		},
	});
	const deliveries: (() => void)[] = [];
	const status = document.createElement("p");
	document.body.append(status);
	const release = observeSelfCheckLifetime((current) => {
		deliveries.push(() => {
			if (current()) status.textContent += "delivered";
		});
		if (epoch === 0) {
			++epoch;
			document.dispatchEvent(new Event("praxity:self-check-owner"));
		}
		return () => {};
	});
	deliveries[0]();
	deliveries[1]();
	expect(status.textContent).toBe("delivered");
	release();
	deliveries[1]();
	expect(status.textContent).toBe("delivered");
});

it("a later event listener retains dispatch authority after an earlier listener revokes it", () => {
	let epoch = 0;
	const events = new WeakMap<Event, () => boolean>();
	Object.assign(window, {
		__praxitySelfCheckDocument: {
			loadTicket() {
				const captured = epoch;
				return () => epoch === captured;
			},
			captureEvent(event: Event, current: () => boolean) {
				events.set(event, current);
			},
			eventTicket(event: Event) {
				return events.get(event);
			},
		},
	});
	const status = document.createElement("p");
	document.body.append(status);
	const revoke = () => {
		++epoch;
	};
	const consume = (event: Event) => {
		if (selfCheckEpochTicket(document, event)()) status.textContent += "current";
	};
	document.addEventListener("learner-test", revoke);
	document.addEventListener("learner-test", consume);
	try {
		expect(dispatchSelfCheckEvent(new Event("learner-test"), selfCheckEpochTicket())).toBe(false);
		expect(status.textContent).toBe("");
		document.removeEventListener("learner-test", revoke);
		expect(dispatchSelfCheckEvent(new Event("learner-test"), selfCheckEpochTicket())).toBe(true);
		expect(status.textContent).toBe("current");
	} finally {
		document.removeEventListener("learner-test", revoke);
		document.removeEventListener("learner-test", consume);
	}
});
