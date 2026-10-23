import { expect, test } from "@playwright/test";
import { readTestEnv } from "./helpers";

const root = () => `${readTestEnv().url}/design-navigation`;
test("retired card shadows leave reading cards on plain paper", async ({ page }) => {
	for (const slug of ["default", "override"]) {
		await page.goto(`${root()}/defaults-card-shadow/${slug}.html`);
		const card = page.locator("[data-card-item]").first();
		await expect(card).toBeVisible();
		await expect(card).toHaveCSS("box-shadow", "none");
	}
});

test("retired tab orientation keeps one horizontal label row", async ({ page }) => {
	for (const [slug, _retiredVertical] of [
		["default", true],
		["override", false],
	] as const) {
		await page.goto(`${root()}/defaults-tabs-orientation/${slug}.html`);
		const tabs = page.getByRole("tab");
		await expect(tabs).toHaveCount(2);
		const [first, second] = await tabs.evaluateAll((nodes) =>
			nodes.map((node) => {
				const { x, y } = node.getBoundingClientRect();
				return { x, y };
			}),
		);
		expect(second.y).toBeCloseTo(first.y, 0);
		expect(second.x).toBeGreaterThan(first.x);
	}
});

for (const mode of ["small", "full"]) {
	const query = mode === "small" ? "?minimal=1&praxity-small-preview=1" : "";
	test(`${mode} comparison default selects slider while explicit side-by-side keeps its content layout`, async ({
		page,
	}) => {
		await page.goto(`${root()}/defaults-comparison-layout/default.html${query}`);
		await expect(page.locator(".praxity-comparison-slider")).toBeVisible();
		await page.goto(`${root()}/defaults-comparison-layout/override.html${query}`);
		await expect(page.locator(".praxity-comparison-slider")).toHaveCount(0);
		await expect(page.getByText("Before", { exact: true }).first()).toBeVisible();
	});
	test(`${mode} signature default changes the initially visible input`, async ({ page }) => {
		for (const [slug, visible] of [
			["default", "type"],
			["override", "draw"],
		]) {
			await page.goto(`${root()}/defaults-signature-mode/${slug}.html${query}`);
			await expect(page.locator(`[data-signature-panel="${visible}"]`)).toBeVisible();
		}
	});
}

for (const [setting, selector] of [
	["outline", "#course-nav-sidebar"],
	["header", ".praxity-top-bar"],
	["side-arrows", ".praxity-edge-arrow-nav a"],
	["inpage", ".praxity-floating-toc"],
]) {
	test(`${setting} controls full preview navigation and stays absent in small preview`, async ({
		page,
	}) => {
		for (const enabled of [true, false]) {
			await page.goto(`${root()}/${setting}-${enabled}/navigation.html`);
			if (enabled) await expect(page.locator(selector)).toBeVisible();
			else
				for (const element of await page.locator(selector).all())
					await expect(element).toBeHidden();
			await page.goto(
				`${root()}/${setting}-${enabled}/navigation.html?minimal=1&praxity-small-preview=1`,
			);
			for (const element of await page.locator(selector).all()) await expect(element).toBeHidden();
		}
	});
}

test("reading tools use each selected region or disappear when hidden", async ({ page }) => {
	for (const [placement, region] of [
		["topBar", ".praxity-top-bar"],
		["bottomBar", ".praxity-page-nav-tools"],
		["sidebar", "#course-nav-sidebar"],
		["none", ""],
	]) {
		await page.goto(`${root()}/reading-${placement}/navigation.html`);
		if (placement === "none")
			await expect(page.locator("#praxity-a11y-preferences")).toHaveCount(0);
		else await expect(page.locator(`${region} #praxity-a11y-preferences`)).toBeVisible();
	}
});
test("glossary toggle changes the generated destination", async ({ page }) => {
	for (const enabled of [true, false]) {
		await page.goto(`${root()}/glossary-${enabled}/navigation.html`);
		const links = page.locator('a[href="glossary.html"]');
		if (enabled) await expect(links.first()).toBeVisible();
		else await expect(links).toHaveCount(0);
	}
});
test("brand placement and light/dark variants work while small preview suppresses branding", async ({
	page,
}) => {
	for (const placement of ["header", "sidebar"]) {
		await page.goto(`${root()}/brand-${placement}/navigation.html`);
		const region = placement === "header" ? ".praxity-top-bar" : "#course-nav-sidebar";
		await page.emulateMedia({ colorScheme: "light" });
		await expect(page.locator(`${region} .praxity-brand-logo--light`)).toBeVisible();
		await expect(page.locator(`${region} .praxity-brand-logo--dark`)).toBeHidden();
		await page.emulateMedia({ colorScheme: "dark" });
		await expect(page.locator(`${region} .praxity-brand-logo--dark`)).toBeVisible();
		await expect(page.locator(`${region} .praxity-brand-logo--light`)).toBeHidden();
		await page.goto(
			`${root()}/brand-${placement}/navigation.html?minimal=1&praxity-small-preview=1`,
		);
		for (const image of await page.locator(".praxity-brand-logo").all())
			await expect(image).toBeHidden();
	}
	for (const state of ["hidden", "removed"]) {
		await page.goto(`${root()}/brand-${state}/navigation.html`);
		await expect(page.locator(".praxity-brand-logo")).toHaveCount(0);
	}
	await page.goto(`${root()}/brand-only-dark/navigation.html`);
	await expect(page.locator(".praxity-brand-logo--dark")).toBeVisible();
});

for (const [preset, visible] of [
	["sidebar", "#course-nav-sidebar"],
	["bottomBar", ".praxity-top-bar"],
	["slides", ".praxity-slide-nav"],
	["scroll", ".praxity-floating-toc"],
	["minimal", ".praxity-progress-dots"],
	["embedded", ".praxity-native-page-nav"],
	["none", "main"],
]) {
	test(`${preset} preset renders its navigation and suppresses it in small preview`, async ({
		page,
	}) => {
		await page.goto(`${root()}/preset-${preset}/navigation.html`);
		await expect(page.locator(visible).first()).toBeVisible();
		if (preset === "none") await expect(page.locator("#praxity-a11y-preferences")).toHaveCount(0);
		await page.goto(`${root()}/preset-${preset}/navigation.html?minimal=1&praxity-small-preview=1`);
		for (const item of await page
			.locator(
				"#course-nav-sidebar, .praxity-top-bar, .praxity-slide-nav, .praxity-native-page-nav, .praxity-floating-toc, #praxity-a11y-preferences",
			)
			.all())
			await expect(item).toBeHidden();
	});
}
for (const mode of ["bar", "dots", "dotsArrows", "hidden"]) {
	test(`bottom navigation ${mode} controls visible progress and arrows`, async ({ page }) => {
		await page.goto(`${root()}/bottom-${mode}/navigation.html`);
		if (mode === "bar")
			await expect(page.locator('.praxity-pages-progress[role="progressbar"]')).toBeVisible();
		else if (mode === "hidden")
			await expect(page.locator(".praxity-slide-nav, .praxity-native-page-nav")).toHaveCount(0);
		else {
			await expect(page.locator(".praxity-progress-dots")).toBeVisible();
			await expect(page.locator(".praxity-slide-nav__arrow")).toHaveCount(
				mode === "dotsArrows" ? 2 : 0,
			);
		}
	});
}
for (const mode of ["small", "full"]) {
	test(`${mode} card transition default reaches the active slide deck`, async ({ page }) => {
		const query = mode === "small" ? "?minimal=1&praxity-small-preview=1" : "";
		for (const [slug, transition] of [
			["default", "slide"],
			["override", "none"],
		]) {
			await page.goto(`${root()}/defaults-card-transition/${slug}.html${query}`);
			await expect(page.locator("[data-card-root]")).toHaveAttribute("data-layout", "single");
			await expect(page.locator(".praxity-slides-grid")).toHaveAttribute(
				"data-transition",
				transition,
			);
			await expect(page.locator(".praxity-slides-grid")).toBeVisible();
			const active = page.locator('.praxity-slides-item[data-active="true"]');
			await expect(active).toHaveCSS("opacity", "1");
			await expect(active).toHaveCSS("transform", /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
			await page.emulateMedia({ reducedMotion: "reduce" });
			// The global reduced-motion guard permits 0.01ms to preserve transition events.
			await expect
				.poll(() =>
					active.evaluate((element) =>
						Number.parseFloat(getComputedStyle(element).transitionDuration),
					),
				)
				.toBeLessThanOrEqual(0.00001);
			await expect(active).toHaveCSS("transform", /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
			await page.emulateMedia({ reducedMotion: "no-preference" });
		}
	});
}

test("full assessment group default accepts one selected question while explicit all requires both", async ({
	page,
}) => {
	await page.goto(`${root()}/defaults-assessment-group-mode/default.html`);
	await expect(page.locator(".praxity-assessment-group-picker")).toBeVisible();
	await expect(
		page.getByRole("radio", { name: "Second correct answer", exact: true }),
	).toBeHidden();
	await page.getByRole("radio", { name: "Correct answer", exact: true }).check();
	await page.getByRole("button", { name: "Submit selected", exact: true }).click();
	await expect(page.locator("[data-assessment-group-results]")).toContainText("Score: 100%");
	await expect(page.locator("[data-assessment-group-results]")).toContainText("Passed");
	await page.goto(`${root()}/defaults-assessment-group-mode/override.html`);
	await expect(page.locator(".praxity-assessment-group-picker")).toHaveCount(0);
	await page.getByRole("radio", { name: "Correct answer", exact: true }).check();
	await page.getByRole("button", { name: "Submit all", exact: true }).click();
	await expect(page.locator(".praxity-ag-required-error")).toBeVisible();
	await expect(page.locator("[data-assessment-group-results]")).not.toContainText("Score:");
	await page.getByRole("radio", { name: "Second correct answer", exact: true }).check();
	await page.getByRole("button", { name: "Submit all", exact: true }).click();
	await expect(page.locator("[data-assessment-group-results]")).toContainText("Score: 100%");
	await expect(page.locator("[data-assessment-group-results]")).toContainText("Passed");
});

test("small assessment group preserves default and override modes with inert question content", async ({
	page,
}) => {
	for (const [slug, mode] of [
		["default", "oneOf"],
		["override", "all"],
	]) {
		await page.goto(
			`${root()}/defaults-assessment-group-mode/${slug}.html?minimal=1&praxity-small-preview=1`,
		);
		await expect(page.locator("html")).toHaveAttribute("data-praxity-small-preview-ready", "true");
		await expect(page.getByRole("heading", { name: "Knowledge check", exact: true })).toBeVisible();
		const compiledMode = await page
			.locator("#praxity-config")
			.evaluate(
				(element) =>
					JSON.parse(element.textContent ?? "{}").blocks.find(
						(block: { type: string }) => block.type === "assessmentGroup",
					).data.mode,
			);
		expect(compiledMode).toBe(mode);
		await expect(page.getByRole("radio", { name: "Correct answer", exact: true })).toBeDisabled();
		const members = page.locator('[data-island="assessment"]');
		await expect(members).toHaveCount(2);
		await expect(members.last().locator('input[type="radio"]').first()).toBeDisabled();
		const picker = page.locator(".praxity-assessment-group-picker");
		if (mode === "oneOf") {
			await expect(members.last()).toBeHidden();
			await expect(picker).toBeVisible();
			await expect(picker.locator("input")).toHaveCount(2);
			await expect(picker.locator("input").first()).toBeChecked();
			await expect(picker.locator("input").first()).toBeDisabled();
			await expect(picker.locator("input").last()).toBeDisabled();
		} else {
			await expect(
				page.getByRole("radio", { name: "Second correct answer", exact: true }),
			).toBeVisible();
			await expect(picker).toHaveCount(0);
		}
	}
});
