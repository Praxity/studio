import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CompileQueue,
	type CourseContextInput,
	type CourseExportInput,
	compilePage,
	createCourseContext,
} from "@praxity/export-pipeline";
import { readLesson } from "@praxity/grammar";
import { afterEach, expect, it, vi } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { resolveLessonSources } from "../lesson-source";
import { PreviewScheduler, type PreviewSchedulerEvent } from "../studio/preview-scheduler";
import { createStudioProjectSession, type StudioEvent } from "../studio/project-session";

const roots: string[] = [];
const sessions: Awaited<ReturnType<typeof createStudioProjectSession>>[] = [];
afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(sessions.splice(0).map((s) => s.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const model = (seq: number): CourseExportInput & { seq: number } => ({
	id: "course",
	title: "Course",
	sourceLocale: "en",
	seq,
	content: [
		{
			id: "page",
			title: "Page",
			blocks: [{ id: "text", type: "text", data: { content: "Before" } }],
		},
	],
});

it("review: continuous edits must not starve trailing compile", () => {
	let now = 0;
	const queue = new CompileQueue(() => now);
	queue.request({ seq: 1, pageIds: ["page"], visiblePageId: "page" });
	const first = queue.next();
	if (!first) throw Error("no first");
	queue.complete(first, "first");
	const starts: number[] = [];
	for (now = 20; now <= 5000; now += 20) {
		queue.request({ seq: now / 20 + 1, pageIds: ["page"], visiblePageId: "page" });
		const job = queue.next();
		if (job) {
			starts.push(job.seq);
			queue.complete(job, "html");
		}
	}
	expect(starts.length).toBeGreaterThan(0);
});

it("review: adding a valid float boundary must still compile the page", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = new PreviewScheduler(await createCourseContext(model(0)), (e) =>
		events.push(e),
	);
	try {
		scheduler.selectPage("page");
		await vi.runAllTimersAsync();
		events.length = 0;
		let id = 0;
		const parsed = readLesson(
			"# Page\n\n::: float {side=left}\n![Picture](https://example.com/picture.png)\nText beside picture.\n:::\n",
			{ ids: () => `float-${id++}` },
		);
		expect(parsed.hasErrors).toBe(false);
		const next: CourseContextInput = { ...model(1), content: [{ ...parsed.pages[0], id: "page" }] };
		const fresh = compilePage(await createCourseContext(next), "page");
		expect(fresh.html).toContain("Text beside picture.");
		await scheduler.refresh(next, {});
		await vi.runAllTimersAsync();
		expect(events.some((e) => e.type === "pageCompiled" && e.patch.seq === 1)).toBe(true);
		expect(events.some((e) => e.type === "compileFailed")).toBe(false);
		expect(scheduler.lastGood("page")?.html).toBe(fresh.html);
	} finally {
		scheduler.close();
	}
});

async function fixture(files: Record<string, string>) {
	const root = await mkdtemp(join(tmpdir(), "p3a-regression-"));
	roots.push(root);
	for (const [name, source] of Object.entries(files)) await writeFile(join(root, name), source);
	await persistFixtureIdentity(root);
	const session = await createStudioProjectSession(root, "review");
	sessions.push(session);
	const events: StudioEvent[] = [];
	session.subscribe((e) => events.push(e));
	return { root, session, events };
}
async function eventFor(events: StudioEvent[], predicate: (e: StudioEvent) => boolean) {
	const end = Date.now() + 1000;
	while (Date.now() < end) {
		const event = events.find(predicate);
		if (event) return event;
		await new Promise((r) => setTimeout(r, 10));
	}
	throw Error("No event within 1s");
}

it("review: a broken lesson must not freeze a valid visible lesson", async () => {
	const good = "# Good\n\nBefore.\n";
	const { root, session, events } = await fixture({
		"course.yaml": "title: Course\nlessons:\n  - good.prax\n  - bad.prax\n",
		"good.prax": good,
		"bad.prax": "# Bad\n\nFine.\n",
	});
	const identity = await resolveLessonSources(root);
	const badPage = identity.lessons.get("bad.prax")?.pages[0]?.id;
	const goodPage = identity.lessons.get("good.prax")?.pages[0]?.id;
	if (!badPage || !goodPage) throw Error("Missing lesson pages");
	await session.invoke("previewSelectPage", { pageId: badPage });
	const badOutput = await eventFor(events, (e) => e.type === "pageCompiled");
	if (badOutput.type !== "pageCompiled") throw Error("Missing bad lesson output");
	await session.invoke("previewSelectPage", { pageId: goodPage });
	await eventFor(events, (e) => e.type === "pageCompiled");
	events.length = 0;
	await writeFile(join(root, "bad.prax"), "# Bad\n\n::: note Broken\nUnclosed.\n");
	const failure = await eventFor(events, (e) => e.type === "compileFailed");
	expect(failure).toMatchObject({
		pageId: badPage,
		diagnostics: [expect.objectContaining({ file: "bad.prax" })],
	});
	events.length = 0;
	await writeFile(join(root, "good.prax"), good.replace("Before", "After!"));
	await eventFor(events, (e) => e.type === "grammarChanged" && e.filename === "good.prax");
	await eventFor(
		events,
		(e) => e.type === "pageCompiled" && e.patch.fragments.some((f) => f.html.includes("After!")),
	);
	events.length = 0;
	await writeFile(
		join(root, "course.yaml"),
		"title: Renamed\nlessons:\n  - good.prax\n  - bad.prax\n",
	);
	expect(
		await eventFor(events, (e) => e.type === "pageCompiled" && e.patch.pageId === goodPage),
	).toMatchObject({
		patch: { shellStale: true },
	});
	events.length = 0;
	await session.invoke("previewSelectPage", { pageId: badPage });
	expect(events).toMatchObject([
		{ type: "pageCompiled", patch: { pageId: badPage, fragments: badOutput.patch.fragments } },
		{
			type: "compileFailed",
			pageId: badPage,
			diagnostics: [expect.objectContaining({ file: "bad.prax" })],
		},
	]);
	events.length = 0;
	const badFile = join(root, "bad.prax");
	const second = Math.floor(Date.now() / 1000);
	await writeFile(badFile, "# Bad\n\nFixed\n");
	await utimes(badFile, second + 0.1, second + 0.1);
	expect(
		await eventFor(events, (e) => e.type === "pageCompiled" && e.patch.pageId === badPage),
	).toMatchObject({
		patch: { fragments: [expect.objectContaining({ html: expect.stringContaining("Fixed") })] },
	});
	events.length = 0;
	await writeFile(badFile, "# Bad\n\nFresh\n");
	await utimes(badFile, second + 0.2, second + 0.2);
	await eventFor(
		events,
		(e) => e.type === "pageCompiled" && e.patch.fragments.some((f) => f.html.includes("Fresh")),
	);
	events.length = 0;
	await writeFile(badFile, "# Bad\n\n::: note Broken\nUnclosed.\n");
	await eventFor(events, (e) => e.type === "compileFailed");
	events.length = 0;
	await session.invoke("previewSelectPage", { pageId: badPage });
	expect(events[0]).toMatchObject({
		patch: {
			fragments: expect.arrayContaining([
				expect.objectContaining({ html: expect.stringContaining("Fresh") }),
			]),
		},
	});
});

it("a new invalid unlisted lesson does not freeze later valid edits", async () => {
	const { root, session, events } = await fixture({ "lesson.prax": "# Page\n\nBefore.\n" });
	await session.invoke("previewSelectPage", {});
	await eventFor(events, (e) => e.type === "pageCompiled");
	events.length = 0;
	await writeFile(join(root, "broken.prax"), "# Broken\n\n::: note Unclosed\nText.\n");
	await eventFor(events, (e) => e.type === "compileFailed");
	events.length = 0;
	await writeFile(join(root, "lesson.prax"), "# Page\n\nAfter!.\n");
	expect(await eventFor(events, (e) => e.type === "pageCompiled")).toMatchObject({
		patch: { fragments: [expect.objectContaining({ html: expect.stringContaining("After!.") })] },
	});
});

it.each(["delete", "rename", "move"] as const)(
	"review: stale running compile is fenced after page %s",
	async (change) => {
		vi.useFakeTimers();
		const events: PreviewSchedulerEvent[] = [];
		let finish: (() => void) | undefined;
		const scheduler = new PreviewScheduler(
			await createCourseContext(model(3)),
			(e) => events.push(e),
			{
				compile: (context, pageId) =>
					new Promise((done) => {
						finish = () => done(compilePage(context, pageId));
					}),
			},
		);
		try {
			scheduler.selectPage("page");
			await vi.advanceTimersByTimeAsync(0);
			const next = model(4);
			if (change === "delete")
				next.content = [
					{
						id: "new",
						title: "New",
						blocks: [{ id: "new-text", type: "text", data: { content: "New" } }],
					},
				];
			if (change === "rename") next.content[0].title = "Renamed";
			if (change === "move") {
				next.moduleDeck = {};
				next.content[0].lessonId = "second-lesson";
			}
			await scheduler.refresh(next, {});
			if (!finish) throw Error("Compile did not start");
			finish();
			await Promise.resolve();
			await Promise.resolve();
			expect(events.filter((e) => e.type === "pageCompiled")).toEqual([]);
			expect(scheduler.stats().discarded).toBe(1);
		} finally {
			scheduler.close();
		}
	},
);

it("review: dispose clears a scheduled trailing timer and blocks an in-flight delivery", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = new PreviewScheduler(await createCourseContext(model(0)), (e) =>
		events.push(e),
	);
	scheduler.selectPage("page");
	await vi.runAllTimersAsync();
	await scheduler.refresh({ ...model(1), title: "Renamed" }, {});
	expect(vi.getTimerCount()).toBeGreaterThan(0);
	scheduler.close();
	expect(vi.getTimerCount()).toBe(0);
	const count = events.length;
	await vi.runAllTimersAsync();
	expect(events).toHaveLength(count);
});

it("compiled scheduler failures retain their code and localization reference", async () => {
	const { PracticeAdmissionError } = await import("@praxity/export-pipeline");
	const events: PreviewSchedulerEvent[] = [];
	const scheduler = await PreviewScheduler.create(model(0), (event) => events.push(event), {
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

it("newer preview content fences stale failures and refreshes", async () => {
	vi.useFakeTimers();
	const events: PreviewSchedulerEvent[] = [];
	const input = (seq: number) => {
		const value = model(seq);
		value.content[0].blocks[0].data.content = `Content ${seq}`;
		return value;
	};
	const scheduler = await PreviewScheduler.create(input(0), (event) => events.push(event));
	try {
		await scheduler.refresh(input(2), {});
		await vi.runAllTimersAsync();
		expect(scheduler.lastGood("page")?.html).toContain("Content 2");
		events.length = 0;
		scheduler.fail(1, [{ message: "Stale failure" }]);
		await vi.runAllTimersAsync();
		expect(events.filter((event) => event.type === "compileFailed")).toEqual([]);
		expect(scheduler.lastGood("page")?.html).toContain("Content 2");
		await expect(scheduler.refresh(input(1), {})).rejects.toThrow(
			"Course context sequence must advance",
		);
		expect(events).toEqual([]);
		await vi.runAllTimersAsync();
		expect(scheduler.context().seq).toBe(2);
		expect(scheduler.lastGood("page")?.seq).toBe(2);
		expect(scheduler.lastGood("page")?.html).toContain("Content 2");
	} finally {
		scheduler.close();
	}
});
