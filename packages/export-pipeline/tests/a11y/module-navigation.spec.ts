import { expect, type Page, test } from "@playwright/test";
import { MODULE_TITLES } from "./fixtures/module-navigation-fixture";
import { LAYOUT_UNIT, readTestEnv, textFitsWithin, waitForHydration } from "./helpers";

test("module links work without JavaScript", async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		const page = await context.newPage();
		const url = `${readTestEnv().url}/module-navigation-html`;
		await page.goto(`${url}/index.html`);
		const modules = page.locator(".praxity-native-module > a");
		await expect(modules).toHaveCount(MODULE_TITLES.length);
		await modules.nth(1).click();
		await expect(page.locator(".praxity-pages-position")).toHaveText("Page 1 of 2");
		const progress = page.locator(".praxity-pages-progress[role=progressbar]");
		await expect(progress).toHaveAttribute("aria-valuenow", "1");
		await expect(progress).toHaveAttribute("aria-valuemax", "2");
		await expect(page.locator(".praxity-native-module > ol")).toHaveCount(1);
		await page.locator(".praxity-nav-prev").click();
		await expect(page.locator(".praxity-pages-position")).toHaveText("Page 2 of 2");
	} finally {
		await context.close();
	}
});

async function getCoursePages(page: Page, url: string): Promise<Array<{ slug: string }>> {
	await page.goto(`${url}/index.html`);
	await page.waitForSelector("#praxity-config", { state: "attached" });
	return page
		.locator("#praxity-config")
		.evaluate((element) => JSON.parse(element.textContent ?? "{}").pages);
}

for (const format of ["html", "scorm12"]) {
	test(`${format} module links, local counters, focus, Back/Forward and isolated glossary`, async ({
		page,
		context,
	}) => {
		const url = `${readTestEnv().url}/module-navigation-${format}`;
		const pages = await getCoursePages(page, url);
		await page.goto(`${url}/${pages[0].slug}.html`);
		await waitForHydration(page);
		const modules = page.locator(".praxity-native-module > a");
		for (const [index, title] of MODULE_TITLES.entries())
			await expect(modules.nth(index)).toContainText(title);
		await expect(page.locator(".praxity-native-module > ol")).toHaveCount(1);
		await modules.nth(1).focus();
		await page.keyboard.press("ArrowRight");
		await expect(page).toHaveURL(`${url}/${pages[0].slug}.html`);
		await page.keyboard.press("Enter");
		await expect(page).toHaveURL(`${url}/${pages[2].slug}.html`);
		await waitForHydration(page);
		await expect(page.locator("#main-content h1").first()).toBeFocused();
		await expect(page.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
		await expect(page.locator(".praxity-pages-position")).toHaveText("Page 1 of 2");
		await page.locator(".praxity-nav-prev").click();
		await expect(page).toHaveURL(`${url}/${pages[1].slug}.html`);
		await waitForHydration(page);
		await expect(page.locator(".praxity-nav-next .praxity-nav-label-full")).toHaveText(
			"Next Module",
		);
		await page.locator(".praxity-nav-next").click();
		await expect(page).toHaveURL(`${url}/${pages[2].slug}.html`);
		await waitForHydration(page);
		await page.goBack();
		await expect(page).toHaveURL(`${url}/${pages[1].slug}.html`);
		await page.goForward();
		await expect(page).toHaveURL(`${url}/${pages[2].slug}.html`);
		await waitForHydration(page);
		const before = await page.evaluate(() => JSON.stringify(localStorage));
		const popupEvent = context.waitForEvent("page");
		const glossaryLink = page.getByRole("link", { name: "Glossary , (opens in a new tab)" });
		await expect(glossaryLink.locator("svg.praxity-external-icon")).toBeVisible();
		await glossaryLink.click();
		const glossary = await popupEvent;
		await glossary.waitForLoadState();
		await expect(glossary.locator(".praxity-glossary-term")).toHaveCount(4);
		for (const width of [320, 1280]) {
			await glossary.setViewportSize({ width, height: 800 });
			const heading = await glossary.locator("h1").boundingBox();
			const firstTerm = await glossary.locator(".praxity-glossary-term").first().boundingBox();
			if (!heading || !firstTerm) throw new Error("Missing glossary heading or first entry");
			expect(firstTerm.y - (heading.y + heading.height)).toBeGreaterThanOrEqual(24);
		}
		expect(await glossary.evaluate(() => Boolean(window.__praxityRuntime))).toBe(false);
		await expect(glossary.locator("[data-page-direction]")).toHaveCount(0);
		expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(before);
		await expect(page).toHaveURL(`${url}/${pages[2].slug}.html`);
		await glossary.close();
	});
}

test("module drawer remains operable at 400% reflow and in forced colours", async ({ page }) => {
	const url = `${readTestEnv().url}/module-navigation-html`;
	const pages = await getCoursePages(page, url);
	await page.setViewportSize({ width: 320, height: 640 });
	await page.emulateMedia({ forcedColors: "active" });
	await page.goto(`${url}/${pages[0].slug}.html`);
	await waitForHydration(page);
	await page.locator("[data-nav-menu-toggle]").first().click();
	await expect(page.locator('.praxity-course-menu [aria-current="page"]')).toBeFocused();
	const module = page.locator(".praxity-native-module > a").nth(3);
	await module.focus();
	await expect(module).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(`${url}/${pages[6].slug}.html`);
	await waitForHydration(page);
	await expect(page.locator("#main-content h1").first()).toBeFocused();
	await expect(page.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
		true,
	);
});

test("SCORM resumes an exact module page and glossary never calls LMSInitialize", async ({
	page,
	context,
}) => {
	const url = `${readTestEnv().url}/module-navigation-scorm12`;
	const pages = await getCoursePages(page, url);
	await context.addInitScript(() => {
		const values: Record<string, string> = {
			"cmi.core.entry": "resume",
			"cmi.core.lesson_location": "index.html?praxity-page=module-2-page-1",
			"cmi.core.lesson_status": "incomplete",
		};
		Object.assign(window, {
			lmsInitializations: 0,
			API: {
				LMSInitialize: () => {
					(window as unknown as { lmsInitializations: number }).lmsInitializations++;
					return "true";
				},
				LMSFinish: () => "true",
				LMSCommit: () => "true",
				LMSGetValue: (key: string) => values[key] ?? "",
				LMSSetValue: (key: string, value: string) => {
					values[key] = value;
					return "true";
				},
				LMSGetLastError: () => "0",
				LMSGetErrorString: () => "",
				LMSGetDiagnostic: () => "",
			},
		});
	});
	await page.goto(`${url}/index.html`);
	await expect(page).toHaveURL(`${url}/${pages[5].slug}.html`);
	await waitForHydration(page);
	await expect(page.locator(".praxity-pages-position")).toHaveText("Page 2 of 2");
	// The canonical page title differs from the authored H1 in this fixture.
	const summary = page.locator(".praxity-resume-summary");
	await expect(summary).toHaveText("Resumed at page 6 of 8: Module 2 page 1");
	await expect(summary).toMatchAriaSnapshot(
		'- paragraph: "Resumed at page 6 of 8 : Module 2 page 1"',
	);
	expect(await summary.evaluate((element) => element.firstChild?.textContent)).toBe(
		"Resumed at page 6 of 8",
	);
	const hiddenTitle = summary.locator(".praxity-a11y-sr-only");
	await expect(hiddenTitle).toHaveText(": Module 2 page 1");
	expect((await hiddenTitle.boundingBox())?.width).toBe(1);
	expect(await hiddenTitle.evaluate((element) => getComputedStyle(element).clip)).toBe(
		"rect(0px, 0px, 0px, 0px)",
	);
	await expect(summary).toBeVisible();
	await expect(summary).toBeFocused();
	await expect(page.locator("#main-content h1").first()).toHaveText("Module 2: Practice page 2");
	await expect(page.locator("#praxity-live-region")).toBeEmpty();
	await expect(page.locator(".praxity-native-outline")).not.toContainText("Resumed at");
	expect(await page.title()).toBe("Module 2 page 1");
	const popup = context.waitForEvent("page");
	await page.getByRole("link", { name: "Glossary , (opens in a new tab)" }).click();
	const glossary = await popup;
	await glossary.waitForLoadState();
	expect(
		await glossary.evaluate(
			() => (window as unknown as { lmsInitializations: number }).lmsInitializations,
		),
	).toBe(0);
	await glossary.close();
});

for (const javaScriptEnabled of [true, false]) {
	test(`mobile module navigation reflows with JavaScript ${javaScriptEnabled ? "on" : "off"}`, async ({
		browser,
	}) => {
		const context = await browser.newContext({ javaScriptEnabled });
		try {
			const page = await context.newPage();
			const url = `${readTestEnv().url}/module-navigation-html`;
			await page.goto(`${url}/index.html`);
			await page.locator(".praxity-nav-next").click();
			if (javaScriptEnabled) await waitForHydration(page);
			const next = page.locator(".praxity-nav-next");
			await expect(next.locator(".praxity-nav-label-full")).toBeVisible();
			await expect(next.locator(".praxity-nav-label-full")).toHaveText("Next Module");
			await expect(next).toHaveAccessibleName(`Next Module: ${MODULE_TITLES[1]}`);
			for (const width of [768, 1280]) {
				await page.setViewportSize({ width, height: 800 });
				await expect(next.locator(".praxity-nav-label-full")).toBeVisible();
				await expect(next.locator(".praxity-nav-label-compact")).toBeHidden();
			}
			await page.setViewportSize({ width: 360, height: 740 });
			await expect(next.locator(".praxity-pagination-title")).toBeVisible();
			const position = page.locator(".praxity-pages-position");
			await expect(position).toHaveText("Page 2 of 2");
			await page.locator(".praxity-page-nav").evaluate((navigation) => {
				for (const element of navigation.querySelectorAll<HTMLElement>("*")) {
					element.style.setProperty("line-height", "1.5", "important");
					element.style.setProperty("letter-spacing", "0.12em", "important");
					element.style.setProperty("word-spacing", "0.16em", "important");
				}
			});
			for (const width of [320, 360, 430]) {
				await page.setViewportSize({ width, height: 740 });
				await expect(next.locator(".praxity-nav-label-compact")).toBeVisible();
				await expect(next.locator(".praxity-nav-label-compact")).toHaveText("Next");
				await expect(next.locator(".praxity-nav-label-full")).toBeHidden();
				await expect(
					page.locator(".praxity-native-page-position .praxity-native-progress"),
				).toBeHidden();
				for (const direction of ["ltr", "rtl"]) {
					await page
						.locator("html")
						.evaluate((element, dir) => element.setAttribute("dir", dir), direction);
					const previousBox = await page.locator(".praxity-nav-prev").boundingBox();
					const nextBox = await next.boundingBox();
					const progressBox = await position.boundingBox();
					expect(previousBox).not.toBeNull();
					expect(nextBox).not.toBeNull();
					expect(progressBox).not.toBeNull();
					if (!previousBox || !nextBox || !progressBox)
						throw new Error("Missing navigation geometry");
					for (const control of [previousBox, nextBox]) {
						expect(control.height).toBeGreaterThanOrEqual(44);
						expect(control.width).toBeGreaterThanOrEqual(44);
						expect(control.x).toBeGreaterThanOrEqual(0);
						expect(control.x + control.width).toBeLessThanOrEqual(width);
						expect(progressBox.y + progressBox.height).toBeLessThanOrEqual(control.y);
					}
					expect(nextBox.y).toBeGreaterThanOrEqual(previousBox.y + previousBox.height);
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
					).toBe(true);
				}
			}
			await page.locator(".praxity-page-nav").evaluate((navigation) => {
				for (const element of navigation.querySelectorAll<HTMLElement>("*")) {
					element.style.setProperty("font-size", "32px", "important");
				}
			});
			await page.setViewportSize({ width: 320, height: 740 });
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
			).toBe(true);
			for (const selector of [".praxity-nav-prev", ".praxity-nav-next"]) {
				expect(await textFitsWithin(page.locator(selector))).toBe(true);
			}
			await next.click();
			if (javaScriptEnabled) await waitForHydration(page);
			const previous = page.locator(".praxity-nav-prev");
			await expect(previous.locator(".praxity-nav-label-compact")).toBeVisible();
			await expect(previous.locator(".praxity-nav-label-compact")).toHaveText("Previous");
			await expect(previous).toHaveAccessibleName(`Previous Module: ${MODULE_TITLES[0]}`);
			await page.setViewportSize({ width: 768, height: 800 });
			await expect(previous.locator(".praxity-nav-label-full")).toBeVisible();
			await expect(previous.locator(".praxity-nav-label-full")).toHaveText("Previous Module");
		} finally {
			await context.close();
		}
	});
}

for (const direction of ["ltr", "rtl"]) {
	test(`text containment rejects 2px clipped labels in ${direction}`, async ({ page }) => {
		for (const label of ["Previous Module", "NextModuleWithALongUnbreakableLabel"]) {
			await page.setContent(
				`<a href="#next" dir="${direction}" style="display:block;white-space:nowrap;overflow:hidden;font:16px monospace"><span>${label}</span></a>`,
			);
			const link = page.locator("a");
			const overflow = await link.evaluate((element) => {
				const range = document.createRange();
				range.selectNodeContents(element);
				// Clip actual label text by 2px, well beyond the rounding tolerance.
				element.style.width = `${range.getBoundingClientRect().width - 2}px`;
				const bounds = element.getBoundingClientRect();
				const text = range.getBoundingClientRect();
				return Math.max(bounds.left - text.left, text.right - bounds.right);
			});
			expect(Math.abs(overflow - 2), label).toBeLessThanOrEqual(LAYOUT_UNIT);
			expect(await textFitsWithin(link), label).toBe(false);
		}
	});
}
