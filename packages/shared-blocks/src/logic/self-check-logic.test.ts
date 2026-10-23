import { afterEach, assert, expect, it, vi } from "vitest";
import {
	dispatchSelfCheckEvent,
	type SelfCheckConsumers,
	selfCheckEpochTicket,
} from "../self-check-consumers";
import type { SelfCheckTicket, SelfCheckView } from "../self-check-session";
import { createCompletionEffects } from "../viewer/completion-effects";
import { clearRequiredValidation, showRequiredValidation } from "../viewer/required-blocks";
import { initDomLogicRuntime } from "./dom-logic-runtime";
import { LogicEngine } from "./logic-engine";
import { VariableStore } from "./variable-store";

let domRuntime: ReturnType<typeof initDomLogicRuntime>;
afterEach(() => {
	clearRequiredValidation();
	domRuntime?.destroy();
	vi.restoreAllMocks();
	document.documentElement.removeAttribute("data-self-check-dependencies");
	Reflect.deleteProperty(window, "__praxitySelfCheckDocument");
	delete window.__praxityRuntime;
	document.body.replaceChildren();
});

function resumedRating(hydration = false) {
	document.documentElement.setAttribute("data-self-check-dependencies", "A,B");
	document.body.innerHTML =
		'<div data-block-id="rating" data-block-type="rating" data-rating-value="0"></div><div data-block-id="reveal"><span data-mention="variable:count"></span></div>';
	const frames: FrameRequestCallback[] = [];
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
		frames.push(callback);
		return frames.length;
	});
	const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
	let epoch = 0;
	let saved = '{"v":{"count":0,"ordinary":4}}';
	const callbacks = new Map<string, Parameters<SelfCheckConsumers["subscribe"]>[0]>();
	const owner: SelfCheckConsumers = {
		read: (blockId) => view({ blockId }),
		epoch: () => epoch,
		forwardReady: () => true,
		settled: () => true,
		finalize() {},
		presentLogicGate() {},
		subscribe(effect, phase = "effects") {
			callbacks.set(phase, effect);
			return () => callbacks.delete(phase);
		},
	};
	Object.assign(window, {
		__praxitySelfCheckDocument: { consumers: owner },
		__praxityRuntime: {
			getSuspendData: () => saved,
			setSuspendData: (value: string) => {
				saved = value;
			},
			commit() {},
		},
	});
	domRuntime = initDomLogicRuntime({
		courseId: "resumed-rating",
		pageId: "practice",
		blocks: [...blocks, { id: "B", type: "selfCheck", data: {} }],
		logic: {
			visibility: hydration
				? [
						{
							blockId: "reveal",
							conditions: {
								operator: "and",
								rules: [
									{ source: "block:rating", field: "ratingScore", comparison: "gte", value: 2 },
								],
							},
						},
					]
				: [],
			variables: [
				{ name: "count", dataType: "number", defaultValue: 0 },
				{ name: "ordinary", dataType: "number", defaultValue: 0 },
			],
			rules: [
				{
					blockId: "mixed",
					conditions: {
						operator: "and",
						rules: [
							{ source: "block:A", field: "isCompleted", comparison: "is", value: true },
							{ source: "block:rating", field: "ratingScore", comparison: "gte", value: 2 },
						],
					},
					actions: [
						{ type: "setVariable", target: "count", value: { operation: "add", operand: 1 } },
						{ type: "jumpToPage", target: "destination" },
					],
				},
				{
					blockId: "restored-only",
					conditions: {
						operator: "and",
						rules: [{ source: "block:A", field: "isCompleted", comparison: "is", value: true }],
					},
					actions: [
						{ type: "setVariable", target: "count", value: 999 },
						{ type: "jumpToPage", target: "restored-destination" },
					],
				},
				{
					blockId: "ordinary",
					conditions: {
						operator: "and",
						rules: [{ source: "variable:ordinary", comparison: "gte", value: 0 }],
					},
					actions: [
						{ type: "setVariable", target: "ordinary", value: { operation: "add", operand: 1 } },
					],
				},
				{
					blockId: "restored-B",
					conditions: {
						operator: "and",
						rules: [{ source: "block:B", field: "isCompleted", comparison: "is", value: true }],
					},
					actions: [
						{ type: "setVariable", target: "count", value: 1000 },
						{ type: "jumpToPage", target: "other-restored-destination" },
					],
				},
			],
		},
	});
	const finalize = () => {
		const generation = epoch;
		const ticket: SelfCheckTicket = { revision: 1, current: () => generation === epoch };
		callbacks.get("effects")?.(ticket);
	};
	finalize();
	return {
		cancel,
		read: () => ({ count: 0, ...JSON.parse(saved).v }),
		interact() {
			dispatchSelfCheckEvent(
				new CustomEvent("praxity:block-interaction", {
					detail: { blockId: "rating", blockType: "rating" },
				}),
				selfCheckEpochTicket(),
			);
		},
		flush() {
			frames.splice(0).forEach((frame) => frame(0));
		},
		replace(lifecycle: "provider" | "pagehide") {
			epoch++;
			if (lifecycle === "pagehide") window.dispatchEvent(new Event("pagehide"));
			else document.dispatchEvent(new Event("praxity:self-check-owner"));
			saved = '{"v":{"count":0,"ordinary":4}}';
			if (lifecycle === "pagehide")
				window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
			finalize();
		},
		refresh() {
			callbacks.get("effects")?.({ revision: 1, current: () => true });
		},
	};
}

it.each(["provider", "pagehide"] as const)(
	"%s rejects a retained hydration observer before successor visibility",
	(boundary) => {
		const callbacks: MutationCallback[] = [];
		class Observer {
			constructor(callback: MutationCallback) {
				callbacks.push(callback);
			}
			observe() {}
			disconnect() {}
			takeRecords() {
				return [];
			}
		}
		vi.stubGlobal("MutationObserver", Observer);
		try {
			const session = resumedRating(true);
			const obsolete = callbacks[0];
			session.replace(boundary);
			const rating = document.querySelector<HTMLElement>('[data-block-id="rating"]');
			const reveal = document.querySelector<HTMLElement>('[data-block-id="reveal"]');
			assert(rating && reveal);
			rating.dataset.ratingValue = "2";
			obsolete?.([], {} as MutationObserver);
			expect(reveal.hidden).toBe(true);
			expect(session.read()).toEqual({ count: 0, ordinary: 5 });
			callbacks.at(-1)?.([], {} as MutationObserver);
			expect(reveal.hidden).toBe(false);
			expect(session.read()).toEqual({ count: 0, ordinary: 5 });
		} finally {
			domRuntime?.destroy();
			vi.unstubAllGlobals();
		}
	},
);

it("a new rating after self-check resume runs its compound write and authored jump once", () => {
	const session = resumedRating();
	expect(session.read()).toEqual({ count: 0, ordinary: 5 });
	expect(domRuntime?.getJumpTarget()).toBeNull();
	const rating = document.querySelector<HTMLElement>('[data-block-id="rating"]');
	assert(rating);
	rating.dataset.ratingValue = "2";
	session.interact();
	session.flush();
	expect(session.read()).toEqual({ count: 1, ordinary: 6 });
	expect(domRuntime?.getJumpTarget()).toBe("destination");
	session.refresh();
	expect(session.read()).toEqual({ count: 1, ordinary: 6 });
	expect(domRuntime?.getJumpTarget()).toBe("destination");
});

it.each(["provider", "pagehide"] as const)(
	"%s revokes old interaction frames before successor writes or validation cleanup",
	(lifecycle) => {
		const session = resumedRating();
		const rating = document.querySelector<HTMLElement>('[data-block-id="rating"]');
		assert(rating);
		Object.defineProperty(rating, "scrollIntoView", { value: vi.fn() });
		rating.dataset.required = "true";
		expect(showRequiredValidation()).toBe(true);
		session.interact();
		session.replace(lifecycle);
		rating.dataset.completed = "true";
		session.flush();
		expect(session.read()).toEqual({ count: 0, ordinary: 5 });
		expect(domRuntime?.getJumpTarget()).toBeNull();
		expect(document.querySelectorAll(".praxity-required-message")).toHaveLength(1);
		expect(session.cancel).toHaveBeenCalledWith(1);
	},
);
const blocks = [
	{ id: "A", type: "selfCheck", name: "Practice", data: {} },
	{ id: "reveal", type: "text", visible: false, data: {} },
	{ id: "rating", type: "rating", data: {} },
];
function view(overrides: Partial<SelfCheckView & { ready: boolean }> = {}) {
	return {
		blockId: "A",
		ready: true,
		outcome: "submitted" as const,
		completed: true,
		available: true,
		origin: "restore" as const,
		generation: 1,
		admitted: true,
		...overrides,
	};
}
function fixture(initial = view()) {
	let activity = initial;
	let saved = '{"v":{"count":7,"flag":true}}';
	const runtime = {
		getSuspendData: () => saved,
		setSuspendData: vi.fn((value: string) => {
			saved = value;
		}),
		commit: vi.fn(),
	};
	const store = new VariableStore(
		[
			{ name: "count", dataType: "number", defaultValue: 0 },
			{ name: "flag", dataType: "boolean", defaultValue: false },
		],
		runtime,
	);
	const owner = { read: () => activity };
	const engine = new LogicEngine(store, blocks, undefined, undefined, owner);
	return {
		engine,
		store,
		runtime,
		update(next: typeof activity) {
			activity = next;
		},
	};
}

it.each(["pending", "unavailable", "refused"] as const)(
	"%s never chooses negative or OR branches, including a variable writer dependency",
	(outcome) => {
		const { engine, store, runtime } = fixture(
			view({ outcome, ready: outcome !== "pending", available: false, completed: false }),
		);
		engine.registerLogicBlock({
			blockId: "writer",
			conditions: {
				operator: "and",
				rules: [{ source: "block:Practice", field: "isCompleted", comparison: "is", value: true }],
			},
			actions: [{ type: "setVariable", target: "flag", value: true }],
		});
		engine.registerLogicBlock({
			blockId: "negative",
			conditions: {
				operator: "or",
				rules: [
					{ source: "block:Practice", field: "isCompleted", comparison: "isNot", value: true },
					{ source: "variable:flag", comparison: "is", value: true },
				],
			},
			actions: [
				{ type: "show", target: "reveal" },
				{ type: "require", target: "rating" },
				{ type: "setVariable", target: "count", value: 999 },
				{ type: "jumpToPage", target: "__end_lesson__" },
			],
		});
		engine.evaluate();
		expect(engine.getVisibleBlockIds().has("reveal")).toBe(false);
		expect(engine.isCompletionBlocked()).toBe(true);
		expect(engine.getJumpTarget()).toBeNull();
		expect(store.get("count")).toBe(7);
		expect(runtime.setSuspendData).not.toHaveBeenCalled();
	},
);

it("restore and hydration apply require/show/gates without a compound write or jump; live Show applies the ordinary pass", () => {
	document.body.innerHTML = '<div data-block-id="rating"></div>';
	const { engine, store, runtime, update } = fixture();
	engine.registerLogicBlock({
		blockId: "restored",
		conditions: {
			operator: "and",
			rules: [{ source: "block:Practice", field: "isCompleted", comparison: "is", value: true }],
		},
		actions: [
			{ type: "show", target: "reveal" },
			{ type: "require", target: "rating", value: 2 },
			{ type: "disableCompletion", reason: "Finish the rating." },
			{ type: "setVariable", target: "count", value: { operation: "add", operand: 1 } },
			{ type: "jumpToPage", target: "__end_lesson__" },
		],
	});
	engine.evaluate();
	engine.refreshVisibility();
	expect(engine.getVisibleBlockIds().has("reveal")).toBe(true);
	expect(document.querySelector('[data-block-id="rating"]')).toHaveAttribute(
		"data-required-min",
		"2",
	);
	expect(engine.isCompletionBlocked()).toBe(true);
	expect(engine.getJumpTarget()).toBeNull();
	expect(store.get("count")).toBe(7);
	expect(runtime.setSuspendData).not.toHaveBeenCalled();
	update(view({ origin: "interaction" }));
	engine.evaluate("interaction");
	expect(store.get("count")).toBe(8);
	expect(engine.getJumpTarget()).toBe("__end_lesson__");
	update(view({ origin: "fresh", outcome: "empty", completed: false }));
	engine.refreshVisibility();
	expect(document.querySelector('[data-block-id="rating"]')).not.toHaveAttribute("data-required");
	expect(engine.isCompletionBlocked()).toBe(false);
	expect(store.get("count")).toBe(8);
	engine.destroy();
});

it("DomLogicRuntime awaits a current finalization ticket before hydration, effects and learner writes", () => {
	document.documentElement.setAttribute("data-self-check-dependencies", "A");
	document.body.innerHTML =
		'<div class="praxity-block" data-block-id="reveal" hidden><span data-mention="variable:count"></span></div>';
	const callbacks = new Map<string, Parameters<SelfCheckConsumers["subscribe"]>[0]>();
	let current = false;
	let revision = 2;
	const owner: SelfCheckConsumers = {
		read: () => view(),
		epoch: () => 0,
		forwardReady: () => current,
		settled: () => current,
		finalize() {},
		presentLogicGate: vi.fn(),
		subscribe(effect, phase = "effects") {
			callbacks.set(phase, effect);
			return () => callbacks.delete(phase);
		},
	};
	Object.assign(window, { __praxitySelfCheckDocument: { consumers: owner } });
	let saved = '{"v":{"count":7}}';
	const writes = vi.fn((value: string) => {
		saved = value;
	});
	Object.assign(window, {
		__praxityRuntime: { getSuspendData: () => saved, setSuspendData: writes, commit: vi.fn() },
	});
	domRuntime = initDomLogicRuntime({
		courseId: "course",
		pageId: "practice",
		blocks,
		logic: {
			variables: [{ name: "count", dataType: "number", defaultValue: 0 }],
			rules: [
				{
					blockId: "restore",
					conditions: {
						operator: "and",
						rules: [
							{ source: "block:Practice", field: "isCompleted", comparison: "is", value: true },
						],
					},
					actions: [
						{ type: "show", target: "reveal" },
						{ type: "setVariable", target: "count", value: 999 },
						{ type: "jumpToPage", target: "__end_lesson__" },
					],
				},
			],
		},
	});
	domRuntime?.evaluate();
	expect(writes).not.toHaveBeenCalled();
	callbacks.get("effects")?.({ revision: 1, current: () => false });
	expect(document.querySelector('[data-block-id="reveal"]')).toHaveAttribute("hidden");
	current = true;
	callbacks.get("effects")?.({ revision: 2, current: () => revision === 2 });
	expect(document.querySelector('[data-block-id="reveal"]')).not.toHaveAttribute("hidden");
	expect(document.querySelector("[data-mention]")?.textContent).toBe("7");
	expect(writes).not.toHaveBeenCalled();
	callbacks.get("tracking")?.({ revision: 2, current: () => true });
	expect(JSON.parse(saved).learnerTracking.practice.visitCount).toBe(1);
	revision = 3;
	callbacks.get("effects")?.(
		{ revision: 3, current: () => revision === 3 },
		{ type: "show-feedback", blockId: "A" },
	);
	expect(JSON.parse(saved).v.count).toBe(999);
	expect(domRuntime?.getJumpTarget()).toBe("__end_lesson__");
	callbacks.get("effects")?.({ revision: 3, current: () => revision === 3 });
	domRuntime?.evaluate();
	expect(domRuntime?.getJumpTarget()).toBe("__end_lesson__");
	expect(writes).toHaveBeenCalledTimes(2);
});

it("a deck gate describes forward links while preserving backward destinations after resume", () => {
	document.body.innerHTML =
		'<nav id="deck-controls"><a data-deck-page="previous" data-page-number="2" href="previous.html">Back</a><a data-deck-page="next" data-page-number="4" href="next.html">Next</a></nav><section data-deck-slide="current" data-page-number="3"></section>';
	const gate = createCompletionEffects(1);
	gate.sync(true, ["Comparison unavailable"]);
	const backward = document.querySelector('[data-deck-page="previous"]');
	const forward = document.querySelector('[data-deck-page="next"]');
	expect(backward).toHaveAttribute("href", "previous.html");
	expect(forward).not.toHaveAttribute("href");
	expect(forward).toHaveAttribute("aria-disabled", "true");
	expect(forward).toHaveAttribute("aria-describedby", gate.description.id);
	gate.sync(false, []);
	expect(forward).toHaveAttribute("href", "next.html");
	gate.destroy();
});

it("a pending deck keeps its recovery band visible before deck initialization", () => {
	document.body.innerHTML =
		'<nav id="deck-controls" hidden><button id="deck-next">Next</button></nav>';
	const gate = createCompletionEffects(1);
	gate.sync(true, ["Restoring progress"]);
	expect(document.getElementById("deck-controls")).not.toHaveAttribute("hidden");
	expect(gate.description.textContent).toBe("Restoring progress");
	expect(document.getElementById("deck-next")).toHaveAttribute("aria-disabled", "true");
	gate.sync(false, []);
	expect(document.getElementById("deck-controls")).toHaveAttribute("hidden");
	gate.destroy();
});

it("a variable reader waits for its writer in another module", () => {
	const { store, runtime } = fixture();
	const engine = new LogicEngine(
		store,
		blocks,
		undefined,
		undefined,
		{ read: () => view({ ready: false, available: false }) },
		[
			{
				conditions: {
					operator: "and",
					rules: [
						{ source: "block:Practice", field: "isCompleted", comparison: "is", value: true },
					],
				},
				actions: [{ type: "setVariable", target: "flag", value: true }],
			},
		],
	);
	engine.registerLogicBlock({
		blockId: "reader",
		conditions: {
			operator: "and",
			rules: [{ source: "variable:flag", comparison: "is", value: true }],
		},
		actions: [
			{ type: "show", target: "reveal" },
			{ type: "setVariable", target: "count", value: 999 },
		],
	});
	engine.evaluate("interaction");
	expect(engine.getVisibleBlockIds().has("reveal")).toBe(false);
	expect(store.get("count")).toBe(7);
	expect(runtime.setSuspendData).not.toHaveBeenCalled();
});

it("an unavailable compound operand skips every action in its rule", () => {
	const { engine, store, runtime } = fixture(view({ available: false, outcome: "unavailable" }));
	engine.registerLogicBlock({
		blockId: "compound",
		conditions: {
			operator: "and",
			rules: [{ source: "variable:flag", comparison: "is", value: true }],
		},
		actions: [
			{ type: "show", target: "reveal" },
			{
				type: "setVariable",
				target: "count",
				value: { operation: "assign", operand: { ref: "block:Practice", field: "isCompleted" } },
			},
		],
	});
	engine.evaluate("interaction");
	expect(engine.getVisibleBlockIds().has("reveal")).toBe(false);
	expect(store.get("count")).toBe(7);
	expect(runtime.setSuspendData).not.toHaveBeenCalled();
});
