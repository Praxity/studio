import { expect, test } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import { publishedCourseServer } from "../fixtures/published-course-server";

// The ordering page from the break-ui worst-case course.
const source = `# order : نور الهدى عبد الرحمن

::: order Paramètres de confidentialité et de sécurité pour les équipes internationales de Platform Infrastructure {scored attempts=1284 points=1000000 level=3}
1. bartholomew.fitzgerald@northwind-industries-holdings.example.com
2. J
3. Paramètres de confidentialité et de sécurité pour les équipes internationales de Platform Infrastructure
4. 👩🏽‍💻 Priya
:::
`;

for (const locale of ["en", "fr"]) {
	for (const hydrated of [false, true]) {
		test.describe(`${locale}, ${hydrated ? "hydrated" : "native"}`, () => {
			test.use({ javaScriptEnabled: hydrated });
			let fixture: Awaited<ReturnType<typeof publishedCourseServer>>;
			test.beforeAll(async () => {
				fixture = await publishedCourseServer({
					id: "order-reflow",
					title: "Ordering",
					sourceLocale: locale,
					content: readLesson(source).pages,
				});
			});
			test.afterAll(async () => {
				await fixture?.close();
			});
			for (const width of [320, 1280]) {
				test(`every row retains its label and move controls at ${width}px`, async ({ page }) => {
					await page.setViewportSize({ width, height: 900 });
					await page.goto(`${fixture.url}/index.html`);
					const rows = page.locator(".praxity-order-item");
					await expect(rows).toHaveCount(4);
					if (hydrated)
						await expect(page.locator('[data-island="assessment"]')).toHaveAttribute(
							"data-hydrated",
							"",
						);
					for (const row of await rows.all()) {
						const bounds = await row.evaluate((element) => {
							const rect = element.getBoundingClientRect();
							return Array.from(
								element.querySelectorAll<HTMLElement>(
									".praxity-order-label, .praxity-order-controls",
								),
							).map((child) => ({
								left: child.getBoundingClientRect().left >= rect.left,
								right: child.getBoundingClientRect().right <= Math.min(rect.right, innerWidth),
								unclipped: child.scrollWidth <= child.clientWidth + 1,
							}));
						});
						expect(bounds).toEqual([
							{ left: true, right: true, unclipped: true },
							{ left: true, right: true, unclipped: true },
						]);
					}
				});
			}
		});
	}
}
