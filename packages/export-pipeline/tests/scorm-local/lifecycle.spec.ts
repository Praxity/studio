import { expect, type Frame, type Page, test } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { type CourseExportInput, compileCourse, deployCourse } from "../../src/build";
import type { SCORMRuntime } from "../../src/scorm/types";
import { createLifecycleHarness, type ScormFormat } from "./local-harness";

const packages = new Map<string, Buffer>();

test.beforeAll(async () => {
	test.setTimeout(120_000);
	for (const mode of ["pages", "logic", "guided"] as const) {
		const source =
			mode === "logic"
				? "---\n{ variables: { finish: true } }\n---\n\n# One\n\nRead [term]{definition}.\n\n::: rule\nif: finish is true\nthen: jump @course-end\n:::\n\n# Two\n\nRead two.\n\n# Three\n\nRead three.\n"
				: "# One\n\nRead [term]{definition}.\n\n# Two\n\nRead two.\n\n# Three\n\nRead three.\n";
		const content = splitBlocksIntoPages(readLesson(source).blocks, "Finish");
		if (mode === "logic") {
			// The terminal lesson sentinel is a stored-model action, without a G4 name spelling.
			const rule = content[0].blocks.find((block) => block.type === "logic");
			if (!rule) throw new Error("Missing lifecycle rule");
			rule.data.actions = [{ type: "jumpToPage", targets: ["__end_lesson__"] }];
			// Prose ends variable parameters before the rule. Fail before export if it is swallowed.
			expect(content[0].blocks.find((block) => block.type === "logic")?.data.actions).toEqual([
				{ type: "jumpToPage", targets: ["__end_lesson__"] },
			]);
		}
		content.forEach((page, index) => {
			page.id = `page-${index + 1}`;
			page.lessonId = index < 2 ? "first-module" : "last-module";
			page.lessonTitle = index < 2 ? "First module" : "Last module";
			page.isFirstPageOfLesson = index === 0 || index === 2;
			page.narrationEnabled = false;
		});
		if (mode === "pages")
			content[0].blocks.push({
				id: "finish-course",
				type: "button",
				data: { text: "Finish lesson", action: "goToPage", targetPageId: "__end_lesson__" },
			});
		const course: CourseExportInput = {
			id: `finish-${mode}`,
			title: "Finish",
			sourceLocale: "en",
			content,
			resourceEntries: [
				{
					title: "Reading",
					description: "Course reference",
					url: "https://example.com/reference",
					resourceType: "link",
				},
			],
			navigationStyle: mode === "guided" ? "slides" : "sidebar",
			...(mode === "guided" ? { moduleDeck: {} } : {}),
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

interface LifecycleState {
	state: string;
	entry: string;
	saved: Record<string, string>;
	values: Record<string, string>;
	calls: string[][];
	errors: string[];
}

async function snapshot(page: Page): Promise<LifecycleState> {
	return page.evaluate(() => {
		const lms = (
			window as unknown as {
				lifecycle: {
					calls: string[][];
					errors: string[];
					snapshot: () => Omit<LifecycleState, "calls" | "errors">;
				};
			}
		).lifecycle;
		return { ...lms.snapshot(), calls: lms.calls, errors: lms.errors };
	});
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

async function reloadDocument(frame: Frame): Promise<void> {
	await frame.evaluate(() => {
		document.documentElement.setAttribute("data-test-reloading", "");
		location.reload();
	});
	// Guided's replaceState also emits framenavigated. Only a replacement document
	// loses this marker; the outgoing document can already have reached load.
	await frame.locator("html:not([data-test-reloading])").waitFor({ state: "attached" });
	await frame.waitForLoadState("load");
}

async function finishButton(frame: Frame): Promise<void> {
	await expect(frame.locator('[data-island="nav"][data-hydrated]').first()).toBeAttached();
	await frame.getByRole("button", { name: "Finish lesson", exact: true }).click();
}

function count(state: LifecycleState, operation: string): number {
	return state.calls.filter(([name]) => name === operation).length;
}

function exitKey(format: ScormFormat): string {
	return format === "scorm12" ? "cmi.core.exit" : "cmi.exit";
}

async function nativeLink(frame: Frame, destination: string): Promise<void> {
	await frame.evaluate((href) => {
		document.getElementById("test-course-link")?.remove();
		const link = document.createElement("a");
		link.href = href;
		link.textContent = "Course destination";
		link.id = "test-course-link";
		document.body.append(link);
	}, destination);
	await frame.locator("#test-course-link").click();
}

async function assertClosed(
	page: Page,
	format: ScormFormat,
	exit: string,
): Promise<LifecycleState> {
	await expect.poll(async () => (await snapshot(page)).state).toBe("closed");
	const state = await snapshot(page);
	expect(state.saved[exitKey(format)]).toBe(exit);
	expect(state.calls.at(-2)?.[0]).toBe("commit");
	expect(state.calls.at(-1)?.[0]).toBe("terminate");
	expect(count(state, "terminate")).toBe(1);
	return state;
}

for (const format of ["scorm12", "scorm2004"] as const) {
	test(`${format}: authored logic End commits then finishes without following Next`, async ({
		page,
	}) => {
		test.setTimeout(30_000);
		const harness = await createLifecycleHarness(packages.get(`logic-${format}`) as Buffer, format);
		try {
			await page.goto(harness.url);
			const frame = await ready(page);
			await expect(frame.locator('[data-island="nav"][data-hydrated]').first()).toBeAttached();
			await expect
				.poll(() => frame.evaluate(() => window.__praxityLogicEngine?.getJumpTarget()))
				.toBe("__end_lesson__");
			await frame.locator("[data-continue-button]").filter({ visible: true }).first().click();
			const state = await assertClosed(page, format, format === "scorm12" ? "" : "normal");
			expect(frame.url()).toContain("/one.html");
			expect(state.errors).toEqual([]);
		} finally {
			await page.close();
			await harness.cleanup();
		}
	});

	for (const failure of ["false", "throw"] as const) {
		test(`${format}: ${failure} final commit keeps authored Finish retryable`, async ({ page }) => {
			test.setTimeout(30_000);
			const harness = await createLifecycleHarness(
				packages.get(`pages-${format}`) as Buffer,
				format,
			);
			try {
				await page.goto(harness.url);
				const frame = await ready(page);
				await page.evaluate(
					(mode) =>
						(
							window as unknown as { lifecycle: { failNextCommit: (mode: string) => void } }
						).lifecycle.failNextCommit(mode),
					failure,
				);
				await finishButton(frame);
				const failed = await snapshot(page);
				expect(failed.state).toBe("active");
				expect(count(failed, "terminate")).toBe(0);
				expect(failed.calls.at(-1)?.[0]).toBe("commit");
				await finishButton(frame);
				await assertClosed(page, format, format === "scorm12" ? "" : "normal");
			} finally {
				await page.close();
				await harness.cleanup();
			}
		});
	}

	for (const status of ["failed", "passed", ...(format === "scorm2004" ? ["unknown"] : [])]) {
		test(`${format}: ${status} attempt policy survives resources and authored Finish`, async ({
			page,
		}) => {
			test.setTimeout(30_000);
			const harness = await createLifecycleHarness(
				packages.get(`pages-${format}`) as Buffer,
				format,
			);
			try {
				await page.goto(harness.url);
				let frame = await ready(page);
				await frame.evaluate(
					({ is12, result }) => {
						const runtime = window.__praxityRuntime as SCORMRuntime;
						if (is12) runtime.setCompletion(result as "passed" | "failed");
						else {
							runtime.setCompletion("completed");
							runtime.setSuccess?.(result as "passed" | "failed" | "unknown");
						}
						runtime.commit();
					},
					{ is12: format === "scorm12", result: status },
				);
				const exit = status === "passed" ? (format === "scorm12" ? "" : "normal") : "suspend";
				const statusKey = format === "scorm12" ? "cmi.core.lesson_status" : "cmi.success_status";
				for (const destination of ["resources.html", "glossary.html"]) {
					await nativeLink(frame, destination);
					await frame.waitForURL(`**/${destination}`);
					frame = await ready(page);
					await frame.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
					const state = await snapshot(page);
					expect(state.state).toBe("active");
					expect(state.saved[exitKey(format)]).toBe(exit);
					expect(state.saved[statusKey]).toBe(status);
					expect(count(state, "initialize")).toBe(1);
					expect(count(state, "terminate")).toBe(0);
				}
				await nativeLink(frame, "one.html");
				await frame.waitForURL("**/one.html");
				frame = await ready(page);
				await finishButton(frame);
				const closed = await assertClosed(page, format, exit);
				expect(closed.saved[statusKey]).toBe(status);
				expect(closed.errors).toEqual([]);
			} finally {
				await page.close();
				await harness.cleanup();
			}
		});
	}

	test(`${format}: links, history, reload, forms and redirect keep the session until Finish`, async ({
		page,
		context,
	}) => {
		test.setTimeout(45_000);
		await context.addInitScript(() => {
			Object.defineProperty(window, "navigation", { value: undefined });
			window.addEventListener("pageswap", (event) => event.stopImmediatePropagation(), {
				capture: true,
			});
		});
		const harness = await createLifecycleHarness(packages.get(`pages-${format}`) as Buffer, format);
		try {
			await page.goto(harness.url);
			let frame = await ready(page);
			await nativeLink(frame, "two.html");
			await frame.waitForURL("**/two.html");
			frame = await ready(page);
			await frame.evaluate(() => history.back());
			await frame.waitForURL("**/one.html");
			frame = await ready(page);
			await frame.evaluate(() => history.forward());
			await frame.waitForURL("**/two.html");
			frame = await ready(page);
			await reloadDocument(frame);
			frame = await ready(page);
			for (const action of ["one.html", "index.html?praxity-page=page-1"]) {
				const arrived = page.waitForEvent(
					"framenavigated",
					(candidate) =>
						candidate === frame && new URL(candidate.url()).pathname.endsWith("/one.html"),
				);
				await frame.evaluate((destination) => {
					const form = document.createElement("form");
					// GET discards an action query, so use a successful form control.
					const url = new URL(destination, location.href);
					form.action = url.pathname;
					for (const [name, value] of url.searchParams) {
						const input = document.createElement("input");
						input.name = name;
						input.value = value;
						form.append(input);
					}
					document.body.append(form);
					form.submit();
				}, action);
				await arrived;
				await frame.waitForURL((url) => url.pathname.endsWith("/one.html"));
				frame = await ready(page);
			}
			await nativeLink(frame, "redirect.html");
			await frame.waitForURL("**/two.html");
			frame = await ready(page);
			const state = await snapshot(page);
			expect(state.state).toBe("active");
			expect(count(state, "initialize")).toBe(1);
			expect(count(state, "terminate")).toBe(0);
			expect(state.saved[exitKey(format)]).toBe("suspend");
			expect(state.errors).toEqual([]);
			await nativeLink(frame, "one.html");
			await frame.waitForURL("**/one.html");
			await finishButton(await ready(page));
			await assertClosed(page, format, format === "scorm12" ? "" : "normal");
		} finally {
			await page.close();
			await harness.cleanup();
		}
	});

	test(`${format}: auxiliary opener glossary departure preserves the main course`, async ({
		page,
		context,
	}) => {
		test.setTimeout(30_000);
		const harness = await createLifecycleHarness(packages.get(`pages-${format}`) as Buffer, format);
		try {
			await page.goto(harness.url);
			const frame = await ready(page);
			const opened = context.waitForEvent("page");
			await frame.evaluate(() => {
				const link = document.createElement("a");
				link.href = "glossary.html";
				link.target = "glossary-review";
				link.rel = "opener";
				link.textContent = "Review glossary";
				link.id = "review-glossary";
				document.body.append(link);
			});
			await frame.locator("#review-glossary").click();
			const popup = await opened;
			await popup.waitForURL("**/glossary.html");
			await expect.poll(() => popup.evaluate(() => !!window.__praxityRuntime)).toBe(true);
			const before = await snapshot(page);
			await popup.goto(new URL("/away.html", harness.url).href);
			const after = await snapshot(page);
			expect(after.state).toBe("active");
			expect(count(after, "terminate")).toBe(0);
			expect(count(after, "commit")).toBeGreaterThan(count(before, "commit"));
			expect(after.errors).toEqual([]);
			await popup.close();
			await finishButton(frame);
			await assertClosed(page, format, format === "scorm12" ? "" : "normal");
		} finally {
			await page.close();
			await harness.cleanup();
		}
	});

	for (const mode of ["pages", "guided"] as const) {
		test(`${format} ${mode}: cumulative session time survives documents, reload and cached-page events`, async ({
			page,
		}) => {
			test.setTimeout(30_000);
			const start = Date.UTC(2026, 9, 3, 12);
			await page.clock.setFixedTime(start);
			const harness = await createLifecycleHarness(
				packages.get(`${mode}-${format}`) as Buffer,
				format,
			);
			const timeKey = format === "scorm12" ? "cmi.core.session_time" : "cmi.session_time";
			try {
				await page.goto(harness.url);
				let frame = await ready(page);
				await page.clock.setFixedTime(start + 12_349);
				if (mode === "pages") {
					await nativeLink(frame, "two.html");
					await frame.waitForURL("**/two.html");
				} else {
					await frame.locator("#deck-next").click();
					await expect(frame.locator('[data-deck-slide="page-2"]')).toBeVisible();
					const previous = frame.url();
					await frame.locator("#deck-next").click();
					await frame.waitForURL(
						(url) => url.href !== previous && !url.pathname.endsWith("/index.html"),
					);
				}
				frame = await ready(page);
				expect((await snapshot(page)).saved[timeKey]).toBe(
					format === "scorm12" ? "0000:00:12.34" : "PT12.34S",
				);
				await page.clock.setFixedTime(start + 62_340);
				await frame.evaluate(() => window.__praxityRuntime?.commit?.());
				expect((await snapshot(page)).saved[timeKey]).toBe(
					format === "scorm12" ? "0000:01:02.34" : "PT1M2.34S",
				);
				await reloadDocument(frame);
				frame = await ready(page);
				await page.clock.setFixedTime(start + 73_459);
				expect(await frame.evaluate(() => Date.now())).toBe(start + 73_459);
				await frame.evaluate(() => {
					window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
					window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
				});
				const continued = await snapshot(page);
				expect(continued.saved[timeKey]).toBe(
					format === "scorm12" ? "0000:01:13.45" : "PT1M13.45S",
				);
				expect(count(continued, "initialize")).toBe(1);
				expect(count(continued, "terminate")).toBe(0);
				await page.getByRole("button", { name: "Return to LMS" }).click();
				await frame.waitForURL("**/away.html");
				await page.clock.setFixedTime(start + 600_000);
				await page.getByRole("button", { name: "Launch course" }).click();
				// Pages resumes Two; Guided has visited every slide and starts again at One.
				// Wait past any entry/resume redirects before advancing the new launch clock.
				await frame.waitForURL(
					(url) => url.pathname === (mode === "pages" ? "/course/two.html" : "/course/one.html"),
					{ waitUntil: "load" },
				);
				frame = await ready(page);
				expect((await snapshot(page)).entry).toBe(mode === "pages" ? "resume" : "");
				await page.clock.setFixedTime(start + 602_349);
				expect(await frame.evaluate(() => Date.now())).toBe(start + 602_349);
				expect(await frame.evaluate(() => window.__praxityRuntime?.commit?.())).toBe(true);
				const relaunched = await snapshot(page);
				expect(relaunched.saved[timeKey]).toBe(format === "scorm12" ? "0000:00:02.34" : "PT2.34S");
				expect(count(relaunched, "initialize")).toBe(2);
				expect(
					relaunched.calls.some(
						([operation, key]) => operation === "set" && key.endsWith("total_time"),
					),
				).toBe(false);
				expect(relaunched.errors).toEqual([]);
			} finally {
				await page.close();
				await harness.cleanup();
			}
		});

		test(`${format} ${mode}: pagehide, beforeunload, LMS return and iframe removal commit only`, async ({
			page,
		}) => {
			test.setTimeout(30_000);
			const harness = await createLifecycleHarness(
				packages.get(`${mode}-${format}`) as Buffer,
				format,
			);
			try {
				await page.goto(harness.url);
				const frame = await ready(page);
				const returnUrl = frame.url();
				if (mode === "guided") {
					await frame.locator("#deck-next").click();
					await expect(frame.locator('[data-deck-slide="page-2"]')).toBeVisible();
				}
				for (const event of ["pagehide", "beforeunload"] as const) {
					const before = await snapshot(page);
					await frame.evaluate((eventName) => window.dispatchEvent(new Event(eventName)), event);
					const after = await snapshot(page);
					expect(count(after, "commit")).toBe(count(before, "commit") + 1);
					expect(count(after, "terminate")).toBe(0);
					expect(after.saved[exitKey(format)]).toBe("suspend");
				}
				await page.getByRole("button", { name: "Return to LMS" }).click();
				await frame.waitForURL("**/away.html");
				expect((await snapshot(page)).state).toBe("active");
				expect(count(await snapshot(page), "terminate")).toBe(0);
				// Return to a content URL without pretending the LMS started a new launch.
				await page.evaluate((url) => {
					const frame = document.querySelector("iframe");
					if (frame) frame.src = url;
				}, returnUrl);
				await ready(page);
				const before = await snapshot(page);
				await page.evaluate(() => document.querySelector("iframe")?.remove());
				const after = await snapshot(page);
				expect(after.state).toBe("active");
				expect(count(after, "commit")).toBeGreaterThan(count(before, "commit"));
				expect(count(after, "terminate")).toBe(0);
				expect(count(after, "initialize")).toBe(1);
				expect(after.saved[exitKey(format)]).toBe("suspend");
				expect(after.errors).toEqual([]);
			} finally {
				await page.close();
				await harness.cleanup();
			}
		});
	}

	test(`${format}: authored Finish ends only after its final successful commit`, async ({
		page,
	}) => {
		test.setTimeout(30_000);
		const harness = await createLifecycleHarness(packages.get(`pages-${format}`) as Buffer, format);
		try {
			await page.goto(harness.url);
			const frame = await ready(page);
			const before = await snapshot(page);
			await finishButton(frame);
			await expect.poll(async () => (await snapshot(page)).state).toBe("closed");
			const state = await snapshot(page);
			expect(state.saved[format === "scorm12" ? "cmi.core.exit" : "cmi.exit"]).toBe(
				format === "scorm12" ? "" : "normal",
			);
			expect(state.calls.at(-2)?.[0]).toBe("commit");
			expect(state.calls.at(-1)?.[0]).toBe("terminate");
			expect(state.calls.filter(([name]) => name === "terminate")).toHaveLength(1);
			expect(count(state, "commit")).toBe(count(before, "commit") + 1);
			expect(state.errors).toEqual([]);
			await frame.evaluate(() => {
				window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
				window.dispatchEvent(new Event("beforeunload"));
				window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
			});
			await finishButton(frame);
			expect((await snapshot(page)).calls).toEqual(state.calls);
		} finally {
			await page.close();
			await harness.cleanup();
		}
	});
}
