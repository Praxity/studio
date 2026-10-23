import { compilePage, createCourseContext } from "@praxity/export-pipeline";
import { readLesson } from "@praxity/grammar";
import { afterEach, expect, it, vi } from "vitest";
import {
	type PreviewDraftIdentity,
	PreviewScheduler,
	type PreviewSchedulerEvent,
} from "../studio/preview-scheduler";

const input = (seq = 0, text = "Saved.") => ({
	id: "course",
	title: "Course",
	sourceLocale: "en",
	seq,
	content: [
		{
			id: "page",
			title: "Page",
			blocks: [{ id: "node", type: "text" as const, data: { content: text } }],
		},
	],
});
const request = (seq = 1, source = "Draft.", transactionId = `edit-${seq}`) => ({
	pageId: "page",
	nodeId: "node",
	seq,
	source,
	transactionId,
});
afterEach(() => vi.useRealTimers());

it("five draft settlements within 100 ms retain the two-compile burst bound", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = await PreviewScheduler.create(input(), (event) => events.push(event));
	try {
		for (let seq = 1; seq <= 5; seq++) {
			scheduler.renderDraft(request(seq, `Draft ${seq}.`));
			await scheduler.refresh(input(seq, `Saved ${seq}.`), {}, false);
			await vi.advanceTimersByTimeAsync(0);
			scheduler.settleDraft(`edit-${seq}`, false);
			await vi.advanceTimersByTimeAsync(10);
		}
		await vi.runAllTimersAsync();
		expect(scheduler.stats().compiles).toBeLessThanOrEqual(2);
		expect(events.at(-1)).toMatchObject({ type: "pageCompiled", patch: { seq: 5 } });
	} finally {
		scheduler.close();
	}
});

const siblingInput = (seq = 0, a = "Saved A.", b = "Saved B.") => ({
	...input(seq),
	content: [
		{
			id: "page",
			title: "Page",
			blocks: [
				{ id: "a", type: "text" as const, data: { content: a } },
				{ id: "b", type: "text" as const, data: { content: b } },
			],
		},
	],
});

it("reusing a pending transaction for another node refuses without losing its settlement", async () => {
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = await PreviewScheduler.create(siblingInput(), (event) => events.push(event));
	try {
		expect(scheduler.renderDraft({ ...request(), nodeId: "a" })).toMatchObject({ ok: true });
		expect(scheduler.renderDraft({ ...request(2, "Other.", "edit-1"), nodeId: "b" })).toMatchObject(
			{ ok: false, code: "stale" },
		);
		scheduler.settleDraft("edit-1", false);
		expect(events).toMatchObject([
			{ render: { state: "draft", fragments: [{ id: "a" }] } },
			{ render: { state: "reverted", fragments: [{ id: "a" }] } },
		]);
	} finally {
		scheduler.close();
	}
});

it("removing a drafted page still settles its transaction with no obsolete fragment", async () => {
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = await PreviewScheduler.create(input(), (event) => events.push(event));
	try {
		scheduler.renderDraft(request());
		await scheduler.refresh(
			{ ...input(1), content: [{ ...input(1).content[0], id: "replacement" }] },
			{},
			false,
		);
		scheduler.settleDraft("edit-1", false);
		scheduler.settleDraft("edit-1", false);
		expect(events).toMatchObject([
			{ render: { state: "draft" } },
			{ type: "pagesChanged", pageIds: ["replacement"] },
			{ render: { transactionId: "edit-1", state: "reverted", fragments: [] } },
		]);
	} finally {
		scheduler.close();
	}
});

it("an outside layout-region replacement settles without poisoning the valid page compile", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = await PreviewScheduler.create(siblingInput(), (event) => events.push(event));
	try {
		scheduler.renderDraft({ ...request(), nodeId: "a" });
		const next = {
			...input(1),
			content: [
				{
					id: "page",
					title: "Page",
					blocks: [
						{ id: "b", type: "text" as const, data: { content: "Outside B." } },
						{ id: "a", type: "blockBreak" as const, data: { close: "float" } },
					],
				},
			],
		};
		await scheduler.refresh(next, {}, false);
		await vi.runAllTimersAsync();
		scheduler.settleDraft("edit-1", false);
		expect(events.at(-1)).toMatchObject({ render: { state: "reverted", fragments: [] } });
		await vi.runAllTimersAsync();
		expect(events.filter((event) => event.type === "compileFailed")).toEqual([]);
		expect(events.at(-1)).toMatchObject({ type: "pageCompiled", patch: { seq: 1 } });
		expect(scheduler.lastGood("page")?.html).toContain("Outside B.");
	} finally {
		scheduler.close();
	}
});

it("closing the scheduler ends every pending draft exactly once", async () => {
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = await PreviewScheduler.create(siblingInput(), (event) => events.push(event));
	scheduler.renderDraft({ ...request(), nodeId: "a" });
	scheduler.renderDraft({ ...request(2), nodeId: "b" });
	scheduler.close();
	scheduler.close();
	expect(
		events.filter((event) => event.type === "draftRendered" && event.render.state === "reverted"),
	).toMatchObject([
		{ render: { transactionId: "edit-1", fragments: [{ id: "a" }] } },
		{ render: { transactionId: "edit-2", fragments: [{ id: "b" }] } },
	]);
});

it.each([false, true])(
	"settlement retries a page compile suppressed by a pending draft, committed=%s",
	async (committed) => {
		vi.useFakeTimers();
		const events: PreviewSchedulerEvent[] = [];
		const scheduler = await PreviewScheduler.create(siblingInput(), (event) => events.push(event));
		try {
			scheduler.selectPage("page");
			await vi.runAllTimersAsync();
			expect(scheduler.renderDraft({ ...request(), nodeId: "a" })).toMatchObject({ ok: true });
			await scheduler.refresh(siblingInput(1, "Outside A.", "Outside B."), {}, false);
			await vi.runAllTimersAsync();
			expect(events.filter((event) => event.type === "pageCompiled")).toHaveLength(1);
			const count = scheduler.stats().compiles;
			scheduler.settleDraft("edit-1", committed);
			if (!committed)
				expect(events.at(-1)).toMatchObject({
					type: "draftRendered",
					render: {
						state: "reverted",
						fragments: [{ id: "a", html: expect.stringContaining("Outside A.") }],
					},
				});
			await vi.runAllTimersAsync();
			expect(events.at(-1)).toMatchObject({
				type: "pageCompiled",
				patch: {
					seq: 1,
					fragments: expect.arrayContaining([
						{ id: "b", html: expect.stringContaining("Outside B.") },
					]),
				},
			});
			expect(scheduler.stats().compiles).toBe(count + 1);
			expect(scheduler.lastGood("page")?.html).toContain("Outside A.");
		} finally {
			scheduler.close();
		}
	},
);

it.each([false, true])(
	"each node's draft settles exactly once after a newer sibling draft, committed=%s",
	async (committed) => {
		const events: PreviewSchedulerEvent[] = [];
		const scheduler = await PreviewScheduler.create(siblingInput(), (event) => events.push(event));
		try {
			expect(scheduler.renderDraft({ ...request(1, "Draft A."), nodeId: "a" })).toMatchObject({
				ok: true,
			});
			expect(scheduler.renderDraft({ ...request(2, "Draft B."), nodeId: "b" })).toMatchObject({
				ok: true,
			});
			scheduler.renderCommitted(1, siblingInput().content, siblingInput(1, "Committed A.").content);
			scheduler.settleDraft("edit-1", committed);
			scheduler.settleDraft("edit-1", committed);
			scheduler.settleDraft("edit-2", false);
			scheduler.settleDraft("edit-2", false);
			const settlements = events.filter(
				(event) => event.type === "draftRendered" && event.render.state !== "draft",
			);
			expect(settlements).toMatchObject([
				{
					render: {
						transactionId: "edit-1",
						state: committed ? "saved" : "reverted",
						fragments: [{ id: "a", html: expect.stringContaining("Committed A.") }],
					},
				},
				{
					render: {
						transactionId: "edit-2",
						state: "reverted",
						fragments: [{ id: "b", html: expect.stringContaining("Saved B.") }],
					},
				},
			]);
		} finally {
			scheduler.close();
		}
	},
);

it("an older draft on the same node receives its own settlement without ending the newer draft", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = await PreviewScheduler.create(input(), (event) => events.push(event));
	try {
		scheduler.renderDraft(request(1, "First."));
		scheduler.renderDraft(request(2, "Second."));
		await scheduler.refresh(input(1, "Outside."), {}, false);
		await vi.runAllTimersAsync();
		scheduler.settleDraft("edit-1", false);
		await vi.runAllTimersAsync();
		expect(events.at(-1)).toMatchObject({
			type: "draftRendered",
			render: { transactionId: "edit-1", state: "reverted" },
		});
		expect(events.filter((event) => event.type === "pageCompiled")).toEqual([]);
		scheduler.settleDraft("edit-2", false);
		await vi.runAllTimersAsync();
		expect(events.at(-1)).toMatchObject({ type: "pageCompiled", patch: { seq: 1 } });
	} finally {
		scheduler.close();
	}
});

it("draft render parses one node, returns real HTML and leaves admitted context unchanged", async () => {
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = await PreviewScheduler.create(input(), (e) => events.push(e));
	try {
		const result = scheduler.renderDraft(request());
		expect(result).toMatchObject({
			ok: true,
			render: {
				seq: 1,
				pageId: "page",
				transactionId: "edit-1",
				state: "draft",
				fragments: [{ id: "node", html: expect.stringContaining("Draft.") }],
			},
		});
		expect(events.at(-1)).toMatchObject({ type: "draftRendered", render: { state: "draft" } });
		expect(compilePage(scheduler.context(), "page").html).toContain("Saved.");
		expect(scheduler.context().seq).toBe(0);
	} finally {
		scheduler.close();
	}
});

it("older page draft sequences and reused sequences cannot overwrite a newer render", async () => {
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = await PreviewScheduler.create(input(), (e) => events.push(e));
	try {
		expect(scheduler.renderDraft(request(4, "Newest."))).toMatchObject({ ok: true });
		for (const seq of [3, 4])
			expect(scheduler.renderDraft(request(seq, "Stale."))).toMatchObject({
				ok: false,
				code: "stale",
			});
		expect(events).toHaveLength(1);
		scheduler.settleDraft("edit-3", false);
		expect(events).toHaveLength(1);
		scheduler.settleDraft("edit-4", false);
		expect(events.at(-1)).toMatchObject({
			type: "draftRendered",
			render: {
				seq: 4,
				state: "reverted",
				fragments: [{ html: expect.stringContaining("Saved.") }],
			},
		});
	} finally {
		scheduler.close();
	}
});

it.each(["::: note Broken\nUnclosed", "First.\n\nSecond.", "# Another page\n\nBody."])(
	"refuses a malformed or escaping single-node draft: %s",
	async (source) => {
		const events: PreviewSchedulerEvent[] = [];
		const scheduler = await PreviewScheduler.create(input(), (e) => events.push(e));
		try {
			expect(scheduler.renderDraft(request(1, source))).toMatchObject({ ok: false });
			expect(events).toEqual([]);
		} finally {
			scheduler.close();
		}
	},
);

it("a page absent from the latest admitted input cannot fall back to the old context", async () => {
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = await PreviewScheduler.create(input(), (e) => events.push(e));
	try {
		expect(scheduler.renderDraft(request(), null)).toMatchObject({ ok: false, code: "orphaned" });
		expect(events).toEqual([]);
	} finally {
		scheduler.close();
	}
});

it("an in-flight saved compile never replaces an unsettled draft", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	let finish: (() => void) | undefined;
	const scheduler = new PreviewScheduler(
		await createCourseContext(input()),
		(e) => events.push(e),
		{
			compile: (context, id) =>
				new Promise((done) => {
					finish = () => done(compilePage(context, id));
				}),
		},
	);
	try {
		scheduler.selectPage("page");
		await vi.advanceTimersByTimeAsync(0);
		scheduler.renderDraft(request());
		if (!finish) throw Error("Compile not started");
		finish();
		await Promise.resolve();
		await Promise.resolve();
		expect(events.filter((e) => e.type === "pageCompiled")).toEqual([]);
		scheduler.settleDraft("edit-1", false);
		expect(events.at(-1)).toMatchObject({ type: "draftRendered", render: { state: "reverted" } });
	} finally {
		scheduler.close();
	}
});

it("queued refresh is off the response path, coalesces input work and keeps latest context", async () => {
	vi.useFakeTimers();
	const scheduler = await PreviewScheduler.create(input(), () => {});
	const first = vi.fn(async () => input(1, "Old."));
	const latest = vi.fn(async () => input(2, "Latest."));
	try {
		scheduler.enqueueRefresh(1, async () => {
			await scheduler.refresh(await first(), {}, false);
		});
		scheduler.enqueueRefresh(2, async () => {
			await scheduler.refresh(await latest(), {}, false);
		});
		expect(first).not.toHaveBeenCalled();
		expect(latest).not.toHaveBeenCalled();
		await vi.runAllTimersAsync();
		expect(first).not.toHaveBeenCalled();
		expect(latest).toHaveBeenCalledOnce();
		expect(scheduler.lastGood("page")?.html).toContain("Latest.");
	} finally {
		scheduler.close();
	}
});

it("queued refresh failures report diagnostics and a later valid revision compiles", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = await PreviewScheduler.create(input(), (e) => events.push(e));
	try {
		scheduler.enqueueRefresh(1, async () => {
			throw Error("Input failed");
		});
		await vi.runAllTimersAsync();
		expect(events.at(-1)).toMatchObject({
			type: "compileFailed",
			diagnostics: [{ message: "Input failed" }],
		});
		scheduler.enqueueRefresh(2, async () => {
			await scheduler.refresh(input(2, "Recovered."), {}, false);
		});
		await vi.runAllTimersAsync();
		expect(scheduler.lastGood("page")?.html).toContain("Recovered.");
	} finally {
		scheduler.close();
	}
});

it("an older queued request cannot replace the latest refresh after it starts", async () => {
	vi.useFakeTimers();
	const scheduler = await PreviewScheduler.create(input(), () => {});
	let release: (() => void) | undefined;
	const stale = vi.fn(async () => {
		throw Error("Stale input must not run");
	});
	try {
		scheduler.enqueueRefresh(2, async () => {
			await new Promise<void>((done) => {
				release = done;
			});
			await scheduler.refresh(input(2, "Latest."), {}, false);
		});
		await vi.advanceTimersByTimeAsync(0);
		scheduler.enqueueRefresh(1, stale);
		if (!release) throw Error("Refresh not started");
		release();
		await vi.runAllTimersAsync();
		expect(stale).not.toHaveBeenCalled();
		expect(scheduler.lastGood("page")?.html).toContain("Latest.");
	} finally {
		scheduler.close();
	}
});

it("a newer queued refresh fences both an in-flight older context and older diagnostics", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = await PreviewScheduler.create(input(), (e) => events.push(e));
	let release: (() => void) | undefined;
	try {
		scheduler.enqueueRefresh(1, async () => {
			await new Promise<void>((done) => {
				release = done;
			});
			await scheduler.refresh(input(1, "Obsolete."), {}, false);
			scheduler.fail(1, [{ message: "Obsolete diagnostic" }]);
		});
		await vi.advanceTimersByTimeAsync(0);
		scheduler.enqueueRefresh(2, async () => {
			await scheduler.refresh(input(2, "Newest."), {}, false);
		});
		if (!release) throw Error("Refresh not started");
		release();
		await vi.runAllTimersAsync();
		expect(events.filter((e) => e.type === "compileFailed")).toEqual([]);
		expect(events.filter((e) => e.type === "pageCompiled")).toMatchObject([{ patch: { seq: 2 } }]);
		expect(scheduler.lastGood("page")?.html).toContain("Newest.");
	} finally {
		scheduler.close();
	}
});

it("close cancels queued input work and refuses later draft requests", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = await PreviewScheduler.create(input(), (e) => events.push(e));
	const work = vi.fn(async () => {
		await scheduler.refresh(input(1), {}, false);
	});
	scheduler.enqueueRefresh(1, work);
	scheduler.close();
	await vi.runAllTimersAsync();
	expect(work).not.toHaveBeenCalled();
	expect(scheduler.renderDraft(request())).toMatchObject({ ok: false, code: "not-allowed" });
	expect(events).toEqual([]);
});

it("a large accepted operation never restores the pre-gesture saved fragment", async () => {
	const content = (text: string) => [
		{
			id: "page",
			title: "Page",
			blocks: Array.from({ length: 9 }, (_, i) => ({
				id: `node-${i}`,
				type: "text" as const,
				data: { content: text },
			})),
		},
	];
	const before = content("Saved.");
	const after = content("Committed.");
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = await PreviewScheduler.create({ ...input(), content: before }, (e) =>
		events.push(e),
	);
	try {
		scheduler.renderDraft({ ...request(1, "Committed."), nodeId: "node-0" });
		expect(scheduler.renderCommitted(1, before, after)).toBeUndefined();
		scheduler.settleDraft("edit-1", true);
		expect(events.at(-1)).toMatchObject({
			type: "draftRendered",
			render: { state: "saved", fragments: [] },
		});
	} finally {
		scheduler.close();
	}
});

function practiceDraft(initialNode = "::: text {name=t}\nSaved.\n:::\n") {
	const prefix = "---\nvariables:\n  picked: false\n---\n# Page\n\n";
	const source = `${prefix}${initialNode}# Other\n::: choice Q {private name=priv}\n(x) Yes\n( ) No\n:::\n`;
	const admitted: PreviewDraftIdentity = {
		admission: {
			lessons: new Map([["lesson.prax", readLesson(source)]]),
			identity: {
				sourceMappings: [
					{
						id: "node",
						file: "lesson.prax",
						span: { start: prefix.length, end: prefix.length + initialNode.length },
					},
				],
			},
		} as unknown as PreviewDraftIdentity["admission"],
		files: [{ path: "lesson.prax", source }],
	};
	return { admitted, offset: prefix.length };
}

it("draft admission swaps the old violation for a repair and returns real source coordinates", async () => {
	const { admitted, offset } = practiceDraft(
		'::: text {visible="@priv.isCompleted is true"}\nSaved.\n:::\n',
	);
	const scheduler = await PreviewScheduler.create(input(), () => {});
	try {
		expect(scheduler.renderDraft(request(1, "Repaired."), undefined, admitted)).toMatchObject({
			ok: true,
			render: { fragments: [{ html: expect.stringContaining("Repaired.") }] },
		});
		const refused = scheduler.renderDraft(
			request(2, "::: choice Q {private required}\n(x) Yes\n( ) No\n:::\n"),
			undefined,
			admitted,
		);
		expect(refused).toMatchObject({
			ok: false,
			diagnostics: [
				expect.objectContaining({
					code: "private-choice-practice-only",
					file: "lesson.prax",
					line: 7,
					column: 1,
					span: { start: offset, end: expect.any(Number) },
					messageRef: {
						key: "grammar.v4.private-choice-practice-only",
						args: { line: 7, column: 1 },
					},
				}),
			],
		});
		expect(JSON.stringify(refused)).not.toMatch(/Yes|No/);
	} finally {
		scheduler.close();
	}
});

it.each([
	['::: text {visible="@priv.isCompleted is true"}\nDraft.\n:::\n', "visible=", 7, 11],
	["::: rule\nif: picked is true\nthen: require @priv\n:::\n", "then:", 9, 1],
] as const)(
	"draft admission retains private choices on another page of the same lesson: %s",
	async (source, operand, line, column) => {
		const { admitted, offset } = practiceDraft();
		const events: PreviewSchedulerEvent[] = [];
		const scheduler = await PreviewScheduler.create(input(), (event) => events.push(event));
		try {
			expect(scheduler.renderDraft(request(1, source), undefined, admitted)).toMatchObject({
				ok: false,
				diagnostics: [
					expect.objectContaining({
						code: "practice-no-tracking",
						file: "lesson.prax",
						line,
						column,
						span: { start: offset + source.indexOf(operand), end: expect.any(Number) },
						messageRef: { key: "grammar.v4.practice-no-tracking", args: { line, column } },
					}),
				],
			});
			expect(events).toEqual([]);
		} finally {
			scheduler.close();
		}
	},
);

it("compiled scheduler failures retain their code and localization reference", async () => {
	const { PracticeAdmissionError } = await import("@praxity/export-pipeline");
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = await PreviewScheduler.create(input(), (event) => events.push(event), {
		compile: () => {
			throw new PracticeAdmissionError("practice-no-tracking", "node", "data.actions", "fr");
		},
	});
	try {
		scheduler.selectPage("page");
		await vi.waitFor(() =>
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "compileFailed",
					diagnostics: [
						{
							message: expect.any(String),
							code: "practice-no-tracking",
							messageRef: { key: "grammar.v4.practice-no-tracking", args: {} },
						},
					],
				}),
			),
		);
	} finally {
		scheduler.close();
	}
});
