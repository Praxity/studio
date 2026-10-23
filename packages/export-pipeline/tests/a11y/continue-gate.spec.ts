import { expect, test } from "@playwright/test";
import { readTestEnv } from "./helpers";

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		const mute = () => {
			for (const media of document.querySelectorAll<HTMLMediaElement>("audio, video"))
				media.muted = true;
		};
		new MutationObserver(mute).observe(document, { childList: true, subtree: true });
	});
	await page.goto(`${readTestEnv().url}/continue-gate/en/safety.html`);
	await expect(page.locator('[data-island="nav"]').first()).toHaveAttribute("data-hydrated", "");
});

test("blocked Continue remains visible and discoverable with the authored reason and no live destinations", async ({
	page,
}) => {
	const next = page.locator(".praxity-nav-next[data-continue-button]");
	await expect(next).toBeVisible();
	await expect(next).toHaveAttribute("aria-disabled", "true");
	await expect(next).toHaveAccessibleDescription(
		"Select Ready in the safety check before continuing.",
	);
	await expect(page.locator("[data-completion-reason]")).toBeVisible();
	await expect(page.locator("#praxity-page-nav [data-completion-reason]")).toHaveCount(1);
	for (const control of await page.locator("[data-continue-button]").all()) {
		await expect(control).toHaveAttribute("aria-disabled", "true");
		await expect(control).not.toHaveAttribute("href");
	}
	await next.focus();
	await page.keyboard.press("Shift+Tab");
	await expect(next).not.toBeFocused();
	await page.keyboard.press("Tab");
	await expect(next).toBeFocused();
	await page.screenshot({ path: test.info().outputPath("blocked-continue.png"), fullPage: true });
	await page.emulateMedia({ forcedColors: "active" });
	await expect(next).toBeVisible();
	await expect(page.locator("[data-completion-reason]")).toBeVisible();
	await page.setViewportSize({ width: 320, height: 720 });
	await expect(page.locator("[data-completion-reason]")).toBeVisible();
	const reasonBounds = await page.locator("[data-completion-reason]").evaluate((element) => {
		const bounds = element.getBoundingClientRect();
		return { left: bounds.left, right: bounds.right, viewport: window.innerWidth };
	});
	expect(reasonBounds.left).toBeGreaterThanOrEqual(0);
	expect(reasonBounds.right).toBeLessThanOrEqual(reasonBounds.viewport);
	const landmarks = await page
		.locator('main, nav, [role="region"], section[aria-label], section[aria-labelledby]')
		.evaluateAll((nodes) =>
			nodes.map((node) => ({ tag: node.tagName, name: node.getAttribute("aria-label") })),
		);
	expect(landmarks.filter((landmark) => landmark.tag === "MAIN")).toHaveLength(1);
});

test("pointer, Enter, AT-style activation, modified click, shortcut, swipe and outline jumps stay blocked", async ({
	page,
}) => {
	const next = page.locator(".praxity-nav-next[data-continue-button]");
	// Playwright intentionally refuses pointer activation of aria-disabled controls.
	await next.dispatchEvent("click", { button: 0 });
	await next.focus();
	await page.keyboard.press("Enter");
	await next.evaluate((element: HTMLElement) => element.click());
	await next.dispatchEvent("click", { button: 0, ctrlKey: true });
	await next.dispatchEvent("auxclick", { button: 1 });
	await page.locator("main").focus();
	await page.keyboard.press("ArrowRight");
	await page.locator("main").evaluate((element) => {
		for (const [type, x] of [
			["touchstart", 200],
			["touchend", 20],
		] as const) {
			const event = new Event(type, { bubbles: true });
			Object.defineProperty(event, type === "touchstart" ? "touches" : "changedTouches", {
				value: [{ clientX: x, clientY: 200 }],
			});
			element.dispatchEvent(event);
		}
	});
	const jump = page.locator('[data-page-slug="next"]').first();
	await expect(jump).not.toHaveAttribute("href");
	await jump.evaluate((element: HTMLElement) => element.click());
	await expect(page).toHaveURL(/\/safety\.html$/);
	await expect(page.locator("[data-completion-reason]")).toBeVisible();
	for (const control of await page.locator("[data-continue-button]").all())
		await expect(control).not.toHaveAttribute("href");
});

test("a newly blocked focused Continue retains focus, recovery restores destinations, and another focus is not stolen", async ({
	page,
}) => {
	const next = page.locator(".praxity-nav-next[data-continue-button]");
	await page.locator(".praxity-rating-option").nth(2).click();
	await expect(next).not.toHaveAttribute("aria-disabled");
	await next.focus();
	await page
		.locator('[data-island="rating"] input[value="1"]')
		.evaluate((input: HTMLInputElement) => {
			input.checked = true;
			input.dispatchEvent(new Event("change"));
		});
	await expect(next).toHaveAttribute("aria-disabled", "true");
	await expect(next).toBeFocused();
	await page.locator(".praxity-rating-option").nth(2).click();
	await expect(next).not.toHaveAttribute("aria-disabled");
	await expect(next).toHaveAttribute(
		"href",
		`${readTestEnv().url}/continue-gate/en/next.html?praxity-resume=0`,
	);
	await expect(page.locator("[data-completion-reason]")).toHaveCount(0);
	await page.locator('[data-island="rating"] input[value="1"]').focus();
	await page.keyboard.press("Space");
	await expect(next).toHaveAttribute("aria-disabled", "true");
	await expect(page.locator('[data-island="rating"] input[value="1"]')).toBeFocused();
	await page.locator(".praxity-rating-option").nth(2).click();
	await expect(next).not.toHaveAttribute("aria-disabled");
	await next.click();
	await expect(page).toHaveURL(/\/next\.html$/);
});

test("backward recovery is available and legacy gates show the localized fallback", async ({
	page,
}) => {
	await page.locator('.praxity-nav-prev[data-page-direction="previous"]').click();
	await expect(page).toHaveURL(/\/start\.html$/);
	await page.goto(`${readTestEnv().url}/continue-gate/fr/safety.html`);
	await expect(page.locator("[data-completion-reason]")).toHaveText(
		"La page suivante est indisponible.",
	);
	await expect(page.locator(".praxity-nav-next[data-continue-button]")).toHaveAccessibleDescription(
		"La page suivante est indisponible.",
	);
});

test("a restored satisfied prerequisite releases Continue on hydration", async ({ page }) => {
	await page.locator(".praxity-rating-option").nth(2).click();
	await expect(page.locator(".praxity-nav-next[data-continue-button]")).not.toHaveAttribute(
		"aria-disabled",
	);
	await page.reload();
	await expect(page.locator('[data-island="rating"] input[value="3"]')).toBeChecked();
	await expect(page.locator(".praxity-nav-next[data-continue-button]")).not.toHaveAttribute(
		"aria-disabled",
	);
	await page.locator(".praxity-nav-next[data-continue-button]").click();
	await expect(page).toHaveURL(/\/next\.html$/);
});

test("authored forward jumps and completion actions respect the gate", async ({ page }) => {
	await page.evaluate(() => {
		(window as Window & { completionCalls?: string[] }).completionCalls = [];
		window.__praxityRuntime = {
			...window.__praxityRuntime,
			setCompletion: (status: string) => {
				(window as unknown as { completionCalls: string[] }).completionCalls.push(status);
			},
		};
	});
	await page.getByRole("button", { name: "Jump forward" }).click();
	await page.getByRole("button", { name: "Finish lesson" }).click();
	await expect(page).toHaveURL(/\/safety\.html$/);
	expect(
		await page.evaluate(() => (window as unknown as { completionCalls: string[] }).completionCalls),
	).toEqual([]);
	await page.locator(".praxity-rating-option").nth(2).click();
	await expect(page.locator(".praxity-nav-next[data-continue-button]")).not.toHaveAttribute(
		"aria-disabled",
	);
	await page.getByRole("button", { name: "Finish lesson" }).click();
	expect(
		await page.evaluate(() => (window as unknown as { completionCalls: string[] }).completionCalls),
	).toEqual(["completed"]);
});

for (const route of ["proxy", "slides", "bottombar", "en?minimal=1"]) {
	test(`the reason remains visible in ${route} navigation`, async ({ page }) => {
		const [directory, query] = route.split("?");
		await page.goto(
			`${readTestEnv().url}/continue-gate/${directory}/safety.html${query ? `?${query}` : ""}`,
		);
		await expect(page.locator("[data-completion-reason]")).toBeVisible();
		await expect(page.locator("[data-completion-reason]")).toHaveText(
			"Select Ready in the safety check before continuing.",
		);
		await page.setViewportSize({ width: 320, height: 720 });
		await expect(page.locator("[data-completion-reason]")).toBeVisible();
		const reasonBounds = await page.locator("[data-completion-reason]").evaluate((element) => ({
			right: element.getBoundingClientRect().right,
			viewport: window.innerWidth,
		}));
		expect(reasonBounds.right).toBeLessThanOrEqual(reasonBounds.viewport);
		if (route === "proxy") {
			await expect(page.locator("#praxity-page-nav [data-continue-button]")).toBeVisible();
			await page.locator(".praxity-rating-option").nth(2).click();
			await expect(page.locator("[data-completion-reason]")).toHaveCount(0);
			await expect(page.locator("#praxity-page-nav")).toBeHidden();
		}
	});
}
