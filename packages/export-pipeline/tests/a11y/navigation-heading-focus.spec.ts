import { readLesson } from "@praxity/grammar";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { publishedCourseServer } from "../fixtures/published-course-server";
import { expect, test } from "../fixtures/published-navigation";
import { expectFocusRing, expectNoFocusRing } from "../focus-assertions";

for (const mode of ["pages", "deck"]) {
	for (const locale of ["en", "fr"]) {
		for (const input of ["keyboard", "pointer"]) {
			test(`${mode} ${locale} ${input} Next focuses the heading without a ring`, async ({
				page,
				publishedNavigation,
			}) => {
				await page.goto(`${publishedNavigation}/${mode}-${locale}/index.html`);
				if (mode === "deck")
					await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
				else await expect(page.locator("html")).toHaveClass(/praxity-js-loaded/);
				const next = page.locator(
					mode === "deck" ? "#deck-next" : '#praxity-page-nav a[data-page-direction="next"]',
				);
				if (input === "keyboard") {
					await page.keyboard.press("Tab");
					await next.focus();
					await expect(next).toBeFocused();
					await expectFocusRing(next, 2);
					await page.keyboard.press("Enter");
				} else await next.click();
				const heading = page.getByRole("heading", { name: "Second slide", exact: true });
				await expect(heading).toBeFocused();
				await expect(heading).toHaveAttribute("tabindex", "-1");
				await expectNoFocusRing(heading);
				// Keyboard controls keep their indicator after arrival as well.
				await page.keyboard.press("Tab");
				await next.focus();
				await expect(next).toBeFocused();
				await expectFocusRing(next, 2);
			});
		}
	}
}

for (const mode of ["pages", "deck"]) {
	test(`${mode} Next also focuses an H3 without a ring`, async ({ page }) => {
		const parsed = readLesson(
			"# First slide\n\nStart here.\n\n# Hidden page title {hideTitle}\n\n### Deep destination\n\nRead this section.\n",
		);
		const content = splitBlocksIntoPages(parsed.blocks, "Heading focus");
		for (const [index, page] of content.entries()) {
			page.lessonId = "heading-focus";
			page.lessonTitle = "Heading focus";
			page.isFirstPageOfLesson = index === 0;
		}
		const fixture = await publishedCourseServer({
			id: `heading-focus-${mode}`,
			title: "Heading focus",
			sourceLocale: "en",
			content,
			navigationStyle: mode === "pages" ? "sidebar" : "slides",
			...(mode === "deck" ? { moduleDeck: {} } : {}),
		});
		try {
			await page.goto(`${fixture.url}/index.html`);
			if (mode === "deck")
				await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			else await expect(page.locator("html")).toHaveClass(/praxity-js-loaded/);
			await page
				.locator(mode === "deck" ? "#deck-next" : '#praxity-page-nav a[data-page-direction="next"]')
				.focus();
			await page.keyboard.press("Enter");
			const heading = page.getByRole("heading", { level: 3, name: "Deep destination" });
			await expect(heading).toBeFocused();
			await expect(heading).toHaveAttribute("tabindex", "-1");
			await expectNoFocusRing(heading);
		} finally {
			await fixture.close();
		}
	});
}
