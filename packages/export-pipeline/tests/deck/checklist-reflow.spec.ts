import { expect, test } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import { publishedCourseServer } from "../fixtures/published-course-server";

// The checklist page and 60-item case from the break-ui worst-case course.
const labels = [
	"bartholomew.fitzgerald@northwind-industries-holdings.example.com",
	"Paramètres de confidentialité et de sécurité pour les équipes internationales de Platform Infrastructure",
	"J",
	"王秀英",
	"نور الهدى عبد الرحمن",
	"👩🏽‍💻 Priya",
];

for (const locale of ["en", "fr"]) {
	for (const hydrated of [false, true]) {
		test.describe(`${locale}, ${hydrated ? "hydrated" : "native"}`, () => {
			test.use({ javaScriptEnabled: hydrated });
			let fixture: Awaited<ReturnType<typeof publishedCourseServer>>;
			test.beforeAll(async () => {
				const source = [3, 60]
					.map(
						(count) =>
							`# Checklist ${count}\n\n::: checklist\n${Array.from({ length: count }, (_, i) => `- [ ] ${labels[i % labels.length]}`).join("\n")}\n:::\n`,
					)
					.join("\n");
				fixture = await publishedCourseServer({
					id: "checklist-reflow",
					title: "Checklists",
					sourceLocale: locale,
					content: readLesson(source).pages,
				});
			});
			test.afterAll(async () => {
				await fixture?.close();
			});
			for (const width of [320, 1280]) {
				test(`long checklist labels do not overflow at ${width}px`, async ({ page }) => {
					await page.setViewportSize({ width, height: 900 });
					for (const count of [3, 60]) {
						await page.goto(`${fixture.url}/checklist-${count}.html`);
						const items = page.locator("[data-checklist-item]");
						await expect(items).toHaveCount(count);
						if (hydrated)
							await expect(page.locator('[data-island="checklist"]')).toHaveAttribute(
								"data-hydrated",
								"",
							);
						if (hydrated) await page.evaluate(() => document.fonts.ready);
						expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
						for (const item of await items.all()) {
							const checkbox = await item.getByRole("checkbox").boundingBox();
							expect(checkbox).not.toBeNull();
							if (!checkbox) throw new Error("Missing checkbox bounds");
							expect(checkbox.x).toBeGreaterThanOrEqual(0);
							expect(checkbox.x + checkbox.width).toBeLessThanOrEqual(width);
						}
					}
				});
			}
		});
	}
}
