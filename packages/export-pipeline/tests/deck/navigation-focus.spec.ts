import { expect, test } from "../fixtures/published-navigation";
import { expectFocusRing, expectNoFocusRing } from "../focus-assertions";

for (const tabindex of [null, "0"]) {
	for (const mode of ["deck", "pages"]) {
		test(`${mode} restores original heading tabindex ${tabindex} and class after navigation focus`, async ({
			page,
			publishedNavigation,
		}) => {
			await page.addInitScript((original) => {
				const observer = new MutationObserver(() => {
					for (const heading of document.querySelectorAll<HTMLElement>("h1")) {
						if (heading.textContent?.trim() !== "Second slide" || heading.dataset.authored)
							continue;
						heading.dataset.authored = "true";
						heading.classList.add("authored-heading");
						if (original !== null) heading.setAttribute("tabindex", original);
					}
				});
				observer.observe(document, { childList: true, subtree: true });
			}, tabindex);
			await page.goto(`${publishedNavigation}/${mode}-en/index.html`);
			if (mode === "deck") {
				await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
				await page.locator("#deck-next").click();
			} else {
				await page.locator('#praxity-page-nav a[data-page-direction="next"]').click();
			}
			const heading = page.getByRole("heading", { name: "Second slide", exact: true });
			await expect(heading).toBeFocused();
			await expect(heading).toHaveAttribute("tabindex", "-1");
			await page
				.locator(
					mode === "deck"
						? "#deck-previous"
						: '#praxity-page-nav a[data-page-direction="previous"]',
				)
				.focus();
			if (tabindex === null) await expect(heading).not.toHaveAttribute("tabindex");
			else await expect(heading).toHaveAttribute("tabindex", tabindex);
			await expect(heading).toHaveClass(/authored-heading/);
			await expect(heading).not.toHaveClass(/praxity-navigation-focus/);
			if (mode === "deck") {
				await page.locator("#deck-previous").click();
				const departed = page.locator("#page-2 h1");
				if (tabindex === null) await expect(departed).not.toHaveAttribute("tabindex");
				else await expect(departed).toHaveAttribute("tabindex", tabindex);
			}
		});
	}
}

test("narration End, Home and play keep slider focus while the slide and title update", async ({
	page,
	publishedNavigation,
}) => {
	await page.goto(`${publishedNavigation}/narrated-en/index.html?praxity-inspect=1`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	const slider = page.locator('input[type="range"]');
	await expect(slider).toBeEnabled();
	await slider.focus();
	await page.keyboard.press("End");
	await expect(page.locator("#page-3")).toBeVisible();
	await expect(page).toHaveTitle("Third slide");
	await expect(slider).toBeFocused();
	await page.keyboard.press("Home");
	await expect(page.locator("#page-1")).toBeVisible();
	await expect(page).toHaveTitle("First slide");
	await expect(slider).toBeFocused();
	// Start playback without moving focus to the play button.
	await page
		.locator(".praxity-narration-transport button")
		.evaluate((button: HTMLButtonElement) => button.click());
	await expect(page.locator("#page-1")).toBeVisible();
	await expect(page).toHaveTitle("First slide");
	await expect(slider).toBeFocused();
	const audio = page.locator("[data-narration-player]");
	await expect(audio).toHaveJSProperty("paused", false);
	await audio.evaluate((element) => element.dispatchEvent(new Event("ended")));
	await expect(page.locator("#page-2")).toBeVisible();
	await expect(page).toHaveTitle("Second slide");
	await expect(slider).toBeFocused();
});

for (const locale of ["en", "fr"]) {
	test(`deck ${locale} navigation focuses headings and names the next lesson`, async ({
		page,
		publishedNavigation,
	}) => {
		await page.goto(`${publishedNavigation}/deck-${locale}/index.html`);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await expect(page.locator("body")).toBeFocused();
		await page.locator("#deck-next").focus();
		await page.keyboard.press("Enter");
		await expect(page.getByRole("heading", { name: "Second slide", exact: true })).toBeFocused();
		await expectNoFocusRing(page.getByRole("heading", { name: "Second slide", exact: true }));
		await page.locator("#deck-previous").focus();
		await page.keyboard.press("Enter");
		await expect(page.getByRole("heading", { name: "First slide", exact: true })).toBeFocused();
		await page.locator("#deck-next").click();
		await page.locator("#deck-next").click();
		await page.locator("#deck-next").click();
		const name =
			locale === "fr" ? "Module suivant : Destination lesson" : "Next module: Destination lesson";
		await expect(page.locator("#deck-completion button")).toHaveCount(1);
		await expect(page.locator("#deck-next")).toHaveAccessibleName(name);
		await page.locator("#deck-next").click();
		await expect(page).toHaveURL(/destination-heading\.html.*#page-4$/);
		await expect(
			page.getByRole("heading", { name: "Destination heading", exact: true }),
		).toBeFocused();
		await Promise.all([page.waitForNavigation(), page.evaluate(() => location.reload())]);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await expect(
			page.getByRole("heading", { name: "Destination heading", exact: true }),
		).toBeVisible();
		await expect(page.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
		await expect(page.locator("body")).toBeFocused();
		// Fresh course entry still resumes and focuses the saved destination.
		await page.goto("about:blank");
		await page.goto(`${publishedNavigation}/deck-${locale}/index.html`);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await expect(
			page.getByRole("heading", {
				name:
					locale === "fr"
						? "Reprise à la diapositive 1 sur 1 : Destination heading"
						: "Resumed at slide 1 of 1: Destination heading",
				exact: true,
			}),
		).toBeFocused();
	});
}

for (const panel of ["outline", "script"]) {
	test(`narrow ${panel} navigation exposes and focuses destination content`, async ({
		page,
		publishedNavigation,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`${publishedNavigation}/deck-en/index.html`);
		const deck = page.locator(".praxity-deck");
		await expect(deck).toHaveAttribute("data-ready", "true");
		await page.locator("#deck-more-toggle").click();
		await page.locator(`#deck-${panel}-toggle`).click();
		await expect(deck).toHaveAttribute("data-panel", panel);
		await expect(page.locator("#main-content")).toHaveJSProperty("inert", true);
		if (panel === "outline") {
			await page.locator('#deck-outline a[data-deck-page="page-2"]').focus();
			await page.keyboard.press("Enter");
		} else {
			await page.keyboard.press("ArrowRight");
		}
		await expect(deck).toHaveAttribute("data-panel", "");
		await expect(page.locator("#main-content")).toHaveJSProperty("inert", false);
		await expect(page.getByRole("heading", { name: "Second slide", exact: true })).toBeFocused();
		await page.reload();
		await expect(deck).toHaveAttribute("data-ready", "true");
		await expect(deck).toHaveAttribute("data-panel", "");
		await expect(page.locator("#main-content")).toHaveJSProperty("inert", false);
	});
}

test("deck heading-free slide focuses main content", async ({ page, publishedNavigation }) => {
	await page.goto(`${publishedNavigation}/headless-en/index.html`);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await page.locator("#deck-next").click();
	await expect(page.locator("#page-2 h1, #page-2 h2")).toHaveCount(0);
	await expect(page.locator("#main-content")).toBeFocused();
	await expect(page.locator("#main-content")).toHaveAttribute("tabindex", "0");
	await page.locator("#deck-previous").click();
	await page.keyboard.press("Tab");
	await page.locator("#deck-next").focus();
	await page.keyboard.press("Enter");
	await expect(page.locator("#main-content")).toBeFocused();
	await expectFocusRing(page.locator("#main-content"), 3, true, "Highlight");
});

test("Pages navigation focuses the destination heading", async ({ page, publishedNavigation }) => {
	await page.goto(`${publishedNavigation}/pages-en/index.html`);
	const next = page.locator('#praxity-page-nav a[data-page-slug="second-slide"]');
	await expect(next).toBeVisible();
	await next.focus();
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/second-slide\.html/);
	await expect(page.getByRole("heading", { name: "Second slide", exact: true })).toBeFocused();
});

for (const mode of ["deck", "pages"]) {
	test(`${mode} navigation skips a hidden destination heading`, async ({
		page,
		publishedNavigation,
	}) => {
		await page.addInitScript(() => {
			const observer = new MutationObserver(() => {
				for (const heading of document.querySelectorAll<HTMLElement>("h1"))
					if (heading.textContent?.trim() === "Second slide") heading.style.display = "none";
			});
			observer.observe(document, { childList: true, subtree: true });
		});
		await page.goto(`${publishedNavigation}/${mode}-en/index.html`);
		if (mode === "deck") {
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await page.locator("#deck-next").click();
		} else {
			await page.locator('#praxity-page-nav a[data-page-slug="second-slide"]').click();
			await expect(page).toHaveURL(/second-slide\.html/);
		}
		await expect(page.getByRole("heading", { name: "Section heading", exact: true })).toBeFocused();
	});
}
