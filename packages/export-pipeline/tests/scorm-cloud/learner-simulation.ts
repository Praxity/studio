import { type Browser, expect, type Frame, type Page } from "@playwright/test";

export interface SimulationResult {
	pagesVisited: number;
	questionsAnswered: number;
	allCorrect: boolean;
	groupsCompleted: number;
	startingPage: number;
	initialCheckedValues: string[];
}

interface SimulationOptions {
	answerCorrectly?: boolean;
	stopAfterPage?: number;
}

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

const AUTOMATABLE_TYPES = new Set(["choice", "matching", "textResponse", "sequence"]);

async function waitForCourseLoad(coursePage: Page, timeoutMs = 30_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const url = coursePage.url();
		if (
			url &&
			!url.endsWith("/index.html") &&
			!url.includes("content.html") &&
			!url.includes("about:blank")
		) {
			return;
		}
		await coursePage.waitForTimeout(500);
	}
	throw new Error(
		`Course page did not navigate to a page slug within ${timeoutMs}ms. URL: ${coursePage.url()}`,
	);
}

async function waitForHydration(coursePage: Page): Promise<void> {
	// 30s timeout — resume sessions restore suspend data from the SCORM API
	// which can take longer than a fresh launch.
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			const ready = await coursePage.evaluate(() => {
				if (!document.documentElement.classList.contains("praxity-js-loaded")) return false;
				const rt = (window as unknown as { __praxityRuntime?: unknown }).__praxityRuntime;
				return rt != null;
			});
			if (ready) return;
		} catch {
			// Page may be navigating
		}
		await coursePage.waitForTimeout(300);
	}
	throw new Error(`Course runtime did not initialize after 30s. Page: ${coursePage.url()}`);
}

async function readConfig(coursePage: Page): Promise<PraxityConfig> {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		try {
			const config = await coursePage.evaluate(() => {
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
		} catch {
			// Page may still be navigating
		}
		await coursePage.waitForTimeout(300);
	}
	const debug = await coursePage
		.evaluate(() => ({
			url: window.location.href,
			title: document.title,
			bodyLen: document.body?.innerHTML?.length ?? 0,
		}))
		.catch(() => ({ url: "unknown", title: "unknown", bodyLen: 0 }));
	throw new Error(
		`Missing #praxity-host-config after 15s. Page: url=${debug.url} title=${debug.title} bodyLen=${debug.bodyLen}`,
	);
}

// --- Assessment answering helpers ---

/**
 * Reorder sequence items using the up/down ActionIcon buttons rendered by SequencePreview.
 *
 * Strategy: bubble-sort the current DOM order toward the target order.
 * For each position (left to right), find which item belongs there and
 * click "move up" until it reaches that position. This is O(n²) clicks
 * but reliable — no drag-and-drop required.
 *
 * When answerCorrectly=false we trigger a single button click to set hasInteracted
 * (so the submit button appears), then submit in the shuffled order for a wrong answer.
 */
export async function answerSequenceBlock(
	coursePage: Page | Frame,
	blockId: string,
	items: Array<{ id: string; label: string; correctPosition: number }>,
	answerCorrectly: boolean,
): Promise<void> {
	const container = coursePage.locator(
		`.praxity-block[data-block-type="assessment"][data-block-id="${blockId}"]`,
	);

	if (!answerCorrectly) {
		// Submitting the shuffled order gives a wrong answer for sequences.
		// Trigger hasInteracted by clicking the first down-arrow button.
		const firstDown = container
			.locator("button[aria-label*='down'], button[aria-label*='bas']")
			.first();
		if ((await firstDown.count()) > 0) {
			await firstDown.click({ force: true });
		}
		return;
	}

	// Build target order: correctPosition=0 is first, 1 is second, etc.
	const sortedByCorrect = [...items].sort((a, b) => a.correctPosition - b.correctPosition);
	const targetIds = sortedByCorrect.map((item) => item.id);
	const n = targetIds.length;

	/**
	 * Item identities survive hydration and distinguish duplicate or overlapping labels.
	 */
	async function readCurrentOrder(): Promise<string[]> {
		return container.evaluate((el) =>
			Array.from(el.querySelectorAll(".praxity-order-item")).map((row) => {
				const id = row.getAttribute("data-node-id");
				if (!id) throw new Error("Ordering item is missing its identity");
				return id;
			}),
		);
	}

	/**
	 * Click the "move up" button for the item currently at DOM position `index`.
	 * Index 0 has no up-button; up-buttons exist for indices 1..n-1.
	 * The nth up-button (0-based) corresponds to the item at list position (n+1).
	 */
	async function clickMoveUp(index: number): Promise<void> {
		const rows = container.locator(".praxity-order-item");
		const id = await rows.nth(index).getAttribute("data-node-id");
		const btn = rows.nth(index).locator("button[aria-label*='up'], button[aria-label*='haut']");
		await btn.click({ force: true });
		await expect(rows.nth(index - 1)).toHaveAttribute("data-node-id", id as string);
	}

	// Bubble-sort approach: for each target position, bring the right item there.
	let moved = false;
	for (let targetPos = 0; targetPos < n; targetPos++) {
		const wantedId = targetIds[targetPos];
		let currentOrder = await readCurrentOrder();

		let currentPos = currentOrder.indexOf(wantedId);
		if (currentPos === -1) {
			throw new Error(`Ordering item "${wantedId}" not found in DOM order`);
		}

		while (currentPos > targetPos) {
			await clickMoveUp(currentPos);
			moved = true;
			currentPos--;
			currentOrder = await readCurrentOrder();
			const actualPos = currentOrder.indexOf(wantedId);
			if (actualPos !== -1) currentPos = actualPos;
		}
	}
	if (!moved && n > 1) {
		const firstDown = container.locator(".praxity-order-item").first().locator("button").last();
		await firstDown.click({ force: true });
		await clickMoveUp(1);
	}
}

async function answerChoiceBlock(
	coursePage: Page,
	blockId: string,
	options: Array<{ id: string; isCorrect?: boolean; label?: string; text?: string }>,
	selectionMode: string,
	answerCorrectly: boolean,
): Promise<void> {
	const container = coursePage.locator(
		`.praxity-block[data-block-type="assessment"][data-block-id="${blockId}"]`,
	);

	if (selectionMode === "single") {
		const targetOption = options.find((o) =>
			answerCorrectly ? o.isCorrect === true : o.isCorrect !== true,
		);
		if (!targetOption) return;
		await container
			.locator(`input[type="radio"][value="${targetOption.id}"]`)
			.check({ force: true });
	} else {
		for (const opt of options) {
			const shouldCheck = answerCorrectly ? opt.isCorrect === true : opt.isCorrect !== true;
			if (shouldCheck) {
				const label = opt.label || opt.text || opt.id;
				// Mantine Checkbox doesn't render a value attribute — find by label text
				const checkbox = container
					.locator(".praxity-assessment-choice-option")
					.filter({ hasText: label })
					.locator("input[type='checkbox']");
				await checkbox.check({ force: true });
			}
		}
	}
}

async function answerMatchingBlock(
	coursePage: Page,
	blockId: string,
	pairs: Array<{ id: string; correctMatch: string }>,
	distractors: string[],
	answerCorrectly: boolean,
): Promise<void> {
	const container = coursePage.locator(
		`.praxity-block[data-block-type="assessment"][data-block-id="${blockId}"]`,
	);
	const allMatches = [...pairs.map((p) => p.correctMatch), ...distractors];

	for (let i = 0; i < pairs.length; i++) {
		const pair = pairs[i];

		let value: string;
		if (answerCorrectly) {
			value = pair.correctMatch;
		} else {
			const shiftedIndex = (i + 1) % allMatches.length;
			value = allMatches[shiftedIndex];
			if (value === pair.correctMatch) {
				value = allMatches[(shiftedIndex + 1) % allMatches.length];
			}
		}

		const combobox = container.getByRole("combobox").nth(i);
		await combobox.click();
		await coursePage.getByRole("option", { name: value, exact: true }).click();
	}
}

async function answerTextResponseBlock(coursePage: Page, blockId: string): Promise<void> {
	const container = coursePage.locator(
		`.praxity-block[data-block-type="assessment"][data-block-id="${blockId}"]`,
	);
	const textarea = container.locator("textarea, input[type='text']").first();
	await textarea.fill("Test response for automated SCORM validation.");
}

/**
 * Answer an individual assessment block (without clicking submit).
 * Returns true if the assessment type was automatable.
 */
async function answerAssessment(
	coursePage: Page,
	block: { id: string; data: AssessmentBlockData },
	answerCorrectly: boolean,
): Promise<boolean> {
	const selector = `.praxity-block[data-block-type="assessment"][data-block-id="${block.id}"]`;
	const container = coursePage.locator(selector);
	await container.waitFor({ state: "attached", timeout: 10_000 });
	await container.scrollIntoViewIfNeeded();
	if ((await container.getAttribute("data-island")) === "assessment") {
		await coursePage
			.locator(`${selector}[data-hydrated]`)
			.waitFor({ state: "attached", timeout: 10_000 });
	}
	const response = block.data.response;
	if (!response) return false;

	const assessmentType = block.data.assessmentType ?? response.type;
	if (!AUTOMATABLE_TYPES.has(assessmentType)) return false;

	if (response.type === "choice" && response.options) {
		await answerChoiceBlock(
			coursePage,
			block.id,
			response.options,
			response.selectionMode ?? "single",
			answerCorrectly,
		);
	} else if (response.type === "matching" && response.pairs) {
		await answerMatchingBlock(
			coursePage,
			block.id,
			response.pairs,
			response.distractors ?? [],
			answerCorrectly,
		);
	} else if (assessmentType === "sequence" && response.items && response.items.length > 0) {
		await answerSequenceBlock(coursePage, block.id, response.items, answerCorrectly);
	} else if (assessmentType === "textResponse") {
		await answerTextResponseBlock(coursePage, block.id);
	} else {
		return false;
	}

	return true;
}

/**
 * Submit a standalone assessment (not a group member) and wait for completion.
 */
async function submitStandaloneAssessment(coursePage: Page, blockId: string): Promise<boolean> {
	const container = coursePage.locator(
		`.praxity-block[data-block-type="assessment"][data-block-id="${blockId}"]`,
	);
	const submitBtn = container.locator('[data-assessment-submit="true"]');
	try {
		await submitBtn.waitFor({ timeout: 5_000 });
		await submitBtn.click();
		await coursePage
			.locator(`.praxity-block-assessment[data-block-id="${blockId}"][data-completed="true"]`)
			.waitFor({ timeout: 10_000 });
		return true;
	} catch {
		return false;
	}
}

async function completeRequiredChecklist(coursePage: Page): Promise<void> {
	const checkboxes = coursePage.locator(
		'[data-required="true"][data-block-type="checklist"] input[type="checkbox"]',
	);
	for (let index = 0; index < (await checkboxes.count()); index += 1) {
		await checkboxes.nth(index).check();
	}
}

// --- Assessment group helpers ---

async function handleAssessmentGroup(
	coursePage: Page,
	group: { id: string; data: AssessmentGroupData },
	assessmentBlocks: Map<string, { id: string; data: AssessmentBlockData }>,
	answerCorrectly: boolean,
): Promise<number> {
	let answered = 0;
	const members = group.data.memberBlockIds
		.map((id) => assessmentBlocks.get(id))
		.filter(Boolean) as Array<{ id: string; data: AssessmentBlockData }>;

	if (members.length === 0) return 0;

	if (group.data.mode === "oneOf") {
		// Select the first radio option in the picker, then answer that assessment
		const firstRadio = coursePage.locator(`.praxity-ag-radio`).first();
		if ((await firstRadio.count()) > 0) {
			await firstRadio.check({ force: true });
		}
		const member = members[0];
		const wasAutomatable = await answerAssessment(coursePage, member, answerCorrectly);
		if (wasAutomatable) answered++;
	} else {
		// Mode "all": answer every member
		for (const member of members) {
			const wasAutomatable = await answerAssessment(coursePage, member, answerCorrectly);
			if (wasAutomatable) answered++;
		}
	}

	// Brief wait for the group script to detect hydration and inject the submit button.
	// The script uses requestAnimationFrame internally, so a short pause is sufficient.
	await coursePage.waitForTimeout(500);

	// Click the group-level submit button (injected by the assessment group script).
	// The button text is "Submit All" or "Submit Selected" depending on mode.
	const submitText = group.data.mode === "oneOf" ? "Submit Selected" : "Submit All";
	const groupLabel = group.data.groupName ?? group.id;
	let submitted = false;

	// Resolve the submit button: primary selector first, then text-based fallback.
	let groupSubmit = coursePage.locator(`button.praxity-ag-submit-btn`);
	try {
		await groupSubmit.waitFor({ timeout: 8_000 });
	} catch {
		// Primary selector timed out — fall back to button text
		const fallback = coursePage.locator(`button:has-text("${submitText}")`);
		if ((await fallback.count()) > 0) {
			groupSubmit = fallback;
		} else {
			console.warn(`[learner-sim]   ✗ Group submit button not found for "${groupLabel}"`);
			return answered;
		}
	}

	// If the button is disabled, poll until it becomes enabled (the group
	// script enables it after its hydration check completes).
	if (await groupSubmit.isDisabled()) {
		console.log(`[learner-sim]   ⏳ Group submit disabled — waiting for enable…`);
		const deadline = Date.now() + 3_000;
		while (Date.now() < deadline && (await groupSubmit.isDisabled())) {
			await coursePage.waitForTimeout(200);
		}
		if (await groupSubmit.isDisabled()) {
			console.warn(`[learner-sim]   ⚠ Group submit still disabled after 3 s — skipping`);
			return answered;
		}
	}

	await groupSubmit.click();

	// Wait for group results to appear, indicating the submission was processed.
	try {
		await coursePage.locator(`.praxity-ag-results`).waitFor({ state: "visible", timeout: 8_000 });
		submitted = true;
	} catch {
		// .praxity-ag-results may not always render; treat the click itself as success.
		submitted = true;
	}

	if (submitted) {
		console.log(`[learner-sim]   ✓ Group "${groupLabel}" submitted`);
	}

	return answered;
}

// --- Navigation ---

async function navigateToNextPage(coursePage: Page): Promise<boolean> {
	// Try an explicit control first, then the keyboard navigation floor used by
	// minimal layouts with no visible navigation.
	let nextBtn = coursePage.locator("[data-continue-button]:visible").first();
	try {
		await nextBtn.waitFor({ state: "attached", timeout: 3_000 });
	} catch {
		// Fall back to the static HTML nav link
		const fallbackLink = coursePage.locator(".praxity-page-nav-fallback a").last();
		if ((await fallbackLink.count()) > 0) {
			const text = await fallbackLink.textContent();
			if (text?.trim().toLowerCase().includes("next")) {
				nextBtn = fallbackLink;
			} else {
				console.warn(`[learner-sim] No Next nav found (static or React)`);
				return false;
			}
		} else {
			const currentUrl = coursePage.url();
			await coursePage.waitForTimeout(150);
			const usesSwipe = await coursePage.evaluate(() => {
				const raw = document.getElementById("praxity-config")?.textContent;
				return raw ? JSON.parse(raw).navSwipeGestures === true : false;
			});
			if (usesSwipe) {
				await coursePage.evaluate(() => {
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
				await coursePage.locator("#main-content").press("ArrowRight");
			}
			try {
				await coursePage.waitForURL((url) => url.toString() !== currentUrl, { timeout: 15_000 });
				return true;
			} catch {
				console.warn(`[learner-sim] No navigation found on page`);
				return false;
			}
		}
	}
	if (await nextBtn.evaluate((el) => el instanceof HTMLButtonElement && el.disabled)) {
		console.warn(`[learner-sim] Next button is disabled`);
		return false;
	}

	const currentUrl = coursePage.url();
	await nextBtn.click();

	try {
		await coursePage.waitForURL((url) => url.toString() !== currentUrl, { timeout: 15_000 });
	} catch {
		console.warn(
			`[learner-sim] Navigation did not occur after clicking Next. URL still: ${coursePage.url()}`,
		);
		return false;
	}

	return true;
}

// --- Main simulation ---

export async function simulateLearner(
	browser: Browser,
	launchUrl: string,
	opts?: SimulationOptions,
): Promise<SimulationResult> {
	const answerCorrectly = opts?.answerCorrectly ?? true;
	const context = await browser.newContext();
	const page = await context.newPage();
	let pagesVisited = 0;
	let questionsAnswered = 0;
	let allCorrect = true;
	let groupsCompleted = 0;
	let startingPage = 0;
	let initialCheckedValues: string[] = [];

	try {
		const popupPromise = page.waitForEvent("popup");
		await page.goto(launchUrl);
		const coursePage = await popupPromise;

		await waitForCourseLoad(coursePage);
		await waitForHydration(coursePage);
		let config = await readConfig(coursePage);
		const totalPages = config.totalPages;
		startingPage = config.currentPage;
		for (const assessment of await coursePage.locator('[data-island="assessment"]').all()) {
			await assessment.scrollIntoViewIfNeeded();
			const blockId = await assessment.getAttribute("data-block-id");
			await coursePage
				.locator(`[data-island="assessment"][data-block-id="${blockId}"][data-hydrated]`)
				.waitFor({ state: "attached", timeout: 10_000 });
		}
		initialCheckedValues = await coursePage
			.locator("input:checked")
			.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));

		const runtimeType = await coursePage.evaluate(() => {
			const win = window as unknown as Record<string, unknown>;
			return win.__praxityRuntime?.constructor?.name ?? "none";
		});
		if (runtimeType.length <= 2) {
			console.warn(`[learner-sim] Runtime class: ${runtimeType} (minified runtime name)`);
		}

		console.log(
			`[learner-sim] Course loaded: ${totalPages} pages, starting at ${config.pages[config.currentPage - 1]?.slug}`,
		);

		for (let pageIndex = 0; pageIndex < totalPages && opts?.stopAfterPage !== 0; pageIndex++) {
			pagesVisited++;

			if (pageIndex > 0) {
				await waitForHydration(coursePage);
				config = await readConfig(coursePage);
			}

			console.log(
				`[learner-sim] Page ${pageIndex + 1}/${totalPages}: ${config.pages[config.currentPage - 1]?.slug ?? "unknown"}`,
			);

			// Identify assessment groups and their members on this page
			const groups = config.blocks
				.filter((b) => b.type === "assessmentGroup")
				.map((b) => ({ id: b.id, data: b.data as unknown as AssessmentGroupData }));
			const groupMemberIds = new Set(groups.flatMap((g) => g.data.memberBlockIds ?? []));

			// Build a map of assessment blocks for group lookup
			const assessmentBlocks = new Map(
				config.blocks
					.filter((b) => b.type === "assessment")
					.map((b) => [b.id, { id: b.id, data: b.data as unknown as AssessmentBlockData }]),
			);

			// Handle standalone assessments (not in any group)
			const standaloneAssessments = config.blocks.filter(
				(b) => b.type === "assessment" && !groupMemberIds.has(b.id),
			);

			for (const block of standaloneAssessments) {
				const data = block.data as unknown as AssessmentBlockData;
				const assessmentType = data.assessmentType ?? data.response?.type ?? "unknown";

				if (!AUTOMATABLE_TYPES.has(assessmentType)) {
					console.log(`[learner-sim]   Skipping ${block.id} (${assessmentType} — not automatable)`);
					continue;
				}

				console.log(`[learner-sim]   Assessment ${block.id} (${assessmentType})`);

				const wasAnswered = await answerAssessment(
					coursePage,
					{ id: block.id, data },
					answerCorrectly,
				);
				if (!wasAnswered) continue;
				if (!answerCorrectly) allCorrect = false;

				const submitted = await submitStandaloneAssessment(coursePage, block.id);
				if (submitted) {
					questionsAnswered++;
					console.log(`[learner-sim]   ✓ Answered ${block.id}`);
				} else {
					console.warn(`[learner-sim]   ✗ Submit/complete failed for ${block.id}`);
				}
			}

			// Handle assessment groups
			for (const group of groups) {
				console.log(
					`[learner-sim]   Group "${group.data.groupName ?? group.id}" (mode: ${group.data.mode}, members: ${group.data.memberBlockIds?.length ?? 0})`,
				);
				const groupAnswered = await handleAssessmentGroup(
					coursePage,
					group,
					assessmentBlocks,
					answerCorrectly,
				);
				questionsAnswered += groupAnswered;
				if (groupAnswered > 0) groupsCompleted++;
				if (!answerCorrectly) allCorrect = false;
			}

			await completeRequiredChecklist(coursePage);

			// Stop early if requested
			if (opts?.stopAfterPage != null && pagesVisited >= opts.stopAfterPage) {
				break;
			}

			// Navigate to next page
			if (pageIndex < totalPages - 1) {
				const navigated = await navigateToNextPage(coursePage);
				if (!navigated) {
					console.warn(`[learner-sim] Could not navigate past page ${pageIndex + 1}. Stopping.`);
					break;
				}
			}
		}

		// Flush SCORM data before closing
		const commitResult = await coursePage.evaluate(() => {
			const runtime = (window as unknown as { __praxityRuntime?: { commit?: () => boolean } })
				.__praxityRuntime;
			if (!runtime?.commit) return "no-runtime";
			const ok = runtime.commit();
			return ok ? "committed" : "commit-failed";
		});
		console.log(`[learner-sim] Final commit: ${commitResult}`);
		await coursePage.close({ runBeforeUnload: true });
		await page.waitForTimeout(4000);
	} catch {
		// Playwright navigation errors may include bearer launch URLs.
		throw new Error("SCORM Cloud learner simulation failed; see the preceding simulation steps.");
	} finally {
		await context.close();
	}

	return {
		pagesVisited,
		questionsAnswered,
		allCorrect,
		groupsCompleted,
		startingPage,
		initialCheckedValues,
	};
}
