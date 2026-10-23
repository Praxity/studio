import { expect } from "@playwright/test";
import { test } from "../muted-test";
import {
	assertAxeScenario,
	findPageWithSelector,
	getCoursePages,
	readTestEnv,
	type TestEnv,
	waitForHydration,
} from "./helpers";

let env: TestEnv;

test.describe("WCAG 2.2 AA axe scans", () => {
	test.setTimeout(120_000);

	test.beforeAll(() => {
		env = readTestEnv();
	});

	test("default scan across exported pages", async ({ page }) => {
		const pages = await getCoursePages(page, env.url);

		for (const meta of pages) {
			await page.goto(`${env.url}/${meta.slug}.html`);
			await waitForHydration(page);
			await assertAxeScenario(page, `${meta.slug}.html::default`);
		}
	});

	test("multi-state scans for interactive content", async ({ page }) => {
		const pages = await getCoursePages(page, env.url);

		const accordionPage = await findPageWithSelector(
			page,
			env.url,
			pages,
			"[data-block-type='accordion']",
		);
		if (!accordionPage) throw new Error("Missing required accordion fixture");
		{
			const accordionTriggers = page.locator(
				"[data-block-type='accordion'] [data-disclosure-trigger]",
			);
			const triggerCount = await accordionTriggers.count();
			for (let i = 0; i < triggerCount; i++) {
				const trigger = accordionTriggers.nth(i);
				const island = trigger.locator("xpath=ancestor::*[@data-island='accordion'][1]");
				await island.scrollIntoViewIfNeeded();
				await expect(island).toHaveAttribute("data-hydrated", "");
				await trigger.focus();
				await page.keyboard.press("Enter");
				if ((await trigger.evaluate((node) => node.tagName)) === "SUMMARY") {
					await expect(trigger.locator("..")).toHaveJSProperty("open", true);
				} else {
					await expect(trigger).toHaveAttribute("aria-expanded", "true");
				}
				const panelId = await trigger.getAttribute("aria-controls");
				expect(panelId, "Expanded accordion trigger must identify its content").toBeTruthy();
				await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
			}

			await assertAxeScenario(page, `${accordionPage.slug}.html::accordion-expanded`);
		}

		const tabsPage = await findPageWithSelector(
			page,
			env.url,
			pages,
			"[data-block-type='tabs'] [role='tab']",
		);
		if (!tabsPage) throw new Error("Missing required tabs fixture");
		{
			const tabs = page.locator("[data-block-type='tabs'] [role='tab']");
			const tabCount = await tabs.count();
			for (let i = 0; i < tabCount; i++) {
				const tab = tabs.nth(i);
				const island = tab.locator("xpath=ancestor::*[@data-island='tabs'][1]");
				await island.scrollIntoViewIfNeeded();
				await expect(island).toHaveAttribute("data-hydrated", "");
				await tab.click();
				await expect(tab).toHaveAttribute("aria-selected", "true");
				const panelId = await tab.getAttribute("aria-controls");
				expect(panelId, "Selected tab must identify its content").toBeTruthy();
				const panel = page.locator(`[id="${panelId}"]`);
				await expect(panel).toBeVisible();
				await assertAxeScenario(page, `${tabsPage.slug}.html::tab-${i + 1}`);
			}
		}

		let assessmentBaseUrl = env.url;
		let assessmentPage = await findPageWithSelector(
			page,
			assessmentBaseUrl,
			pages,
			"[data-block-type='assessment']:visible",
		);
		if (!assessmentPage && env.navVariants?.sidebar) {
			assessmentBaseUrl = env.navVariants.sidebar;
			assessmentPage = await findPageWithSelector(
				page,
				assessmentBaseUrl,
				await getCoursePages(page, assessmentBaseUrl),
				"[data-block-type='assessment']:visible",
			);
		}
		if (!assessmentPage) throw new Error("Missing required assessment fixture");
		{
			const wrongChoice = await page.evaluate(() => {
				const configScript = document.getElementById("praxity-config")?.textContent;
				if (!configScript) return null;
				const isVisibleBlock = (id: string): boolean => {
					const element = document.querySelector(`[data-block-id="${CSS.escape(id)}"]`);
					if (!(element instanceof HTMLElement)) return false;
					let current: HTMLElement | null = element;
					while (current) {
						const style = window.getComputedStyle(current);
						if (style.display === "none" || style.visibility === "hidden") return false;
						current = current.parentElement;
					}
					return element.getClientRects().length > 0;
				};
				try {
					const config = JSON.parse(configScript) as {
						blocks?: Array<{
							id?: string;
							type?: string;
							data?: {
								assessmentType?: string;
								response?: {
									type?: string;
									options?: Array<{ id?: string; isCorrect?: boolean; label?: string }>;
								};
							};
						}>;
					};
					const assessmentBlock = (config.blocks ?? []).find(
						(block) =>
							block.type === "assessment" &&
							typeof block.id === "string" &&
							isVisibleBlock(block.id) &&
							block.data?.assessmentType === "choice" &&
							block.data.response?.type === "choice",
					);
					if (!assessmentBlock || typeof assessmentBlock.id !== "string") {
						return null;
					}
					const options = assessmentBlock.data?.response?.options ?? [];
					if (options.length < 2) return null;
					const wrong = options.find((opt) => opt.isCorrect !== true);
					if (!wrong || typeof wrong.id !== "string") return null;
					return {
						blockId: assessmentBlock.id,
						optionId: wrong.id,
						optionLabel: typeof wrong.label === "string" ? wrong.label : "",
					};
				} catch {
					return null;
				}
			});

			if (!wrongChoice) throw new Error("Missing required visible choice assessment fixture");

			const block = page.locator(`[data-block-id='${wrongChoice.blockId}']`).first();
			await block.scrollIntoViewIfNeeded();
			await expect(block).toHaveAttribute("data-hydrated", "");

			let option = block.locator("input").first();
			if (wrongChoice.optionLabel.trim().length > 0) {
				const radioOption = block.getByRole("radio", { name: wrongChoice.optionLabel }).first();
				if ((await radioOption.count()) > 0) {
					option = radioOption;
				} else {
					const checkboxOption = block
						.getByRole("checkbox", { name: wrongChoice.optionLabel })
						.first();
					if ((await checkboxOption.count()) > 0) {
						option = checkboxOption;
					}
				}
			}

			if (
				wrongChoice.optionLabel.trim().length === 0 ||
				(await option.evaluate((input) => (input as HTMLInputElement).value)) !==
					wrongChoice.optionId
			) {
				const optionIndex = await block
					.locator("input")
					.evaluateAll(
						(inputs, targetValue) =>
							inputs.findIndex((input) => (input as HTMLInputElement).value === targetValue),
						wrongChoice.optionId,
					);
				if (optionIndex >= 0) {
					option = block.locator("input").nth(optionIndex);
				}
			}
			await expect(option).toBeVisible();
			await option.check();

			const submit = block.locator("[data-assessment-submit='true']").first();
			await expect(submit).toBeVisible();
			await submit.click();
			await expect(block.locator("[data-assessment-continue]")).toBeFocused();
			await expect(block.locator("[data-assessment-status]")).toHaveText("1 of 1 attempts used");

			await assertAxeScenario(page, `${assessmentPage.slug}.html::assessment-wrong-submit`);
		}
	});
});
