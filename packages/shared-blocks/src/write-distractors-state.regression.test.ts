import { describe, expect, it } from "vitest";
import { createActivityEffects } from "./activity-effects";
import { createWriteDistractorsRules } from "./write-distractors-content";
import {
	createDistractorMount,
	encodeWriteDistractorsState,
	reduceWriteDistractors as reduce,
} from "./write-distractors-state";

const rules = createWriteDistractorsRules({
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
});
const reference = { contentRevision: rules.contentRevision, count: 2, itemIds: ["m1", "m2"] };
const saved = (answer = "mine", hadIt: boolean | null = null, shown = false) => ({
	version: 1 as const,
	kind: "write-distractors" as const,
	contentRevision: reference.contentRevision,
	value: {
		answer,
		hadIt,
		options: [
			{ text: "wrong one", misconception: "m1", custom: "" },
			{ text: "wrong two", misconception: "m2", custom: "" },
		],
		shown,
	},
});
const restore = (value?: unknown, authority = true) =>
	reduce(
		createDistractorMount(reference),
		{
			type: "restore",
			generation: 0,
			value,
		},
		authority ? rules : undefined,
	).mount;

describe("round-one contract regressions", () => {
	it.each(["pending", "invalid", "stale", "unavailable", "conflict"] as const)(
		"P1-1: %s hold blocks Check, rating and Compare",
		(status) => {
			let mount =
				status === "pending"
					? createDistractorMount(reference)
					: restore(
							status === "invalid"
								? { version: 9 }
								: status === "stale"
									? { ...saved(), contentRevision: `sha256:${"0".repeat(64)}` }
									: saved("older", false),
							false,
						);
			mount = reduce(mount, { type: "edit-answer", answer: "mine" }, rules).mount;
			if (status === "unavailable")
				mount = reduce(mount, { type: "restore-unavailable", generation: 0 }, rules).mount;
			if (status === "conflict")
				mount = reduce(
					mount,
					{ type: "restore", generation: 0, value: saved("older", false) },
					rules,
				).mount;
			for (const command of [
				{ type: "check" },
				{ type: "rate", hadIt: true },
				{ type: "compare" },
			] as const) {
				const result = reduce(mount, command, rules);
				expect(result.mount.checkedAnswer).toBe(false);
				expect(result.mount.value.hadIt).toBeNull();
				expect(result.mount.value.shown).toBe(false);
				expect(result.mount.value.answer).toBe("mine");
				expect(result.write).toBeNull();
				mount = result.mount;
			}
		},
	);
	it("P1-1: edits before admission conflict; admission before edits locks the rated answer", () => {
		const first = reduce(
			createDistractorMount(reference),
			{ type: "edit-answer", answer: "" },
			rules,
		).mount;
		const later = reduce(
			first,
			{ type: "restore", generation: 0, value: saved("older", false) },
			rules,
		);
		expect(later.mount.restoreStatus).toBe("conflict");
		expect(later.mount.value.answer).toBe("");
		expect(later.mount.recovery[0]).toEqual({ path: "value.answer", text: "older" });
		expect(later.mount.restoreWriteHold).toBe(true);
		const admitted = restore(saved("older", false));
		expect(reduce(admitted, { type: "edit-answer", answer: "" }, rules).mount.value.answer).toBe(
			"older",
		);
	});
	it("P1-2: late failure and Retry cannot reopen admission or overwrite later input", () => {
		let mount = reduce(
			restore(saved("old")),
			{ type: "edit-answer", answer: "newer" },
			rules,
		).mount;
		mount = reduce(mount, { type: "restore-unavailable", generation: 0 }, rules).mount;
		expect(mount.restoreWriteHold).toBe(false);
		mount = reduce(mount, { type: "retry", generation: 0 }, rules).mount;
		mount = reduce(mount, { type: "restore", generation: 0, value: saved("old") }, rules).mount;
		expect(mount.value.answer).toBe("newer");
		const reset = reduce(mount, { type: "start-over" }, rules).mount;
		expect(reduce(reset, { type: "restore-unavailable", generation: 0 }, rules).mount).toEqual(
			reset,
		);
	});
	it("P1-2: Retry retires every old outcome and uses W06 tickets for external ownership", () => {
		let mount = reduce(
			restore(saved("old", false), false),
			{ type: "restore-unavailable", generation: 0 },
			rules,
		).mount;
		mount = reduce(mount, { type: "retry", generation: 0 }, rules).mount;
		expect(mount.generation).toBe(1);
		expect(mount.restoreStatus).toBe("pending");
		for (const command of [
			{ type: "restore-unavailable", generation: 0 },
			{ type: "restore", generation: 0, value: saved("old", false) },
			{ type: "retry", generation: 0 },
		] as const)
			expect(reduce(mount, command, rules).mount).toEqual(mount);
		const effects = createActivityEffects({
			current: () => true,
			disposed: () => false,
			activities: () => [],
			snapshot: () => ({}),
			write() {},
			writeFailed() {},
			project() {},
			published() {},
		});
		const ticket = effects.ticket();
		effects.commit();
		for (const command of [
			{ type: "restore", generation: 1, value: saved("old", false), ticket },
			{ type: "restore-unavailable", generation: 1, ticket },
			{ type: "retry", generation: 1, ticket },
		] as const)
			expect(reduce(mount, command, rules).mount).toEqual(mount);
	});
	it.each([
		["answer", 2000, "longAnswer"],
		["text", 300, "longText"],
		["custom", 120, "longCustom"],
	] as const)(
		"P1-3: oversized %s stays in memory, reports a blocked write and validates on action",
		(field, limit, code) => {
			const text = ` ${"x".repeat(limit + 1)} `;
			let mount = field === "answer" ? restore() : restore(saved("mine", true));
			if (field === "custom")
				mount = reduce(
					mount,
					{ type: "edit-option", index: 0, field: "misconception", text: "other" },
					rules,
				).mount;
			const edited = reduce(
				mount,
				field === "answer"
					? { type: "edit-answer", answer: text }
					: { type: "edit-option", index: 0, field, text },
				rules,
			);
			expect(edited.write).toBeNull();
			expect(edited.notice).toBe("practiceNotSaved");
			expect(edited.mount.notSaved).toBe(true);
			expect(edited.writeBlocked).toEqual({
				reason: "validation",
				field: field === "answer" ? "value.answer" : `value.options[0].${field}`,
				code,
			});
			expect(edited.mount.error).toBeNull();
			const attempted = reduce(
				edited.mount,
				{ type: field === "answer" ? "check" : "compare" },
				rules,
			);
			expect(attempted.mount.error).toEqual(
				field === "answer" ? code : expect.arrayContaining([expect.objectContaining({ code })]),
			);
			expect(
				field === "answer" ? attempted.mount.value.answer : attempted.mount.value.options[0][field],
			).toBe(text);
		},
	);
	it("P1-3: missing Content authority has an explicit unsaved outcome, including flush", () => {
		const edited = reduce(restore(saved("mine", false)), {
			type: "edit-option",
			index: 0,
			field: "text",
			text: "retained",
		});
		expect(edited.writeBlocked).toEqual({ reason: "content-unavailable" });
		expect(edited.mount.notSaved).toBe(true);
		expect(encodeWriteDistractorsState(edited.mount)).toEqual({
			state: null,
			writeBlocked: { reason: "content-unavailable" },
		});
		expect(reduce(edited.mount, { type: "flush" }).writeBlocked).toEqual({
			reason: "content-unavailable",
		});
	});
	it("P2-1: Start over cannot write unread storage", () => {
		const mount = createDistractorMount(reference),
			result = reduce(mount, { type: "start-over" }, rules);
		expect(result.mount).toEqual(mount);
		expect(result.write).toBeNull();
	});
	it("P2-2: only a current successful save clears notSaved", () => {
		const initial = reduce(
			createDistractorMount(reference),
			{ type: "edit-answer", answer: "held" },
			rules,
		).mount;
		const read = reduce(initial, { type: "restore", generation: 0, value: undefined }, rules).mount;
		expect(read.notSaved).toBe(true);
		const proposal = reduce(read, { type: "edit-answer", answer: "new" }, rules);
		expect(proposal.mount.notSaved).toBe(true);
		if (proposal.writeId === null) throw new Error("Expected a write request");
		const success = reduce(
			proposal.mount,
			{ type: "write-result", generation: 0, writeId: proposal.writeId, outcome: "saved" },
			rules,
		);
		expect(success.mount.notSaved).toBe(false);
		expect(success.mount.saved).toEqual(proposal.write);
	});
	it("P2-3: revision changes use observed/confirmed bytes, never memory or unflushed proposals", () => {
		const other = { ...reference, contentRevision: `sha256:${"f".repeat(64)}` };
		const memory = reduce(restore(), { type: "edit-answer", answer: "unconfirmed" }, rules);
		const changed = reduce(
			memory.mount,
			{ type: "revision-change", reference: other },
			rules,
		).mount;
		expect(changed.restoreStatus).toBe("empty");
		expect(changed.restoreWriteHold).toBe(false);
		expect(changed.saved).toBeUndefined();
		expect(changed.localRecovery[0].text).toBe("unconfirmed");
		if (memory.writeId === null) throw new Error("Expected a write request");
		const confirmed = reduce(
			memory.mount,
			{ type: "write-result", generation: 0, writeId: memory.writeId, outcome: "saved" },
			rules,
		).mount;
		const stored = reduce(confirmed, { type: "revision-change", reference: other }, rules).mount;
		expect(stored.restoreStatus).toBe("out-of-date");
		expect(stored.saved).toEqual(memory.write);
	});
	it("P3-2: hidden option edits cannot contaminate the answer/rating stages", () => {
		let mount = restore();
		mount = reduce(
			mount,
			{ type: "edit-option", index: 0, field: "text", text: "x".repeat(301) },
			rules,
		).mount;
		expect(mount.value.options[0].text).toBe("");
		mount = reduce(mount, { type: "edit-answer", answer: "mine" }, rules).mount;
		mount = reduce(mount, { type: "check" }, rules).mount;
		expect(
			reduce(mount, { type: "edit-option", index: 0, field: "text", text: "hidden" }, rules).mount
				.value.options[0].text,
		).toBe("");
	});
	it("P3-1: raw edge-space drafts round-trip through the owning upstream trim bridge", () => {
		const text = `   ${"x".repeat(300)}   `;
		const edited = reduce(
			restore(saved("mine", false)),
			{ type: "edit-option", index: 0, field: "text", text },
			rules,
		);
		expect(edited.write?.value.options[0].text).toBe(text);
		expect(edited.write?.value.options[0].text.length).toBe(306);
		if (!edited.write) throw new Error("Expected a raw draft envelope");
		// The Content owner calls the pin's validateState with trim-only copies.
		expect(rules.validateValue(edited.write.value)).toBe(true);
		expect(restore(edited.write).value.options[0].text).toBe(text);
	});
	it("P3-3: revisiting the saved revision stays pending until explicit admission", () => {
		const original = saved("original");
		const other = { ...reference, contentRevision: `sha256:${"f".repeat(64)}` };
		let mount = reduce(
			restore(original),
			{ type: "revision-change", reference: other },
			rules,
		).mount;
		mount = reduce(mount, { type: "revision-change", reference }, rules).mount;
		expect(mount.restoreStatus).toBe("pending");
		expect(mount.restoreWriteHold).toBe(true);
		const admitted = reduce(
			mount,
			{ type: "restore", generation: mount.generation, value: original },
			rules,
		);
		expect(admitted.mount.restoreStatus).toBe("valid");
		expect(admitted.mount.restoreWriteHold).toBe(false);
		expect(admitted.write).toBeNull();
	});
	it("P2-2: superseded receipts cannot clear an unsaved newer draft", () => {
		const first = reduce(restore(), { type: "edit-answer", answer: "first" }, rules);
		if (first.writeId === null) throw new Error("Expected first write");
		const newer = reduce(first.mount, { type: "edit-answer", answer: "x".repeat(2001) }, rules);
		const late = reduce(
			newer.mount,
			{ type: "write-result", generation: 0, writeId: first.writeId, outcome: "saved" },
			rules,
		);
		expect(late.mount).toEqual(newer.mount);
		expect(late.mount.notSaved).toBe(true);
		expect(late.mount.saved).toBeUndefined();
	});
	it("P2-2: a failed reset save retains empty memory and the observed old bytes", () => {
		const original = saved("old", true, true),
			reset = reduce(restore(original), { type: "start-over" }, rules);
		if (reset.writeId === null) throw new Error("Expected reset write");
		const failed = reduce(
			reset.mount,
			{
				type: "write-result",
				generation: reset.mount.generation,
				writeId: reset.writeId,
				outcome: "failed",
			},
			rules,
		);
		expect(failed.mount.value.answer).toBe("");
		expect(failed.mount.value.shown).toBe(false);
		expect(failed.mount.saved).toBe(original);
		expect(failed.mount.notSaved).toBe(true);
		expect(failed.notice).toBe("practiceNotSaved");
	});
});
