import { afterEach, assert, expect, it, vi } from "vitest";
import {
	dispatchSelfCheckEvent,
	type SelfCheckConsumers,
	selfCheckEpochTicket,
} from "../self-check-consumers";
import { clearRequiredValidation, showRequiredValidation } from "../viewer/required-blocks";
import { initDomLogicRuntime } from "./dom-logic-runtime";
import type { LogicAction, LogicConditions } from "./evaluate";

let runtime: ReturnType<typeof initDomLogicRuntime>;
afterEach(() => {
	clearRequiredValidation();
	runtime?.destroy();
	vi.restoreAllMocks();
	document.documentElement.removeAttribute("data-self-check-dependencies");
	Reflect.deleteProperty(window, "__praxitySelfCheckDocument");
	delete window.__praxityRuntime;
	document.body.replaceChildren();
});

function fixture(indirect = false) {
	document.documentElement.setAttribute("data-self-check-dependencies", "A,B");
	document.body.innerHTML =
		'<div data-block-id="first" data-block-type="rating" data-rating-value="0"></div><div data-block-id="second" data-block-type="rating" data-rating-value="0"></div><div data-block-id="third" data-block-type="rating" data-rating-value="0"></div><div data-block-id="reveal" hidden></div>';
	const first = document.querySelector<HTMLElement>('[data-block-id="first"]');
	const second = document.querySelector<HTMLElement>('[data-block-id="second"]');
	const third = document.querySelector<HTMLElement>('[data-block-id="third"]');
	assert(first && second && third);
	const frames: FrameRequestCallback[] = [];
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
	const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
	let epoch = 0;
	let authority = 0;
	let saved = '{"v":{"restoredOnly":7}}';
	let reenter: (() => void) | undefined;
	const stamps = new WeakMap<Event, () => boolean>();
	const callbacks = new Map<string, Parameters<SelfCheckConsumers["subscribe"]>[0]>();
	const owner: SelfCheckConsumers = {
		read: (blockId) => ({
			blockId,
			ready: true,
			outcome: blockId === "B" ? "unavailable" : "submitted",
			completed: blockId !== "B",
			available: blockId !== "B",
			origin: "restore",
			generation: 1,
			admitted: true,
		}),
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
		__praxitySelfCheckDocument: {
			consumers: owner,
			captureEvent: (event: Event, current: () => boolean) => stamps.set(event, current),
			eventTicket: (event: Event) => stamps.get(event),
		},
		__praxityRuntime: {
			getSuspendData: () => saved,
			setSuspendData: (value: string) => {
				saved = value;
				const callback = reenter;
				reenter = undefined;
				callback?.();
			},
			commit() {},
		},
	});
	const completed = {
		source: "block:Practice",
		field: "isCompleted",
		comparison: "is",
		value: true,
	};
	const score = (id: string) => ({
		source: `block:${id}`,
		field: "ratingScore",
		comparison: "gte",
		value: 2,
	});
	const add = (target: string): LogicAction => ({
		type: "setVariable",
		target,
		value: { operation: "add", operand: 1 },
	});
	const rule = (blockId: string, rules: LogicConditions["rules"], actions: LogicAction[]) => ({
		blockId,
		conditions: { operator: "and" as const, rules },
		actions,
	});
	runtime = initDomLogicRuntime({
		courseId: "provenance",
		blocks: [
			{ id: "A", name: "Practice", type: "selfCheck", data: {} },
			{ id: "B", type: "selfCheck", data: {} },
			{ id: "first", name: "First", type: "rating", data: {} },
			{ id: "second", name: "Second", type: "rating", data: {} },
			{ id: "third", type: "rating", data: {} },
			{ id: "reveal", type: "text", visible: false, data: {} },
		],
		logic: {
			variables: [
				"firstCount",
				"secondCount",
				"thirdCount",
				"restoredOnly",
				"ordinary",
				"carried",
				"forbidden",
			].map((name) => ({ name, dataType: "number", defaultValue: 0 })),
			rules: [
				rule("writer", [score("First")], [{ type: "setVariable", target: "carried", value: 1 }]),
				rule(
					"first-rule",
					[
						completed,
						indirect ? { source: "variable:carried", comparison: "gte", value: 1 } : score("First"),
					],
					[add("firstCount"), { type: "jumpToPage", target: "destination" }],
				),
				rule("second-rule", indirect ? [completed] : [completed, score("Second")], [
					indirect
						? {
								type: "setVariable",
								target: "secondCount",
								value: { operation: "add", operand: { ref: "block:Second", field: "ratingScore" } },
							}
						: add("secondCount"),
				]),
				rule("third-rule", [completed, score("third")], [add("thirdCount")]),
				rule(
					"restored-only",
					[completed],
					[
						add("restoredOnly"),
						{ type: "jumpToPage", target: "forbidden" },
						{ type: "show", target: "reveal" },
					],
				),
				rule(
					"ordinary",
					[{ source: "variable:ordinary", comparison: "gte", value: 0 }],
					[add("ordinary")],
				),
				{
					blockId: "unavailable-or",
					conditions: {
						operator: "or",
						rules: [
							score("First"),
							{ source: "block:B", field: "isCompleted", comparison: "isNot", value: true },
						],
					},
					actions: [add("forbidden"), { type: "jumpToPage", target: "unavailable" }],
				},
			],
		},
	});
	const finalize = (command?: Parameters<Parameters<SelfCheckConsumers["subscribe"]>[0]>[1]) => {
		const generation = authority;
		callbacks.get("effects")?.({ revision: 1, current: () => generation === authority }, command);
	};
	finalize();
	return {
		first,
		second,
		third,
		readThird: () => JSON.parse(saved).v?.thirdCount ?? 0,
		cancel,
		read: () => ({
			firstCount: 0,
			secondCount: 0,
			restoredOnly: 0,
			ordinary: 0,
			carried: 0,
			forbidden: 0,
			...JSON.parse(saved).v,
		}),
		interact(blockId: unknown) {
			dispatchSelfCheckEvent(
				new CustomEvent("praxity:block-interaction", { detail: { blockId, blockType: "rating" } }),
				selfCheckEpochTicket(),
			);
		},
		flush() {
			frames.splice(0).forEach((frame) => frame(0));
		},
		reenter(callback: () => void) {
			reenter = callback;
		},
		finalize,
		revoke(boundary: "provider" | "pagehide" | "retry" | "reset" | "ready" | "destroy") {
			if (boundary === "destroy") runtime?.destroy();
			else if (boundary === "ready") window.dispatchEvent(new Event("praxity:runtime-ready"));
			else {
				authority++;
				if (boundary === "provider" || boundary === "pagehide") {
					epoch++;
					saved = '{"v":{"restoredOnly":7}}';
				}
				if (boundary === "pagehide") {
					window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
					window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
				} else if (boundary === "provider")
					document.dispatchEvent(new Event("praxity:self-check-owner"));
				finalize(
					boundary === "retry" || boundary === "reset"
						? { type: boundary === "reset" ? "start-over" : "retry", blockId: "A" }
						: undefined,
				);
			}
		},
	};
}

it.each([false, true])(
	"retains both origins in one frame, indirect dependencies %s",
	(indirect) => {
		const session = fixture(indirect);
		session.first.dataset.ratingValue = "2";
		session.second.dataset.ratingValue = "2";
		session.interact("first");
		session.interact("second");
		session.flush();
		expect(session.read()).toEqual({
			firstCount: 1,
			secondCount: indirect ? 2 : 1,
			restoredOnly: 7,
			ordinary: 2,
			carried: 1,
			forbidden: 0,
		});
		expect(runtime?.getJumpTarget()).toBe("destination");
	},
);

it.each([false, true])(
	"reverse order keeps direct and transitive origins, indirect %s",
	(indirect) => {
		const session = fixture(indirect);
		session.first.dataset.ratingValue = "2";
		session.second.dataset.ratingValue = "2";
		session.interact("second");
		session.interact("first");
		session.flush();
		expect(session.read()).toEqual({
			firstCount: 1,
			secondCount: indirect ? 2 : 1,
			restoredOnly: 7,
			ordinary: 2,
			carried: 1,
			forbidden: 0,
		});
	},
);

it("repeated origins use final values once and a separate frame acts again", () => {
	const session = fixture();
	session.first.dataset.ratingValue = "2";
	session.interact("first");
	session.interact("first");
	session.second.dataset.ratingValue = "2";
	session.interact("second");
	session.second.dataset.ratingValue = "1";
	session.interact("second");
	session.flush();
	expect(session.read()).toMatchObject({
		firstCount: 1,
		secondCount: 0,
		ordinary: 2,
		restoredOnly: 7,
	});
	session.interact("first");
	session.flush();
	expect(session.read()).toMatchObject({ firstCount: 2, secondCount: 0, ordinary: 3 });
});

it("detaches the batch before a reentrant input from an injected write", () => {
	const session = fixture();
	session.first.dataset.ratingValue = "2";
	session.second.dataset.ratingValue = "2";
	session.third.dataset.ratingValue = "2";
	session.reenter(() => session.interact("third"));
	session.interact("first");
	session.interact("second");
	session.flush();
	expect(session.read()).toMatchObject({ firstCount: 1, secondCount: 1, ordinary: 2 });
	expect(session.readThird()).toBe(0);
	session.flush();
	expect(session.read()).toMatchObject({ firstCount: 1, secondCount: 1, ordinary: 3 });
	expect(session.readThird()).toBe(1);
});

it.each([undefined, "", 123, {}, "unknown"])(
	"malformed origin %j cannot admit restored actions",
	(origin) => {
		const session = fixture();
		session.first.dataset.ratingValue = "2";
		session.second.dataset.ratingValue = "2";
		session.interact(origin);
		session.flush();
		expect(session.read()).toMatchObject({
			firstCount: 0,
			secondCount: 0,
			restoredOnly: 7,
			ordinary: 2,
		});
		expect(runtime?.getJumpTarget()).toBeNull();
	},
);

it.each(["provider", "pagehide", "retry", "reset", "ready", "destroy"] as const)(
	"%s clears every queued origin and fences a forced cancelled callback",
	(boundary) => {
		const session = fixture();
		session.first.dataset.required = "true";
		Object.defineProperty(session.first, "scrollIntoView", { value: vi.fn() });
		expect(showRequiredValidation()).toBe(true);
		session.interact("first");
		session.interact("second");
		session.revoke(boundary);
		session.first.dataset.ratingValue = "2";
		session.second.dataset.ratingValue = "2";
		session.flush();
		expect(session.read()).toMatchObject({
			firstCount: 0,
			secondCount: 0,
			restoredOnly: 7,
			ordinary: 1,
		});
		expect(runtime?.getJumpTarget()).toBeNull();
		expect(document.querySelectorAll(".praxity-required-message")).toHaveLength(1);
		expect(session.first.getAttribute("aria-invalid")).toBe("true");
		expect(session.cancel).toHaveBeenCalled();
		if (boundary !== "destroy") {
			session.interact("second");
			session.flush();
			expect(session.read()).toMatchObject({
				firstCount: 0,
				secondCount: 1,
				restoredOnly: 7,
				ordinary: 2,
			});
			session.interact("first");
			session.interact("second");
			session.flush();
			expect(session.read()).toMatchObject({
				firstCount: 1,
				secondCount: 2,
				restoredOnly: 7,
				ordinary: 3,
			});
		} else {
			const successor = fixture();
			successor.first.dataset.ratingValue = "2";
			successor.second.dataset.ratingValue = "2";
			successor.interact("first");
			successor.interact("second");
			successor.flush();
			expect(successor.read()).toMatchObject({
				firstCount: 1,
				secondCount: 1,
				ordinary: 2,
				restoredOnly: 7,
			});
		}
	},
);

it("Show feedback keeps its broad pass and hydration preserves its jump", () => {
	const session = fixture();
	session.first.dataset.ratingValue = "2";
	session.second.dataset.ratingValue = "2";
	session.finalize({ type: "show-feedback", blockId: "A" });
	expect(session.read()).toMatchObject({
		firstCount: 1,
		secondCount: 1,
		restoredOnly: 8,
		ordinary: 2,
	});
	expect(runtime?.getJumpTarget()).toBe("forbidden");
	session.finalize();
	expect(session.read()).toMatchObject({
		firstCount: 1,
		secondCount: 1,
		restoredOnly: 8,
		ordinary: 2,
	});
	expect(runtime?.getJumpTarget()).toBe("forbidden");
});

it("clears validation created between coalesced inputs when the required rating completes", () => {
	const session = fixture();
	session.second.dataset.required = "true";
	session.second.innerHTML = "<input>";
	const input = session.second.querySelector("input");
	assert(input);
	Object.defineProperty(input, "scrollIntoView", { value: vi.fn() });
	session.first.dataset.ratingValue = "2";
	session.interact("first");
	expect(showRequiredValidation()).toBe(true);
	expect(input.getAttribute("aria-invalid")).toBe("true");
	session.second.dataset.ratingValue = "2";
	session.second.dataset.completed = "true";
	session.interact("second");
	session.flush();
	expect(document.querySelectorAll(".praxity-required-message")).toHaveLength(0);
	expect(input.getAttribute("aria-invalid")).toBeNull();
});

it("clears the replacement validation target captured by a later input in the same batch", () => {
	const session = fixture();
	for (const rating of [session.first, session.second]) {
		rating.dataset.required = "true";
		rating.innerHTML = "<input>";
		const input = rating.querySelector("input");
		assert(input);
		Object.defineProperty(input, "scrollIntoView", { value: vi.fn() });
	}
	expect(showRequiredValidation()).toBe(true);
	session.first.dataset.ratingValue = "2";
	session.first.dataset.completed = "true";
	session.interact("first");
	expect(showRequiredValidation()).toBe(true);
	expect(session.first.querySelector("input")?.getAttribute("aria-invalid")).toBeNull();
	expect(session.second.querySelector("input")?.getAttribute("aria-invalid")).toBe("true");
	session.second.dataset.ratingValue = "2";
	session.second.dataset.completed = "true";
	session.interact("second");
	session.flush();
	expect(document.querySelectorAll(".praxity-required-message")).toHaveLength(0);
	expect(session.second.querySelector("input")?.getAttribute("aria-invalid")).toBeNull();
});

it("a reentrant input keeps its validation target for the next frame", () => {
	const session = fixture();
	for (const rating of [session.first, session.second]) {
		rating.dataset.required = "true";
		Object.defineProperty(rating, "scrollIntoView", { value: vi.fn() });
	}
	expect(showRequiredValidation()).toBe(true);
	session.first.dataset.ratingValue = "2";
	session.first.dataset.completed = "true";
	session.interact("first");
	session.reenter(() => {
		expect(showRequiredValidation()).toBe(true);
		session.second.dataset.ratingValue = "2";
		session.second.dataset.completed = "true";
		session.interact("second");
	});
	session.flush();
	expect(document.querySelectorAll(".praxity-required-message")).toHaveLength(1);
	expect(session.second.getAttribute("aria-invalid")).toBe("true");
	session.flush();
	expect(document.querySelectorAll(".praxity-required-message")).toHaveLength(0);
	expect(session.second.getAttribute("aria-invalid")).toBeNull();
});
