import { expect, type Page, test } from "@playwright/test";
import { EXPORTABLE_HIDDEN_BLOCK_TYPES } from "./fixtures/lightweight-fixture";
import { assertAxeScenario, readHiddenBlocksFixture, waitForHydration } from "./helpers";

async function openHiddenBlocksPage(page: Page): Promise<void> {
	const fixture = readHiddenBlocksFixture();
	expect(fixture.pages, "Hidden-block fixture must export exactly one page").toHaveLength(1);
	await page.goto(`${fixture.url}/${fixture.pages[0].slug}.html`, {
		waitUntil: "domcontentloaded",
	});
	await waitForHydration(page);
}

test.describe("hidden block accessibility", () => {
	test.beforeEach(async ({ page }) => {
		await openHiddenBlocksPage(page);
	});

	test("exports every parser-reachable hidden block and passes the standard axe scan", async ({
		page,
	}) => {
		const hiddenSelector = EXPORTABLE_HIDDEN_BLOCK_TYPES.map(
			(type) => `[data-block-type='${type}']`,
		).join(",");
		const exportedTypes = await page
			.locator(hiddenSelector)
			.evaluateAll((elements) =>
				[
					...new Set(
						elements.map((element) => element.getAttribute("data-block-type")).filter(Boolean),
					),
				].sort(),
			);
		expect(exportedTypes).toEqual([...EXPORTABLE_HIDDEN_BLOCK_TYPES].sort());
		await assertAxeScenario(page, "hidden-blocks::default");
	});

	test("chart exposes a text alternative and equivalent data table", async ({ page }) => {
		const chart = page.locator("[data-block-type='chart']");
		await expect(
			chart.getByRole("img", { name: "Bar chart of completed accessibility checks by month" }),
		).toBeAttached();
		await expect(chart.getByRole("table")).toContainText("June");
	});

	test("rating and signature have named roles and complete keyboard paths", async ({ page }) => {
		const rating = page.locator("[data-block-type='rating']");
		const ratingGroup = rating.getByRole("radiogroup", { name: "Rate this lesson" });
		await expect(ratingGroup).toBeVisible();
		const firstRating = rating.getByRole("radio", { name: "1 of 5" });
		await firstRating.focus();
		await page.keyboard.press("ArrowRight");
		await expect(rating.getByRole("radio", { name: "2 of 5" })).toBeFocused();
		await expect(rating.getByRole("radio", { name: "2 of 5" })).toBeChecked();

		const signature = page.locator("[data-block-type='signature']");
		// Not exact: the fixture sets required:true, so RequiredIndicator's glyph is
		// appended to the label element's text (SignatureBlock.tsx:217-218).
		await expect(signature.getByText("Sign to confirm completion")).toBeVisible();
		const methodTabs = signature.getByRole("tablist", { name: /signature method/i });
		await expect(methodTabs).toBeVisible();
		const drawTab = signature.getByRole("tab", { name: /draw/i });
		const typeTab = signature.getByRole("tab", { name: /type/i });
		await drawTab.focus();
		await page.keyboard.press("ArrowRight");
		await expect(typeTab).toBeFocused();
		await expect(typeTab).toHaveAttribute("aria-selected", "true");
		const typedSignature = signature.getByRole("textbox", { name: "Sign to confirm completion" });
		await typedSignature.fill("Ada Lovelace");
		await expect(signature.locator("[data-signed='true']")).toBeAttached();
	});

	test("rating feedback appears in a polite live region after selection", async ({ page }) => {
		const rating = page.locator("[data-block-type='rating']");
		const feedback = rating.locator("[data-rating-feedback]");
		await expect(feedback).toBeHidden();
		// The styled label covers the visually hidden radio, as for a learner.
		const option = rating.getByRole("radio", { name: "2 of 5" });
		await rating.locator(`label[for="${await option.getAttribute("id")}"]`).click();
		await expect(option).toBeChecked();
		await expect(feedback).toBeVisible();
		await expect(feedback).toContainText("Review your rating before continuing.");
		await expect(feedback.locator("..")).toHaveAttribute("aria-live", "polite");
	});

	test("code, equation, sequence, and document retain accessible output", async ({ page }) => {
		const code = page.locator("[data-block-type='code']");
		const scrollRegion = code.locator("pre.praxity-code-pre");
		await expect(code.getByRole("region")).toHaveCount(1);
		await expect(scrollRegion).toHaveRole("region");
		await expect(scrollRegion).toHaveAccessibleName("Code HTML");
		await expect(scrollRegion).toHaveAttribute("tabindex", "0");
		await expect(scrollRegion).toBeVisible();
		await page.evaluate(() => {
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: { writeText: () => Promise.resolve() },
			});
		});
		const copy = code.getByRole("button", { name: /copy/i });
		await copy.focus();
		await page.keyboard.press("Tab");
		await expect(scrollRegion).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect(copy).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(code.locator("[aria-live='polite']")).toHaveText("Copied to clipboard");
		await expect(
			page.locator("[data-block-type='equation'] [role='math'][aria-label]"),
		).toBeVisible();
		await expect(page.locator("[data-block-type='sequence'] ol[aria-label]")).toContainText(
			"Publish the course",
		);
		const documentLink = page.locator("[data-block-type='document'] a[href]");
		await expect(documentLink).toHaveAccessibleName(/Accessibility checklist/i);
		await documentLink.evaluate((link) => {
			link.addEventListener("click", (event) => {
				event.preventDefault();
				link.setAttribute("data-keyboard-activated", "true");
			});
		});
		await documentLink.focus();
		await page.keyboard.press("Enter");
		await expect(documentLink).toHaveAttribute("data-keyboard-activated", "true");
	});
});
