import { expect, it } from "vitest";
import { createWriteDistractorsRules } from "./write-distractors-content";
import {
	createDistractorMount,
	type DistractorCommand,
	encodeWriteDistractorsState,
	reduceWriteDistractors,
} from "./write-distractors-state";

// Contract oracle: stage permissions come from CONTRACTS.md:475-496. Stored
// fixtures carry their independently specified admission class. No production
// codec, bounds helper or comparison validator supplies an expected result.
type Value = {
	answer: string;
	hadIt: boolean | null;
	options: { text: string; misconception: string; custom: string }[];
	shown: boolean;
};
type Failure = { reason: string; field?: string; code?: string };
type FieldError = { option: number; field: string; code: string };
type Fixture = { raw: unknown; revision: number; value?: Value; malformed?: boolean };
type Action = {
	command: DistractorCommand;
	authority: "current" | "foreign" | "missing";
	current: boolean;
	fixture?: Fixture;
};
type Spec = {
	revision: number;
	value: Value;
	checked: boolean;
	hold: boolean;
	status: string;
	read: boolean;
	generation: number;
	input: string | undefined;
	saved?: Fixture;
	local: { path: string; text: string }[];
	recovery: { path: string; text: string }[];
	error: string | FieldError[] | null;
	notSaved: boolean;
	blocked: Failure | null;
	pending: Value | null;
	sequence: number;
};
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const seeds = Number(env?.DISTRACTOR_MODEL_SEEDS ?? 1000);
const clone = <T>(value: T): T => structuredClone(value);
const normal = (text: string) => text.trim().replace(/\s+/g, " ");
function random(seed: number) {
	let n = seed;
	return (max: number) => {
		n ^= n << 13;
		n ^= n >>> 17;
		n ^= n << 5;
		return (n >>> 0) % max;
	};
}

it.each(Array.from({ length: seeds }, (_, i) => i + 1))(
	"independent contract history seed %i",
	(seed) => {
		const count = seed % 2 ? 5 : 2,
			choose = random(seed);
		const contents = ["Right", "Changed"].map((rightAnswer) => ({
			question: "Question?",
			rightAnswer,
			count,
			misconceptions: [
				{ id: "m1", label: "First" },
				{ id: "m2", label: "Second" },
			],
			authorOptions: [
				{ text: "Wrong", misconception: "m1" },
				{ text: "Other wrong", misconception: "m2" },
			],
		}));
		const rules = contents.map(createWriteDistractorsRules);
		const references = rules.map((rule) => ({
			contentRevision: rule.contentRevision,
			count,
			itemIds: ["m1", "m2"],
		}));
		const blank = (): Value => ({
			answer: "",
			hadIt: null,
			options: Array.from({ length: count }, () => ({ text: "", misconception: "", custom: "" })),
			shown: false,
		});
		const wire = (revision: number, value: Value) => ({
			version: 1,
			kind: "write-distractors",
			contentRevision: references[revision].contentRevision,
			value: {
				answer: value.answer,
				hadIt: value.hadIt,
				options: value.options.map((option) => ({ ...option })),
				shown: value.shown,
			},
		});
		const fresh = (revision = 0, generation = 0): Spec => ({
			revision,
			generation,
			value: blank(),
			checked: false,
			hold: true,
			status: "pending",
			read: false,
			input: undefined,
			saved: undefined,
			local: [],
			recovery: [],
			error: null,
			notSaved: false,
			blocked: null,
			pending: null,
			sequence: 0,
		});
		const recovery = (value?: Value) =>
			value
				? [
						{ path: "value.answer", text: value.answer },
						...[0, 1, 2, 3, 4].flatMap((i) =>
							value.options[i]
								? [
										{ path: `value.options[${i}].text`, text: value.options[i].text },
										{ path: `value.options[${i}].custom`, text: value.options[i].custom },
									]
								: [],
						),
					]
				: [];
		const spec = fresh();
		let mount = createDistractorMount(references[0]);
		const trace: Action[] = [];
		function limits(value: Value): Failure | null {
			if (value.answer.trim().length > 2000)
				return { reason: "validation", field: "value.answer", code: "longAnswer" };
			for (let i = 0; i < value.options.length; i++) {
				const o = value.options[i];
				if (o.text.trim().length > 300)
					return { reason: "validation", field: `value.options[${i}].text`, code: "longText" };
				if (o.custom.trim().length > 120)
					return { reason: "validation", field: `value.options[${i}].custom`, code: "longCustom" };
			}
			for (let i = 0; i < value.options.length; i++) {
				const o = value.options[i];
				if (!["", "other", "m1", "m2"].includes(o.misconception))
					return {
						reason: "validation",
						field: `value.options[${i}].misconception`,
						code: "choose",
					};
			}
			return null;
		}
		function compare(value: Value): FieldError[] {
			const errors: FieldError[] = [],
				seen = new Set<string>();
			value.options.forEach((o, i) => {
				const text = normal(o.text),
					custom = normal(o.custom),
					key = text.toLowerCase();
				const push = (field: string, code: string) => errors.push({ option: i, field, code });
				if (!text) push("text", "empty");
				else if (o.text.trim().length > 300) push("text", "longText");
				else if (key === contents[spec.revision].rightAnswer.toLowerCase()) push("text", "right");
				else if (seen.has(key)) push("text", "duplicate");
				seen.add(key);
				if (o.misconception !== "other" && !["m1", "m2"].includes(o.misconception))
					push("misconception", "choose");
				else if (o.misconception === "other" && !custom) push("custom", "describe");
				else if (o.misconception === "other" && o.custom.trim().length > 120)
					push("custom", "longCustom");
			});
			return errors;
		}
		function encode(full: boolean): { state: unknown; writeBlocked: Failure | null } {
			if (!spec.read || spec.hold)
				return {
					state: null,
					writeBlocked: { reason: spec.read ? "restore-held" : "restore-pending" },
				};
			const invalid = limits(spec.value);
			if (invalid) return { state: null, writeBlocked: invalid };
			if (spec.value.hadIt !== null && !full)
				return { state: null, writeBlocked: { reason: "content-unavailable" } };
			return { state: wire(spec.revision, spec.value), writeBlocked: null };
		}
		function admission(fixture: Fixture, full: boolean): string {
			if (fixture.raw === undefined) return "empty";
			if (fixture.malformed || !fixture.value) return "invalid";
			// Fixtures with old IDs/count are readable, rather than malformed.
			const value = fixture.value;
			if (
				value.answer.trim().length > 2000 ||
				value.options.some((o) => o.text.trim().length > 300 || o.custom.trim().length > 120)
			)
				return "invalid";
			if (fixture.revision !== spec.revision) return "out-of-date";
			if (value.options.length !== count || limits(value)) return "invalid";
			if (value.hadIt !== null && !full) return "pending";
			if (value.shown && compare(value).length) return "invalid";
			return "valid";
		}
		function step(action: Action) {
			trace.push(action);
			const c = action.command,
				full = action.authority === "current";
			let emitted: unknown = null,
				writeId: number | null = null,
				notice: string | null = null;
			const unsaved = () => {
				if (!spec.notSaved) notice = "practiceNotSaved";
				spec.notSaved = true;
			};
			const requestWrite = () => {
				const encoding = encode(full);
				spec.blocked = encoding.writeBlocked;
				spec.pending = null;
				if (encoding.state) {
					emitted = encoding.state;
					writeId = ++spec.sequence;
					spec.pending = clone(spec.value);
				} else if (!spec.hold || spec.input !== undefined) unsaved();
			};
			const isAsync =
				c.type === "restore" ||
				c.type === "restore-unavailable" ||
				c.type === "retry" ||
				c.type === "write-result";
			const live = !isAsync || (action.current && c.generation === spec.generation);
			if (live)
				switch (c.type) {
					case "restore": {
						if (!spec.hold || spec.status === "conflict") break;
						const receipt = spec.saved?.raw !== undefined ? spec.saved : action.fixture;
						if (!receipt) throw new Error("Oracle requires a classified read fixture");
						spec.saved = receipt;
						spec.read = true;
						spec.status = admission(receipt, full);
						spec.recovery = recovery(receipt.value);
						if (spec.status === "empty") {
							spec.hold = false;
							spec.input = undefined;
							spec.blocked = null;
						} else if (spec.status === "valid" && receipt.value) {
							if (spec.input !== undefined && spec.input !== receipt.value.answer) {
								spec.status = "conflict";
								break;
							}
							spec.value = clone(receipt.value);
							spec.checked = receipt.value.hadIt !== null;
							spec.hold = false;
							spec.input = undefined;
							spec.error = null;
							spec.notSaved = false;
							spec.blocked = null;
						}
						break;
					}
					case "restore-unavailable":
						if (spec.hold && spec.status !== "conflict") spec.status = "unavailable";
						break;
					case "retry":
						if (spec.hold && spec.status === "unavailable") {
							spec.generation++;
							spec.status = "pending";
						}
						break;
					case "start-over": {
						if (!spec.read) break;
						const saved = spec.saved;
						Object.assign(spec, fresh(spec.revision, spec.generation + 1), {
							read: true,
							hold: false,
							status: "empty",
							saved,
						});
						requestWrite();
						break;
					}
					case "revision-change": {
						const next = references.findIndex(
							(ref) => ref.contentRevision === c.reference.contentRevision,
						);
						if (next === spec.revision) break;
						const prior = clone(spec),
							actual = spec.saved;
						Object.assign(spec, fresh(next, spec.generation + 1), {
							saved: actual,
							read: prior.read,
							notSaved: prior.notSaved,
						});
						spec.local =
							prior.input !== undefined ||
							prior.value.answer ||
							prior.value.options.some((o) => o.text || o.custom)
								? recovery(prior.value)
								: prior.local;
						if (prior.read && actual?.raw === undefined) {
							spec.hold = false;
							spec.status = "empty";
						} else if (actual?.raw !== undefined) {
							spec.read = true;
							spec.status = admission(actual, false);
							if (spec.status === "valid") spec.status = "pending";
							spec.recovery = recovery(actual.value);
						}
						break;
					}
					case "write-result": {
						if (spec.pending === null || c.writeId !== spec.sequence) break;
						if (c.outcome === "saved") {
							spec.saved = {
								raw: wire(spec.revision, spec.pending),
								revision: spec.revision,
								value: clone(spec.pending),
							};
							spec.notSaved = false;
							spec.blocked = null;
						} else unsaved();
						spec.pending = null;
						break;
					}
					case "flush":
						requestWrite();
						break;
					case "edit-answer":
					case "edit-option": {
						if (spec.value.shown || (c.type === "edit-answer" && spec.checked)) break;
						if (
							c.type === "edit-option" &&
							(spec.hold ||
								spec.value.hadIt === null ||
								!Number.isInteger(c.index) ||
								!spec.value.options[c.index])
						)
							break;
						if (c.type === "edit-answer") spec.value.answer = c.answer;
						else spec.value.options[c.index][c.field] = c.text;
						spec.error = null;
						if (spec.hold) {
							spec.input = spec.value.answer;
							spec.blocked = { reason: spec.read ? "restore-held" : "restore-pending" };
							unsaved();
						} else requestWrite();
						break;
					}
					case "check":
					case "rate":
					case "compare": {
						// Table rows 475,488-493 suspend every reveal/result transition.
						if (spec.hold || spec.value.shown) break;
						if (c.type === "check" && spec.checked) break;
						if (c.type !== "check" && !spec.checked) break;
						if (c.type === "compare" && spec.value.hadIt === null) break;
						const answer = spec.value.answer.trim();
						if (!answer) {
							spec.error = "emptyAnswer";
							break;
						}
						if (answer.length > 2000) {
							spec.error = "longAnswer";
							break;
						}
						if (!full) {
							spec.error = "content-unavailable";
							break;
						}
						if (c.type === "check") {
							spec.checked = true;
							spec.error = null;
							break;
						}
						if (!spec.checked) break;
						if (c.type === "rate") {
							if (limits(spec.value)) break;
							spec.value.hadIt = c.hadIt;
							spec.error = null;
							requestWrite();
							break;
						}
						const errors = compare(spec.value);
						if (errors.length) {
							spec.error = errors;
							break;
						}
						spec.value.options = spec.value.options.map((o) => ({
							text: normal(o.text),
							misconception: o.misconception,
							custom: o.misconception === "other" ? normal(o.custom) : "",
						}));
						spec.value.shown = true;
						spec.error = null;
						requestWrite();
						break;
					}
				}
			const authority =
				action.authority === "missing"
					? undefined
					: rules[action.authority === "foreign" ? 1 - spec.revision : spec.revision];
			// The oracle's read fixture is never the object supplied to production.
			// Mutating a caller-owned read must not mutate our expected saved bytes.
			const input =
				c.type === "restore"
					? { ...c, value: clone(c.value) }
					: c.type === "revision-change"
						? { ...c, reference: clone(c.reference) }
						: c;
			const result = reduceWriteDistractors(mount, input, authority);
			mount = result.mount;
			const encoded = encodeWriteDistractorsState(mount, authority);
			const expected = {
				reference: references[spec.revision],
				value: spec.value,
				checked: spec.checked,
				hold: spec.hold,
				status: spec.status,
				read: spec.read,
				generation: spec.generation,
				saved: spec.saved?.raw,
				recovery: spec.recovery,
				local: spec.local,
				error: spec.error,
				notSaved: spec.notSaved,
				blocked: spec.blocked,
				outcomeBlocked: spec.blocked,
				held: spec.input === undefined ? [] : [{ type: "edit-answer", answer: spec.input }],
				sequence: spec.sequence,
				pending: spec.pending ? wire(spec.revision, spec.pending) : null,
				write: emitted,
				writeId,
				notice,
				response: null,
				encoded: encode(full),
			};
			if (!mount.restoreWriteHold) expect(mount.readDone).toBe(true);
			const observed = {
				reference: mount.reference,
				value: mount.value,
				checked: mount.checkedAnswer,
				hold: mount.restoreWriteHold,
				status: mount.restoreStatus,
				read: mount.readDone,
				generation: mount.generation,
				saved: mount.saved,
				recovery: mount.recovery,
				local: mount.localRecovery,
				error: mount.error,
				notSaved: mount.notSaved,
				blocked: mount.writeBlocked,
				outcomeBlocked: result.writeBlocked,
				held: mount.heldEdits,
				sequence: mount.writeSequence,
				pending: mount.pendingWrite,
				write: result.write,
				writeId: result.writeId,
				notice: result.notice,
				response: result.response,
				encoded,
			};
			// JSON compares the exact would-be stored representation as well as all view
			// and recovery observables. Assertion values never come from a production read.
			if (JSON.stringify(expected) !== JSON.stringify(observed))
				throw new Error(
					JSON.stringify({ seed, step: trace.length, trace: trace.slice(-4), expected, observed }),
				);
		}
		const send = (
			command: DistractorCommand,
			authority: Action["authority"] = "current",
			fixture?: Fixture,
			current = true,
		) => step({ command, authority, fixture, current });
		const read = (
			kind: number,
			authority: Action["authority"] = "current",
			generation = spec.generation,
			current = true,
		) => {
			const value: Value = {
				answer: "stored answer",
				hadIt: kind === 2 || kind === 3 ? false : null,
				options: Array.from({ length: count }, (_, i) => ({
					text: `stored ${i}`,
					misconception: "m1",
					custom: `custom ${i}`,
				})),
				shown: kind === 3,
			};
			if (kind === 4) value.answer = "x".repeat(2001);
			if (kind === 6)
				value.options = [{ text: "old", misconception: "retired-id", custom: "old custom" }];
			const revision = kind === 6 ? 1 - spec.revision : spec.revision;
			const raw = kind === 0 ? undefined : kind === 7 ? null : wire(revision, value);
			if (kind === 5 && raw) raw.version = 9;
			if (kind === 8 && raw) raw.kind = "self-check";
			const fixture: Fixture = {
				raw,
				revision,
				value: kind === 0 || kind === 7 ? undefined : value,
				malformed: kind === 5 || kind === 7 || kind === 8,
			};
			send(
				{
					type: "restore",
					generation,
					value: raw,
					ticket: { revision: generation, current: () => current },
				},
				authority,
				fixture,
				current,
			);
		};
		const ack = (
			outcome: "saved" | "failed" = "saved",
			id = spec.sequence,
			generation = spec.generation,
			current = true,
		) =>
			send(
				{
					type: "write-result",
					generation,
					writeId: id,
					outcome,
					ticket: { revision: generation, current: () => current },
				},
				"current",
				undefined,
				current,
			);
		// These contract witnesses ensure every seed reaches held actions, terminal
		// admission, a superseded retry, each failure signal and a full comparison.
		send({ type: "edit-answer", answer: "mine" });
		send({ type: "check" });
		send({ type: "start-over" });
		if (seed % 9) {
			read((seed % 8) + 1, seed % 3 === 1 ? "missing" : "current");
			send({ type: "check" });
			send({ type: "rate", hadIt: true });
			send({ type: "compare" });
			send({ type: "restore-unavailable", generation: spec.generation });
			const retired = spec.generation;
			send({ type: "retry", generation: retired });
			send({ type: "restore-unavailable", generation: retired });
			send({ type: "start-over" });
			ack();
			send({ type: "edit-answer", answer: "mine" });
		} else read(0);
		send({ type: "check" }, "foreign");
		send({ type: "check" });
		send({ type: "rate", hadIt: true });
		ack();
		for (let i = 0; i < count; i++) {
			send({ type: "edit-option", index: i, field: "text", text: ` wrong   ${i} ` });
			send({ type: "edit-option", index: i, field: "misconception", text: "m1" });
		}
		send({ type: "edit-option", index: 0, field: "misconception", text: "other" });
		send({ type: "edit-option", index: 0, field: "custom", text: "x".repeat(121) });
		send({ type: "compare" });
		send({ type: "edit-option", index: 0, field: "custom", text: " own " });
		send(
			{ type: "edit-option", index: 0, field: "text", text: "kept without authority" },
			"missing",
		);
		send({ type: "flush" }, "missing");
		send({ type: "compare" });
		ack();
		send({ type: "restore-unavailable", generation: spec.generation });
		send({ type: "retry", generation: spec.generation });
		send({ type: "start-over" });
		send({ type: "restore-unavailable", generation: spec.generation - 1 });
		send({ type: "revision-change", reference: references[1] });
		send({ type: "revision-change", reference: references[0] });
		// The stored comparison still has five recovery rows in odd-numbered seeds.
		send({ type: "restore-unavailable", generation: spec.generation });
		const old = spec.generation;
		send({ type: "retry", generation: old });
		send({ type: "restore-unavailable", generation: old });
		read(3, "current", old);
		read(3);
		for (let i = 0; i < 70; i++) {
			const authority = (["current", "current", "current", "foreign", "missing"] as const)[
				choose(5)
			];
			const current = choose(5) !== 0,
				generation = spec.generation - choose(2);
			const ticket = { revision: generation, current: () => current };
			switch (choose(15)) {
				case 0:
				case 1:
					send(
						{
							type: "edit-answer",
							answer: ["", "mine", " stored answer ", "😀".repeat(1000), "x".repeat(2001)][
								choose(5)
							],
						},
						authority,
					);
					break;
				case 2:
				case 3: {
					const field = (["text", "misconception", "custom"] as const)[choose(3)];
					const choices =
						field === "misconception"
							? ["", "m1", "m2", "other", "retired"]
							: ["", " wrong  one ", "wrong two", "Right", "Changed", " own ", "x".repeat(301)];
					send(
						{
							type: "edit-option",
							index: choose(count + 2) - 1,
							field,
							text: choices[choose(choices.length)],
						},
						authority,
					);
					break;
				}
				case 4:
					send({ type: "check" }, authority);
					break;
				case 5:
					send({ type: "rate", hadIt: choose(2) === 0 }, authority);
					break;
				case 6:
					send({ type: "compare" }, authority);
					break;
				case 7:
					send({ type: "start-over" }, authority);
					break;
				case 8:
					read(choose(9), authority, generation, current);
					break;
				case 9:
					send({ type: "restore-unavailable", generation, ticket }, authority, undefined, current);
					break;
				case 10:
					send({ type: "revision-change", reference: references[1 - spec.revision] }, authority);
					break;
				case 11:
					read(3, authority, generation, current);
					break;
				case 12:
					send({ type: "retry", generation, ticket }, authority, undefined, current);
					break;
				case 13:
					ack(choose(2) ? "saved" : "failed", spec.sequence - choose(2), generation, current);
					break;
				case 14:
					send({ type: "flush" }, authority);
					break;
			}
		}
	},
);
