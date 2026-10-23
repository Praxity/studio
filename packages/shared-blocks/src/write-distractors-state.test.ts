import { describe, expect, it } from "vitest";
import { createWriteDistractorsRules } from "./write-distractors-content";
import {
	createDistractorMount,
	type DistractorCommand,
	type DistractorValue,
	decodeWriteDistractorsState,
	encodeWriteDistractorsState,
	recoverWriteDistractorsText,
	reduceWriteDistractors,
} from "./write-distractors-state";

const content = {
	question: "Question?",
	rightAnswer: "Right",
	count: 2,
	misconceptions: [
		{ id: "m1", label: "First" },
		{ id: "m2", label: "Second" },
	],
	authorOptions: [
		{ text: "Wrong", misconception: "m1" },
		{ text: "Also wrong", misconception: "m2" },
	],
};
const rules = createWriteDistractorsRules(content);
const reference = { contentRevision: rules.contentRevision, count: 2, itemIds: ["m1", "m2"] };
const initial: DistractorValue = {
	answer: "",
	hadIt: null,
	options: [
		{ text: "", misconception: "", custom: "" },
		{ text: "", misconception: "", custom: "" },
	],
	shown: false,
};
const draft = (value: DistractorValue = structuredClone(initial)) => ({
	version: 1,
	kind: "write-distractors",
	contentRevision: reference.contentRevision,
	value,
});
const completed = (): DistractorValue => ({
	answer: "  My answer  ",
	hadIt: false,
	options: [
		{ text: "  wrong   one ", misconception: "m1", custom: "unused" },
		{ text: " wrong two ", misconception: "other", custom: "  Own   label " },
	],
	shown: true,
});
function run(commands: DistractorCommand[], ready = true) {
	let mount = createDistractorMount(reference);
	if (ready)
		mount = reduceWriteDistractors(mount, {
			type: "restore",
			generation: 0,
			value: undefined,
		}).mount;
	const reductions = commands.map((command) => {
		const result = reduceWriteDistractors(mount, command, rules);
		mount = result.mount;
		return result;
	});
	return { mount, reductions };
}

describe("strict write-distractors envelope", () => {
	it("copies the exact incomplete draft and rejects legacy state", () => {
		const value = draft();
		const result = decodeWriteDistractorsState(value, reference);
		expect(result.status).toBe("valid");
		expect(result.state).toEqual(value);
		expect(result.state?.value).not.toBe(value.value);
		expect(result.state?.value.options[0]).not.toBe(value.value.options[0]);
		expect(
			decodeWriteDistractorsState(
				draft({ options: initial.options, shown: false } as DistractorValue),
				reference,
			).status,
		).toBe("invalid");
	});
	it.each(["version", "kind", "contentRevision", "value"])("requires envelope key %s", (key) => {
		const value: Record<string, unknown> = draft();
		delete value[key];
		expect(decodeWriteDistractorsState(value, reference).status).toBe("invalid");
	});
	it.each(["answer", "hadIt", "options", "shown"])("requires value key %s", (key) => {
		const value = draft();
		delete (value.value as unknown as Record<string, unknown>)[key];
		expect(decodeWriteDistractorsState(value, reference).status).toBe("invalid");
	});
	it.each(["text", "misconception", "custom"])("requires option key %s", (key) => {
		const value = draft();
		delete (value.value.options[0] as unknown as Record<string, unknown>)[key];
		expect(decodeWriteDistractorsState(value, reference).status).toBe("invalid");
	});
	it("rejects wrong discriminators, revisions, shapes and option counts", () => {
		for (const value of [
			null,
			"{}",
			[],
			{ ...draft(), version: 2 },
			{ ...draft(), kind: "self-check" },
			{ ...draft(), contentRevision: `sha256:${"A".repeat(64)}` },
			{ ...draft(), contentRevision: "sha256:abc" },
			{ ...draft(), extra: true },
			draft({ ...initial, options: [] }),
			draft({ ...initial, options: [initial.options[0]] }),
			draft({ ...initial, options: Array.from({ length: 6 }, () => initial.options[0]) }),
			draft({ ...initial, answer: 4 } as unknown as DistractorValue),
			draft({ ...initial, hadIt: "yes" } as unknown as DistractorValue),
			draft({ ...initial, shown: 1 } as unknown as DistractorValue),
			draft({ ...initial, extra: true } as DistractorValue),
			{
				...draft(),
				value: { ...initial, options: [{ ...initial.options[0], extra: "" }, initial.options[1]] },
			},
			draft({
				...initial,
				options: [{ ...initial.options[0], misconception: "old" }, initial.options[1]],
			}),
		])
			expect(decodeWriteDistractorsState(value, reference, rules).status).toBe("invalid");
	});
	it("never invokes accessors or accepts prototypes, hidden keys, symbols or sparse arrays", () => {
		let reads = 0;
		const getter = {
			get value() {
				reads++;
				return initial;
			},
		};
		const bad = [
			Object.defineProperty(draft(), "value", Object.getOwnPropertyDescriptors(getter).value),
			Object.assign(Object.create({}), draft()),
			Object.defineProperty(draft(), "hidden", { value: true }),
			{ ...draft(), [Symbol("extra")]: true },
		];
		for (const path of ["value", "option", "array"] as const) {
			const value = draft();
			const target =
				path === "value"
					? value.value
					: path === "option"
						? value.value.options[0]
						: value.value.options;
			Object.defineProperty(target, "hidden", { value: true });
			bad.push(value);
		}
		const sparse = draft();
		delete sparse.value.options[0];
		bad.push(sparse);
		const arrayGetter = draft();
		Object.defineProperty(arrayGetter.value.options, "0", {
			enumerable: true,
			get() {
				reads++;
				return initial.options[0];
			},
		});
		bad.push(arrayGetter);
		for (const value of bad)
			expect(decodeWriteDistractorsState(value, reference, rules).status).toBe("invalid");
		expect(reads).toBe(0);
	});
	it.each([
		["answer", 2000],
		["text", 300],
		["custom", 120],
	] as const)("measures %s after trim in U16 at %i", (field, limit) => {
		for (const astral of [false, true])
			for (const over of [0, 1]) {
				const text = `  ${astral ? "😀".repeat(limit / 2) : "x".repeat(limit)}${"x".repeat(over)}  `;
				const value = draft();
				if (field === "answer") value.value.answer = text;
				else value.value.options[0][field] = text;
				const result = decodeWriteDistractorsState(value, reference, rules);
				expect(result.status).toBe(over ? "invalid" : "valid");
				if (!over) expect(result.state?.value).toEqual(value.value);
				else expect(result.recovery.some((entry) => entry.text === text)).toBe(true);
			}
	});
	it("validates rated/shown invariants through full Content, without rewriting restored text", () => {
		for (const hadIt of [false, true]) {
			const value = completed();
			value.hadIt = hadIt;
			expect(decodeWriteDistractorsState(draft(value), reference).status).toBe("pending");
			expect(decodeWriteDistractorsState(draft(value), reference, rules).state?.value).toEqual(
				value,
			);
		}
		for (const value of [
			{ ...initial, hadIt: true },
			{ ...initial, shown: true },
			{ ...completed(), hadIt: null },
			{ ...completed(), options: initial.options },
		])
			expect(decodeWriteDistractorsState(draft(value), reference, rules).status).toBe("invalid");
	});
	it("accepts trimmed limits through full-state admission and Compare", () => {
		const value = completed();
		value.options[0].text = ` ${"😀".repeat(150)} `;
		value.options[1].custom = ` ${"😀".repeat(60)} `;
		const restored = reduceWriteDistractors(
			createDistractorMount(reference),
			{
				type: "restore",
				generation: 0,
				value: draft({ ...value, shown: false }),
			},
			rules,
		);
		expect(restored.mount.restoreWriteHold).toBe(false);
		expect(restored.mount.value).toEqual({ ...value, shown: false });
		const compared = reduceWriteDistractors(restored.mount, { type: "compare" }, rules);
		expect(compared.mount.value.shown).toBe(true);
		expect(compared.write?.value.options[0].text).toBe("😀".repeat(150));
		expect(compared.write?.value.options[1].custom).toBe("😀".repeat(60));
	});
	it("keeps validation bound to its captured Content when the caller mutates the source", () => {
		const input = structuredClone(content);
		const captured = createWriteDistractorsRules(input);
		input.rightAnswer = "Changed";
		input.misconceptions[0].id = "changed-id";
		expect(captured.contentRevision).toBe(reference.contentRevision);
		expect(
			captured.compare([
				{ text: "Right", misconception: "m1", custom: "" },
				{ text: "Wrong two", misconception: "m2", custom: "" },
			]),
		).toEqual({ ok: false, errors: [{ option: 0, field: "text", code: "right" }] });
	});
	it("classifies readable stale states before old IDs/count, but malformed/oversized states stay invalid", () => {
		const value = draft(completed());
		value.contentRevision = `sha256:${"0".repeat(64)}`;
		value.value.options = [{ text: "Old text", custom: "", misconception: "removed-id" }];
		expect(decodeWriteDistractorsState(value, reference, rules).status).toBe("out-of-date");
		value.value.answer = "x".repeat(2001);
		expect(decodeWriteDistractorsState(value, reference, rules).status).toBe("invalid");
	});
	it("extracts only eleven named text paths, preserving oversized/HTML text", () => {
		const answer = `<script>literal</script>${"x".repeat(2001)}`;
		const value = {
			value: {
				answer,
				unrelated: { answer: "hidden" },
				options: Array.from({ length: 7 }, (_, index) => ({
					text: `text${index}`,
					custom: `custom${index}`,
					misconception: "never",
				})),
			},
		};
		expect(recoverWriteDistractorsText(value)).toEqual([
			{ path: "value.answer", text: answer },
			...Array.from({ length: 5 }, (_, index) => [
				{ path: `value.options[${index}].text`, text: `text${index}` },
				{ path: `value.options[${index}].custom`, text: `custom${index}` },
			]).flat(),
		]);
		const recursive = { value: {} };
		recursive.value = recursive;
		expect(recoverWriteDistractorsText(recursive)).toEqual([]);
		expect(recoverWriteDistractorsText(Object.create(value))).toEqual([]);
	});
});

describe("distractor reductions", () => {
	it("starts with exact fresh options and suspends every write before the first read", () => {
		const mount = createDistractorMount(reference);
		expect(mount.value).toEqual(initial);
		expect(mount.value.options[0]).not.toBe(mount.value.options[1]);
		expect(mount.checkedAnswer).toBe(false);
		expect(encodeWriteDistractorsState(mount, rules)).toEqual({
			state: null,
			writeBlocked: { reason: "restore-pending" },
		});
		const result = run(
			[
				{ type: "edit-answer", answer: "new" },
				{ type: "edit-answer", answer: "" },
			],
			false,
		);
		expect(result.reductions.map((r) => [r.write, r.response, r.notice])).toEqual([
			[null, null, "practiceNotSaved"],
			[null, null, null],
		]);
		expect(result.mount.value.answer).toBe("");
		expect(result.mount.heldEdits).toEqual([{ type: "edit-answer", answer: "" }]);
	});
	it("keeps Check mount-only, locks the answer, allows rating changes, and resets exactly", () => {
		const { mount, reductions } = run([
			{ type: "edit-answer", answer: " My answer " },
			{ type: "check" },
			{ type: "edit-answer", answer: "replacement" },
			{ type: "rate", hadIt: true },
			{ type: "rate", hadIt: false },
		]);
		expect(reductions[1].write).toBeNull();
		expect(mount.checkedAnswer).toBe(true);
		expect(mount.value.answer).toBe(" My answer ");
		expect(mount.value.hadIt).toBe(false);
		const reload = reduceWriteDistractors(
			createDistractorMount(reference),
			{ type: "restore", generation: 0, value: reductions[0].write },
			rules,
		);
		expect(reload.mount.checkedAnswer).toBe(false);
		const rated = reduceWriteDistractors(
			createDistractorMount(reference),
			{ type: "restore", generation: 0, value: reductions[4].write },
			rules,
		);
		expect(rated.mount.checkedAnswer).toBe(true);
		const reset = reduceWriteDistractors(mount, { type: "start-over" }, rules);
		expect(reset.write).toEqual(draft());
		expect(reset.mount.value).toEqual(initial);
		expect(reset.mount.checkedAnswer).toBe(false);
		expect(reset.mount.error).toBeNull();
	});
	it.each([
		["  ", "emptyAnswer"],
		[`${"😀".repeat(1000)}x`, "longAnswer"],
	])("refuses Check for invalid answer: $1", (answer, error) => {
		const { mount } = run([{ type: "edit-answer", answer }, { type: "check" }]);
		expect(mount.error).toBe(error);
		expect(mount.checkedAnswer).toBe(false);
		expect(mount.value.answer).toBe(answer);
	});
	it("compares normalized options, clears unused custom and locks rating/result editors", () => {
		let mount = reduceWriteDistractors(
			createDistractorMount(reference),
			{ type: "restore", generation: 0, value: draft({ ...completed(), shown: false }) },
			rules,
		).mount;
		const compared = reduceWriteDistractors(mount, { type: "compare" }, rules);
		expect(compared.write?.value.options).toEqual([
			{ text: "wrong one", misconception: "m1", custom: "" },
			{ text: "wrong two", misconception: "other", custom: "Own label" },
		]);
		expect(compared.write?.value.shown).toBe(true);
		mount = compared.mount;
		for (const command of [
			{ type: "rate", hadIt: true },
			{ type: "edit-option", index: 0, field: "text", text: "change" },
			{ type: "compare" },
		] satisfies DistractorCommand[]) {
			const result = reduceWriteDistractors(mount, command, rules);
			expect(result.mount.value).toEqual(mount.value);
			expect(result.write).toBeNull();
		}
	});
	it.each([
		["text", "  ", "empty"],
		["text", " RIGHT ", "right"],
		["text", "wrong two", "duplicate"],
		["text", "x".repeat(301), "longText"],
		["misconception", "", "choose"],
		["custom", " ", "describe"],
		["custom", "x".repeat(121), "longCustom"],
	] as const)("retains invalid %s when Compare reports %s", (field, text, code) => {
		const value = { ...completed(), shown: false };
		value.options[field === "custom" ? 1 : 0][field] = text;
		const mount = reduceWriteDistractors(
			createDistractorMount(reference),
			{ type: "restore", generation: 0, value: draft(value) },
			rules,
		).mount;
		// Oversized live drafts are editable but cannot be admitted from storage.
		const base = code.startsWith("long")
			? reduceWriteDistractors(
					reduceWriteDistractors(
						createDistractorMount(reference),
						{ type: "restore", generation: 0, value: draft({ ...completed(), shown: false }) },
						rules,
					).mount,
					{ type: "edit-option", index: field === "custom" ? 1 : 0, field, text },
					rules,
				).mount
			: mount;
		const result = reduceWriteDistractors(base, { type: "compare" }, rules);
		expect(result.mount.error).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
		expect(result.mount.value.options[field === "custom" ? 1 : 0][field]).toBe(text);
		expect(result.write).toBeNull();
	});
	it("restores drafts/results silently; protects original saved bytes across retries and edits", () => {
		for (const saved of [draft(), draft({ ...completed(), shown: false }), draft(completed())]) {
			const result = reduceWriteDistractors(
				createDistractorMount(reference),
				{ type: "restore", generation: 0, value: saved },
				rules,
			);
			expect(result.write).toBeNull();
			expect(result.response).toBeNull();
			expect(result.notice).toBeNull();
			expect(result.mount.value).toEqual(saved.value);
			expect(result.mount.restoreWriteHold).toBe(false);
		}
		const saved = draft(completed());
		let mount = reduceWriteDistractors(createDistractorMount(reference), {
			type: "restore",
			generation: 0,
			value: saved,
		}).mount;
		expect(mount.restoreStatus).toBe("pending");
		expect(mount.recovery).toHaveLength(5);
		mount = reduceWriteDistractors(mount, { type: "edit-answer", answer: "" }, rules).mount;
		const restored = reduceWriteDistractors(
			mount,
			{ type: "restore", generation: 0, value: undefined },
			rules,
		);
		expect(restored.mount.restoreStatus).toBe("conflict");
		expect(restored.mount.value.answer).toBe("");
		expect(restored.mount.saved).toBe(saved);
		expect(restored.mount.recovery[0].text).toBe("  My answer  ");
		expect(encodeWriteDistractorsState(restored.mount, rules)).toEqual({
			state: null,
			writeBlocked: { reason: "restore-held" },
		});
		mount = reduceWriteDistractors(
			restored.mount,
			{ type: "edit-answer", answer: saved.value.answer },
			rules,
		).mount;
		expect(
			reduceWriteDistractors(mount, { type: "restore", generation: 0, value: saved }, rules).mount
				.restoreWriteHold,
		).toBe(true);
		expect(saved).toEqual(draft(completed()));
	});
	it("releases an empty read without flushing edits and preserves saved options on a compatible restore", () => {
		const edited = run([{ type: "edit-answer", answer: "same" }], false).mount;
		const empty = reduceWriteDistractors(
			edited,
			{ type: "restore", generation: 0, value: undefined },
			rules,
		);
		expect(empty.mount.value.answer).toBe("same");
		expect(empty.write).toBeNull();
		expect(empty.mount.restoreWriteHold).toBe(false);
		const saved = draft({ ...completed(), answer: "same", hadIt: null, shown: false });
		const restored = reduceWriteDistractors(
			edited,
			{ type: "restore", generation: 0, value: saved },
			rules,
		);
		expect(restored.mount.value.options).toEqual(saved.value.options);
		expect(restored.mount.restoreWriteHold).toBe(false);
		expect(restored.write).toBeNull();
	});
	it("holds invalid/stale/oversized/failed reads; Start over alone can replace them", () => {
		for (const saved of [
			{ ...draft(), version: 9 },
			{ ...draft(), contentRevision: `sha256:${"f".repeat(64)}` },
			draft({ ...initial, answer: "x".repeat(2001) }),
		]) {
			let mount = reduceWriteDistractors(
				createDistractorMount(reference),
				{ type: "restore", generation: 0, value: saved },
				rules,
			).mount;
			mount = reduceWriteDistractors(
				mount,
				{ type: "restore-unavailable", generation: 0 },
				rules,
			).mount;
			const edited = reduceWriteDistractors(mount, { type: "edit-answer", answer: "new" }, rules);
			expect(edited.notice).toBe("practiceNotSaved");
			expect(edited.write).toBeNull();
			expect(edited.mount.saved).toBe(saved);
			const reset = reduceWriteDistractors(edited.mount, { type: "start-over" }, rules);
			expect(reset.write).toEqual(draft());
			// Reset proposes fresh bytes; only W08's confirmed receipt removes old bytes.
			expect(reset.mount.saved).toBe(saved);
			expect(
				reduceWriteDistractors(reset.mount, { type: "restore", generation: 0, value: saved }, rules)
					.mount.value,
			).toEqual(initial);
		}
	});
	it("rejects borrowed authority and changed Content, recovers old text and ignores late restore", () => {
		const changed = createWriteDistractorsRules({ ...content, rightAnswer: "Other" });
		const ready = run([{ type: "edit-answer", answer: "mine" }]).mount;
		expect(reduceWriteDistractors(ready, { type: "check" }, changed).mount.checkedAnswer).toBe(
			false,
		);
		const swapped = reduceWriteDistractors(
			ready,
			{
				type: "revision-change",
				reference: { ...reference, contentRevision: changed.contentRevision },
			},
			changed,
		);
		expect(swapped.mount.restoreStatus).toBe("empty");
		expect(swapped.mount.value).toEqual(initial);
		expect(swapped.mount.recovery).toEqual([]);
		expect(swapped.mount.localRecovery[0].text).toBe("mine");
		expect(swapped.write).toBeNull();
		const late = reduceWriteDistractors(
			swapped.mount,
			{ type: "restore", generation: 0, value: draft(completed()) },
			changed,
		);
		expect(late.mount).toEqual(swapped.mount);
	});
});
