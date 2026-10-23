import { expect, type Page, test } from "@playwright/test";
import { readTestEnv, waitForHydration as waitForShell } from "./helpers";
import { reviewContrast } from "./review-assertions";

async function waitForHydration(page: Page) {
	await waitForShell(page);
	for (const assessment of await page.locator('[data-island="assessment"]').all()) {
		await assessment.scrollIntoViewIfNeeded();
		await expect(assessment).toHaveAttribute("data-hydrated", "");
	}
}

test("choice reveal locks wrong answers, completes the group, and restores without awarding points", async ({
	page,
}, testInfo) => {
	const baseUrl = `${readTestEnv().url}/reveal-answers`;
	expect(baseUrl).toBeTruthy();
	await page.goto(`${baseUrl}/index.html`);
	await waitForHydration(page);
	const slug = await page.evaluate(() => {
		const config = JSON.parse(document.getElementById("praxity-config")?.textContent ?? "{}");
		return config.pages.find((entry: { title: string }) => entry.title === "Reveal answers")?.slug;
	});
	expect(slug).toBeTruthy();
	await page.goto(`${baseUrl}/${slug}.html`);
	await waitForHydration(page);
	const single = page.locator(".praxity-block-assessment[data-assessment-display]").filter({
		has: page.locator("p.praxity-assessment-stem", {
			hasText: "Which reveal action comes first?",
		}),
	});
	const multiple = page.locator(".praxity-block-assessment[data-assessment-display]").filter({
		has: page.locator("p.praxity-assessment-stem", {
			hasText: "Select the reveal safety checks",
		}),
	});
	const context = page.locator(".praxity-block[data-assessment-group-context]");
	await expect(context).toContainText("The team has found a hazard near the equipment.");
	for (const width of [1280, 320]) {
		await page.setViewportSize({ width, height: 900 });
		const frame = await context.evaluate((element) => {
			const header = document.querySelector(".praxity-assessment-group-card");
			const question = document.querySelector(".praxity-block[data-assessment-group]");
			const lastQuestion = document.querySelector(".praxity-block[data-group-last]");
			const footer = document.querySelector("[data-assessment-group-submit]");
			const paragraph = element.querySelector("p");
			if (!header || !question || !lastQuestion || !footer || !paragraph)
				throw new Error("Missing group frame content");
			const bounds = element.getBoundingClientRect();
			const headerBounds = header.getBoundingClientRect();
			const questionBounds = question.getBoundingClientRect();
			const textBounds = paragraph.getBoundingClientRect();
			const style = getComputedStyle(element);
			const frameParts = [
				header,
				element,
				...document.querySelectorAll(
					".praxity-block[data-assessment-group], [data-assessment-group-submit]",
				),
			];
			return {
				frameEdges: frameParts.map((part) => {
					const rect = part.getBoundingClientRect();
					return { left: rect.left - bounds.left, right: rect.right - bounds.right };
				}),
				headerGap: bounds.top - headerBounds.bottom,
				questionGap: questionBounds.top - bounds.bottom,
				footerGap: footer.getBoundingClientRect().top - lastQuestion.getBoundingClientRect().bottom,
				leftOffset: bounds.left - headerBounds.left,
				rightOffset: bounds.right - questionBounds.right,
				leftInset: textBounds.left - bounds.left,
				rightPadding: parseFloat(style.paddingInlineEnd),
				leftBorder: style.borderLeftWidth,
				rightBorder: style.borderRightWidth,
				overflows: element.scrollWidth > element.clientWidth,
			};
		});
		for (const edge of frame.frameEdges) {
			expect(Math.abs(edge.left)).toBeLessThanOrEqual(1);
			expect(Math.abs(edge.right)).toBeLessThanOrEqual(1);
		}
		for (const offset of [
			frame.headerGap,
			frame.questionGap,
			frame.footerGap,
			frame.leftOffset,
			frame.rightOffset,
		]) {
			expect(Math.abs(offset)).toBeLessThanOrEqual(1);
		}
		expect(frame.leftInset).toBe(0);
		expect(frame.rightPadding).toBe(0);
		expect(frame.leftBorder).toBe("0px");
		expect(frame.rightBorder).toBe("0px");
		expect(frame.overflows).toBe(false);
		const submitPadding = await page
			.locator(".praxity-assessment-group-submit")
			.evaluate((element) => parseFloat(getComputedStyle(element).paddingInlineStart));
		expect(submitPadding).toBe(0);
		await page.screenshot({
			fullPage: true,
			path: testInfo.outputPath(`group-context-${width}.png`),
		});
	}
	await page.setViewportSize({ width: 1280, height: 900 });
	await expect(single.getByRole("radio", { name: "Continue working" })).toBeEnabled();
	await expect(page.locator("[data-assessment-correct-answers]")).toHaveCount(0);
	await single.getByRole("radio", { name: "Continue working" }).focus();
	await page.keyboard.press("Space");
	await multiple.getByRole("checkbox", { name: "Check equipment" }).focus();
	await page.keyboard.press("Space");
	await page.getByRole("button", { name: "Submit all" }).focus();
	await page.keyboard.press("Enter");
	const verify = async () => {
		await expect(single).toHaveAttribute("data-completed", "true");
		await expect(single).toHaveAttribute("data-result", "incorrect");
		await expect(single).toHaveAttribute("data-score", "0");
		await expect(single).toHaveAttribute("data-passed", "false");
		await expect(single.getByRole("radio", { name: "Continue working" })).toBeChecked();
		await expect(single.getByRole("radio", { name: "Stop and assess the hazard" })).toBeDisabled();
		await expect(single.locator("[data-assessment-feedback]")).toContainText(
			"Review the safety procedure.",
		);
		await expect(single.locator("[data-assessment-correct-answers] ul")).toHaveCount(1);
		await expect(multiple.locator("[data-assessment-correct-answers] ul")).toHaveCount(1);
		await expect(single.locator("[data-assessment-correct-answers]")).toContainText(
			"Stop and assess the hazard",
		);
		await expect(multiple).toHaveAttribute("data-completed", "true");
		await expect(multiple).toHaveAttribute("data-result", "incorrect");
		await expect(multiple).not.toHaveAttribute("data-score");
		await expect(multiple.getByRole("checkbox", { name: "Check surroundings" })).not.toBeChecked();
		await expect(multiple.getByRole("checkbox", { name: "Check surroundings" })).toBeDisabled();
		await expect(multiple.locator("[data-assessment-correct-answers] li")).toHaveText([
			"Check equipment",
			"Check surroundings",
		]);
		await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
		await expect(page.locator("[data-assessment-group-progress]")).toContainText(
			"Questions completed: 2 of 2",
		);
		await expect(page.locator("[data-assessment-group-results]")).toContainText("Score: 0%");
	};
	await verify();
	for (const width of [1280, 768, 320]) {
		await page.setViewportSize({ width, height: 900 });
		const status = single.locator(".praxity-choice-status").first();
		await expect(status).toHaveCSS("font-weight", "600");
		const row = await status.evaluate((element) => {
			const text = element
				.closest(".praxity-assessment-choice-option")
				?.querySelector(".praxity-choice-label");
			if (!text) throw new Error("Missing answer label");
			const range = document.createRange();
			range.selectNodeContents(text);
			const lines = Array.from(range.getClientRects());
			const lastLine = lines.at(-1);
			if (!lastLine) throw new Error("Missing answer text geometry");
			const marker = element.getBoundingClientRect();
			return {
				aligned: Math.abs(marker.left - lastLine.left) < 2,
				below: marker.top >= lastLine.bottom - 2,
			};
		});
		expect(row.below).toBe(true);
		expect(row.aligned).toBe(true);
		await expect(status.locator("svg")).toHaveAttribute("aria-hidden", "true");
		expect((await single.locator(".praxity-choice-status").allTextContents()).sort()).toEqual([
			"Correct answer",
			"Not quite",
		]);
		expect(await single.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
			true,
		);
		await single.screenshot({ path: testInfo.outputPath(`choice-feedback-${width}.png`) });
	}
	await page.reload();
	await waitForHydration(page);
	await verify();
});

test("match, order, fill-blank and categorize reveal answers and restore their locked result", async ({
	page,
}) => {
	const baseUrl = `${readTestEnv().url}/reveal-answers`;
	await page.goto(`${baseUrl}/index.html`);
	await waitForHydration(page);
	const slug = await page.evaluate(() => {
		const config = JSON.parse(document.getElementById("praxity-config")?.textContent ?? "{}");
		return config.pages.find((entry: { title: string }) => entry.title === "More reveal answers")
			?.slug;
	});
	expect(slug).toBeTruthy();
	await page.goto(`${baseUrl}/${slug}.html`);
	await waitForHydration(page);
	const block = (title: string) =>
		page
			.locator(".praxity-block-assessment[data-assessment-display]")
			.filter({ has: page.locator("p.praxity-assessment-stem", { hasText: title }) });
	const match = block("Match the controls");
	const firstPromptOffset = () =>
		match
			.locator(".praxity-matching-prompt")
			.first()
			.evaluate(
				(element) =>
					element.getBoundingClientRect().top -
					(element.closest(".praxity-matching-grid")?.getBoundingClientRect().top ?? 0),
			);
	const promptBefore = await firstPromptOffset();
	await match.getByRole("combobox").nth(0).click();
	await page.getByRole("option", { name: "Face shield", exact: true }).click();
	await match.getByRole("combobox").nth(1).click();
	await page.getByRole("option", { name: "Guardrail", exact: true }).click();
	const order = block("Order the steps");
	if (await order.getByRole("button", { name: "Move First up" }).count()) {
		await order.getByRole("button", { name: "Move First up" }).click();
	}
	await order.getByRole("button", { name: "Move First down" }).click();
	await block("Complete the permit").getByRole("textbox").fill("wrong");
	await block("Categorize the equipment").getByRole("radio", { name: "Hard hat: Eyes" }).check();
	await block("Categorize the equipment").getByRole("radio", { name: "Goggles: Head" }).check();
	await page.getByRole("button", { name: "Submit all" }).click();
	const expected: Record<string, string[]> = {
		"Match the controls": ["Fall: Guardrail", "Splash: Face shield"],
		"Order the steps": ["First", "Second"],
		"Complete the permit": ["permit"],
		"Categorize the equipment": ["Hard hat: Head", "Goggles: Eyes"],
	};
	const verify = async () => {
		for (const [title, answers] of Object.entries(expected)) {
			const target = block(title);
			await expect(target).toHaveAttribute("data-completed", "true");
			await expect(target).toHaveAttribute("data-score", "0");
			await expect(target.locator("[data-assessment-correct-answers] li")).toHaveText(answers);
			await expect(
				target.locator(
					"input:not([disabled]):not([readonly]), select:not([disabled]), button:not([disabled])",
				),
			).toHaveCount(0);
		}
		await expect(block("Complete the permit").getByRole("textbox")).toHaveValue("wrong");
		await expect(order.locator(".praxity-order-item").first()).toContainText("Second");
		await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
		await expect(page.locator("[data-assessment-group-progress]")).toContainText(
			"Questions completed: 4 of 4",
		);
		await expect(page.locator("[data-assessment-group-results]")).toContainText("Score: 0%");
	};
	await verify();
	expect(Math.abs((await firstPromptOffset()) - promptBefore)).toBeLessThanOrEqual(1);
	for (const select of await match.getByRole("combobox").all()) {
		expect(await reviewContrast(select, "-webkit-text-fill-color")).toBeGreaterThanOrEqual(4.5);
	}
	await page.reload();
	await waitForHydration(page);
	await verify();
});

test("ordering keeps keyboard focus on the moved item in published output", async ({
	page,
	browserName,
}) => {
	const baseUrl = `${readTestEnv().url}/reveal-answers`;
	await page.goto(`${baseUrl}/index.html`);
	await waitForHydration(page);
	const slug = await page.evaluate(() => {
		const config = JSON.parse(document.getElementById("praxity-config")?.textContent ?? "{}");
		return config.pages.find((entry: { title: string }) => entry.title === "More reveal answers")
			?.slug;
	});
	expect(slug).toBeTruthy();
	await page.goto(`${baseUrl}/${slug}.html`);
	await waitForHydration(page);
	const order = page.locator(".praxity-block-assessment[data-assessment-display]").filter({
		has: page.locator("p.praxity-assessment-stem", { hasText: "Order the steps" }),
	});
	const rows = order.locator(".praxity-order-item");
	const moveDown = rows.nth(0).getByRole("button", { name: /^Move .* down$/ });
	const label = (await moveDown.getAttribute("aria-label"))?.replace(/^Move | down$/g, "");
	if (!label) throw new Error("Missing move button label");
	await moveDown.focus();
	await page.keyboard.press("Enter");
	await expect(rows.nth(1)).toContainText(label);
	await expect(rows.nth(0)).not.toContainText(label);
	await expect(order.getByRole("button", { name: `Move ${label} down` })).toHaveCount(0);
	await expect(order.getByRole("button", { name: `Move ${label} up` })).toBeFocused();
	await expect(order.locator('[aria-live="polite"]')).toHaveText(
		`${label} moved to position 2 of 2`,
	);
	await expect(order.locator('[aria-live="polite"]')).not.toContainText(/score|correct/i);
	await page.keyboard.press(
		browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab",
	);
	expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
});

test("correct choice feedback marks chosen options without repeating the solution", async ({
	page,
}, testInfo) => {
	const baseUrl = `${readTestEnv().url}/reveal-answers`;
	await page.goto(`${baseUrl}/index.html`);
	await waitForHydration(page);
	const slug = await page.evaluate(() => {
		const config = JSON.parse(document.getElementById("praxity-config")?.textContent ?? "{}");
		return config.pages.find((entry: { title: string }) => entry.title === "Reveal answers")?.slug;
	});
	expect(slug).toBeTruthy();
	await page.goto(`${baseUrl}/${slug}.html`);
	await waitForHydration(page);
	await page.getByRole("radio", { name: "Stop and assess the hazard" }).check();
	await page.getByRole("checkbox", { name: "Check equipment" }).check();
	await page.getByRole("checkbox", { name: "Check surroundings" }).check();
	await page.getByRole("button", { name: "Submit all" }).click();
	await expect(page.locator('[data-assessment-display][data-result="correct"]')).toHaveCount(2);
	await expect(page.locator(".praxity-choice-status")).toHaveText([
		"Correct",
		"Correct",
		"Correct",
	]);
	const scenario = page
		.locator('.praxity-block-assessment[data-assessment-display="scenario"]')
		.filter({
			has: page.locator("p.praxity-assessment-stem", {
				hasText: "Which reveal action comes first?",
			}),
		});
	await expect(scenario).toHaveCount(1);
	expect(
		await scenario
			.locator(".praxity-assessment-choice-option")
			.first()
			.evaluate((element) => parseFloat(getComputedStyle(element).paddingTop)),
	).toBeGreaterThanOrEqual(8);
	await expect(page.locator("[data-assessment-correct-answers]")).toHaveCount(0);
	for (const feedback of await page.locator("[data-assessment-feedback]").all()) {
		await expect(feedback).toContainText("1 of 1 attempts used");
		await expect(feedback).not.toContainText("Correct");
		await expect(feedback).not.toContainText("Correct answer");
		await expect(feedback.locator("[data-feedback-details]")).toHaveCount(0);
		await expect(feedback).toHaveCSS("border-top-width", "1px");
		expect(
			await feedback.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingTop)),
		).toBeGreaterThan(0);
	}
	await scenario.screenshot({ path: testInfo.outputPath("correct-scenario-feedback.png") });
});
