import { describe, expect, it, vi } from "vitest";
import type { LearnerBlockStateRuntime } from "./learner-block-state";
import { createWriteDistractorsRules } from "./write-distractors-content";
import { createWriteDistractorsSession } from "./write-distractors-session";

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
const reference = {
	contentRevision: rules.contentRevision,
	count: 2,
	itemIds: ["m1", "m2"],
	path: "content.json",
};
function saved(answer = "OLD ANSWER", hadIt: boolean | null = false) {
	return {
		version: 1,
		kind: "write-distractors",
		contentRevision: reference.contentRevision,
		value: {
			answer,
			hadIt,
			shown: false,
			options: [
				{ text: "OLD OPTION ONE", misconception: "m1", custom: "" },
				{ text: "OLD OPTION TWO", misconception: "m2", custom: "" },
			],
		},
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void, reject!: (reason: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
const settle = async () => {
	for (let n = 0; n < 12; n++) await Promise.resolve();
};
function fixture(values: Record<string, unknown> = {}, deferStart = false, withProvider = true) {
	const store = new Map(Object.entries(values));
	const set = vi.fn((id: string, value: unknown) => {
		store.set(id, value);
	});
	const provider = {
		get: vi.fn<LearnerBlockStateRuntime["get"]>((id) => store.get(id) as never),
		set,
		getSaveResult: vi.fn<NonNullable<LearnerBlockStateRuntime["getSaveResult"]>>(() => ({
			status: "saved",
			destination: "device",
		})),
	};
	let current = true;
	const admit = vi.fn<Parameters<typeof createWriteDistractorsSession>[1]["admit"]>(
		async () => rules,
	);
	const session = createWriteDistractorsSession(
		["a", "b"].map((blockId) => ({ ...reference, blockId })),
		{
			provider: withProvider ? provider : undefined,
			current: () => current,
			admit,
			deferStart,
		},
	);
	const announcements: string[] = [];
	session.subscribe((snapshot) => {
		for (const activity of snapshot.activities)
			if (activity.announcement) announcements.push(activity.announcement);
	});
	return {
		store,
		set,
		provider,
		session,
		admit,
		announcements,
		revoke: () => {
			current = false;
		},
	};
}

describe("write-distractors session", () => {
	it.each(["held draft", ""])(
		"empty initial read silently saves a preactivation %j edit",
		async (answer) => {
			const f = fixture({}, true);
			f.provider.getSaveResult.mockImplementation((id) =>
				f.store.has(id) ? { status: "saved", destination: "device" } : undefined,
			);
			f.session.dispatch({ type: "edit-answer", blockId: "a", answer });
			expect(f.set).not.toHaveBeenCalled();
			f.session.initialize();
			await settle();
			expect(f.set).toHaveBeenCalledOnce();
			expect(f.store.get("a")).toMatchObject({ value: { answer, hadIt: null, shown: false } });
			expect(f.session.read("a")?.mount.notSaved).toBe(false);
			expect(f.admit).not.toHaveBeenCalled();
			expect(f.announcements).toEqual([]);
		},
	);
	it("typing during an empty initial read saves the draft without announcing", async () => {
		const f = fixture({}, true);
		f.provider.getSaveResult.mockImplementation((id) =>
			f.store.has(id) ? { status: "saved", destination: "device" } : undefined,
		);
		f.provider.get.mockImplementationOnce(() => {
			expect(f.session.read("a")?.mount.readDone).toBe(false);
			f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "during read" });
			return undefined;
		});
		f.session.initialize();
		await settle();
		expect(f.store.get("a")).toMatchObject({ value: { answer: "during read" } });
		expect(f.set).toHaveBeenCalledOnce();
		expect(f.session.read("a")?.mount.notSaved).toBe(false);
		expect(f.announcements).toEqual([]);
	});
	it.each([false, true])(
		"a preactivation draft's failed first save announces once after the write, no store=%s",
		async (noStore) => {
			const f = fixture({}, true);
			let attempted = false;
			f.set.mockImplementation(() => {
				attempted = true;
			});
			f.provider.getSaveResult.mockImplementation(() =>
				attempted || noStore ? { status: "not-saved", code: "storage-unavailable" } : undefined,
			);
			await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "unsaved draft" });
			expect(f.announcements).toEqual([]);
			f.session.initialize();
			await settle();
			expect(f.set).toHaveBeenCalledOnce();
			expect(f.store.has("a")).toBe(false);
			expect(f.session.read("a")?.mount.value.answer).toBe("unsaved draft");
			expect(f.session.read("a")?.mount.notSaved).toBe(true);
			expect(f.announcements).toEqual(["practiceNotSaved"]);
			await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "later edit" });
			f.session.flush();
			expect(f.announcements).toEqual(["practiceNotSaved"]);
		},
	);
	it("an oversized preactivation answer announces once when the initial read cannot save it", async () => {
		const f = fixture({}, true);
		const answer = "x".repeat(2001);
		await f.session.dispatch({ type: "edit-answer", blockId: "a", answer });
		expect(f.announcements).toEqual([]);
		f.session.initialize();
		await settle();
		expect(f.session.read("a")?.mount).toMatchObject({
			value: { answer },
			notSaved: true,
		});
		expect(f.announcements).toEqual(["practiceNotSaved"]);
		await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: `${answer}x` });
		f.session.flush();
		expect(f.announcements).toEqual(["practiceNotSaved"]);
		expect(f.set).not.toHaveBeenCalled();
		expect(f.store.has("a")).toBe(false);
	});
	it.each(["thrown read", "host-reported transient failure", "missing provider"])(
		"the first edit after an initial %s announces once and keeps unread saved bytes",
		async (kind) => {
			const original = saved();
			const f = fixture({ a: original }, true, kind !== "missing provider");
			if (kind === "thrown read")
				f.provider.get.mockImplementation(() => {
					throw new Error("read unavailable");
				});
			if (kind === "host-reported transient failure") {
				const failedReads = new Set<string>();
				f.provider.getSaveResult.mockImplementation((id) =>
					failedReads.has(id) ? { status: "not-saved", code: "storage-unavailable" } : undefined,
				);
				f.provider.get.mockImplementation((id) => {
					failedReads.add(id);
					return undefined;
				});
			}
			f.session.initialize();
			await settle();
			expect(f.session.read("a")?.mount).toMatchObject({
				readDone: false,
				restoreWriteHold: true,
				restoreStatus: "unavailable",
			});
			expect(f.announcements).toEqual([]);
			await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "first edit" });
			expect(f.announcements).toEqual(["practiceNotSaved"]);
			await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "" });
			f.session.flush();
			expect(f.announcements).toEqual(["practiceNotSaved"]);
			expect(f.session.read("a")?.mount).toMatchObject({
				notSaved: true,
				restoreWriteHold: true,
				value: { answer: "" },
			});
			expect(f.session.read("a")?.notice).toBe("selfCheckUnavailable");
			expect(f.set).not.toHaveBeenCalled();
			expect(f.store.get("a")).toBe(original);
		},
	);
	it.each(["preactivation draft", ""])(
		"a failed initial read keeps preactivation %j silent until the next edit",
		async (answer) => {
			const original = saved();
			const f = fixture({ a: original }, true);
			f.provider.get.mockImplementation(() => {
				throw new Error("read unavailable");
			});
			await f.session.dispatch({ type: "edit-answer", blockId: "a", answer });
			expect(f.announcements).toEqual([]);
			f.session.initialize();
			await settle();
			expect(f.session.read("a")?.mount).toMatchObject({
				readDone: false,
				restoreWriteHold: true,
				restoreStatus: "unavailable",
				notSaved: true,
				value: { answer },
			});
			expect(f.announcements).toEqual([]);
			await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "next edit" });
			expect(f.announcements).toEqual(["practiceNotSaved"]);
			await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "" });
			f.session.flush();
			expect(f.announcements).toEqual(["practiceNotSaved"]);
			expect(f.session.read("a")?.notice).toBe("selfCheckUnavailable");
			expect(f.session.read("a")?.mount).toMatchObject({
				restoreWriteHold: true,
				value: { answer: "" },
			});
			expect(f.set).not.toHaveBeenCalled();
			expect(f.store.get("a")).toBe(original);
		},
	);
	it.each([
		["read", "edit"],
		["receipt", "edit"],
		["read", "revision-change"],
		["receipt", "revision-change"],
	])(
		"Retry interrupted during the %s by %s announces only a current failure once",
		async (phase, interruption) => {
			const original = saved();
			const f = fixture({ a: original }, true);
			f.provider.get.mockImplementation(() => {
				throw new Error("read unavailable");
			});
			f.session.initialize();
			await settle();
			expect(f.announcements).toEqual([]);
			const interrupt = () => {
				if (interruption === "edit")
					f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "during Retry" });
				else
					f.session.dispatch({
						type: "revision-change",
						blockId: "a",
						reference: { ...reference, contentRevision: `sha256:${"f".repeat(64)}` },
					});
			};
			if (phase === "read") {
				f.provider.get.mockImplementationOnce(() => {
					interrupt();
					throw new Error("interrupted read");
				});
			} else {
				f.provider.get.mockReturnValueOnce(undefined);
				f.provider.getSaveResult.mockReturnValueOnce(undefined).mockImplementationOnce(() => {
					interrupt();
					return undefined;
				});
			}
			await f.session.dispatch({ type: "retry", blockId: "a" });
			await settle();
			const expectedAnnouncements = interruption === "edit" ? ["selfCheckUnavailable"] : [];
			expect(f.announcements).toEqual(expectedAnnouncements);
			expect(f.session.read("a")?.mount).toMatchObject({
				readDone: false,
				restoreWriteHold: true,
				restoreStatus: "unavailable",
				value: { answer: interruption === "edit" ? "during Retry" : "" },
			});
			f.session.flush();
			await settle();
			expect(f.announcements).toEqual(expectedAnnouncements);
			expect(f.set).not.toHaveBeenCalled();
			expect(f.store.get("a")).toBe(original);
			expect(f.admit).not.toHaveBeenCalled();
		},
	);
	it.each([
		["read", "success"],
		["receipt", "success"],
		["read", "failure"],
		["receipt", "failure"],
	])(
		"Retry interrupted during the %s resumes Content loading before %s",
		async (phase, outcome) => {
			const original = saved();
			const f = fixture({ a: original }, true);
			const admission = deferred<typeof rules>();
			f.admit.mockReturnValue(admission.promise);
			f.provider.get.mockImplementation(() => {
				throw new Error("read unavailable");
			});
			f.session.initialize();
			await settle();
			expect(f.announcements).toEqual([]);
			f.provider.get.mockImplementation((id) => f.store.get(id) as never);
			const interrupt = () => {
				f.session.dispatch({ type: "edit-answer", blockId: "a", answer: original.value.answer });
			};
			if (phase === "read") {
				f.provider.get.mockImplementationOnce(() => {
					interrupt();
					throw new Error("interrupted read");
				});
			} else {
				f.provider.getSaveResult.mockReturnValueOnce(undefined).mockImplementationOnce(() => {
					interrupt();
					return undefined;
				});
			}
			await f.session.dispatch({ type: "retry", blockId: "a" });
			await settle();
			expect(f.admit).toHaveBeenCalledOnce();
			expect(f.admit).toHaveBeenCalledWith(
				expect.objectContaining({ blockId: "a" }),
				true,
				expect.anything(),
			);
			expect(f.session.read("a")).toMatchObject({
				loading: true,
				mount: { readDone: true, restoreWriteHold: true, restoreStatus: "pending" },
			});
			expect(f.announcements).toEqual(["distractorsLoading"]);
			if (outcome === "success") admission.resolve(rules);
			else admission.reject(new Error("Content unavailable"));
			await settle();
			expect(f.session.read("a")).toMatchObject({
				loading: false,
				notice: outcome === "success" ? null : "selfCheckUnavailable",
				mount: {
					restoreWriteHold: outcome !== "success",
					restoreStatus: outcome === "success" ? "valid" : "unavailable",
				},
			});
			expect(f.announcements).toEqual(
				outcome === "success"
					? ["distractorsLoading"]
					: ["distractorsLoading", "selfCheckUnavailable"],
			);
			if (outcome === "success") expect(f.session.read("a")?.mount.value).toEqual(original.value);
			expect(f.set).not.toHaveBeenCalled();
			expect(f.store.get("a")).toBe(original);
		},
	);
	it("null-rating drafts restore incomplete raw text without Content, response or write", async () => {
		const old = saved(" draft ", null);
		old.value.options[0].text = "";
		const f = fixture({ a: old });
		await settle();
		expect(f.session.read("a")?.mount.value).toEqual(old.value);
		expect(f.admit).not.toHaveBeenCalled();
		expect(f.set).not.toHaveBeenCalled();
		expect(f.session.read("a")?.announcement).toBeNull();
	});
	it("two activities retain independent dirty writes through a reentrant read", async () => {
		const f = fixture({}, true);
		let once = true;
		vi.mocked(f.provider.get).mockImplementation((id) => {
			if (once) {
				once = false;
				f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "A" });
				f.session.dispatch({ type: "edit-answer", blockId: "b", answer: "B" });
			}
			return f.store.get(id) as never;
		});
		f.session.initialize();
		await settle();
		expect(f.store.get("a")).toMatchObject({ value: { answer: "A" } });
		expect(f.store.get("b")).toMatchObject({ value: { answer: "B" } });
	});
	it.each(["asset", "validation"])(
		"W08: failed %s restore keeps bytes, recovery and hold through empty edits, Retry and pagehide",
		async (failure) => {
			const original = saved();
			const f = fixture({ a: original }, true);
			f.admit.mockImplementation(async () => {
				if (failure === "asset") throw new Error("asset");
				return createWriteDistractorsRules({ ...content, rightAnswer: "Changed" });
			});
			f.session.initialize();
			await settle();
			expect(f.session.read("a")?.notice).toBe("selfCheckUnavailable");
			expect(f.session.read("a")?.announcement).toBeNull();
			f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "new" });
			f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "" });
			await f.session.dispatch({ type: "retry", blockId: "a" });
			await settle();
			expect(f.session.read("a")?.mount.recovery).toContainEqual({
				path: "value.options[0].text",
				text: "OLD OPTION ONE",
			});
			expect(f.session.read("a")?.mount.value.answer).toBe("");
			f.session.flush();
			f.revoke();
			f.session.dispose();
			expect(f.store.get("a")).toBe(original);
			expect(f.set).not.toHaveBeenCalled();
			const reopened = fixture({ a: f.store.get("a") });
			await settle();
			expect(reopened.session.read("a")?.mount.value).toEqual(original.value);
			expect(reopened.set).not.toHaveBeenCalled();
		},
	);
	it("Retry succeeds silently without edits, preserves options on the next edit", async () => {
		const f = fixture({ a: saved() }, true);
		f.admit.mockRejectedValue(new Error("load"));
		f.session.initialize();
		await settle();
		f.admit.mockResolvedValue(rules);
		await f.session.dispatch({ type: "retry", blockId: "a" });
		await settle();
		expect(f.session.read("a")?.mount.restoreWriteHold).toBe(false);
		expect(f.set).not.toHaveBeenCalled();
		f.session.dispatch({
			type: "edit-option",
			blockId: "a",
			index: 0,
			field: "text",
			text: "new option",
		});
		expect(f.store.get("a")).toMatchObject({
			value: {
				answer: "OLD ANSWER",
				options: [{ text: "new option" }, { text: "OLD OPTION TWO" }],
			},
		});
	});
	it.each(["invalid", "out-of-date", "oversized"])(
		"W08: %s envelopes keep recovery through Retry, flush and reopen",
		async (kind) => {
			const old = saved();
			if (kind === "invalid") old.version = 9;
			if (kind === "out-of-date") old.contentRevision = `sha256:${"f".repeat(64)}`;
			if (kind === "oversized") old.value.answer = "x".repeat(2001);
			const f = fixture({ a: old, b: old });
			await settle();
			const notice = kind === "out-of-date" ? "distractorsChanged" : "distractorsInvalid";
			expect(f.session.read("a")?.notice).toBe(notice);
			f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "" });
			await f.session.dispatch({ type: "retry", blockId: "a" });
			f.session.flush();
			expect(f.session.read("a")?.notice).toBe(notice);
			expect(f.session.read("a")?.mount.recovery[0].text).toBe(old.value.answer);
			expect(f.set).not.toHaveBeenCalled();
			expect(f.session.read("b")?.notice).toBe(notice);
			f.session.dispatch({ type: "edit-answer", blockId: "b", answer: "" });
			f.session.flush();
			f.revoke();
			f.session.dispose();
			const reopened = fixture({ a: f.store.get("a"), b: f.store.get("b") });
			await settle();
			for (const blockId of ["a", "b"]) {
				expect(reopened.session.read(blockId)?.notice).toBe(notice);
				expect(reopened.session.read(blockId)?.mount.recovery[0].text).toBe(old.value.answer);
			}
			expect(reopened.set).not.toHaveBeenCalled();
			expect(f.set).not.toHaveBeenCalled();
		},
	);
	it("conflicting Retry preserves the preceding recovery notice until Start over", async () => {
		const f = fixture({ a: saved() }, true);
		f.admit.mockRejectedValue(new Error("load"));
		f.session.initialize();
		await settle();
		f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "" });
		f.admit.mockResolvedValue(rules);
		await f.session.dispatch({ type: "retry", blockId: "a" });
		await settle();
		expect(f.session.read("a")?.mount.restoreStatus).toBe("conflict");
		expect(f.session.read("a")?.notice).toBe("selfCheckUnavailable");
		expect(f.session.read("a")?.mount.recovery[0].text).toBe("OLD ANSWER");
		expect(f.set).not.toHaveBeenCalled();
		const requests = f.admit.mock.calls.length;
		await f.session.dispatch({ type: "retry", blockId: "a" });
		expect(f.admit).toHaveBeenCalledTimes(requests);
		f.session.dispatch({ type: "start-over", blockId: "a" });
		expect(f.session.read("a")?.notice).toBeNull();
		expect(f.store.get("a")).toMatchObject({ value: { answer: "", hadIt: null, shown: false } });
	});
	it("failed Start over keeps empty memory, old durable bytes and a failure notice", async () => {
		const original = saved();
		const f = fixture({ a: original });
		await settle();
		f.set.mockImplementation(() => {});
		vi.mocked(f.provider.getSaveResult).mockReturnValue({
			status: "not-saved",
			code: "storage-unavailable",
		});
		f.session.dispatch({ type: "start-over", blockId: "a" });
		expect(f.session.read("a")?.mount.value.answer).toBe("");
		expect(f.session.read("a")?.mount.notSaved).toBe(true);
		expect(f.store.get("a")).toBe(original);
	});
	it("unacknowledged stored writes never become an empty store on revision change", async () => {
		const f = fixture();
		await settle();
		vi.mocked(f.provider.getSaveResult).mockReturnValue(undefined);
		f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "STORED WITHOUT RECEIPT" });
		f.session.dispatch({
			type: "revision-change",
			blockId: "a",
			reference: { ...reference, contentRevision: `sha256:${"f".repeat(64)}` },
		});
		expect(f.session.read("a")?.mount.restoreWriteHold).toBe(true);
		expect(f.session.read("a")?.mount.restoreStatus).not.toBe("empty");
		expect(f.session.read("a")?.mount.localRecovery).toContainEqual({
			path: "value.answer",
			text: "STORED WITHOUT RECEIPT",
		});
		await f.session.dispatch({ type: "retry", blockId: "a" });
		await settle();
		expect(f.session.read("a")?.mount.restoreStatus).toBe("out-of-date");
		expect(f.session.read("a")?.mount.recovery).toContainEqual({
			path: "value.answer",
			text: "STORED WITHOUT RECEIPT",
		});
		f.session.dispatch({ type: "start-over", blockId: "a" });
		expect(f.session.read("a")?.mount.value.answer).toBe("");
	});
	it("a reentrant write receipt records actual storage without certifying a newer oversized draft", async () => {
		const f = fixture();
		await settle();
		let once = true;
		f.set.mockImplementation((id, value) => {
			f.store.set(id, value);
			if (once) {
				once = false;
				f.session.dispatch({ type: "edit-answer", blockId: id, answer: "x".repeat(2001) });
			}
		});
		f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "STORED" });
		expect(f.session.read("a")?.mount.notSaved).toBe(true);
		f.session.dispatch({
			type: "revision-change",
			blockId: "a",
			reference: { ...reference, contentRevision: `sha256:${"f".repeat(64)}` },
		});
		expect(f.session.read("a")?.mount.recovery).toContainEqual({
			path: "value.answer",
			text: "STORED",
		});
		expect(f.session.read("a")?.mount.restoreStatus).toBe("out-of-date");
	});
	it("Studio codec retains trimmed-limit option text during rated restore", async () => {
		const old = saved();
		old.value.options[0].text = `   ${"x".repeat(300)}   `;
		const f = fixture({ a: old });
		await settle();
		expect(f.session.read("a")?.mount.restoreStatus).toBe("valid");
		expect(f.session.read("a")?.mount.value.options[0].text).toBe(old.value.options[0].text);
	});
	it("changed Content with an unchanged reference refuses reveal", async () => {
		const f = fixture({}, true);
		f.admit.mockResolvedValue(createWriteDistractorsRules({ ...content, rightAnswer: "Tampered" }));
		f.session.initialize();
		f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "mine" });
		await f.session.dispatch({ type: "check", blockId: "a" });
		await settle();
		expect(f.session.read("a")?.mount.checkedAnswer).toBe(false);
		expect(f.session.read("a")?.notice).toBe("selfCheckUnavailable");
	});
	it("pagehide revokes held loads; return restores once with no stale write", async () => {
		const f = fixture({ a: saved() }, true);
		const held = deferred<typeof rules>();
		f.admit.mockReturnValue(held.promise);
		f.session.initialize();
		f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "held before pagehide" });
		expect(f.session.read("a")?.mount.heldEdits).toHaveLength(1);
		f.session.dispose();
		f.session.flush();
		const cancelled = f.session.read("a");
		expect(cancelled).toMatchObject({
			cancelled: true,
			loading: false,
			mount: { restoreStatus: "pending", restoreWriteHold: true },
		});
		held.resolve(rules);
		await settle();
		expect(f.set).not.toHaveBeenCalled();
		expect(f.session.read("a")).toEqual(cancelled);
		expect(f.admit.mock.calls[0][2].current()).toBe(false);
		expect(f.session.ticket().current()).toBe(false);
		const returned = fixture({ a: f.store.get("a") });
		await settle();
		expect(returned.session.read("a")?.mount.value.answer).toBe("OLD ANSWER");
		expect(returned.set).not.toHaveBeenCalled();
	});
	it.each(["read", "admit", "write", "start-over", "retry"])(
		"reentrant replacement during %s cannot borrow successor authority",
		async (phase) => {
			const f = fixture(phase === "retry" ? { a: saved() } : {}, true);
			const successor = fixture();
			const previous = window.__praxityBlockState;
			window.__praxityBlockState = f.provider;
			const replace = () => {
				window.__praxityBlockState = successor.provider;
				f.revoke();
			};
			if (phase === "retry") {
				f.admit.mockRejectedValue(new Error("load"));
				f.session.initialize();
				await settle();
			}
			if (phase === "read")
				vi.mocked(f.provider.get).mockImplementation(() => {
					replace();
					return saved() as never;
				});
			if (phase === "admit" || phase === "retry")
				f.admit.mockImplementation(async () => {
					replace();
					return rules;
				});
			let armed = phase === "write";
			if (phase === "write" || phase === "start-over")
				f.set.mockImplementation(() => {
					if (armed) replace();
				});
			f.session.initialize();
			if (phase !== "read") {
				f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "mine" });
				if (phase === "start-over") armed = true;
				await f.session.dispatch({
					type: phase === "admit" ? "check" : phase === "retry" ? "retry" : "start-over",
					blockId: "a",
				});
			}
			await settle();
			const count = f.set.mock.calls.length;
			f.session.flush();
			f.session.dispatch({ type: "edit-answer", blockId: "b", answer: "late" });
			expect(f.set).toHaveBeenCalledTimes(count);
			expect(successor.set).not.toHaveBeenCalled();
			window.__praxityBlockState = previous;
		},
	);
	it("Retry failure announces once; passive failure and background flush stay silent", async () => {
		const f = fixture({ a: saved() }, true);
		f.admit.mockRejectedValue(new Error("load"));
		f.session.initialize();
		await settle();
		expect(f.session.read("a")?.announcement).toBeNull();
		const seen: string[] = [];
		f.session.subscribe((s) => {
			const key = s.activities[0].announcement;
			if (key) seen.push(key);
		});
		await f.session.dispatch({ type: "retry", blockId: "a" });
		await settle();
		expect(seen.filter((key) => key === "selfCheckUnavailable")).toHaveLength(1);
		f.session.flush();
		expect(f.session.read("a")?.announcement).toBeNull();
	});
});

it("two rated restores settle independently with one Content request each", async () => {
	const f = fixture({ a: saved("A"), b: saved("B") });
	await settle();
	expect(f.admit).toHaveBeenCalledTimes(2);
	expect(f.session.read("a")?.mount.value.answer).toBe("A");
	expect(f.session.read("b")?.mount.value.answer).toBe("B");
	expect(f.set).not.toHaveBeenCalled();
});

it("held rated restore retains explicit empty edits as conflicts without refetching", async () => {
	const f = fixture({ a: saved() }, true);
	const held = deferred<typeof rules>();
	f.admit.mockReturnValue(held.promise);
	f.session.initialize();
	f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "" });
	held.resolve(rules);
	await settle();
	expect(f.admit).toHaveBeenCalledOnce();
	expect(f.session.read("a")?.mount.restoreStatus).toBe("conflict");
	expect(f.session.read("a")?.mount.value.answer).toBe("");
	expect(f.set).not.toHaveBeenCalled();
});

it("the rules interface removes the unused checkAnswer capability", () => {
	expect(rules).not.toHaveProperty("checkAnswer");
});

it("refused saved accessors are never executed while taking session snapshots", async () => {
	const getter = vi.fn(() => "SECRET");
	const old = saved();
	Object.defineProperty(old.value, "answer", { get: getter, enumerable: true });
	const f = fixture({ a: old });
	await settle();
	expect(f.session.read("a")?.mount.restoreStatus).toBe("invalid");
	expect(getter).not.toHaveBeenCalled();
});

it("a deliberate failed device write announces once and background flush stays silent", async () => {
	const f = fixture();
	await settle();
	f.set.mockImplementation(() => {});
	f.provider.getSaveResult.mockReturnValue({ status: "not-saved", code: "storage-unavailable" });
	f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "mine" });
	expect(f.announcements).toEqual(["practiceNotSaved"]);
	f.session.flush();
	expect(f.session.read("a")?.announcement).toBeNull();
	f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "newer" });
	expect(f.session.read("a")?.announcement).toBeNull();
	expect(f.announcements).toEqual(["practiceNotSaved"]);
	f.set.mockImplementation((id, value) => {
		f.store.set(id, value);
	});
	f.provider.getSaveResult.mockReturnValue({ status: "saved", destination: "device" });
	await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "saved" });
	expect(f.session.read("a")?.mount.notSaved).toBe(false);
	f.set.mockImplementation(() => {});
	f.provider.getSaveResult.mockReturnValue({ status: "not-saved", code: "storage-unavailable" });
	await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "failed again" });
	await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "still failed" });
	expect(f.store.get("a")).toMatchObject({ value: { answer: "saved" } });
	expect(f.announcements).toEqual(["practiceNotSaved", "practiceNotSaved"]);
});

it("tickets retained before disposal remain revoked even if the provider is unchanged", () => {
	const f = fixture();
	const pass = f.session.ticket();
	f.session.dispose();
	expect(pass.current()).toBe(false);
	expect(f.session.ticket().current()).toBe(false);
});

it("read failure and failed Retry keep initial write hold; repaired Retry saves a held empty draft", async () => {
	const f = fixture({}, true);
	vi.mocked(f.provider.get).mockImplementation(() => {
		throw new Error("read unavailable");
	});
	f.session.initialize();
	expect(f.session.read("a")?.notice).toBe("selfCheckUnavailable");
	f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "" });
	expect(f.announcements).toEqual(["practiceNotSaved"]);
	await f.session.dispatch({ type: "retry", blockId: "a" });
	expect(f.announcements).toEqual(["practiceNotSaved", "selfCheckUnavailable"]);
	expect(f.announcements.filter((key) => key === "selfCheckUnavailable")).toHaveLength(1);
	expect(f.set).not.toHaveBeenCalled();
	vi.mocked(f.provider.get).mockImplementation(() => undefined);
	await f.session.dispatch({ type: "retry", blockId: "a" });
	await settle();
	expect(f.store.get("a")).toMatchObject({ value: { answer: "" } });
});

it("a cached return replays a held explicit empty input before the new lifetime reads", async () => {
	const f = fixture({ a: saved() }, true);
	const held = deferred<typeof rules>();
	f.admit.mockReturnValue(held.promise);
	f.session.initialize();
	f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "" });
	const retained = f.session.read("a")?.mount.heldEdits ?? [];
	f.revoke();
	f.session.dispose();
	const returned = fixture({ a: f.store.get("a") }, true);
	for (const command of retained) returned.session.dispatch({ ...command, blockId: "a" });
	returned.session.initialize();
	held.resolve(rules);
	await settle();
	expect(returned.session.read("a")?.mount.value.answer).toBe("");
	expect(returned.session.read("a")?.mount.restoreStatus).toBe("conflict");
	expect(returned.session.read("a")?.mount.recovery[0].text).toBe("OLD ANSWER");
	expect(returned.set).not.toHaveBeenCalled();
	expect(f.set).not.toHaveBeenCalled();
});

it("a returned provider's failed-save memory is retained without claiming durability", async () => {
	const provider: LearnerBlockStateRuntime = {
		get: () => saved("UNSAVED", null) as never,
		set: vi.fn(),
		getSaveResult: () => ({ status: "not-saved", code: "storage-unavailable" }),
	};
	const session = createWriteDistractorsSession([{ ...reference, blockId: "a" }], {
		provider,
		current: () => true,
		admit: async () => rules,
	});
	await settle();
	expect(session.read("a")?.mount.value.answer).toBe("UNSAVED");
	expect(session.read("a")?.mount.notSaved).toBe(true);
	expect(session.read("a")?.announcement).toBeNull();
	expect(provider.set).not.toHaveBeenCalled();
});

it("every admission receives a required W06 ticket revoked by Start over", async () => {
	const f = fixture({ a: saved() }, true);
	const held = deferred<typeof rules>();
	f.admit.mockReturnValue(held.promise);
	f.session.initialize();
	const pass = f.admit.mock.calls[0]?.[2];
	expect(pass?.current()).toBe(true);
	f.session.dispatch({ type: "start-over", blockId: "a" });
	expect(pass?.current()).toBe(false);
	const count = f.set.mock.calls.length;
	held.resolve(rules);
	await settle();
	expect(f.set).toHaveBeenCalledTimes(count);
	expect(f.session.read("a")?.mount.value.answer).toBe("");
});

it("cancellation subscribers receive a revoked ticket while observing the cancelled view", () => {
	const f = fixture();
	const tickets: boolean[] = [];
	f.session.subscribe((snapshot, pass) => {
		if (snapshot.activities[0].cancelled) tickets.push(pass.current());
	});
	f.session.dispose();
	expect(tickets).toEqual([false]);
});

it("no device store permits memory-only Check, rating and Compare with one save-failure announcement", async () => {
	const f = fixture({}, true);
	f.set.mockImplementation(() => {});
	f.provider.getSaveResult.mockReturnValue({ status: "not-saved", code: "storage-unavailable" });
	const seen: string[] = [];
	f.session.subscribe((snapshot) => {
		const key = snapshot.activities[0].announcement;
		if (key) seen.push(key);
	});
	f.session.initialize();
	expect(f.session.read("a")?.mount.restoreWriteHold).toBe(false);
	expect(f.session.read("a")?.notice).toBeNull();
	await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "mine" });
	await f.session.dispatch({ type: "check", blockId: "a" });
	expect(f.session.read("a")?.mount.checkedAnswer).toBe(true);
	await f.session.dispatch({ type: "rate", blockId: "a", hadIt: false });
	for (const [index, text] of ["Learner one", "Learner two"].entries()) {
		await f.session.dispatch({ type: "edit-option", blockId: "a", index, field: "text", text });
		await f.session.dispatch({
			type: "edit-option",
			blockId: "a",
			index,
			field: "misconception",
			text: `m${index + 1}`,
		});
	}
	await f.session.dispatch({ type: "compare", blockId: "a" });
	expect(f.session.read("a")?.mount.value).toMatchObject({
		answer: "mine",
		hadIt: false,
		shown: true,
	});
	expect(f.session.read("a")?.mount.notSaved).toBe(true);
	expect(seen.filter((key) => key === "practiceNotSaved")).toHaveLength(1);
	expect(f.set).toHaveBeenCalled();
	expect(f.store.size).toBe(0);
});

it("Start over after a failed initial read explicitly replaces unread saved work when writable", async () => {
	const original = saved();
	const f = fixture({ a: original }, true);
	f.provider.get.mockImplementation(() => {
		throw new Error("read failed");
	});
	f.session.initialize();
	expect(f.session.read("a")?.mount.restoreWriteHold).toBe(true);
	expect(f.store.get("a")).toBe(original);
	await f.session.dispatch({ type: "start-over", blockId: "a" });
	expect(f.session.read("a")?.mount.restoreWriteHold).toBe(false);
	expect(f.session.read("a")?.mount.notSaved).toBe(false);
	expect(f.session.read("a")?.notice).toBeNull();
	expect(f.set).toHaveBeenCalledOnce();
	expect(f.store.get("a")).toEqual({
		version: 1,
		kind: "write-distractors",
		contentRevision: reference.contentRevision,
		value: {
			answer: "",
			hadIt: null,
			shown: false,
			options: [
				{ text: "", misconception: "", custom: "" },
				{ text: "", misconception: "", custom: "" },
			],
		},
	});
});

it("a host-reported transient device read failure holds unread saved bytes through the first edit", async () => {
	const original = saved();
	const f = fixture({ a: original }, true);
	const readFailures = new Set<string>();
	// The private host catches the device read error and reports it via its
	// per-block save result; get itself returns undefined, never throws.
	f.provider.getSaveResult.mockImplementation((id) =>
		readFailures.has(id) ? { status: "not-saved", code: "storage-unavailable" } : undefined,
	);
	f.provider.get.mockImplementation((id) => {
		if (id === "a" && !readFailures.has(id)) {
			readFailures.add(id);
			return undefined;
		}
		return f.store.get(id) as never;
	});
	f.session.initialize();
	await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "memory-only edit" });
	expect(f.session.read("a")?.mount.restoreWriteHold).toBe(true);
	expect(f.session.read("a")?.notice).toBe("selfCheckUnavailable");
	expect(f.session.read("a")?.mount.value.answer).toBe("memory-only edit");
	expect(f.announcements).toEqual(["practiceNotSaved"]);
	await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "later edit" });
	f.session.flush();
	expect(f.announcements).toEqual(["practiceNotSaved"]);
	expect(f.set).not.toHaveBeenCalled();
	expect(f.store.get("a")).toBe(original);
});

it("returning to the saved revision re-admits Content and releases the hold without writes", async () => {
	const old = saved();
	const f = fixture({ a: old });
	await settle();
	f.admit.mockClear();
	await f.session.dispatch({
		type: "revision-change",
		blockId: "a",
		reference: { ...reference, contentRevision: `sha256:${"f".repeat(64)}` },
	});
	await f.session.dispatch({ type: "revision-change", blockId: "a", reference });
	await settle();
	expect(f.admit).toHaveBeenCalledOnce();
	expect(f.session.read("a")?.mount.value).toEqual(old.value);
	expect(f.session.read("a")?.mount.restoreWriteHold).toBe(false);
	expect(f.set).not.toHaveBeenCalled();
});

it("a late sibling admission cannot republish another activity's consumed Retry announcement", async () => {
	const f = fixture({ a: saved("A"), b: saved("B") }, true);
	const held = deferred<typeof rules>();
	f.admit.mockImplementation(async (ref) => {
		if (ref.blockId === "b") return held.promise;
		throw new Error("load failed");
	});
	const seen: string[] = [];
	f.session.subscribe((snapshot) => {
		for (const activity of snapshot.activities)
			if (activity.announcement) seen.push(`${activity.blockId}:${activity.announcement}`);
	});
	f.session.initialize();
	await settle();
	await f.session.dispatch({ type: "retry", blockId: "a" });
	held.resolve(rules);
	await settle();
	expect(f.session.read("b")?.mount.value.answer).toBe("B");
	expect(seen.filter((key) => key === "a:selfCheckUnavailable")).toHaveLength(1);
});

it("the first edit during a hold announces practiceNotSaved once; subsequent edits stay silent", async () => {
	const f = fixture({ a: saved() }, true);
	const held = deferred<typeof rules>();
	f.admit.mockReturnValue(held.promise);
	const seen: string[] = [];
	f.session.subscribe((snapshot) => {
		const key = snapshot.activities[0].announcement;
		if (key) seen.push(key);
	});
	f.session.initialize();
	await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "first" });
	expect(seen).toEqual(["practiceNotSaved"]);
	await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "" });
	expect(seen).toEqual(["practiceNotSaved"]);
	expect(f.session.read("a")?.mount.notSaved).toBe(true);
	expect(f.set).not.toHaveBeenCalled();
});

it.each(["invalid", "out-of-date", "oversized", "pending", "failed", "conflict"])(
	"a preactivation edit stays silent until a later edit of an existing %s envelope",
	async (kind) => {
		const old = saved();
		if (kind === "invalid") old.version = 9;
		if (kind === "out-of-date") old.contentRevision = `sha256:${"f".repeat(64)}`;
		if (kind === "oversized") old.value.answer = "x".repeat(2001);
		if (kind === "conflict") old.value.hadIt = null;
		const f = fixture({ a: old }, true);
		const held = deferred<typeof rules>();
		if (kind === "pending") f.admit.mockReturnValue(held.promise);
		if (kind === "failed") f.admit.mockRejectedValue(new Error("asset unavailable"));
		await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "before read" });
		expect(f.announcements).toEqual([]);
		f.session.initialize();
		await settle();
		expect(f.announcements).toEqual([]);
		if (kind === "conflict") expect(f.session.read("a")?.mount.restoreStatus).toBe("conflict");
		const recovery = f.session.read("a")?.mount.recovery;
		const notice = f.session.read("a")?.notice;
		expect(recovery).toContainEqual({ path: "value.answer", text: old.value.answer });
		await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "first held edit" });
		expect(f.announcements).toEqual(["practiceNotSaved"]);
		await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "" });
		f.session.flush();
		expect(f.announcements).toEqual(["practiceNotSaved"]);
		expect(f.session.read("a")?.mount.restoreWriteHold).toBe(true);
		expect(f.session.read("a")?.mount.recovery).toEqual(recovery);
		expect(f.session.read("a")?.notice).toBe(notice);
		expect(f.set).not.toHaveBeenCalled();
		expect(f.store.get("a")).toBe(old);
		f.session.dispose();
		held.resolve(rules);
		await settle();
	},
);

it("uncertain storage re-reads newer bytes even after an earlier confirmed saved revision", async () => {
	const f = fixture();
	await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "confirmed" });
	f.provider.getSaveResult.mockReturnValue(undefined);
	await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "newer without receipt" });
	await f.session.dispatch({
		type: "revision-change",
		blockId: "a",
		reference: { ...reference, contentRevision: `sha256:${"f".repeat(64)}` },
	});
	expect(f.session.read("a")?.notice).toBe("selfCheckUnavailable");
	expect(f.session.read("a")?.mount.recovery[0].text).toBe("confirmed");
	const before = f.provider.get.mock.calls.length;
	await f.session.dispatch({ type: "retry", blockId: "a" });
	expect(f.provider.get).toHaveBeenCalledTimes(before + 1);
	expect(f.session.read("a")?.mount.recovery[0].text).toBe("newer without receipt");
	expect(f.session.read("a")?.mount.localRecovery[0].text).toBe("newer without receipt");
});

it("disposal inside a failed provider read cannot mutate the cancelled view", () => {
	const f = fixture({}, true);
	f.provider.get.mockImplementation(() => {
		f.session.dispose();
		throw new Error("read failed after disposal");
	});
	f.session.initialize();
	expect(f.session.read("a")?.cancelled).toBe(true);
	expect(f.session.read("a")?.notice).toBeNull();
	expect(f.set).not.toHaveBeenCalled();
});

it("a live captured provider cannot redirect its writes to a successor global provider", async () => {
	const f = fixture();
	const successor = fixture();
	const previous = window.__praxityBlockState;
	try {
		window.__praxityBlockState = successor.provider;
		await f.session.dispatch({ type: "edit-answer", blockId: "a", answer: "captured only" });
		expect(f.store.get("a")).toMatchObject({ value: { answer: "captured only" } });
		expect(successor.set).not.toHaveBeenCalled();
	} finally {
		window.__praxityBlockState = previous;
	}
});
