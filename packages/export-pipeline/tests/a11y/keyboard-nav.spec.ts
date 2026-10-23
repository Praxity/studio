import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "../muted-test";
import {
	findPageWithSelector,
	getCoursePages,
	readTestEnv,
	type TestEnv,
	WEBKIT_TAB_ORDER_SKIP,
	waitForHydration,
} from "./helpers";

let env: TestEnv;

function focusSignatureScript() {
	return () => {
		const el = document.activeElement as HTMLElement | null;
		if (!el) return "";
		const id = el.id ? `#${el.id}` : "";
		const role = el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : "";
		const name = (el.getAttribute("aria-label") ?? "").trim();
		const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
		return `${el.tagName.toLowerCase()}${id}${role}:${name || text}`;
	};
}

async function pressTabUntilFocused(page: Page, locator: Locator, maxPresses = 40) {
	for (let i = 0; i < maxPresses; i++) {
		if (
			await locator
				.first()
				.evaluate((el) => el === document.activeElement)
				.catch(() => false)
		) {
			return true;
		}
		await page.keyboard.press("Tab");
	}
	return false;
}

async function activateNextPage(page: Page, nextControl: Locator) {
	await nextControl.focus();
	await expect(nextControl).toBeFocused();
	const href = await nextControl.getAttribute("href");
	expect(href, "Next page control must identify its destination").toBeTruthy();
	const destination = new URL(href ?? "", page.url()).href;
	// WebKit can return from press() before the new document starts loading.
	await Promise.all([
		page.waitForURL(destination, { waitUntil: "domcontentloaded" }),
		nextControl.press("Enter"),
	]);
	await waitForHydration(page);
}

test.describe("Keyboard navigation", () => {
	test.beforeAll(() => {
		env = readTestEnv();
	});

	test("Enter reaches the next page when its response is delayed", async ({ page }) => {
		await page.goto(`${env.url}/rich-content-and-typography.html`);
		await waitForHydration(page);
		const nextControl = page.getByRole("link", { name: "Next page: Media & Embeds" });
		await page.route("**/media-and-embeds.html", async (route) => {
			// Keep WebKit on the loaded source document until the destination responds.
			await new Promise((resolve) => setTimeout(resolve, 500));
			await route.continue();
		});
		await activateNextPage(page, nextControl);
		await expect(page).toHaveURL(`${env.url}/media-and-embeds.html`);
	});

	test("tab traversal reaches all interactive controls on first page", async ({
		page,
		browserName,
	}) => {
		test.skip(browserName === "webkit", WEBKIT_TAB_ORDER_SKIP);
		const pages = await getCoursePages(page, env.url);
		await page.goto(`${env.url}/${pages[0]?.slug}.html`);
		await waitForHydration(page);

		const expected = await page.evaluate(() => {
			const selector =
				"a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex='-1'])";
			const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
			const visible = nodes.filter((node) => {
				if (node.hasAttribute("disabled") || node.getAttribute("aria-hidden") === "true")
					return false;
				const style = window.getComputedStyle(node);
				if (style.display === "none" || style.visibility === "hidden") return false;
				const rect = node.getBoundingClientRect();
				return rect.width > 0 && rect.height > 0;
			});
			return visible.map((el) => {
				const id = el.id ? `#${el.id}` : "";
				const role = el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : "";
				const name = (el.getAttribute("aria-label") ?? "").trim();
				const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
				return `${el.tagName.toLowerCase()}${id}${role}:${name || text}`;
			});
		});

		const visited = new Set<string>();
		for (let i = 0; i < expected.length + 20; i++) {
			await page.keyboard.press("Tab");
			visited.add(await page.evaluate(focusSignatureScript()));
		}

		for (const signature of expected) {
			expect(visited.has(signature), `Missing focus target in Tab order: ${signature}`).toBe(true);
		}
	});

	test("accordion keyboard behavior", async ({ page }) => {
		const pages = await getCoursePages(page, env.url);
		const accordionPage = await findPageWithSelector(
			page,
			env.url,
			pages,
			"[data-block-type='accordion'] [data-disclosure-trigger]",
		);
		expect(accordionPage, "No accordion block found in exported fixture").toBeTruthy();

		const triggers = page.locator("[data-block-type='accordion'] [data-disclosure-trigger]");
		const accordionIsland = page.locator('[data-island="accordion"]').first();
		await accordionIsland.scrollIntoViewIfNeeded();
		await expect(accordionIsland).toHaveAttribute("data-hydrated", "");
		await expect(triggers.first()).toBeVisible();
		await triggers.first().focus();
		await expect(triggers.first()).toBeFocused();

		for (const trigger of await triggers.all()) {
			await expect(trigger).toHaveAttribute("aria-expanded", "false");
		}
		await page.keyboard.press("Space");
		await expect(triggers.first()).toHaveAttribute("aria-expanded", "true");
		const panelId = await triggers.first().getAttribute("aria-controls");
		expect(panelId).toBeTruthy();
		await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
		await page.keyboard.press("Enter");
		await expect(triggers.first()).toHaveAttribute("aria-expanded", "false");
		await expect(page.locator(`[id="${panelId}"]`)).toBeHidden();

		if ((await triggers.count()) > 1) {
			await page.keyboard.press("ArrowDown");
			await expect(triggers.nth(1)).toBeFocused();
			await page.keyboard.press("ArrowUp");
			await expect(triggers.first()).toBeFocused();
		}
	});

	test("textareas keep a visible keyboard focus indicator", async ({ page }) => {
		const pages = await getCoursePages(page, env.url);
		const textareaPage = await findPageWithSelector(
			page,
			env.url,
			pages,
			"[data-block-type='assessment'] textarea",
		);
		expect(textareaPage, "No textarea assessment found in exported fixture").toBeTruthy();

		const textarea = page.locator("[data-block-type='assessment'] textarea").first();
		expect(
			await pressTabUntilFocused(page, textarea, 120),
			"Tab did not reach the assessment textarea",
		).toBe(true);

		const focusAppearance = await textarea.evaluate((element) => {
			const style = getComputedStyle(element);
			return {
				focusVisible: element.matches(":focus-visible"),
				outlineStyle: style.outlineStyle,
				outlineWidth: Number.parseFloat(style.outlineWidth),
			};
		});
		expect(focusAppearance.focusVisible).toBe(true);
		expect(focusAppearance.outlineStyle).toBe("solid");
		expect(focusAppearance.outlineWidth).toBeGreaterThanOrEqual(2);
	});

	test("tabs, assessment, and page navigation keyboard behavior", async ({ page, browserName }) => {
		const pages = await getCoursePages(page, env.url);
		const tab = browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";

		const tabsPage = await findPageWithSelector(
			page,
			env.url,
			pages,
			"[data-block-type='tabs'] [role='tab']",
		);
		expect(tabsPage, "No tabs block found in exported fixture").toBeTruthy();

		const tabsBlock = page.locator("[data-island='tabs']").first();
		await tabsBlock.scrollIntoViewIfNeeded();
		await expect(tabsBlock).toHaveAttribute("data-hydrated", "");
		const tabs = tabsBlock.locator("[role='tab']");
		await expect(tabs.first()).toBeVisible();
		await tabs.first().focus();
		await page.keyboard.press("ArrowRight");
		await expect(tabs.nth(1)).toBeFocused();
		await page.keyboard.press("ArrowLeft");
		await expect(tabs.first()).toBeFocused();

		const assessmentPage = await findPageWithSelector(
			page,
			env.url,
			pages,
			"[data-block-type='assessment']:visible input:visible",
		);
		expect(assessmentPage, "No assessment block found in exported fixture").toBeTruthy();

		const assessmentIsland = page
			.locator('[data-island="assessment"]')
			.filter({ has: page.locator("input:visible") })
			.first();
		await assessmentIsland.scrollIntoViewIfNeeded();
		await expect(assessmentIsland).toHaveAttribute("data-hydrated", "");

		const firstOption = page
			.locator("[data-block-type='assessment']:visible input:visible")
			.first();
		await expect(firstOption, "No visible assessment option found").toBeVisible();
		await firstOption.focus();
		await expect(firstOption).toBeFocused();
		await page.keyboard.press("Space");
		await expect(firstOption).toBeChecked();

		const submitSelector =
			"[data-block-type='assessment']:visible [data-assessment-submit='true']:visible";
		const submitButton = page.locator(submitSelector).first();
		if (browserName !== "webkit") {
			expect(
				await pressTabUntilFocused(page, submitButton),
				"Tab did not reach assessment submit",
			).toBe(true);
		} else {
			await submitButton.focus();
			await page.keyboard.press(`Shift+${tab}`);
			await page.keyboard.press(tab);
			await expect(submitButton).toBeFocused();
		}

		await page.goto(`${env.url}/${pages[0]?.slug}.html`);
		await waitForHydration(page);
		const navNextControl = page
			.getByRole("button", { name: /next/i })
			.or(page.getByRole("link", { name: /next/i }))
			.first();
		if (browserName !== "webkit") {
			const navReached = await pressTabUntilFocused(page, navNextControl);
			expect(navReached, "Tab did not reach Next page control").toBe(true);
		} else {
			// Playwright WebKit skips native links in sequential Tab order. Real
			// Safari needs macOS Keyboard Navigation and its "Press Tab to highlight
			// each item on a webpage" setting. Seed focus for Enter activation below.
			await navNextControl.focus();
			await expect(navNextControl).toBeFocused();
		}

		await activateNextPage(page, navNextControl);

		if (browserName !== "webkit") {
			const signatures = new Set<string>();
			for (let i = 0; i < 40; i++) {
				await page.keyboard.press("Tab");
				signatures.add(await page.evaluate(focusSignatureScript()));
			}
			expect(signatures.size, "Focus appears trapped on too few elements").toBeGreaterThan(5);
		}
	});
});
