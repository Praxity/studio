import { afterEach, describe, expect, it, vi } from "vitest";
import { createActivityEffects } from "./activity-effects";

type Command = { activityId: string; value: number };
type State = Record<string, number>;

function toy() {
	let owned = true,
		disposed = false;
	const state: State = { a: 0, b: 0 };
	const writes: [string, number][] = [],
		reduced: Command[] = [],
		published: State[] = [];
	const provider = { write: (_id: string, _value: number) => {} };
	const project = { run: () => {} };
	const effects = createActivityEffects<Command, State>({
		current: () => owned,
		disposed: () => disposed,
		activities: () => Object.keys(state),
		snapshot: () => ({ ...state }),
		write(id) {
			writes.push([id, state[id]]);
			provider.write(id, state[id]);
		},
		writeFailed(id) {
			state[id] = -1;
			effects.commit();
		},
		project: () => project.run(),
		published: (value) => published.push(value),
	});
	const dispatch = (command: Command) => {
		effects.enqueue(() => {
			if (!owned || disposed) return;
			// The toy reducer owns values; the mechanism owns scheduling and effects.
			state[command.activityId] = command.value;
			reduced.push(command);
			effects.commit(command, command.activityId);
		});
	};
	return {
		effects,
		dispatch,
		provider,
		project,
		writes,
		reduced,
		published,
		replace: () => {
			owned = false;
		},
		dispose: () => {
			disposed = true;
			owned = false;
			effects.enqueue(() => effects.clearWrites());
		},
	};
}

afterEach(() => vi.unstubAllGlobals());

describe("activity effects", () => {
	it("reduces reentrant callback commands FIFO before publishing their final state", () => {
		const t = toy();
		const snapshots: State[] = [];
		t.effects.subscribe((state) => snapshots.push(state));
		t.provider.write = () => {
			t.provider.write = () => {};
			t.dispatch({ activityId: "b", value: 2 });
			t.dispatch({ activityId: "a", value: 3 });
		};
		t.dispatch({ activityId: "a", value: 1 });
		expect(t.reduced).toEqual([
			{ activityId: "a", value: 1 },
			{ activityId: "b", value: 2 },
			{ activityId: "a", value: 3 },
		]);
		expect(t.writes).toEqual([
			["a", 1],
			["a", 3],
			["b", 2],
		]);
		expect(snapshots).toEqual([
			{ a: 0, b: 0 },
			{ a: 3, b: 2 },
		]);
	});

	it("retains each activity's dirty write across an interrupted publication", () => {
		const t = toy();
		t.effects.enqueue(() => {
			t.dispatch({ activityId: "a", value: 4 });
			t.dispatch({ activityId: "b", value: 5 });
		});
		t.writes.length = 0;
		t.provider.write = (id) => {
			if (id === "a") {
				t.provider.write = () => {};
				t.dispatch({ activityId: "a", value: 8 });
			}
		};
		t.effects.enqueue(() => {
			t.dispatch({ activityId: "a", value: 6 });
			t.dispatch({ activityId: "b", value: 7 });
		});
		expect(t.writes).toEqual([
			["a", 6],
			["a", 8],
			["b", 7],
		]);
		expect(t.published.at(-1)).toEqual({ a: 8, b: 7 });
	});

	it("reports a throwing subscriber and still delivers later subscribers and settlements", () => {
		const t = toy();
		const error = new Error("subscriber sentinel"),
			reported: unknown[] = [],
			delivered: string[] = [];
		vi.stubGlobal("reportError", (value: unknown) => reported.push(value));
		t.effects.subscribe((state) => {
			if (state.a === 1) throw error;
		});
		t.effects.subscribe((state) => {
			if (state.a === 1) delivered.push("subscriber");
		});
		t.effects.enqueue(() => {
			t.dispatch({ activityId: "a", value: 1 });
			t.effects.settle(() => delivered.push("settled"));
		});
		expect(reported).toEqual([error]);
		expect(delivered).toEqual(["subscriber", "settled"]);
		expect(t.published.at(-1)).toEqual({ a: 1, b: 0 });
	});

	it.each([false, true])(
		"projection revocation stops publication with subscribers=%s",
		(subscribed) => {
			const t = toy();
			const listener = vi.fn();
			if (subscribed) t.effects.subscribe(listener);
			listener.mockClear();
			t.project.run = () => t.replace();
			t.dispatch({ activityId: "a", value: 1 });
			// Without subscribers, no listener guard can hide a missing post-projection check.
			expect(t.published).toEqual([]);
			expect(listener).not.toHaveBeenCalled();
		},
	);

	for (const revoke of ["replace", "dispose"] as const) {
		it(`${revoke} during a provider write revokes the next write, projection and subscriber`, () => {
			const t = toy();
			const project = vi.spyOn(t.project, "run"),
				listener = vi.fn();
			t.effects.subscribe(listener);
			listener.mockClear();
			const before = t.effects.ticket();
			t.provider.write = () => t[revoke]();
			t.effects.enqueue(() => {
				t.dispatch({ activityId: "a", value: 1 });
				t.dispatch({ activityId: "b", value: 2 });
			});
			expect(before.current()).toBe(false);
			expect(t.effects.ticket().current()).toBe(false);
			expect(t.writes).toEqual([["a", 1]]);
			expect(project).not.toHaveBeenCalled();
			expect(listener).not.toHaveBeenCalled();
		});

		it(`${revoke} inside a subscriber suppresses the next subscriber but settles local receipts`, () => {
			const t = toy();
			const delivered: string[] = [];
			t.effects.subscribe((state) => {
				if (state.a === 1) t[revoke]();
			});
			t.effects.subscribe((state) => {
				if (state.a === 1) delivered.push("stale");
			});
			t.effects.enqueue(() => {
				t.dispatch({ activityId: "a", value: 1 });
				t.effects.settle(() => delivered.push("settled"));
			});
			expect(delivered).toEqual(["settled"]);
		});
	}

	it("publishes write failure state without retrying a consumed dirty slot", () => {
		const t = toy();
		t.provider.write = () => {
			throw new Error("save refused");
		};
		t.dispatch({ activityId: "b", value: 9 });
		expect(t.writes).toEqual([["b", 9]]);
		expect(t.published).toEqual([{ a: 0, b: -1 }]);
	});
});

function fixture() {
	const current = vi.fn(() => true);
	const effects = createActivityEffects({
		current,
		disposed: () => false,
		activities: () => [],
		snapshot: () => ({}),
		write() {},
		writeFailed() {},
		project() {},
		published() {},
	});
	return { current, effects };
}

it("obsolete synchronous tickets short-circuit before calling the owner, as before scoped admissions", () => {
	const { current, effects } = fixture();
	const pass = effects.ticket();
	effects.commit();
	current.mockClear();
	expect(pass.current()).toBe(false);
	expect(current).not.toHaveBeenCalled();
});

it("async activity tickets survive sibling turns but revoke with their captured generation", () => {
	const { effects } = fixture();
	let generation = 0;
	const pass = effects.activityTicket(() => generation === 0);
	effects.commit();
	expect(pass.current()).toBe(true);
	generation++;
	expect(pass.current()).toBe(false);
});
