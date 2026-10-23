import { expect, type Frame, type Page, test } from "@playwright/test";
import { readLesson as readSource } from "@praxity/grammar";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { type CourseExportInput, compileCourse, deployCourse } from "../../src/build";
import type { SCORMRuntime } from "../../src/scorm/types";
import { createLifecycleHarness, type ScormFormat } from "./local-harness";

const packages = new Map<string, Buffer>();
const assessmentIds = new Map<string, string>();

test.beforeAll(async () => {
	test.setTimeout(120_000);
	for (const mode of ["pages", "guided"] as const) {
		const content = splitBlocksIntoPages(
			readSource(
				"# One\n\nRead one.\n\n# Two\n\nRead two.\n\n# Assessment\n\n::: choice What is one plus one? {scored required attempts=2 shuffle=false deckGate=attempt}\n(x) Two\n( ) Three\n:::\n\n# End\n\nRead end.\n",
			).blocks,
			"Retry",
		);
		const assessment = content
			.flatMap((page) => page.blocks)
			.find((block) => block.type === "assessment");
		if (!assessment) throw new Error("Missing retry assessment");
		assessmentIds.set(mode, assessment.id);
		content.forEach((page, index) => {
			page.id = `page-${index + 1}`;
			page.lessonId = index < 2 ? "first-module" : "last-module";
			page.lessonTitle = index < 2 ? "First module" : "Last module";
			page.isFirstPageOfLesson = index === 0 || index === 2;
			page.narrationEnabled = false;
		});
		if (mode === "pages")
			content[2].blocks.push({
				id: "finish-course",
				type: "button",
				data: { text: "Finish lesson", action: "goToPage", targetPageId: "__end_lesson__" },
			});
		const course: CourseExportInput = {
			id: `retry-${mode}`,
			title: "Retry",
			sourceLocale: "en",
			content,
			navigationStyle: mode === "guided" ? "slides" : "sidebar",
			...(mode === "guided" ? { moduleDeck: {} } : {}),
			completionMethod: "percentage",
			completionThreshold: 75,
			passingScore: 80,
		};
		const artifact = await compileCourse(course);
		try {
			for (const format of ["scorm12", "scorm2004"] as const) {
				packages.set(`${mode}-${format}`, (await deployCourse(artifact, { format })).zip);
			}
		} finally {
			await artifact.dispose();
		}
	}
});

interface LmsState {
	entry: string;
	saved: Record<string, string>;
	calls: string[][];
	errors: string[];
}

for (const format of ["scorm12", "scorm2004"] as const) {
	test(`${format} pages: authored Finish preserves a retryable failure for the next launch`, async ({
		page,
	}) => {
		test.setTimeout(45_000);
		const harness = await createLifecycleHarness(
			packages.get(`pages-${format}`) as Buffer,
			format,
			{
				failedStatusEndsAttempt: true,
			},
		);
		const prefix = format === "scorm12" ? "cmi.core." : "cmi.";
		try {
			await page.goto(harness.url);
			let frame = await assessment(page, "pages");
			await answer(frame, false);
			await expect.poll(async () => (await snapshot(page)).saved[`${prefix}score.raw`]).toBe("0");
			await expect(frame.locator('[data-island="nav"][data-hydrated]').first()).toBeAttached();
			await frame.getByRole("button", { name: "Finish lesson", exact: true }).click();
			const finished = await snapshot(page);
			expect(
				finished.saved[format === "scorm12" ? "cmi.core.lesson_status" : "cmi.completion_status"],
			).toBe("incomplete");
			if (format === "scorm2004") expect(finished.saved["cmi.success_status"]).toBe("failed");
			expect(finished.saved[`${prefix}exit`]).toBe("suspend");
			expect(finished.calls.at(-2)?.[0]).toBe("commit");
			expect(finished.calls.at(-1)?.[0]).toBe("terminate");
			expect(finished.calls.filter(([operation]) => operation === "terminate")).toHaveLength(1);
			await page.getByRole("button", { name: "Return to LMS" }).click();
			await frame.waitForURL("**/away.html");
			await page.getByRole("button", { name: "Launch course" }).click();
			frame = await ready(page);
			expect((await snapshot(page)).entry).toBe("resume");
			await expect(
				frame.getByRole("heading", { level: 1, name: /Resumed at page 3 of 4.*Assessment/ }),
			).toBeVisible();
			await expect(frame.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
			expect((await snapshot(page)).errors).toEqual([]);
		} finally {
			await page.close();
			await harness.cleanup();
		}
	});
}

async function snapshot(page: Page): Promise<LmsState> {
	return page.evaluate(() => {
		const lms = (
			window as unknown as {
				lifecycle: { calls: string[][]; errors: string[]; snapshot(): LmsState };
			}
		).lifecycle;
		return { ...lms.snapshot(), calls: lms.calls, errors: lms.errors };
	});
}

function expectScoreBeforeCompletion(state: LmsState): void {
	const operations = state.calls.map(([operation]) => operation);
	const completionWrite = state.calls
		.map(([operation, key]) => (operation === "set" ? key : ""))
		.lastIndexOf("cmi.completion_status");
	expect(completionWrite).toBeGreaterThan(-1);
	const previousCommit = operations.slice(0, completionWrite).lastIndexOf("commit");
	expect(operations.slice(completionWrite + 1)).toContain("commit");
	// Guided can commit its new bookmark after saving the result. Check the commit
	// that transfers completion, which is the point at which an LMS can lock the score.
	const writes = state.calls
		.slice(previousCommit + 1, completionWrite + 1)
		.filter(([operation]) => operation === "set")
		.map(([, key]) => key);
	const score = writes.lastIndexOf("cmi.score.scaled");
	const success = writes.lastIndexOf("cmi.success_status");
	const completion = writes.lastIndexOf("cmi.completion_status");
	expect(score).toBeGreaterThan(-1);
	expect(success).toBeGreaterThan(score);
	expect(completion).toBeGreaterThan(success);
}

async function ready(page: Page): Promise<Frame> {
	await expect
		.poll(async () => {
			const frame = page
				.frames()
				.find(
					(candidate) =>
						candidate.url().includes("/course/") && !candidate.url().includes("/index.html"),
				);
			return frame?.evaluate(() => !!window.__praxityRuntime).catch(() => false);
		})
		.toBe(true);
	return page.frames().find((candidate) => candidate.url().includes("/course/")) as Frame;
}

async function assessment(page: Page, mode: "pages" | "guided"): Promise<Frame> {
	for (const id of ["page-2", "page-3"]) {
		const frame = await ready(page);
		if (mode === "guided") {
			await frame.locator("#deck-next").click();
			await expect
				.poll(async () => (await ready(page)).locator(`[data-deck-slide="${id}"]`).isVisible())
				.toBe(true);
		} else {
			await frame
				.locator('a[data-page-direction="next"]')
				.filter({ visible: true })
				.first()
				.click();
			await frame.waitForURL(id === "page-2" ? "**/two.html" : "**/assessment.html");
		}
	}
	return ready(page);
}

async function answer(frame: Frame, correct: boolean): Promise<void> {
	await frame.getByRole("radio", { name: correct ? "Two" : "Three", exact: true }).check();
	await frame.getByRole("button", { name: "Submit", exact: true }).click();
}

for (const format of ["scorm12", "scorm2004"] as const) {
	for (const mode of ["pages", "guided"] as const) {
		for (const retryPasses of [true, false]) {
			test(`${format} ${mode}: retryable failure resumes the saved assessment before ${retryPasses ? "passing" : "final failure"}`, async ({
				page,
			}) => {
				test.setTimeout(45_000);
				const harness = await createLifecycleHarness(
					packages.get(`${mode}-${format}`) as Buffer,
					format,
					{ failedStatusEndsAttempt: true },
				);
				const prefix = format === "scorm12" ? "cmi.core." : "cmi.";
				const statusKey = format === "scorm12" ? "cmi.core.lesson_status" : "cmi.success_status";
				try {
					await page.goto(harness.url);
					let frame = await assessment(page, mode);
					await answer(frame, false);
					await expect
						.poll(async () => (await snapshot(page)).saved[statusKey])
						.toBe(format === "scorm12" ? "incomplete" : "failed");
					const failed = await snapshot(page);
					if (format === "scorm2004") {
						expect(failed.saved["cmi.completion_status"]).toBe("incomplete");
						expectScoreBeforeCompletion(failed);
					}
					expect(failed.saved[`${prefix}score.raw`]).toBe("0");
					expect(failed.saved[`${prefix}exit`]).toBe("suspend");
					const bookmarkKey = format === "scorm12" ? "cmi.core.lesson_location" : "cmi.location";
					expect(failed.saved[bookmarkKey]).toBe("index.html?praxity-page=page-3");
					const scoreWrite = failed.calls.findIndex(
						([operation, key]) => operation === "set" && key === `${prefix}score.raw`,
					);
					expect(scoreWrite).toBeGreaterThan(-1);
					await page.getByRole("button", { name: "Return to LMS" }).click();
					await frame.waitForURL("**/away.html");
					await page.getByRole("button", { name: "Launch course" }).click();
					frame = await ready(page);
					expect((await snapshot(page)).entry).toBe("resume");
					const cue = mode === "pages" ? "Resumed at page 3 of 4" : "Resumed at slide 1 of 2";
					await expect(
						frame.getByRole("heading", { level: 1, name: new RegExp(`${cue}.*Assessment`) }),
					).toBeVisible();
					// Firefox can retain the LMS launch button's outer-document focus.
					// Verify the course document's focus destination separately from that host policy.
					await expect
						.poll(() => frame.evaluate(() => document.activeElement?.textContent))
						.toMatch(new RegExp(`${cue}.*Assessment`));
					await expect(frame.getByRole("radio", { name: "Three", exact: true })).toBeChecked();
					await frame.getByRole("button", { name: "Try again", exact: true }).click();
					await answer(frame, retryPasses);
					await expect
						.poll(async () => (await snapshot(page)).saved[statusKey])
						.toBe(retryPasses ? "passed" : "failed");
					const final = await snapshot(page);
					await test.info().attach("lms-state.json", {
						body: JSON.stringify({ format, mode, retryPasses, failed, final }, null, 2),
						contentType: "application/json",
					});
					const writes = final.calls.map(([operation, key]) => (operation === "set" ? key : ""));
					// Incomplete may already be current on the first answer. The final result changes
					// status and must transfer after the final attempt's score in the same save.
					expect(writes.lastIndexOf(statusKey)).toBeGreaterThan(
						writes.lastIndexOf(`${prefix}score.raw`),
					);
					expect(final.saved[`${prefix}score.raw`]).toBe(retryPasses ? "100" : "0");
					expect(final.saved[`${prefix}exit`]).toBe(
						retryPasses ? (format === "scorm12" ? "" : "normal") : "suspend",
					);
					if (format === "scorm2004") {
						expect(final.saved["cmi.completion_status"]).toBe("completed");
						expectScoreBeforeCompletion(final);
					}
					expect(final.calls.filter(([operation]) => operation === "initialize")).toHaveLength(2);
					expect(final.calls.filter(([operation]) => operation === "terminate")).toHaveLength(0);
					expect(final.errors).toEqual([]);
					if (!retryPasses) {
						// A final failure can return empty entry with saved answers. That is not confirmed resume.
						await page.getByRole("button", { name: "Return to LMS" }).click();
						await frame.waitForURL("**/away.html");
						await page.getByRole("button", { name: "Launch course" }).click();
						frame = await ready(page);
						expect((await snapshot(page)).entry).toBe("");
						await expect(
							frame.getByRole("heading", { level: 1, name: "One", exact: true }),
						).toBeVisible();
						await expect(frame.locator(".praxity-resume-prefix")).toHaveCount(0);
						expect(
							await frame.evaluate(
								(assessmentId) =>
									(window.__praxityRuntime as SCORMRuntime)
										?.getInteractions()
										.filter((interaction) => interaction.id === assessmentId).length,
								assessmentIds.get(mode),
							),
						).toBe(2);
					}
				} finally {
					await page.close();
					await harness.cleanup();
				}
			});
		}
	}
}
