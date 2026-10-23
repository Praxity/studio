import {
	type CourseContextInput,
	compilePage,
	createCourseContext,
} from "@praxity/export-pipeline";
import { readLesson } from "@praxity/grammar";
import { isCoursePreviewCommand } from "@praxity/shared-blocks/course-preview-protocol";
import { afterEach, expect, it, vi } from "vitest";
import { PreviewScheduler, type PreviewSchedulerEvent } from "../studio/preview-scheduler";

const input = (seq = 0, text = "Before") =>
	({
		id: "course",
		title: "Course",
		sourceLocale: "en",
		seq,
		content: [
			{
				id: "page",
				title: "Page",
				blocks: [{ id: "node", type: "text", data: { content: text } }],
			},
		],
	}) satisfies CourseContextInput;
afterEach(() => vi.useRealTimers());

it("rejects navigation to an unknown page", async () => {
	const scheduler = new PreviewScheduler(await createCourseContext(input()), () => {});
	expect(() => scheduler.selectPage("absent")).toThrow("Unknown preview page");
	scheduler.close();
});

it("refreshing a cross-page dependency produces the same page as a fresh context", async () => {
	vi.useFakeTimers();
	let id = 0;
	const reader = {
		...readLesson("# Reader\n\nHello {{name}}\n", { ids: () => `reader-${id++}` }).pages[0],
		id: "page",
	};
	const model = (seq: number, value: string): CourseContextInput => ({
		...input(seq),
		content: [
			{
				id: "definition",
				title: "Definition",
				blocks: [
					{
						id: "var",
						type: "variable",
						data: { variableName: "name", dataType: "text", defaultValue: value },
					},
				],
			},
			reader,
		],
	});
	const scheduler = new PreviewScheduler(await createCourseContext(model(0, "Alice")), () => {});
	scheduler.selectPage("page");
	await vi.runAllTimersAsync();
	const next = model(1, "Bob");
	await scheduler.refresh(next, { lessons: ["definition"] }, false);
	await vi.runAllTimersAsync();
	expect(scheduler.lastGood("page")?.html).toBe(
		compilePage(await createCourseContext(next), "page").html,
	);
	expect(scheduler.lastGood("page")?.html).toContain('data-fallback="Bob">Bob');
	scheduler.close();
});

it("renders every touched page below the eight-node limit", async () => {
	vi.useFakeTimers();
	const multiple = (seq: number, text: string): CourseContextInput => ({
		...input(seq, text),
		content: [
			input(seq, text).content[0],
			{
				id: "second",
				title: "Second",
				blocks: [{ id: "other", type: "text", data: { content: text } }],
			},
		],
	});
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = new PreviewScheduler(
		await createCourseContext(multiple(0, "Before")),
		(event) => events.push(event),
	);
	expect(await scheduler.refresh(multiple(1, "After"), {}, true)).toMatchObject({
		pageId: "page",
		seq: 1,
	});
	expect(
		events.filter((event) => event.type === "nodesRendered").map((event) => event.render.pageId),
	).toEqual(["page", "second"]);
	await vi.runAllTimersAsync();
	expect(
		events
			.filter((event) => event.type === "pageCompiled")
			.every((event) => event.patch.fragments.length === 0),
	).toBe(true);
	scheduler.close();
});

it("navigation replays compiler diagnostics before any good output exists", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = new PreviewScheduler(
		await createCourseContext(input()),
		(event) => events.push(event),
		{
			compile: () => {
				throw new Error("Compile broke");
			},
		},
	);
	scheduler.selectPage("page");
	await vi.runAllTimersAsync();
	events.length = 0;
	scheduler.selectPage("page");
	expect(events).toMatchObject([
		{ type: "compileFailed", pageId: "page", diagnostics: [{ message: "Compile broke" }] },
	]);
	scheduler.close();
});

it("navigation replays complete current fragments without another compile", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = new PreviewScheduler(await createCourseContext(input()), (event) =>
		events.push(event),
	);
	scheduler.selectPage("page");
	await vi.runAllTimersAsync();
	const event = events[0];
	if (event?.type !== "pageCompiled") throw new Error("Missing page output");
	const identity = {
		channel: "a".repeat(32),
		courseId: "course",
		revision: "revision",
		pageId: "page",
	};
	expect(
		isCoursePreviewCommand(
			{ source: "praxity-studio", version: 1, ...identity, action: "patch", ...event.patch },
			identity,
		),
	).toBe(false);
	const count = scheduler.stats().compiles;
	scheduler.selectPage("page");
	expect(events).toHaveLength(2);
	expect(events.at(-1)).toMatchObject({
		type: "pageCompiled",
		patch: { fragments: [{ id: "node", html: expect.stringContaining("Before") }] },
	});
	expect(scheduler.stats().compiles).toBe(count);
	scheduler.close();
});

it("optimistic payload mutation cannot change the next compile's comparison baseline", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = new PreviewScheduler(await createCourseContext(input()), (event) =>
		events.push(event),
	);
	const render = await scheduler.refresh(input(1, "After"), {}, true);
	if (!render?.fragments[0]) throw new Error("Missing render");
	render.fragments[0].html = "Mutated client payload";
	await vi.runAllTimersAsync();
	expect(events.at(-1)).toMatchObject({ type: "pageCompiled", patch: { fragments: [] } });
	scheduler.close();
});

it("T2 omits optimistic rendering above eight touched nodes", async () => {
	vi.useFakeTimers();
	const base = input();
	const many = (seq: number, content: string): CourseContextInput => ({
		...base,
		seq,
		content: [
			{
				id: "page",
				title: "Page",
				blocks: Array.from({ length: 9 }, (_, index) => ({
					id: `node-${index}`,
					type: "text" as const,
					data: { content },
				})),
			},
		],
	});
	const scheduler = new PreviewScheduler(await createCourseContext(many(0, "Before")), () => {});
	expect(await scheduler.refresh(many(1, "After"), {}, true)).toBeUndefined();
	await vi.runAllTimersAsync();
	expect(scheduler.lastGood("page")?.fragments.size).toBe(9);
	scheduler.close();
});

it("T2 returns real node HTML and suppresses its duplicate in the compile patch", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = new PreviewScheduler(
		await createCourseContext(input()),
		events.push.bind(events),
	);
	scheduler.selectPage("page");
	await vi.runAllTimersAsync();
	const render = await scheduler.refresh(input(1, "After"), {}, true);
	expect(render).toMatchObject({
		seq: 1,
		pageId: "page",
		fragments: [{ id: "node", html: expect.stringContaining("After") }],
	});
	await vi.runAllTimersAsync();
	expect(events.at(-1)).toMatchObject({
		type: "pageCompiled",
		// A paragraph changes only the shell's inert config JSON, which the digest leaves out.
		patch: { seq: 1, fragments: [], shellStale: false },
	});
	scheduler.close();
});

it("a newly selected frame receives fragments an earlier frame of its page already had", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = new PreviewScheduler(
		await createCourseContext(input()),
		events.push.bind(events),
	);
	scheduler.selectPage("page");
	await vi.runAllTimersAsync();
	// The shown frame receives the optimistic node; a remounted frame of the page did not.
	await scheduler.refresh(input(1, "After"), {}, true);
	scheduler.selectPage("page");
	await vi.runAllTimersAsync();
	expect(events.at(-1)).toMatchObject({
		type: "pageCompiled",
		patch: { seq: 1, fragments: [{ id: "node", html: expect.stringContaining("After") }] },
	});
	scheduler.close();
});

it("reports a changed page list, but not a content-only refresh", async () => {
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = new PreviewScheduler(await createCourseContext(input()), (event) =>
		events.push(event),
	);
	await scheduler.refresh(input(1, "After"), {}, false);
	expect(events.filter((event) => event.type === "pagesChanged")).toEqual([]);
	const renamed = input(2, "After");
	await scheduler.refresh(
		{ ...renamed, content: [{ ...renamed.content[0], id: "replaced" }] },
		{},
		false,
	);
	expect(events.filter((event) => event.type === "pagesChanged")).toEqual([
		{ type: "pagesChanged", pageIds: ["replaced"] },
	]);
	scheduler.close();
});

it("reports an actual shell change without recompiling hidden page bodies", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	const compiler = vi.fn(compilePage);
	const scheduler = new PreviewScheduler(
		await createCourseContext(input()),
		(event) => events.push(event),
		{ compile: compiler },
	);
	scheduler.selectPage("page");
	await vi.runAllTimersAsync();
	await scheduler.refresh({ ...input(1), title: "Renamed course" }, { manifest: true }, false);
	await vi.runAllTimersAsync();
	expect(events.at(-1)).toMatchObject({ type: "pageCompiled", patch: { shellStale: true } });
	expect(scheduler.lastGood("page")?.html).toBe(
		compilePage(await createCourseContext({ ...input(1), title: "Renamed course" }), "page").html,
	);
	expect(compiler).toHaveBeenCalledTimes(2);
	scheduler.close();
});

it("discards a compile that completes after optimistic seq 4", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	let resolve: ((value: ReturnType<typeof compilePage>) => void) | undefined;
	const scheduler = new PreviewScheduler(
		await createCourseContext(input(3)),
		events.push.bind(events),
		{
			compile: (context, pageId) =>
				new Promise((done) => {
					resolve = () => done(compilePage(context, pageId));
				}),
		},
	);
	scheduler.selectPage("page");
	await vi.advanceTimersByTimeAsync(0);
	await scheduler.refresh(input(4, "Newest"), {}, true);
	if (!resolve) throw new Error("Compile did not start");
	resolve(compilePage(scheduler.context(), "page"));
	await Promise.resolve();
	await Promise.resolve();
	expect(events.filter((event) => event.type === "pageCompiled")).toEqual([]);
	expect(scheduler.stats().discarded).toBe(1);
	scheduler.close();
});

it("outside refresh compiles the visible page; a parse failure keeps its last good output", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = new PreviewScheduler(
		await createCourseContext(input()),
		events.push.bind(events),
	);
	scheduler.selectPage("page");
	await vi.runAllTimersAsync();
	await scheduler.refresh(input(1, "Outside"), {}, false);
	await vi.runAllTimersAsync();
	expect(events.at(-1)).toMatchObject({
		type: "pageCompiled",
		patch: { seq: 1, fragments: [{ html: expect.stringContaining("Outside") }] },
	});
	const lastGood = scheduler.lastGood("page");
	scheduler.fail(2, [{ message: "Unclosed block", line: 3 }]);
	expect(events.at(-1)).toMatchObject({
		type: "compileFailed",
		seq: 2,
		pageId: "page",
		diagnostics: [{ message: "Unclosed block", line: 3 }],
	});
	expect(scheduler.lastGood("page")).toBe(lastGood);
	await scheduler.refresh(input(3, "Recovered"), {}, false);
	await vi.runAllTimersAsync();
	expect(events.at(-1)).toMatchObject({ type: "pageCompiled", patch: { seq: 3 } });
	scheduler.close();
});

it("navigation after a parse failure replays the last good page and its diagnostics", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = new PreviewScheduler(await createCourseContext(input()), (event) =>
		events.push(event),
	);
	scheduler.selectPage("page");
	await vi.runAllTimersAsync();
	scheduler.fail(1, [{ message: "Unclosed block", line: 3 }]);
	await vi.runAllTimersAsync();
	events.length = 0;
	scheduler.selectPage("page");
	expect(events.map((event) => event.type)).toEqual(["pageCompiled", "compileFailed"]);
	scheduler.close();
});

it("reports compiler exceptions and releases the queue for the next revision", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	let broken = true;
	const scheduler = new PreviewScheduler(
		await createCourseContext(input()),
		events.push.bind(events),
		{
			compile: (context, pageId) => {
				if (broken) throw new Error("Compile broke");
				return compilePage(context, pageId);
			},
		},
	);
	scheduler.selectPage("page");
	await vi.runAllTimersAsync();
	expect(events.at(-1)).toMatchObject({
		type: "compileFailed",
		diagnostics: [{ message: "Compile broke" }],
	});
	broken = false;
	await scheduler.refresh(input(1, "Fixed"), {}, false);
	await vi.runAllTimersAsync();
	expect(events.at(-1)?.type).toBe("pageCompiled");
	scheduler.close();
});
