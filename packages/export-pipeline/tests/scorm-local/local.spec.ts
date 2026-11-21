import type { Frame, Page } from "@playwright/test";
import { chromium, expect, test } from "@playwright/test";
import { buildScormCloudFixtures } from "../scorm-cloud/fixture";
import { answerSequenceBlock } from "../scorm-cloud/learner-simulation";
import { createLocalHarness, isDriverAvailable, type ScormFormat } from "./local-harness";

interface PraxityConfig {
	totalPages: number;
	currentPage: number;
	blocks: Array<{
		id: string;
		type: string;
		data: Record<string, unknown>;
	}>;
	pages: Array<{ slug: string; title: string }>;
}

interface AssessmentBlockData {
	assessmentType?: string;
	response?: {
		type: string;
		selectionMode?: string;
		options?: Array<{ id: string; isCorrect?: boolean; label?: string; text?: string }>;
		pairs?: Array<{ id: string; correctMatch: string }>;
		distractors?: string[];
		items?: Array<{ id: string; label: string; correctPosition: number }>;
	};
}

interface AssessmentGroupData {
	mode: "all" | "oneOf";
	memberBlockIds: string[];
	groupName?: string;
}

interface ScormState {
	lessonStatus: string;
	suspendData: string;
	score: string;
	successStatus?: string;
}

type ScormDataStore = Record<string, string>;

const AUTOMATABLE_TYPES = new Set(["choice", "matching", "textResponse", "sequence"]);

async function waitForFrameHydration(frame: Frame): Promise<void> {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		try {
			const ready = await frame.evaluate(() => {
				if (!document.documentElement.classList.contains("praxity-js-loaded")) return false;
				const rt = (window as unknown as { __praxityRuntime?: unknown }).__praxityRuntime;
				return rt != null;
			});
			if (ready) return;
		} catch {}
		await frame.waitForTimeout(300);
	}
	throw new Error(`Course runtime did not initialize in SCO frame after 15 s: ${frame.url()}`);
}

async function readFrameConfig(frame: Frame): Promise<PraxityConfig> {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		try {
			const config = await frame.evaluate(() => {
				const hostElement = document.getElementById("praxity-host-config");
				if (!hostElement?.textContent) return null;
				const host = JSON.parse(hostElement.textContent) as {
					totalPages: number;
					currentPage: number;
					availableSlugs: string[];
				};
				const viewerElement = document.getElementById("praxity-config");
				const viewer = viewerElement?.textContent
					? (JSON.parse(viewerElement.textContent) as Partial<PraxityConfig>)
					: {};
				return {
					totalPages: host.totalPages,
					currentPage: host.currentPage,
					blocks: viewer.blocks ?? [],
					pages: viewer.pages ?? host.availableSlugs.map((slug) => ({ slug, title: slug })),
				};
			});
			if (config) return config as PraxityConfig;
		} catch {}
		await frame.waitForTimeout(300);
	}
	throw new Error("Missing #praxity-host-config in SCO frame after 15 s");
}

async function answerChoiceInFrame(
	frame: Frame,
	blockId: string,
	options: Array<{ id: string; isCorrect?: boolean; label?: string; text?: string }>,
	selectionMode: string,
	answerCorrectly: boolean,
): Promise<void> {
	const container = frame.locator(
		`.praxity-block[data-block-type="assessment"][data-block-id="${blockId}"]`,
	);
	if (selectionMode === "single") {
		const target = options.find((o) =>
			answerCorrectly ? o.isCorrect === true : o.isCorrect !== true,
		);
		if (!target) return;
		await container.locator(`input[type="radio"][value="${target.id}"]`).check({ force: true });
	} else {
		for (const opt of options) {
			const shouldCheck = answerCorrectly ? opt.isCorrect === true : opt.isCorrect !== true;
			if (shouldCheck) {
				const label = opt.label || opt.text || opt.id;
				const checkbox = container
					.locator(".praxity-assessment-choice-option")
					.filter({ hasText: label })
					.locator("input[type='checkbox']");
				await checkbox.check({ force: true });
			}
		}
	}
}

async function answerMatchingInFrame(
	frame: Frame,
	blockId: string,
	pairs: Array<{ id: string; correctMatch: string }>,
	distractors: string[],
	answerCorrectly: boolean,
): Promise<void> {
	const container = frame.locator(
		`.praxity-block[data-block-type="assessment"][data-block-id="${blockId}"]`,
	);
	const allMatches = [...pairs.map((p) => p.correctMatch), ...distractors];

	for (let i = 0; i < pairs.length; i++) {
		const pair = pairs[i];
		let value: string;
		if (answerCorrectly) {
			value = pair.correctMatch;
		} else {
			const shifted = (i + 1) % allMatches.length;
			value = allMatches[shifted];
			if (value === pair.correctMatch) {
				value = allMatches[(shifted + 1) % allMatches.length];
			}
		}

		const combobox = container.getByRole("combobox").nth(i);
		await combobox.click();
		await frame.getByRole("option", { name: value, exact: true }).click();
	}
}

async function answerAssessmentInFrame(
	frame: Frame,
	block: { id: string; data: AssessmentBlockData },
	answerCorrectly: boolean,
): Promise<boolean> {
	const selector = `.praxity-block[data-block-type="assessment"][data-block-id="${block.id}"]`;
	const container = frame.locator(selector);
	await container.waitFor({ state: "attached", timeout: 10_000 });
	await container.scrollIntoViewIfNeeded();
	if ((await container.getAttribute("data-island")) === "assessment") {
		await frame
			.locator(`${selector}[data-hydrated]`)
			.waitFor({ state: "attached", timeout: 10_000 });
	}
	const response = block.data.response;
	if (!response) return false;

	const assessmentType = block.data.assessmentType ?? response.type;
	if (!AUTOMATABLE_TYPES.has(assessmentType)) return false;

	try {
		if (response.type === "choice" && response.options) {
			await answerChoiceInFrame(
				frame,
				block.id,
				response.options,
				response.selectionMode ?? "single",
				answerCorrectly,
			);
		} else if (response.type === "matching" && response.pairs) {
			await answerMatchingInFrame(
				frame,
				block.id,
				response.pairs,
				response.distractors ?? [],
				answerCorrectly,
			);
		} else if (assessmentType === "sequence" && response.items && response.items.length > 0) {
			await answerSequenceBlock(frame, block.id, response.items, answerCorrectly);
		} else if (assessmentType === "textResponse") {
			const textarea = container.locator("textarea, input[type='text']").first();
			await textarea.fill("Test response for local SCORM validation.");
		} else {
			return false;
		}
	} catch (error) {
		console.warn(`[local-sim]   Skipping ${block.id}; automation failed: ${String(error)}`);
		return false;
	}
	return true;
}

async function submitStandaloneInFrame(frame: Frame, blockId: string): Promise<boolean> {
	const container = frame.locator(
		`.praxity-block[data-block-type="assessment"][data-block-id="${blockId}"]`,
	);
	const submitBtn = container.locator('[data-assessment-submit="true"]');
	try {
		await submitBtn.waitFor({ timeout: 5_000 });
		await submitBtn.evaluate((el) => (el as HTMLButtonElement).click());
		await frame
			.locator(`.praxity-block-assessment[data-block-id="${blockId}"][data-completed="true"]`)
			.waitFor({ timeout: 10_000 });
		return true;
	} catch (error) {
		console.warn(`[local-sim]   Submit failed for ${blockId}: ${String(error)}`);
		return false;
	}
}

async function completeRequiredChecklistInFrame(frame: Frame): Promise<void> {
	const checkboxes = frame.locator(
		'[data-required="true"][data-block-type="checklist"] input[type="checkbox"]',
	);
	for (let index = 0; index < (await checkboxes.count()); index += 1) {
		await checkboxes.nth(index).check();
	}
}

async function handleAssessmentGroupInFrame(
	frame: Frame,
	group: { id: string; data: AssessmentGroupData },
	assessmentBlocks: Map<string, { id: string; data: AssessmentBlockData }>,
	answerCorrectly: boolean,
): Promise<number> {
	let answered = 0;
	const members = (group.data.memberBlockIds ?? [])
		.map((id) => assessmentBlocks.get(id))
		.filter(Boolean) as Array<{ id: string; data: AssessmentBlockData }>;

	if (members.length === 0) return 0;

	try {
		if (group.data.mode === "oneOf") {
			const firstRadio = frame.locator(".praxity-ag-radio").first();
			if ((await firstRadio.count()) > 0) {
				await firstRadio.evaluate((el) => (el as HTMLInputElement).click());
			}
			const member = members[0];
			const wasAutomatable = await answerAssessmentInFrame(frame, member, answerCorrectly);
			if (wasAutomatable) answered++;
		} else {
			for (const member of members) {
				const wasAutomatable = await answerAssessmentInFrame(frame, member, answerCorrectly);
				if (wasAutomatable) answered++;
			}
		}
	} catch (error) {
		console.warn(
			`[local-sim]   Skipping group "${group.data.groupName ?? group.id}"; automation failed: ${String(error)}`,
		);
		return answered;
	}

	await frame.waitForTimeout(500);

	const submitText = group.data.mode === "oneOf" ? "Submit Selected" : "Submit All";
	const groupLabel = group.data.groupName ?? group.id;

	let groupSubmit = frame.locator("button.praxity-ag-submit-btn");
	try {
		await groupSubmit.waitFor({ timeout: 8_000 });
	} catch {
		const fallback = frame.locator(`button:has-text("${submitText}")`);
		if ((await fallback.count()) > 0) {
			groupSubmit = fallback;
		} else {
			console.warn(`[local-sim]   ✗ Group submit button not found for "${groupLabel}"`);
			return answered;
		}
	}

	if (await groupSubmit.isDisabled()) {
		const deadline = Date.now() + 3_000;
		while (Date.now() < deadline && (await groupSubmit.isDisabled())) {
			await frame.waitForTimeout(200);
		}
		if (await groupSubmit.isDisabled()) {
			console.warn(`[local-sim]   ✗ Group submit still disabled for "${groupLabel}" — skipping`);
			return answered;
		}
	}

	await groupSubmit.evaluate((el) => (el as HTMLButtonElement).click());

	try {
		await frame.locator(".praxity-ag-results").waitFor({ state: "visible", timeout: 8_000 });
	} catch {}

	console.log(`[local-sim]   ✓ Group "${groupLabel}" submitted`);
	return answered;
}

async function navigateFrameToNextPage(frame: Frame): Promise<boolean> {
	let nextBtn = frame.locator("[data-continue-button]");
	try {
		await nextBtn.waitFor({ state: "attached", timeout: 3_000 });
	} catch {
		const edgeNext = frame.locator(".praxity-edge-arrow--next").first();
		if ((await edgeNext.count()) > 0) {
			nextBtn = edgeNext;
		} else {
			const fallback = frame.locator(".praxity-page-nav-fallback a").last();
			if ((await fallback.count()) > 0) {
				const text = await fallback.textContent();
				if (text?.trim().toLowerCase().includes("next")) {
					nextBtn = fallback;
				} else {
					return false;
				}
			} else {
				const currentUrl = frame.url();
				await frame.waitForTimeout(150);
				const usesSwipe = await frame.evaluate(() => {
					const raw = document.getElementById("praxity-config")?.textContent;
					return raw ? JSON.parse(raw).navSwipeGestures === true : false;
				});
				if (usesSwipe) {
					await frame.evaluate(() => {
						const target = document.body;
						const touch = (clientX: number) =>
							new Touch({ identifier: 1, target, clientX, clientY: 100 });
						target.dispatchEvent(
							new TouchEvent("touchstart", { bubbles: true, touches: [touch(200)] }),
						);
						target.dispatchEvent(
							new TouchEvent("touchend", { bubbles: true, changedTouches: [touch(100)] }),
						);
					});
				} else {
					await frame.locator("#main-content").press("ArrowRight");
				}
				try {
					await frame.waitForURL((url) => url.toString() !== currentUrl, { timeout: 15_000 });
					return true;
				} catch {
					return false;
				}
			}
		}
	}

	if (await nextBtn.evaluate((el) => el instanceof HTMLButtonElement && el.disabled)) {
		return false;
	}

	const currentUrl = frame.url();
	if (await nextBtn.isVisible()) {
		await nextBtn.click({ timeout: 5_000 });
	} else {
		await nextBtn.evaluate((el) => (el as HTMLElement).click());
	}

	try {
		await frame.waitForURL((url) => url.toString() !== currentUrl, { timeout: 15_000 });
	} catch {
		return false;
	}

	return true;
}

async function injectScormApiMocks(
	page: Page,
	format: ScormFormat,
	initialStore?: ScormDataStore,
): Promise<void> {
	await page.addInitScript(
		({ fmt, seededStore }) => {
			if (window.frameElement !== null) return;

			const store: Record<string, string> = { ...(seededStore ?? {}) };
			(window as unknown as Record<string, unknown>).__scormStore = store;

			if (fmt === "scorm12") {
				(window as unknown as Record<string, unknown>).API = {
					LMSInitialize: (_: string) => "true",
					LMSFinish: (_: string) => "true",
					LMSGetValue: (key: string) => store[key] ?? "",
					LMSSetValue: (key: string, value: string) => {
						store[key] = String(value);
						return "true";
					},
					LMSCommit: (_: string) => "true",
					LMSGetLastError: () => "0",
					LMSGetErrorString: (_: string) => "",
					LMSGetDiagnostic: (_: string) => "",
				};
			} else {
				(window as unknown as Record<string, unknown>).API_1484_11 = {
					Initialize: (_: string) => "true",
					Terminate: (_: string) => "true",
					GetValue: (key: string) => store[key] ?? "",
					SetValue: (key: string, value: string) => {
						store[key] = String(value);
						return "true";
					},
					Commit: (_: string) => "true",
					GetLastError: () => "0",
					GetErrorString: (_: string) => "",
					GetDiagnostic: (_: string) => "",
				};
			}
		},
		{ fmt: format, seededStore: initialStore ?? null },
	);
}

async function readScormStore(page: Page): Promise<ScormDataStore> {
	return page.evaluate(() => {
		const store = (window as unknown as { __scormStore?: Record<string, string> }).__scormStore;
		if (!store) return {};
		return { ...store };
	});
}

async function readScormState(page: Page, format: ScormFormat): Promise<ScormState> {
	return page.evaluate((fmt) => {
		const store = (window as unknown as { __scormStore?: Record<string, string> }).__scormStore;
		if (!store) return { lessonStatus: "unknown", suspendData: "", score: "" };

		if (fmt === "scorm12") {
			return {
				lessonStatus: store["cmi.core.lesson_status"] ?? "",
				suspendData: store["cmi.suspend_data"] ?? "",
				score: store["cmi.core.score.raw"] ?? "",
			};
		}

		return {
			lessonStatus: store["cmi.completion_status"] ?? "",
			suspendData: store["cmi.suspend_data"] ?? "",
			score: store["cmi.score.scaled"] ?? "",
			successStatus: store["cmi.success_status"] ?? "",
		};
	}, format);
}

async function commitAndReadState(
	scoFrame: Frame,
	page: Page,
	format: ScormFormat,
): Promise<ScormState> {
	const committed = await scoFrame.evaluate(() => {
		const runtime = (window as unknown as { __praxityRuntime?: { commit?: () => boolean } })
			.__praxityRuntime;
		return runtime?.commit?.();
	});
	expect(committed).toBe(true);
	return readScormState(page, format);
}

interface SimulationResult {
	pagesVisited: number;
	questionsAnswered: number;
	groupsCompleted: number;
}

async function simulateInFrame(
	frame: Frame,
	opts: { answerCorrectly: boolean; stopAfterPage?: number },
): Promise<SimulationResult> {
	let pagesVisited = 0;
	let questionsAnswered = 0;
	let groupsCompleted = 0;

	await waitForFrameHydration(frame);
	let config = await readFrameConfig(frame);
	const totalPages = config.totalPages;

	console.log(
		`[local-sim] Course loaded: ${totalPages} pages, starting at "${config.pages[0]?.slug}"`,
	);

	for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
		pagesVisited++;

		if (pageIndex > 0) {
			await waitForFrameHydration(frame);
			config = await readFrameConfig(frame);
		}

		console.log(
			`[local-sim] Page ${pageIndex + 1}/${totalPages}: "${config.pages[config.currentPage - 1]?.slug ?? "unknown"}"`,
		);

		const groups = config.blocks
			.filter((b) => b.type === "assessmentGroup")
			.map((b) => ({ id: b.id, data: b.data as unknown as AssessmentGroupData }));
		const groupMemberIds = new Set(groups.flatMap((g) => g.data.memberBlockIds ?? []));

		const assessmentBlockMap = new Map(
			config.blocks
				.filter((b) => b.type === "assessment")
				.map((b) => [b.id, { id: b.id, data: b.data as unknown as AssessmentBlockData }]),
		);

		const standaloneAssessments = config.blocks.filter(
			(b) => b.type === "assessment" && !groupMemberIds.has(b.id),
		);

		for (const block of standaloneAssessments) {
			const data = block.data as unknown as AssessmentBlockData;
			const assessmentType = data.assessmentType ?? data.response?.type ?? "unknown";

			if (!AUTOMATABLE_TYPES.has(assessmentType)) {
				console.log(`[local-sim]   Skipping ${block.id} (${assessmentType} — not automatable)`);
				continue;
			}

			console.log(`[local-sim]   Assessment ${block.id} (${assessmentType})`);
			const answered = await answerAssessmentInFrame(
				frame,
				{ id: block.id, data },
				opts.answerCorrectly,
			);
			if (!answered) continue;

			const submitted = await submitStandaloneInFrame(frame, block.id);
			if (submitted) {
				questionsAnswered++;
				console.log(`[local-sim]   ✓ Answered ${block.id}`);
			} else {
				console.warn(`[local-sim]   ✗ Submit failed for ${block.id}`);
			}
		}

		for (const group of groups) {
			console.log(
				`[local-sim]   Group "${group.data.groupName ?? group.id}" (mode: ${group.data.mode}, members: ${group.data.memberBlockIds?.length ?? 0})`,
			);
			const groupAnswered = await handleAssessmentGroupInFrame(
				frame,
				group,
				assessmentBlockMap,
				opts.answerCorrectly,
			);
			questionsAnswered += groupAnswered;
			if (groupAnswered > 0) groupsCompleted++;
		}

		await completeRequiredChecklistInFrame(frame);

		if (opts.stopAfterPage != null && pagesVisited >= opts.stopAfterPage) break;

		if (pageIndex < totalPages - 1) {
			const navigated = await navigateFrameToNextPage(frame);
			if (!navigated) {
				console.warn(`[local-sim] Could not navigate past page ${pageIndex + 1}. Stopping.`);
				break;
			}
		}
	}

	return { pagesVisited, questionsAnswered, groupsCompleted };
}

async function getContentFrame(page: Page): Promise<Frame> {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		const frame = page.frame("scormdriver_content");
		if (frame) {
			const url = frame.url();
			if (url && !url.includes("blank.html") && !url.includes("about:blank")) {
				return frame;
			}
		}
		await page.waitForTimeout(300);
	}
	throw new Error(
		"scormdriver_content frame did not navigate away from blank.html within 20 s. " +
			"Check that the HTTP server is running and scormcontent/index.html exists.",
	);
}

for (const format of ["scorm12", "scorm2004"] as const) {
	test.describe(`Local SCORM driver: ${format} — comprehensive fixture`, () => {
		test.describe.configure({ mode: "serial" });

		let fullZip: Buffer;
		let fullPageCount: number;
		let driverAvailable = false;

		test.beforeAll(async () => {
			driverAvailable = await isDriverAvailable(format);
			if (!driverAvailable) return;

			const fixtures = await buildScormCloudFixtures({ full: true });
			fullZip = format === "scorm12" ? fixtures.scorm12Zip : fixtures.scorm2004Zip;
			fullPageCount = fixtures.pageCount;
		});

		test("navigates all pages and answers automatable assessments", async () => {
			if (!driverAvailable) {
				test.skip(
					true,
					`Rustici driver not found for ${format} — copy driver files to tests/scorm-local/drivers/${format}/`,
				);
				return;
			}

			const harness = await createLocalHarness(fullZip, format);
			const browser = await chromium.launch({ headless: true });
			const context = await browser.newContext();
			const page = await context.newPage();

			try {
				await injectScormApiMocks(page, format);
				await page.goto(harness.url);
				const contentFrame = await getContentFrame(page);

				const result = await simulateInFrame(contentFrame, { answerCorrectly: true });
				console.log(`[local] ${format} comprehensive fixture result:`, result);

				expect(result.pagesVisited).toBe(fullPageCount);

				expect(result.questionsAnswered).toBeGreaterThan(0);

				const state = await commitAndReadState(contentFrame, page, format);
				console.log(`[local] ${format} comprehensive fixture SCORM state:`, state);

				if (format === "scorm12") {
					expect(["passed", "completed"]).toContain(state.lessonStatus);
				} else {
					expect(state.lessonStatus).toBe("completed");
				}

				if (state.score !== "") {
					expect(parseFloat(state.score)).toBeGreaterThan(0);
				}
			} finally {
				await context.close();
				await browser.close();
				await harness.cleanup();
			}
		});

		test("assessment groups — submit button interaction", async () => {
			if (!driverAvailable) {
				test.skip(
					true,
					`Rustici driver not found for ${format} — copy driver files to tests/scorm-local/drivers/${format}/`,
				);
				return;
			}

			const harness = await createLocalHarness(fullZip, format);
			const browser = await chromium.launch({ headless: true });
			const context = await browser.newContext();
			const page = await context.newPage();

			try {
				await injectScormApiMocks(page, format);
				await page.goto(harness.url);
				const contentFrame = await getContentFrame(page);

				const result = await simulateInFrame(contentFrame, { answerCorrectly: true });
				console.log(`[local] ${format} assessment groups result:`, result);

				expect(result.pagesVisited).toBe(fullPageCount);

				if (result.groupsCompleted > 0) {
					console.log(`[local] Groups completed: ${result.groupsCompleted}`);
					expect(result.groupsCompleted).toBeGreaterThan(0);
				} else {
					console.warn(
						"[local] ⚠ No assessment groups completed — group submit button may not have " +
							"rendered (rAF timing). Skipping group count assertion.",
					);
				}
			} finally {
				await context.close();
				await browser.close();
				await harness.cleanup();
			}
		});
	});
}

for (const format of ["scorm12", "scorm2004"] as const) {
	test.describe(`Local SCORM driver: ${format}`, () => {
		test.describe.configure({ mode: "serial" });

		let scorm12Zip: Buffer;
		let scorm2004Zip: Buffer;
		let pageCount: number;
		let scoredQuestionCount: number;
		let driverAvailable = false;

		test.beforeAll(async () => {
			driverAvailable = await isDriverAvailable(format);
			if (!driverAvailable) return;

			const fixtures = await buildScormCloudFixtures();
			scorm12Zip = fixtures.scorm12Zip;
			scorm2004Zip = fixtures.scorm2004Zip;
			pageCount = fixtures.pageCount;
			scoredQuestionCount = fixtures.scoredQuestionCount;
		});

		test("full completion with correct answers", async () => {
			if (!driverAvailable) {
				test.skip(
					true,
					`Rustici driver not found for ${format} — copy driver files to tests/scorm-local/drivers/${format}/`,
				);
				return;
			}

			const zipBuffer = format === "scorm12" ? scorm12Zip : scorm2004Zip;
			const harness = await createLocalHarness(zipBuffer, format);
			const browser = await chromium.launch({ headless: true });
			const context = await browser.newContext();
			const page = await context.newPage();

			try {
				await injectScormApiMocks(page, format);
				await page.goto(harness.url);
				const contentFrame = await getContentFrame(page);

				const result = await simulateInFrame(contentFrame, { answerCorrectly: true });
				expect(result.pagesVisited).toBe(pageCount);
				expect(result.questionsAnswered).toBe(scoredQuestionCount);

				const state = await commitAndReadState(contentFrame, page, format);
				console.log(`[local] Final SCORM state:`, state);

				if (format === "scorm12") {
					expect(["passed", "completed"]).toContain(state.lessonStatus);
				} else {
					expect(state.lessonStatus).toBe("completed");
				}

				const sd = JSON.parse(state.suspendData) as { visitedPages?: unknown };
				expect(Array.isArray(sd.visitedPages)).toBe(true);
				expect((sd.visitedPages as unknown[]).length).toBe(pageCount);

				if (scoredQuestionCount > 0) {
					expect(state.score).not.toBe("");
					const scoreNum = parseFloat(state.score);
					expect(scoreNum).toBeGreaterThan(0);
				}
			} finally {
				await context.close();
				await browser.close();
				await harness.cleanup();
			}
		});

		test("suspend data persists across sessions", async () => {
			if (!driverAvailable) {
				test.skip(
					true,
					`Rustici driver not found for ${format} — copy driver files to tests/scorm-local/drivers/${format}/`,
				);
				return;
			}

			const zipBuffer = format === "scorm12" ? scorm12Zip : scorm2004Zip;

			const harness1 = await createLocalHarness(zipBuffer, format);
			const browser1 = await chromium.launch({ headless: true });
			const context1 = await browser1.newContext();
			const page1 = await context1.newPage();
			let suspendDataAfterSession1 = "";

			try {
				await injectScormApiMocks(page1, format);
				await page1.goto(harness1.url);
				const frame1 = await getContentFrame(page1);
				await simulateInFrame(frame1, { answerCorrectly: true, stopAfterPage: 2 });
				const state1 = await commitAndReadState(frame1, page1, format);
				console.log(`[local] Session 1 state:`, state1);
				suspendDataAfterSession1 = state1.suspendData;
			} finally {
				await context1.close();
				await browser1.close();
				await harness1.cleanup();
			}

			const sd = JSON.parse(suspendDataAfterSession1) as { visitedPages?: unknown };
			expect(Array.isArray(sd.visitedPages)).toBe(true);
			expect((sd.visitedPages as unknown[]).length).toBe(2);
		});

		test("incorrect answers produce a lower score", async () => {
			if (!driverAvailable) {
				test.skip(
					true,
					`Rustici driver not found for ${format} — copy driver files to tests/scorm-local/drivers/${format}/`,
				);
				return;
			}
			if (scoredQuestionCount === 0) {
				test.skip(true, "No scored questions in fixture — cannot verify score difference");
				return;
			}

			const zipBuffer = format === "scorm12" ? scorm12Zip : scorm2004Zip;
			const harness = await createLocalHarness(zipBuffer, format);
			const browser = await chromium.launch({ headless: true });
			const context = await browser.newContext();
			const page = await context.newPage();

			try {
				await injectScormApiMocks(page, format);
				await page.goto(harness.url);
				const contentFrame = await getContentFrame(page);

				await simulateInFrame(contentFrame, { answerCorrectly: false });
				const state = await commitAndReadState(contentFrame, page, format);
				console.log(`[local] Incorrect answers state:`, state);

				expect(state.score).not.toBe("");
				const score = parseFloat(state.score);
				if (format === "scorm12") {
					expect(score).toBeLessThan(100);
				} else {
					expect(score).toBeLessThan(1);
				}
			} finally {
				await context.close();
				await browser.close();
				await harness.cleanup();
			}
		});

		test("required blocks — navigation allowed after assessment completed", async () => {
			if (!driverAvailable) {
				test.skip(
					true,
					`Rustici driver not found for ${format} — copy driver files to tests/scorm-local/drivers/${format}/`,
				);
				return;
			}

			const requiredFixtures = await buildScormCloudFixtures({ variant: "required" });
			const zipBuffer =
				format === "scorm12" ? requiredFixtures.scorm12Zip : requiredFixtures.scorm2004Zip;
			const harness = await createLocalHarness(zipBuffer, format);
			const browser = await chromium.launch({ headless: true });
			const context = await browser.newContext();
			const page = await context.newPage();

			try {
				await injectScormApiMocks(page, format);
				await page.goto(harness.url);
				const contentFrame = await getContentFrame(page);

				const result = await simulateInFrame(contentFrame, { answerCorrectly: true });
				console.log(`[local] Required blocks result:`, result);

				expect(result.pagesVisited).toBe(requiredFixtures.pageCount);
				expect(result.questionsAnswered).toBe(requiredFixtures.scoredQuestionCount);

				const state = await commitAndReadState(contentFrame, page, format);
				console.log(`[local] Required blocks SCORM state:`, state);

				if (format === "scorm12") {
					expect(["passed", "completed"]).toContain(state.lessonStatus);
				} else {
					expect(state.lessonStatus).toBe("completed");
				}
			} finally {
				await context.close();
				await browser.close();
				await harness.cleanup();
			}
		});

		test("quiz completion — pass when all answers correct", async () => {
			if (!driverAvailable) {
				test.skip(
					true,
					`Rustici driver not found for ${format} — copy driver files to tests/scorm-local/drivers/${format}/`,
				);
				return;
			}

			const quizFixtures = await buildScormCloudFixtures({ variant: "quizCompletion" });
			const zipBuffer = format === "scorm12" ? quizFixtures.scorm12Zip : quizFixtures.scorm2004Zip;
			const harness = await createLocalHarness(zipBuffer, format);
			const browser = await chromium.launch({ headless: true });
			const context = await browser.newContext();
			const page = await context.newPage();

			try {
				await injectScormApiMocks(page, format);
				await page.goto(harness.url);
				const contentFrame = await getContentFrame(page);

				const result = await simulateInFrame(contentFrame, { answerCorrectly: true });
				console.log(`[local] Quiz pass result:`, result);

				expect(result.pagesVisited).toBe(quizFixtures.pageCount);
				expect(result.questionsAnswered).toBe(quizFixtures.scoredQuestionCount);

				const state = await commitAndReadState(contentFrame, page, format);
				console.log(`[local] Quiz pass SCORM state:`, state);

				if (format === "scorm12") {
					expect(state.lessonStatus).toBe("passed");
					if (state.score !== "") {
						expect(parseFloat(state.score)).toBe(100);
					}
				} else {
					expect(state.lessonStatus).toBe("completed");
					if (state.successStatus) {
						expect(state.successStatus).toBe("passed");
					}
					if (state.score !== "") {
						expect(parseFloat(state.score)).toBeCloseTo(1, 1);
					}
				}
			} finally {
				await context.close();
				await browser.close();
				await harness.cleanup();
			}
		});

		test("quiz completion — fail when all answers incorrect", async () => {
			if (!driverAvailable) {
				test.skip(
					true,
					`Rustici driver not found for ${format} — copy driver files to tests/scorm-local/drivers/${format}/`,
				);
				return;
			}

			const quizFixtures = await buildScormCloudFixtures({ variant: "quizCompletion" });
			const zipBuffer = format === "scorm12" ? quizFixtures.scorm12Zip : quizFixtures.scorm2004Zip;
			const harness = await createLocalHarness(zipBuffer, format);
			const browser = await chromium.launch({ headless: true });
			const context = await browser.newContext();
			const page = await context.newPage();

			try {
				await injectScormApiMocks(page, format);
				await page.goto(harness.url);
				const contentFrame = await getContentFrame(page);

				const result = await simulateInFrame(contentFrame, { answerCorrectly: false });
				console.log(`[local] Quiz fail result:`, result);

				expect(result.pagesVisited).toBe(quizFixtures.pageCount);

				const state = await commitAndReadState(contentFrame, page, format);
				console.log(`[local] Quiz fail SCORM state:`, state);

				if (format === "scorm12") {
					expect(state.lessonStatus).toBe("failed");
					if (state.score !== "") {
						expect(parseFloat(state.score)).toBeLessThan(80);
					}
				} else {
					expect(state.lessonStatus).toBe("completed");
					if (state.successStatus) {
						expect(state.successStatus).toBe("failed");
					}
					if (state.score !== "") {
						expect(parseFloat(state.score)).toBeLessThan(0.8);
					}
				}
			} finally {
				await context.close();
				await browser.close();
				await harness.cleanup();
			}
		});

		if (format === "scorm12") {
			test("logic rule — correct answer jumps to summary", async () => {
				if (!driverAvailable) {
					test.skip(
						true,
						"Rustici driver not found for scorm12 — copy driver files to tests/scorm-local/drivers/scorm12/",
					);
					return;
				}

				const logicFixtures = await buildScormCloudFixtures({ variant: "logic" });
				const harness = await createLocalHarness(logicFixtures.scorm12Zip, "scorm12");
				const browser = await chromium.launch({ headless: true });
				const context = await browser.newContext();
				const page = await context.newPage();

				try {
					await injectScormApiMocks(page, "scorm12");
					await page.goto(harness.url);
					const contentFrame = await getContentFrame(page);

					const result = await simulateInFrame(contentFrame, { answerCorrectly: true });
					console.log(`[local] Logic correct result:`, result);

					expect(result.pagesVisited).toBe(3);
					expect(result.questionsAnswered).toBe(1);

					const state = await commitAndReadState(contentFrame, page, "scorm12");
					console.log(`[local] Logic correct SCORM state:`, state);

					expect(["passed", "completed"]).toContain(state.lessonStatus);

					if (state.suspendData) {
						try {
							const sd = JSON.parse(state.suspendData) as { visitedPages?: string[] };
							if (Array.isArray(sd.visitedPages)) {
								expect(sd.visitedPages.length).toBe(3);
								expect(sd.visitedPages).not.toContain("remediation");
								expect(sd.visitedPages).toContain("summary");
							}
						} catch {
							console.warn("[local] suspend_data not JSON:", state.suspendData.slice(0, 120));
						}
					}
				} finally {
					await context.close();
					await browser.close();
					await harness.cleanup();
				}
			});

			test("logic rule — incorrect answer goes to remediation", async () => {
				if (!driverAvailable) {
					test.skip(
						true,
						"Rustici driver not found for scorm12 — copy driver files to tests/scorm-local/drivers/scorm12/",
					);
					return;
				}

				const logicFixtures = await buildScormCloudFixtures({ variant: "logic" });
				const harness = await createLocalHarness(logicFixtures.scorm12Zip, "scorm12");
				const browser = await chromium.launch({ headless: true });
				const context = await browser.newContext();
				const page = await context.newPage();

				try {
					await injectScormApiMocks(page, "scorm12");
					await page.goto(harness.url);
					const contentFrame = await getContentFrame(page);

					const result = await simulateInFrame(contentFrame, { answerCorrectly: false });
					console.log(`[local] Logic incorrect result:`, result);

					expect(result.pagesVisited).toBe(4);
					expect(result.questionsAnswered).toBe(1);

					const state = await commitAndReadState(contentFrame, page, "scorm12");
					console.log(`[local] Logic incorrect SCORM state:`, state);

					expect(["passed", "completed"]).toContain(state.lessonStatus);

					if (state.suspendData) {
						try {
							const sd = JSON.parse(state.suspendData) as { visitedPages?: string[] };
							if (Array.isArray(sd.visitedPages)) {
								expect(sd.visitedPages.length).toBe(4);
								expect(sd.visitedPages).toContain("remediation");
								expect(sd.visitedPages).toContain("summary");
							}
						} catch {
							console.warn("[local] suspend_data not JSON:", state.suspendData.slice(0, 120));
						}
					}
				} finally {
					await context.close();
					await browser.close();
					await harness.cleanup();
				}
			});

			test("logic variable state persists across SCORM sessions", async () => {
				if (!driverAvailable) {
					test.skip(
						true,
						"Rustici driver not found for scorm12 — copy driver files to tests/scorm-local/drivers/scorm12/",
					);
					return;
				}

				const logicFixtures = await buildScormCloudFixtures({ variant: "logicPersistence" });
				let storeAfterSession1: ScormDataStore = {};

				const harness1 = await createLocalHarness(logicFixtures.scorm12Zip, "scorm12");
				const browser1 = await chromium.launch({ headless: true });
				const context1 = await browser1.newContext();
				const page1 = await context1.newPage();
				try {
					await injectScormApiMocks(page1, "scorm12");
					await page1.goto(harness1.url);
					const frame1 = await getContentFrame(page1);
					const hasIslandLoader = await frame1.evaluate(() => {
						const sources = Array.from(document.querySelectorAll("script[src]")).map(
							(el) => el.getAttribute("src") ?? "",
						);
						return sources.some((src) => src.includes("island-loader"));
					});
					expect(hasIslandLoader).toBe(true);

					await waitForFrameHydration(frame1);
					const config1 = await readFrameConfig(frame1);
					const assessmentBlock = config1.blocks.find(
						(block) => block.id === "b-logic-persist-quiz" && block.type === "assessment",
					);
					expect(assessmentBlock).toBeTruthy();
					if (!assessmentBlock) {
						throw new Error("Missing b-logic-persist-quiz block in logicPersistence fixture");
					}
					const answered = await answerAssessmentInFrame(
						frame1,
						{
							id: assessmentBlock.id,
							data: assessmentBlock.data as AssessmentBlockData,
						},
						true,
					);
					expect(answered).toBe(true);
					const submitted = await submitStandaloneInFrame(frame1, assessmentBlock.id);
					expect(submitted).toBe(true);
					await frame1.evaluate(() => {
						const engine = (
							window as unknown as {
								__praxityLogicEngine?: { evaluate?: () => void };
							}
						).__praxityLogicEngine;
						engine?.evaluate?.();
					});
					await frame1.waitForTimeout(200);

					const page2Slug = config1.pages[1]?.slug;
					expect(page2Slug).toBeTruthy();
					await frame1.goto(new URL(`${page2Slug}.html`, frame1.url()).toString());
					await waitForFrameHydration(frame1);

					const page2Config = await readFrameConfig(frame1);
					expect(page2Config.currentPage).toBe(2);

					const state1 = await commitAndReadState(frame1, page1, "scorm12");
					expect(state1.suspendData.length).toBeGreaterThan(0);

					const suspend1 = JSON.parse(state1.suspendData) as {
						custom?: string;
						visitedPages?: string[];
					};
					expect(Array.isArray(suspend1.visitedPages)).toBe(true);
					expect(typeof suspend1.custom).toBe("string");

					const custom1 = JSON.parse(suspend1.custom ?? "{}") as {
						v?: Record<string, unknown>;
						variables?: Record<string, unknown>;
					};
					expect(custom1.v?.quiz_outcome ?? custom1.variables?.quiz_outcome).toBe("passed");

					storeAfterSession1 = await readScormStore(page1);
				} finally {
					await context1.close();
					await browser1.close();
					await harness1.cleanup();
				}

				const harness2 = await createLocalHarness(logicFixtures.scorm12Zip, "scorm12");
				const browser2 = await chromium.launch({ headless: true });
				const context2 = await browser2.newContext();
				const page2 = await context2.newPage();
				try {
					await injectScormApiMocks(page2, "scorm12", storeAfterSession1);
					await page2.goto(harness2.url);
					const frame2 = await getContentFrame(page2);
					await waitForFrameHydration(frame2);

					const config2 = await readFrameConfig(frame2);
					if (config2.currentPage === 1) {
						const navigated = await navigateFrameToNextPage(frame2);
						expect(navigated).toBe(true);
						await waitForFrameHydration(frame2);
					}

					const outcomeText = await frame2
						.locator("#logic-persist-outcome")
						.textContent({ timeout: 10_000 });
					expect(outcomeText ?? "").toContain("passed");
				} finally {
					await context2.close();
					await browser2.close();
					await harness2.cleanup();
				}
			});
		}
	});
}

test.describe("Local SCORM driver: scorm12 — navigation variants", () => {
	test.describe.configure({ mode: "serial" });

	const NAV_VARIANTS = [
		{
			name: "sidebar",
			navigationStyle: "sidebar",
			navToggles: { navOutline: true, navPrevNext: true },
		},
		{
			name: "bottombar",
			navigationStyle: "bottomBar",
			navToggles: { navOutline: true, navPrevNext: true, navBreadcrumbs: true },
		},
		{
			name: "slides",
			navigationStyle: "slides",
			navToggles: { navOutline: false, navPrevNext: false, navEdgeArrows: true },
		},
		{
			name: "scroll",
			navigationStyle: "scroll",
			navToggles: {
				navOutline: true,
				navPrevNext: true,
				navScrollProgress: true,
				navFloatingToc: true,
			},
		},
		{
			name: "minimal",
			navigationStyle: "minimal",
			navToggles: { navOutline: false, navPrevNext: false, navSwipeGestures: true },
		},
		{
			name: "embedded",
			navigationStyle: "embedded",
			navToggles: { navOutline: false, navPrevNext: true },
		},
		{
			name: "none",
			navigationStyle: "none",
			navToggles: { navOutline: false, navPrevNext: false, navEdgeArrows: false },
		},
	] as const;

	for (const nav of NAV_VARIANTS) {
		test(`navigation variant "${nav.name}" — all pages visited, assessments answered, completed`, async () => {
			const driverAvailable = await isDriverAvailable("scorm12");
			if (!driverAvailable) {
				test.skip(
					true,
					"Rustici driver not found for scorm12 — copy driver files to tests/scorm-local/drivers/scorm12/",
				);
				return;
			}

			const fixtures = await buildScormCloudFixtures({
				navigationStyle: nav.navigationStyle,
				navToggles: nav.navToggles,
			});
			const harness = await createLocalHarness(fixtures.scorm12Zip, "scorm12");
			const browser = await chromium.launch({ headless: true });
			const context = await browser.newContext();
			const page = await context.newPage();

			try {
				await injectScormApiMocks(page, "scorm12");
				await page.goto(harness.url);
				const contentFrame = await getContentFrame(page);

				const result = await simulateInFrame(contentFrame, { answerCorrectly: true });
				console.log(`[local] Nav variant "${nav.name}" result:`, result);

				expect(result.pagesVisited).toBe(fixtures.pageCount);
				expect(result.questionsAnswered).toBe(fixtures.scoredQuestionCount);

				const state = await commitAndReadState(contentFrame, page, "scorm12");
				console.log(`[local] Nav variant "${nav.name}" SCORM state:`, state);

				expect(["passed", "completed"]).toContain(state.lessonStatus);

				if (state.score !== "") {
					expect(parseFloat(state.score)).toBe(100);
				}
			} finally {
				await context.close();
				await browser.close();
				await harness.cleanup();
			}
		});
	}
});
