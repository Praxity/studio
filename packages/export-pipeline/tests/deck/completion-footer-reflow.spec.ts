import { expect, test } from "@playwright/test";
import { publishedCourseServer } from "../fixtures/published-course-server";
import { silentWav } from "../fixtures/silent-audio";

const title =
	"Paramètres de confidentialité et de sécurité pour les équipes internationales de Platform Infrastructure";
for (const locale of ["en", "fr"]) {
	test.describe(locale, () => {
		let fixture: Awaited<ReturnType<typeof publishedCourseServer>>;
		test.beforeAll(async () => {
			const originalFetch = globalThis.fetch;
			globalThis.fetch = (input, options) =>
				String(input) === "https://footer.example/clip.wav"
					? Promise.resolve(
							new Response(new Uint8Array(silentWav(1)), {
								headers: { "Content-Type": "audio/wav" },
							}),
						)
					: originalFetch(input, options);
			try {
				fixture = await publishedCourseServer({
					id: "footer-reflow",
					title: "Course",
					sourceLocale: locale,
					navigationStyle: "slides",
					moduleDeck: {},
					content: [
						{
							id: "first",
							title: "First",
							lessonId: "one",
							lessonTitle: "Module one",
							isFirstPageOfLesson: true,
							narrationEnabled: true,
							blocks: [
								{
									id: "text-one",
									type: "text",
									data: {
										content: "Complete this module.",
										narrationAudio: "https://footer.example/clip.wav",
									},
								},
							],
						},
						{
							id: "second",
							title,
							lessonId: "two",
							lessonTitle: title,
							isFirstPageOfLesson: true,
							blocks: [{ id: "text-two", type: "text", data: { content: "Second module." } }],
						},
					],
				});
			} finally {
				globalThis.fetch = originalFetch;
			}
		});
		test.afterAll(async () => {
			await fixture?.close();
		});
		for (const width of [320, 1280]) {
			test(`completion retains a full destination and one footer row at ${width}px`, async ({
				page,
			}) => {
				await page.setViewportSize({ width, height: 900 });
				await page.goto(`${fixture.url}/index.html?praxity-inspect=1`);
				await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
				await page.locator("#deck-next").click();
				await expect(page.locator("#deck-completion")).toBeVisible();
				const compact = locale === "fr" ? "Module suivant" : "Next module";
				const full = `${compact}${locale === "fr" ? " : " : ": "}${title}`;
				const next = page.locator("#deck-next");
				await expect(next.locator(".deck-navigation-label")).toHaveText(compact);
				await expect(next).toHaveAccessibleName(full);
				await expect(next).toHaveAttribute("title", full);
				await expect(page.locator("#deck-completion").getByRole("button")).toHaveCount(1);
				await expect(next).toBeVisible();
				await page.evaluate(() => document.fonts.ready);
				const controls = page.locator(
					"#deck-previous, #deck-position, #deck-more-toggle, #deck-next",
				);
				const boxes = await controls.evaluateAll((elements) =>
					elements
						.filter((element) => element.getBoundingClientRect().width > 0)
						.map((element) => {
							const rect = element.getBoundingClientRect();
							return {
								left: rect.left,
								right: rect.right,
								middle: rect.top + rect.height / 2,
								unclipped: element.scrollWidth <= element.clientWidth + 1,
							};
						}),
				);
				expect(boxes).toHaveLength(4);
				for (const box of boxes) {
					expect(box.left).toBeGreaterThanOrEqual(0);
					expect(box.right).toBeLessThanOrEqual(width);
					expect(box.unclipped).toBe(true);
				}
				if (width === 320)
					expect(
						Math.max(...boxes.map((box) => box.middle)) -
							Math.min(...boxes.map((box) => box.middle)),
					).toBeLessThan(2);
			});
		}
	});
}
