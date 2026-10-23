import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import { test } from "../muted-test";
import { analyzeAxe, readTestEnv, waitForHydration } from "./helpers";

for (const mode of ["static", "full", "small"] as const) {
	test(`equation and code fidelity in ${mode} narrow Larger text output`, async ({
		browser,
	}, testInfo) => {
		const context = await browser.newContext({
			javaScriptEnabled: mode !== "static",
			viewport: { width: 390, height: 844 },
		});
		try {
			const page = await context.newPage();
			await page.goto(
				`${readTestEnv().url}/inline-features/equation-and-code-fidelity.html${mode === "small" ? "?minimal=1&praxity-small-preview=1" : ""}`,
			);
			if (mode === "full") await waitForHydration(page);
			await page.evaluate(() =>
				document.documentElement.setAttribute("data-praxity-text-size", "large"),
			);
			await expect(page.locator("math")).toHaveCount(3);
			await expect(page.locator(".katex-html")).toHaveCount(0);
			await expect(page.locator('[role="math"]')).toHaveCount(2);
			for (const math of await page.locator("math").all()) {
				await expect(math).toBeVisible();
				expect(
					await math.evaluate((element) => ({
						height: element.getBoundingClientRect().height,
						width: element.getBoundingClientRect().width,
						hidden: element.closest('[aria-hidden="true"]') !== null,
					})),
				).toMatchObject({ hidden: false });
				const box = await math.boundingBox();
				expect(box?.height).toBeGreaterThan(0);
				expect(box?.width).toBeGreaterThan(0);
			}
			await expect(page.locator("mfrac")).toHaveCount(1);
			const fraction = await page.locator("mfrac").evaluate((element) => {
				const numerator = element.children[0].getBoundingClientRect();
				const denominator = element.children[1].getBoundingClientRect();
				return { top: numerator.top, bottom: denominator.top };
			});
			expect(fraction.bottom).toBeGreaterThan(fraction.top);
			await expect(page.locator("mtable mtr")).toHaveCount(2);
			const matrixRows = await page
				.locator("mtable mtr")
				.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().top));
			expect(matrixRows[1]).toBeGreaterThan(matrixRows[0]);
			const superscript = await page.locator("msup").evaluate((element) => ({
				base: element.children[0].getBoundingClientRect().top,
				exponent: element.children[1].getBoundingClientRect().top,
			}));
			expect(superscript.exponent).toBeLessThan(superscript.base);
			await expect(page.locator(".praxity-math-block").last()).toHaveText("\\invalid{");
			for (const code of await page.locator("[data-code-content]").all()) {
				expect(
					await code
						.locator("[data-code-line]")
						.evaluateAll((lines) => lines.map((line) => line.textContent)),
				).toEqual(["const answer = 42;", "", '\tconsole.log("<safe>");', ""]);
				const rows = await code.locator(".praxity-code-line").evaluateAll((lines) =>
					lines.map((line) => {
						const rect = line.getBoundingClientRect();
						return {
							top: rect.top,
							bottom: rect.bottom,
							height: rect.height,
							lineHeight: Number.parseFloat(getComputedStyle(line).lineHeight),
						};
					}),
				);
				for (let i = 0; i < rows.length; i++) {
					expect(rows[i].height).toBeCloseTo(rows[i].lineHeight, 0);
					if (i > 0) expect(rows[i].top - rows[i - 1].bottom).toBeCloseTo(0, 0);
				}
				await expect(code.locator(".praxity-code-line--highlighted [data-code-line]")).toHaveText(
					'console.log("<safe>");',
				);
			}
			await expect(page.locator(".praxity-code-line-number")).toHaveText(["4", "5", "6", "7"]);
			await page.screenshot({
				path: testInfo.outputPath(`equation-code-${mode}.png`),
				fullPage: true,
			});
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
			).toBe(true);
		} finally {
			await context.close();
		}
	});
}

test("code Copy preserves source or leaves the readable fallback when clipboard is unavailable", async ({
	page,
	context,
	browserName,
}, testInfo) => {
	if (browserName === "chromium") {
		await context.grantPermissions(["clipboard-read", "clipboard-write"]);
		await page.addInitScript(() => {
			const write = navigator.clipboard.writeText.bind(navigator.clipboard);
			navigator.clipboard.writeText = (text) => {
				(window as Window & { clipboardSource?: string }).clipboardSource = text;
				return write(text);
			};
		});
	} else
		await page.addInitScript(() =>
			Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }),
		);
	await page.goto(`${readTestEnv().url}/inline-features/equation-and-code-fidelity.html`);
	await waitForHydration(page);
	const code = page.locator(".praxity-code-container").first();
	await code.scrollIntoViewIfNeeded();
	await expect(page.locator('[data-island="code"]').first()).toHaveAttribute("data-hydrated", "");
	await code.getByRole("button", { name: "Copy code to clipboard" }).click();
	if (browserName === "chromium") {
		await expect(code.locator("[data-code-copy-status]")).toHaveText("Copied to clipboard");
		const source = 'const answer = 42;\n\n\tconsole.log("<safe>");\n';
		expect(
			await page.evaluate(() => (window as Window & { clipboardSource?: string }).clipboardSource),
		).toBe(source);
		// Windows converts newlines in the native clipboard. Verify the API input
		// exactly, then compare native read-back with only CRLF conversion removed.
		const copied = await page.evaluate(() => navigator.clipboard.readText());
		expect(copied.replace(/\r\n/g, "\n")).toBe(source);
	} else {
		const fallback = page.locator(".praxity-code-container").last().locator("[data-code-content]");
		await expect(fallback).toBeVisible();
		await expect(code.locator("[data-code-copy-status]")).toBeEmpty();
		await fallback.selectText();
		const selection = await page.evaluate(() => getSelection()?.toString() ?? "");
		await testInfo.attach("clipboard-fallback-selection", {
			body: JSON.stringify(selection),
			contentType: "application/json",
		});
		expect(selection).toContain("const answer = 42;");
		expect(selection).toContain('\tconsole.log("<safe>");');
	}
});

for (const small of [false, true]) {
	test(`variable defaults render in ${small ? "small" : "full"} previews`, async ({ page }) => {
		await page.goto(
			`${readTestEnv().url}/inline-features/variable-values.html${small ? "?minimal=1&praxity-small-preview=1" : ""}`,
		);
		await expect(page.locator('[data-mention="variable:learnerName"]')).toHaveText("Taylor");
		await expect(page.locator("code")).toHaveText("{{learnerName}}");
	});
}

for (const small of [false, true]) {
	test(`inline emphasis and doodles are visible in ${small ? "small" : "full"} previews`, async ({
		page,
	}) => {
		await page.goto(
			`${readTestEnv().url}/inline-features/visible-formatting.html${small ? "?minimal=1&praxity-small-preview=1" : ""}`,
		);
		const bold = page.locator("strong").filter({ hasText: "bold text" });
		await expect(bold).toBeVisible();
		expect(
			await bold.evaluate(
				(el) =>
					el.parentElement !== null &&
					Number(getComputedStyle(el).fontWeight) >
						Number(getComputedStyle(el.parentElement).fontWeight),
			),
		).toBe(true);
		const mark = page.locator("mark");
		await expect(mark).toBeVisible();
		expect(await mark.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
			"rgba(0, 0, 0, 0)",
		);
		const box = page.locator('[data-doodle="box"]');
		await expect(box).toBeVisible();
		expect(await box.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
		const arrow = page.locator('[data-doodle="arrow"]');
		await expect(arrow).toBeVisible();
		expect(await arrow.evaluate((element) => getComputedStyle(element).textDecorationLine)).toBe(
			"underline",
		);
		await expect(
			page.locator("svg[data-praxity-doodle-decoration], svg.rough-annotation"),
		).toHaveCount(0);
	});
}

test("small previews retain inline output without starting learner runtimes", async ({ page }) => {
	const scripts: string[] = [];
	page.on("request", (request) => {
		if (request.resourceType() === "script") scripts.push(request.url());
	});
	await page.goto(
		`${readTestEnv().url}/inline-features/cross-block-formatting.html?minimal=1&praxity-small-preview=1`,
	);
	await expect(page.locator("html")).toHaveAttribute("data-praxity-small-preview", "true");
	await expect(page.locator("td svg.praxity-inline-icon")).toBeVisible();
	await expect(page.locator(".praxity-disclosure-heading svg.praxity-inline-icon")).toBeVisible();
	await expect(page.locator(".praxity-footnote-ref")).toHaveCount(2);
	await expect(
		page.locator("nav:visible, .praxity-top-bar:visible, .praxity-embed-nav:visible"),
	).toHaveCount(0);
	await expect(page.locator("[data-tooltip-enhanced]")).toHaveCount(0);
	expect(scripts.some((url) => /island-(?:nav|assessment|narration|tooltip)/.test(url))).toBe(
		false,
	);
	expect(
		await page.evaluate(() => ({
			host: (window as Window & { __praxityHostStarted?: unknown }).__praxityHostStarted,
			storage: Object.keys(localStorage),
		})),
	).toEqual({ host: undefined, storage: [] });
});

test("prepared inline fields survive container activation and keyboard use", async ({
	page,
}, testInfo) => {
	await page.goto(`${readTestEnv().url}/inline-features/cross-block-formatting.html`);
	await waitForHydration(page);
	await expect(page.locator("td strong")).toHaveText("Mail");
	await expect(page.locator("td svg.praxity-inline-icon")).toBeVisible();
	await expect(page.locator(".praxity-disclosure-heading svg.praxity-inline-icon")).toBeVisible();
	await expect(page.locator(".praxity-footnote-ref")).toHaveText(["Footnote [1]", "Footnote [2]"]);
	await expect(page.getByRole("list", { name: "Sources" }).getByRole("listitem")).toHaveText([
		"Table source.",
		"Heading source.",
	]);
	const glossaryTerm = page.locator("td .inline-tooltip-trigger");
	await glossaryTerm.focus();
	await page.keyboard.press("Enter");
	await expect(glossaryTerm).toHaveAttribute("aria-expanded", "true");
	await expect(page.locator(".inline-tooltip-popover")).toHaveAttribute("tabindex", "0");
	await page.keyboard.press("Escape");
	await expect(glossaryTerm).toHaveAttribute("aria-expanded", "false");
	await page.locator("[data-disclosure-trigger]").focus();
	await page.keyboard.press("Enter");
	await expect(page.locator('.praxity-doodle a[href="https://example.com/manual"]')).toBeVisible();
	const highlight = page.locator('[data-doodle="highlight"]');
	expect(await highlight.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
		"rgba(0, 0, 0, 0)",
	);
	await expect(page.locator("svg.rough-annotation")).toHaveCount(0);
	await highlight
		.locator("..")
		.screenshot({ path: testInfo.outputPath("highlight-neighbor-text.png") });
	const results = await analyzeAxe(
		page,
		new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]),
	);
	expect(results.violations).toEqual([]);
});

test("footnotes preserve numbering and accordion placement after hydration", async ({ page }) => {
	const url = `${readTestEnv().url}/inline-features`;
	await page.goto(`${url}/index.html`);
	await waitForHydration(page);
	const pages = await page.evaluate(
		() =>
			JSON.parse(document.getElementById("praxity-config")?.textContent ?? "{}").pages as Array<{
				slug: string;
			}>,
	);
	await page.goto(`${url}/${pages[0].slug}.html`);
	await waitForHydration(page);
	await expect(page.locator(".praxity-footnote-ref")).toHaveText(["Footnote [1]", "Footnote [2]"]);
	const icons = page.locator("main svg.praxity-inline-icon");
	await expect(icons).toHaveCount(2);
	for (const icon of await icons.all()) {
		await expect(icon).toBeVisible();
		await expect(icon).toHaveAttribute("aria-hidden", "true");
		await expect(icon).toHaveAttribute("focusable", "false");
		expect(await icon.locator("path").count()).toBeGreaterThan(0);
	}
	await expect(page.locator(".praxity-footnote-ref a, .praxity-footnote-ref button")).toHaveCount(
		0,
	);
	const toggle = page.locator("[data-disclosure-trigger]").filter({ hasText: "Sources" });
	await toggle.focus();
	await page.keyboard.press("Enter");
	const list = page.getByRole("list", { name: "Sources", exact: true });
	await expect(list).toBeVisible();
	await expect(list.getByRole("listitem")).toHaveText([
		"First source, 2026.",
		"Second source with details.",
	]);
	expect(
		await page
			.locator(".praxity-footnote-ref")
			.evaluateAll((elements) => elements.every((el) => el.getAttribute("tabindex") === null)),
	).toBe(true);
	const results = await analyzeAxe(
		page,
		new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]),
	);
	expect(results.violations).toEqual([]);
	await page.goto(`${url}/${pages[1].slug}.html`);
	await waitForHydration(page);
	await expect(page.locator(".praxity-footnote-ref")).toHaveText(["Footnote [1]"]);
	await expect(page.getByRole("list", { name: "Sources" })).toBeVisible();
});

test("footnotes remain readable without JavaScript at narrow widths", async ({ browser }) => {
	const context = await browser.newContext({
		javaScriptEnabled: false,
		viewport: { width: 320, height: 640 },
	});
	try {
		const page = await context.newPage();
		await page.goto(`${readTestEnv().url}/inline-features/another-page.html`);
		await expect(page.locator("main svg.praxity-inline-icon")).toBeVisible();
		await expect(page.locator(".praxity-footnote-ref")).toContainText("[1]");
		await expect(page.getByRole("list", { name: "Sources" })).toContainText("Third source.");
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
			true,
		);
	} finally {
		await context.close();
	}
});

test("decorates inline feedback revealed after an assessment answer", async ({ page }) => {
	await page.goto(`${readTestEnv().url}/inline-features/assessment-feedback.html`);
	await waitForHydration(page);
	await page.getByRole("radio", { name: "A telescope as a decoration", exact: true }).check();
	await page.getByRole("button", { name: /^(Check|Submit)/ }).click();
	const block = page.locator('[data-island="assessment"]');
	const feedback = page.locator("[data-assessment-feedback]");
	await expect(feedback).toBeVisible();
	await expect(feedback).not.toContainText("@highlight");
	const highlight = feedback.locator('[data-doodle="highlight"][data-doodle-mods="purple"]');
	await expect(highlight).toHaveText('Review "The calibration of a telescope".');
	await expect(feedback.locator("svg.rough-annotation")).toHaveCount(0);
	expect(
		await feedback
			.locator('[data-doodle="highlight"]')
			.evaluate((element) => getComputedStyle(element).backgroundColor),
	).not.toBe("rgba(0, 0, 0, 0)");
	await expect(
		block.locator("[data-assessment-retry], [data-assessment-continue]").first(),
	).toBeFocused();
	await expect(
		block.locator("[data-assessment-retry], [data-assessment-continue]").first(),
	).toHaveAccessibleDescription('Not quite Review "The calibration of a telescope".');
});
