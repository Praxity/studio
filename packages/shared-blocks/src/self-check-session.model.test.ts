import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createSelfCheckSession,
	type SelfCheckCommand,
	type SelfCheckOperations,
	type SelfCheckSession,
	type SelfCheckSnapshot,
} from "./self-check-session";
import * as state from "./self-check-state";

const api = { createSelfCheckSession, ...state };
type ModelState = {
	version?: number;
	kind?: string;
	draft: { answer: string; ticked?: string[]; shown?: boolean };
	submitted?: { answer: string; ticked: string[]; shown: boolean; contentRevision: string } | null;
	fabricated?: boolean;
};
type Action = {
	type:
		| SelfCheckCommand["type"]
		| "check"
		| "replace"
		| "dispose"
		| "pagehide"
		| "pageshow"
		| "throw-subscriber";
	blockId: string;
	answer?: string;
	ticked?: string[];
};
type Owner = {
	index: number;
	model: Map<string, ModelState | undefined>;
	stored: Map<string, ModelState | undefined>;
	projected: Map<string, state.SelfCheckStateResult>;
	projectable: Set<string>;
	mutated: Map<string, boolean | undefined>;
	failed: Set<string>;
	pending: Set<string>;
	latestRequests: Map<string, Request>;
	tokens: Map<string, number>;
	admitted: Set<string>;
	owned: boolean;
	dead: boolean;
	ready: boolean;
	throwSubscriber: boolean;
	session: SelfCheckSession;
	lastSnapshot?: SelfCheckSnapshot;
};
type Request = {
	owner: Owner;
	id: string;
	retry: boolean;
	token: number;
	resolve(operations: SelfCheckOperations): void;
	reject(error: Error): void;
	operations: SelfCheckOperations;
	done: boolean;
};
type Context = {
	owner: Owner;
	id: string;
	previous: ModelState | undefined;
	wasMutated: boolean | undefined;
	previousToken: number;
	aborted: boolean;
};
type Plan = { name?: string; id?: string; actions: Action[]; throw?: boolean };
const content = {
	task: "Explain.",
	model: "A reason.",
	parts: [{ id: "reason", label: "Reason", missed: "Add a reason.", evidence: null }],
};
const clone = <T>(v: T): T => structuredClone(v);
const fresh = (answer = "") => ({
	version: 1,
	kind: "self-check",
	draft: { answer, ticked: [], shown: false },
	submitted: null,
});
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function rng(seed: number) {
	let n = seed >>> 0;
	return (max: number) => {
		n ^= n << 13;
		n ^= n >>> 17;
		n ^= n << 5;
		return (n >>> 0) % max;
	};
}
const flush = async () => {
	for (let i = 0; i < 24; i++) await Promise.resolve();
};

async function runCase(
	seed: number,
	options: { scenario?: number; minimal?: boolean; steps?: number } = {},
) {
	const random = rng(seed || 1),
		ids = seed % 2 ? ["a", "b"] : ["a", "b", "c"];
	const trace: unknown[] = [],
		violations: { code: string; [key: string]: unknown }[] = [],
		requests: Request[] = [],
		owners: Owner[] = [],
		promises: Promise<unknown>[] = [],
		errors: string[] = [];
	const coverage: Record<string, number> = {},
		injectionCoverage: Record<string, number> = {};
	let active: Owner,
		executing: Context | undefined,
		precommit: Context | undefined,
		armed: Plan | undefined;
	let boundaryCount = 0,
		injections = 0,
		commandCount = 0;
	const revision = "sha256:32a01b4ed7e500bf1f37e77c9e63722da50b992c670b0be083f619675beca4cf";
	expect(api.selfCheckContentRevision(content)).toBe(revision);
	const record = (event: unknown) => trace.push(event);
	const fail = (code: string, details: Record<string, unknown>) => {
		if (!violations.some((v) => v.code === code)) violations.push({ code, ...details });
	};
	const command = (
		type: Action["type"],
		id = ids[random(ids.length)],
		answer = `s${seed}-${commandCount++}`,
	) => (type === "edit" ? { type, blockId: id, answer } : { type, blockId: id });
	const availableTypes: Action["type"][] = [
		"edit",
		"start-over",
		"retry",
		"check",
		"show-feedback",
		"replace",
		"dispose",
		"throw-subscriber",
	];
	const safely = (fn: () => unknown) => {
		try {
			return fn();
		} catch (e) {
			errors.push(String(e));
		}
	};
	function makeAction() {
		const action: Action = command(availableTypes[random(availableTypes.length)]);
		if (action.type === "edit" && active.admitted.has(action.blockId) && random(3) !== 0)
			action.ticked = random(2) ? ["reason"] : [];
		return action;
	}
	function withAnswerSuccessor(action: Action): Action[] {
		return action.type === "edit" && action.ticked !== undefined
			? [action, command("edit", action.blockId, `${action.answer}-successor`)]
			: [action];
	}
	function boundary(owner: Owner, name: string, id: string) {
		boundaryCount++;
		coverage[name] = (coverage[name] || 0) + 1;
		record({ boundary: name, id, owner: owner.index });
		const plan =
			armed && (!armed.name || armed.name === name) && (!armed.id || armed.id === id)
				? armed
				: undefined;
		if (!plan) return;
		armed = undefined;
		injections++;
		injectionCoverage[name] = (injectionCoverage[name] || 0) + 1;
		const priorPrecommit = precommit;
		if (
			["operation-edit", "operation-submit", "operation-reset"].includes(name) &&
			executing?.owner === owner &&
			executing.id === id
		)
			precommit = executing;
		for (const action of plan.actions) issue(action, owner);
		precommit = priorPrecommit;
		if (plan.throw) throw new Error(`injected ${name} failure`);
	}
	function issue(action: Action, target = active) {
		record({ action, owner: target?.index });
		if (!target) return;
		const abortOuter = () => {
			if (precommit?.owner !== target || precommit.aborted) return;
			target.model.set(precommit.id, clone(precommit.previous));
			target.mutated.set(precommit.id, precommit.wasMutated);
			target.tokens.set(precommit.id, precommit.previousToken);
			precommit.aborted = true;
		};
		if (action.type === "replace" || action.type === "pageshow") {
			if (target !== active || (target.dead && action.type !== "pageshow")) return;
			abortOuter();
			target.dead = true;
			safely(() => target.session.dispose());
			active = makeOwner(
				new Map(
					ids.map((id) => [
						id,
						action.type === "pageshow"
							? clone(target.model.get(id))
							: random(2)
								? fresh(`provider-${owners.length}-${id}`)
								: undefined,
					]),
				),
			);
			safely(() => active.session.initialize());
			return;
		}
		if (action.type === "dispose" || action.type === "pagehide") {
			abortOuter();
			target.dead = true;
			safely(() => target.session.dispose());
			return;
		}
		if (action.type === "throw-subscriber") {
			target.throwSubscriber = true;
			return;
		}
		if (target.dead) return;
		const id = action.blockId;
		let previous = clone(
			precommit?.owner === target && precommit.id === id && !precommit.aborted
				? precommit.previous
				: target.model.get(id),
		);
		const wasMutated = target.mutated.get(id),
			previousToken = target.tokens.get(id) || 0;
		if (action.type === "check") {
			// Native Check validates and starts admission; it does not submit.
			if (!String(previous?.draft?.answer ?? "").trim()) return;
			if (target.admitted.has(id)) return;
			action = { type: "retry", blockId: id };
		}
		if (
			action.type === "show-feedback" &&
			(!target.admitted.has(id) ||
				target.pending.has(id) ||
				target.failed.has(id) ||
				!previous?.draft?.answer?.trim() ||
				Object.keys(previous ?? {}).length !== 4)
		)
			return;
		abortOuter();
		previous = clone(target.model.get(id));
		if (action.type === "retry") {
			target.tokens.set(id, (target.tokens.get(id) || 0) + 1);
			target.pending.add(id);
		}
		if (action.type === "start-over") {
			target.tokens.set(id, (target.tokens.get(id) || 0) + 1);
			target.pending.delete(id);
			target.model.set(id, fresh());
			target.mutated.set(id, true);
			target.failed.delete(id);
			target.projectable.add(id);
		}
		if (action.type === "edit") {
			const old = previous;
			let state =
				old?.version === 1 && old?.kind === "self-check" && old?.draft ? clone(old) : fresh();
			if (target.admitted.has(id) && old && Object.keys(old ?? {}).length !== 4) state = fresh();
			state.draft = {
				...state.draft,
				answer: action.answer ?? "",
				ticked: action.ticked ?? state.draft.ticked ?? [],
				shown: false,
			};
			if (target.admitted.has(id) && (!old || Object.keys(old ?? {}).length !== 4))
				state.submitted = null;
			target.model.set(id, state);
			target.mutated.set(id, true);
			target.failed.delete(id);
		}
		if (action.type === "show-feedback") {
			const state = clone(previous ?? fresh());
			state.submitted = {
				answer: state.draft.answer,
				ticked: [...(state.draft.ticked ?? [])],
				shown: true,
				contentRevision: revision,
			};
			target.model.set(id, state);
			target.mutated.set(id, true);
			target.failed.delete(id);
			target.tokens.set(id, (target.tokens.get(id) || 0) + 1);
		}
		const outer = executing;
		const context = { owner: target, id, previous, wasMutated, previousToken, aborted: false };
		executing = context;
		let promise: Promise<state.SelfCheckStateResult | undefined> | undefined;
		try {
			promise = target.session.dispatch(
				action.type === "edit"
					? { type: "edit", blockId: id, answer: action.answer ?? "", ticked: action.ticked }
					: { type: action.type as "retry" | "start-over" | "show-feedback", blockId: id },
			);
		} catch (e) {
			errors.push(String(e));
		}
		executing = outer;
		if (promise)
			promises.push(
				Promise.resolve(promise).catch((e) => {
					const text = String(e);
					if (!/ESELFCHECKNOTREADY|ESELFCHECKANSWER|ESELFCHECKSTATE/.test(text)) errors.push(text);
				}),
			);
	}
	function makeOwner(values: Map<string, ModelState | undefined>): Owner {
		const owner: Owner = {
			index: owners.length,
			model: new Map([...values].map(([id, v]) => [id, clone(v)])),
			stored: new Map([...values].map(([id, v]) => [id, clone(v)])),
			projected: new Map(),
			projectable: new Set(),
			mutated: new Map(),
			failed: new Set(),
			pending: new Set(),
			latestRequests: new Map(),
			tokens: new Map(),
			admitted: new Set(),
			owned: true,
			dead: false,
			ready: false,
			throwSubscriber: false,
			session: undefined as unknown as SelfCheckSession,
		};
		owners.push(owner);
		const operations = (id: string): SelfCheckOperations => ({
			restore(value) {
				boundary(owner, "operation-restore", id);
				return api.restoreSelfCheckState(content, value);
			},
			edit(value, draft) {
				boundary(owner, "operation-edit", id);
				return api.editSelfCheckDraft(content, value, draft);
			},
			submit(value) {
				boundary(owner, "operation-submit", id);
				return api.submitSelfCheck(content, value, { blockId: id, language: "en" });
			},
			reset() {
				boundary(owner, "operation-reset", id);
				return api.resetSelfCheckState();
			},
		});
		owner.session = api.createSelfCheckSession(
			ids.map((blockId) => ({ blockId, path: "asset", contentRevision: "revision" })),
			{
				deferStart: true,
				current: (cancelled) => (cancelled || !owner.dead) && owner.owned,
				read(id) {
					const captured = clone(owner.stored.get(id));
					record({ hold: "read", id, owner: owner.index });
					try {
						boundary(owner, "read-enter", id);
						boundary(owner, "read-return", id);
					} catch (e) {
						owner.failed.add(id);
						throw e;
					}
					record({ releaseRead: id, owner: owner.index });
					if (captured === undefined) owner.projectable.add(id);
					return captured;
				},
				write(id, value) {
					if (owner.dead) fail("cancelled-effect", { effect: "write", id, owner: owner.index });
					if (!owner.mutated.get(id)) fail("passive-write", { id, owner: owner.index });
					record({ hold: "write", id, owner: owner.index });
					try {
						boundary(owner, "write-enter", id);
					} catch (e) {
						owner.failed.add(id);
						throw e;
					}
					// A void set call already started while current may finish; successor writes must follow it.
					owner.stored.set(id, clone(value) as ModelState);
					boundary(owner, "write-return", id);
					record({ releaseWrite: id, owner: owner.index });
				},
				project(id, result) {
					if (owner.dead) fail("cancelled-effect", { effect: "project", id, owner: owner.index });
					boundary(owner, "project-enter", id);
					owner.projected.set(id, clone(result));
					boundary(owner, "project-return", id);
				},
				admit(reference, retry) {
					const id = reference.blockId;
					let resolve!: Request["resolve"], reject!: Request["reject"];
					const promise = new Promise<SelfCheckOperations>((yes, no) => {
						resolve = yes;
						reject = no;
					});
					const request: Request = {
						owner,
						id,
						retry,
						token: owner.tokens.get(id) || 0,
						resolve,
						reject,
						operations: operations(id),
						done: false,
					};
					requests.push(request);
					owner.latestRequests.set(id, request);
					owner.pending.add(id);
					boundary(owner, "admit-enter", id);
					boundary(owner, "admit-return", id);
					return promise;
				},
			},
		);
		owner.session.ready.then(() => (owner.ready = true));
		safely(() =>
			owner.session.subscribe((snapshot, ticket) => {
				for (const activity of snapshot.activities) {
					if (
						["refused", "unavailable", "cancelled", "pending"].includes(activity.outcome) &&
						(activity.completed || activity.available)
					)
						fail("false-availability", { activity });
				}
				boundary(owner, "subscriber-first", ids[0]);
				if (owner.throwSubscriber) throw new Error("subscriber sentinel");
			}),
		);
		safely(() =>
			owner.session.subscribe((snapshot, ticket) => {
				if (!ticket.current()) fail("cancelled-ticket-notification", { owner: owner.index });
				owner.lastSnapshot = clone(snapshot);
				boundary(owner, "subscriber-last", ids[0]);
				if (owner.dead) owner.owned = false;
			}),
		);
		return owner;
	}
	async function release(request: Request, reject = false) {
		if (request.done) return;
		request.done = true;
		record({ release: request.id, owner: request.owner.index, reject });
		const isCurrent = () =>
			!request.owner.dead &&
			request.owner.latestRequests.get(request.id) === request &&
			(request.owner.tokens.get(request.id) || 0) === request.token;
		if (isCurrent() && reject) request.owner.failed.add(request.id);
		if (reject) request.reject(new Error("admission sentinel"));
		else request.resolve(request.operations);
		await flush();
		if (isCurrent()) {
			request.owner.pending.delete(request.id);
			if (!reject) {
				request.owner.admitted.add(request.id);
				request.owner.projectable.add(request.id);
			}
		}
	}
	async function quiesce() {
		for (let turn = 0; turn < 8; turn++) {
			const pending = requests.filter((r) => !r.done);
			if (!pending.length) {
				await flush();
				break;
			}
			while (pending.length) await release(pending.splice(random(pending.length), 1)[0]);
		}
		await flush();
	}
	function verify() {
		for (const owner of owners) {
			if (!owner.ready)
				fail("ready-stuck", { owner: owner.index, views: ids.map((id) => owner.session.read(id)) });
			if (owner.dead) continue;
			for (const id of ids) {
				const expected = owner.model.get(id),
					actual = owner.stored.get(id);
				if (owner.mutated.get(id) && !owner.failed.has(id) && !equal(expected, actual))
					fail("lost-write", { owner: owner.index, id, expected, actual });
				const projection = owner.projected.get(id);
				// Opaque rejected bytes have no admitted state. Their completion must stay unavailable.
				const isValid =
					expected?.version === 1 &&
					expected?.kind === "self-check" &&
					Object.keys(expected ?? {}).length === 4;
				if (
					owner.mutated.get(id) &&
					isValid &&
					owner.projectable.has(id) &&
					!owner.failed.has(id) &&
					!equal(expected, projection?.state)
				)
					fail("lost-projection", { id, expected, actual: projection?.state });
				const view = owner.session.read(id);
				if (
					!owner.failed.has(id) &&
					view?.ready &&
					isValid &&
					view.outcome !== "refused" &&
					view.completed !== !!expected.submitted
				)
					fail("wrong-completion", { id, view, expected });
			}
		}
		if (errors.length) fail("uncaught-command-error", { errors });
	}
	const fixture = options.scenario ?? seed % 5;
	active = makeOwner(
		new Map(
			ids.map((id) => [
				id,
				fixture === 0
					? undefined
					: fixture === 4 && id === "a"
						? { fabricated: true, draft: { answer: "recover" } }
						: fixture === 4 && id === "b"
							? {
									...fresh("stale"),
									submitted: {
										answer: "old",
										ticked: [],
										shown: true,
										contentRevision: `sha256:${"0".repeat(64)}`,
									},
								}
							: fresh(`saved-${id}`),
			]),
		),
	);
	if (fixture === 1)
		armed = {
			name: random(2) ? "read-enter" : "read-return",
			id: "a",
			actions: [command("edit", "a", "edit-inside-first-read")],
		};
	if (fixture === 3)
		armed = {
			name: "operation-restore",
			id: "a",
			actions: [command("edit", "a", "edit-inside-restore")],
		};
	safely(() => active.session.initialize());
	if (fixture === 2) active.throwSubscriber = true;
	if (fixture === 5) {
		for (const request of requests.filter((request) => !request.done)) await release(request, true);
		issue(command("edit", "a", "after-load-failure"));
		issue(command("retry", "a"));
	}
	if (fixture === 6) {
		issue(command("edit", "a", "before-pagehide"));
		issue(command("pagehide", "a"));
		issue(command("pageshow", "a"));
	}
	await quiesce();
	if (fixture === 2) {
		verify();
		active.throwSubscriber = false;
	}
	if (fixture === 0) {
		armed = {
			name: random(2) ? "write-enter" : "write-return",
			id: "a",
			actions: [
				command(random(2) ? "edit" : "start-over", "a", "second-a"),
				command("edit", "b", "second-b"),
			],
		};
		issue(command("edit", "a", "first-a"));
		await quiesce();
	}
	if (fixture === 2) {
		const owner = active;
		owner.throwSubscriber = true;
		issue(command("retry", "a"));
		await quiesce();
		owner.throwSubscriber = false;
	}
	if (fixture === 4)
		for (const id of ["a", "b"]) {
			const view = active.session.read(id);
			if (view?.outcome !== "refused" || view.available || view.completed)
				fail("refusal-status", { id, view });
		}
	verify();
	if (!options.minimal) {
		const boundaries = [
			"read-enter",
			"read-return",
			"write-enter",
			"write-return",
			"admit-enter",
			"admit-return",
			"operation-restore",
			"operation-edit",
			"operation-submit",
			"operation-reset",
			"project-enter",
			"project-return",
			"subscriber-first",
			"subscriber-last",
		];
		for (let step = 0; step < (options.steps ?? 48); step++) {
			if (active.dead) {
				active = makeOwner(new Map(ids.map((id) => [id, fresh(`after-dispose-${id}`)])));
				safely(() => active.session.initialize());
			}
			const name = boundaries[random(boundaries.length)];
			const actions = Array.from({ length: 1 + random(3) }, makeAction).flatMap(
				withAnswerSuccessor,
			);
			armed = {
				name,
				actions,
				throw: ["write-enter", "read-enter", "read-return"].includes(name) && random(8) === 0,
			};
			if (random(8) === 0) {
				const pending = requests.filter((r) => !r.done);
				if (pending.length) await release(pending[random(pending.length)], random(4) === 0);
			} else for (const action of withAnswerSuccessor(makeAction())) issue(action);
			await flush();
			// Resetting a thrown listener does not refresh the session; later delivery must recover itself.
			if (random(4) === 0) active.throwSubscriber = false;
		}
		armed = undefined;
		for (const owner of owners) owner.throwSubscriber = false;
		await quiesce();
		verify();
	}
	return {
		seed,
		fixture,
		violations,
		boundaryCount,
		injections,
		commands: commandCount,
		coverage,
		injectionCoverage,
		trace,
		...(options.minimal
			? {
					final: {
						ready: active.ready,
						views: ids.map((id) => active.session.read(id)),
						lastSnapshot: active.lastSnapshot,
						stored: [...active.stored],
						projected: [...active.projected],
					},
				}
			: {}),
	};
}

const surfaced: unknown[] = [];
for (const clearSelection of [false, true])
	it(`retains explicit ticks across answer-only edits during held Retry, clear=${clearSelection}`, async () => {
		let release!: (operations: SelfCheckOperations) => void,
			hold = false;
		const stored = new Map<string, unknown>(),
			projected = new Map<string, state.SelfCheckStateResult>();
		const operations: SelfCheckOperations = {
			restore: (value) => state.restoreSelfCheckState(content, value),
			edit: (value, draft) => state.editSelfCheckDraft(content, value, draft),
			reset: state.resetSelfCheckState,
			submit: (value) => state.submitSelfCheck(content, value, { blockId: "a", language: "en" }),
		};
		const session = createSelfCheckSession([{ blockId: "a", path: "", contentRevision: "" }], {
			read: () => undefined,
			write: (id, value) => stored.set(id, clone(value)),
			project: (id, result) => projected.set(id, clone(result)),
			admit: () =>
				hold ? new Promise((resolve) => (release = resolve)) : Promise.resolve(operations),
		});
		await session.ready;
		await session.dispatch({ type: "edit", blockId: "a", answer: "Initial" });
		await session.dispatch({ type: "retry", blockId: "a" });
		hold = true;
		const retry = session.dispatch({ type: "retry", blockId: "a" });
		await session.dispatch({ type: "edit", blockId: "a", answer: "Initial", ticked: ["reason"] });
		if (clearSelection)
			await session.dispatch({ type: "edit", blockId: "a", answer: "Initial", ticked: [] });
		await session.dispatch({ type: "edit", blockId: "a", answer: "Latest answer" });
		const expected = {
			version: 1,
			kind: "self-check",
			draft: { answer: "Latest answer", ticked: clearSelection ? [] : ["reason"], shown: false },
			submitted: null,
		};
		expect(stored.get("a")).toEqual(expected);
		expect(session.read("a")).toMatchObject({ outcome: "pending", available: false });
		await expect(
			session.dispatch({ type: "edit", blockId: "a", answer: "Invalid", ticked: ["unknown"] }),
		).rejects.toThrow("ESELFCHECKSTATE");
		expect(stored.get("a")).toEqual(expected);
		release(operations);
		await retry;
		expect(stored.get("a")).toEqual(expected);
		expect(projected.get("a")?.state).toEqual(expected);
		await session.dispatch({ type: "show-feedback", blockId: "a" });
		expect(stored.get("a")).toEqual({
			...expected,
			submitted: {
				answer: "Latest answer",
				ticked: clearSelection ? [] : ["reason"],
				shown: true,
				contentRevision: "sha256:32a01b4ed7e500bf1f37e77c9e63722da50b992c670b0be083f619675beca4cf",
			},
		});
	});
beforeEach(() => vi.stubGlobal("reportError", (error: unknown) => surfaced.push(error)));
afterEach(() => {
	surfaced.length = 0;
	vi.unstubAllGlobals();
});
function requirePassing(result: Awaited<ReturnType<typeof runCase>>) {
	expect(result.violations, `seed ${result.seed}\n${JSON.stringify(result.trace)} `).toEqual([]);
}
describe("self-check session command histories", () => {
	for (const [seed, scenario, name] of [
		[1, 1, "resumes the first read after an edit"],
		[3, 3, "resumes admitted restore after an edit"],
		[5, 0, "saves both edits queued inside one write"],
		[10, 0, "saves reset A and edit B queued inside one write"],
		[2, 2, "settles valid admission despite a throwing subscriber"],
		[17, 5, "retries load failure with the latest draft"],
		[18, 6, "readmits retained drafts after pagehide and persisted pageshow"],
	] as const)
		it(name, async () => requirePassing(await runCase(seed, { scenario, minimal: true })));
	const env =
		(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
	const seeds = Number(env.SELF_CHECK_MODEL_SEEDS ?? (env.CI ? 10000 : 1000));
	// Batches keep CI's per-test time gate while running the same complete seed range.
	for (let first = 1; first <= seeds; first += 100) {
		const last = Math.min(first + 99, seeds);
		it(`matches the reference for seeds ${first}-${last}`, async () => {
			for (let seed = first; seed <= last; seed++) requirePassing(await runCase(seed));
		});
	}

	for (const failure of ["write", "admission"] as const)
		it(`projects the latest fresh draft after failed ${failure}`, async () => {
			const stored = new Map<string, unknown>(),
				projected = new Map<string, state.SelfCheckStateResult>();
			let failWrite = failure === "write";
			const session = createSelfCheckSession([{ blockId: "a", path: "", contentRevision: "" }], {
				read: () => undefined,
				write(id, value) {
					if (failWrite) {
						failWrite = false;
						throw new Error("save sentinel");
					}
					stored.set(id, structuredClone(value));
				},
				admit: async () => {
					throw new Error("admission sentinel");
				},
				project: (id, result) => {
					projected.set(id, structuredClone(result));
				},
			});
			await session.ready;
			await session.dispatch(
				failure === "write"
					? { type: "edit", blockId: "a", answer: "first" }
					: { type: "retry", blockId: "a" },
			);
			await session.dispatch({ type: "edit", blockId: "a", answer: "latest" });
			expect(stored.get("a")).toEqual({
				version: 1,
				kind: "self-check",
				draft: { answer: "latest", ticked: [], shown: false },
				submitted: null,
			});
			expect(projected.get("a")?.state).toEqual({
				version: 1,
				kind: "self-check",
				draft: { answer: "latest", ticked: [], shown: false },
				submitted: null,
			});
			expect(session.read("a")).toMatchObject({ ready: true, available: false, completed: false });
		});
});

for (const interveningEdit of [false, true])
	it(`queued admission receipt rejects intervening edits=${interveningEdit}`, async () => {
		let release!: (operations: SelfCheckOperations) => void;
		const held = new Promise<SelfCheckOperations>((resolve) => (release = resolve));
		let receipt: ReturnType<SelfCheckSession["dispatch"]> | undefined,
			armed = true;
		const session = createSelfCheckSession([{ blockId: "a", path: "", contentRevision: "" }], {
			read: () => undefined,
			write() {
				if (!armed) return;
				armed = false;
				receipt = session.dispatch({ type: "retry", blockId: "a" });
				if (interveningEdit) void session.dispatch({ type: "edit", blockId: "a", answer: "Newer" });
			},
			admit: () => held,
		});
		await session.ready;
		await session.dispatch({ type: "edit", blockId: "a", answer: "First" });
		expect(receipt).toBeDefined();
		release({
			restore: (value) => state.restoreSelfCheckState(content, value),
			edit: (value, draft) => state.editSelfCheckDraft(content, value, draft),
			reset: state.resetSelfCheckState,
			submit: (value) => state.submitSelfCheck(content, value, { blockId: "a", language: "en" }),
		});
		await receipt;
		expect(receipt?.current()).toBe(!interveningEdit);
		expect(session.draftAnswer("a")).toBe(interveningEdit ? "Newer" : "First");
		expect(session.read("a")).toMatchObject({
			ready: true,
			admitted: true,
			outcome: "draft",
			available: true,
			completed: false,
		});
	});
for (const timing of ["subscriber", "before-dispose"] as const)
	it(`settles cancellation readiness when ownership ends at ${timing}`, async () => {
		let owned = true,
			effects = 0;
		const session = createSelfCheckSession([{ blockId: "a", path: "", contentRevision: "" }], {
			read: () => ({
				version: 1,
				kind: "self-check",
				draft: { answer: "Saved", ticked: [], shown: false },
				submitted: null,
			}),
			current: () => owned,
			admit: () => new Promise(() => {}),
			write: () => ++effects,
			project: () => ++effects,
		});
		session.subscribe((snapshot) => {
			if (snapshot.activities[0].outcome === "cancelled") owned = false;
		});
		if (timing === "before-dispose") owned = false;
		session.dispose();
		expect(await session.ready).toMatchObject({
			ready: true,
			activities: [{ outcome: "cancelled", available: false, completed: false }],
		});
		expect(effects).toBe(0);
	});

it("replays cancellation when its listener reenters disposal", async () => {
	let cancellations = 0,
		later = 0,
		effects = 0;
	const session = createSelfCheckSession([{ blockId: "a", path: "", contentRevision: "" }], {
		read: () => undefined,
		write: () => ++effects,
		project: () => ++effects,
		admit: () => Promise.reject(new Error("ETESTADMISSION")),
	});
	await session.ready;
	session.subscribe((snapshot) => {
		if (snapshot.activities[0].outcome !== "cancelled") return;
		if (++cancellations === 1) session.dispose();
	});
	session.subscribe((snapshot, ticket) => {
		if (snapshot.activities[0].outcome === "cancelled" && ticket.current()) ++later;
	});
	session.dispose();
	expect(session.read("a")).toMatchObject({ outcome: "cancelled", ready: true });
	expect({ cancellations, later, effects }).toEqual({ cancellations: 2, later: 1, effects: 0 });
});
