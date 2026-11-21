import { expect, type Locator, type Page, test } from "@playwright/test";
import { applyTextSpacing } from "../a11y/layout-overrides";
import { exampleCourseServer } from "../fixtures/example-course-server";

const copy = {
	en: { index: 0, correct: "The 2 L bottle", submit: "Check", continue: "Continue" },
	fr: { index: 2, correct: "La bouteille de 2 L", submit: "Vérifier", continue: "Continuer" },
};
const planted =
	"Shelf labels round some prices, so check the receipt when the difference is small. Some stores print a unit price, but similar products can use different units, such as per 100 g on one label and per kilogram on another.\n\n";
const fitted = { overflow: 0, scrolled: 0, fieldsInside: true };
let fixture: Awaited<ReturnType<typeof exampleCourseServer<"deck" | "pages" | "planted">>>;

test.skip(({ browserName }) => browserName !== "chromium", "Laptop fit is measured in Chromium.");

test.beforeAll(async () => {
	fixture = await exampleCourseServer("patterns/worked-example-practice", {
		deck: (_file, source) => source,
		pages: (file, source) =>
			file === "course.yaml" ? source.replace("moduleDeck: true\n", "") : source,
		planted: (file, source) =>
			file === "en.prax" ? source.replace("::: columns", `${planted}$&`) : source,
	});
});
test.afterAll(async () => {
	await fixture?.close();
});

async function open(page: Page, url: string, width: number, height: number) {
	await page.setViewportSize({ width, height });
	await page.goto(url);
	await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
	await expect(slide(page).locator("[data-island='assessment']")).toHaveAttribute(
		"data-hydrated",
		"",
	);
	await page.evaluate(() => document.fonts.ready);
}

function slide(page: Page) {
	return page.locator(".deck-slide:visible");
}

async function columnBoxes(page: Page) {
	const columns = slide(page).locator("[data-block-type='columns'] .praxity-column");
	await expect(columns).toHaveCount(2);
	const [example, practice] = await Promise.all(
		(await columns.all()).map((column) => column.boundingBox()),
	);
	if (!example || !practice) throw new Error("Both columns need layout boxes");
	return { example, practice };
}

async function selectAnswer(page: Page, locale: keyof typeof copy) {
	await slide(page).getByRole("radio", { name: copy[locale].correct }).check();
	await expect(slide(page).getByRole("button", { name: copy[locale].submit })).toBeVisible();
}

async function measureFit(page: Page) {
	return page.evaluate(() => {
		const main = document.querySelector<HTMLElement>("#main-content");
		const footer = document.querySelector<HTMLElement>("#deck-controls");
		const active = document.querySelector<HTMLElement>(".deck-slide:not([hidden])");
		if (!main || !footer || !active) throw new Error("Deck frame needs a stage and footer");
		const top = main.getBoundingClientRect().top;
		const bottom = footer.getBoundingClientRect().top;
		const fields = Array.from(active.querySelectorAll<HTMLElement>("input, button, textarea"))
			.filter((element) => element.getClientRects().length > 0)
			.map((element) => element.getBoundingClientRect());
		return {
			overflow: main.scrollHeight - main.clientHeight,
			scrolled: main.scrollTop,
			fieldsInside:
				fields.length > 0 && fields.every((rect) => rect.top >= top && rect.bottom <= bottom),
		};
	});
}

async function expectReachable(page: Page, target: Locator, width: number) {
	await target.scrollIntoViewIfNeeded();
	const box = await target.boundingBox();
	const stage = await page.locator("#main-content").boundingBox();
	const footer = await page.locator("#deck-controls").boundingBox();
	if (!box || !stage || !footer) throw new Error("Field, stage and footer need layout boxes");
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(width);
	expect(box.y).toBeGreaterThanOrEqual(stage.y);
	expect(box.y + box.height).toBeLessThanOrEqual(footer.y + footer.height);
}

for (const locale of ["en", "fr"] as const) {
	test(`worked example and practice fit side by side at 1366x768 with panels closed (${locale})`, async ({
		page,
	}) => {
		await open(page, fixture.page("deck", copy[locale].index), 1366, 768);
		await expect(page.locator("#deck-outline")).toBeHidden();
		await expect(page.locator("#deck-sidebar")).toBeHidden();
		const { example, practice } = await columnBoxes(page);
		expect(Math.abs(example.y - practice.y)).toBeLessThan(1);
		expect(practice.x).toBeGreaterThanOrEqual(example.x + example.width);
		expect(example.width).toBeGreaterThanOrEqual(400);
		expect(practice.width).toBeGreaterThanOrEqual(400);
		for (const text of await slide(page).locator("p, li, label").all())
			expect(
				await text.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
			).toBeGreaterThanOrEqual(16);
		expect(await measureFit(page)).toEqual(fitted);
		await selectAnswer(page, locale);
		expect(await measureFit(page)).toEqual(fitted);
		await expect(page.locator("#deck-more-below")).toBeHidden();
	});

	test(`source, reading and Tab order agree in the worked example (${locale})`, async ({
		page,
	}) => {
		await open(page, fixture.page("deck", copy[locale].index), 1366, 768);
		const outline = await slide(page)
			.locator("h1, h2, h3, legend")
			.evaluateAll((elements) =>
				elements.map((element) => `${element.tagName}:${element.textContent?.trim()}`),
			);
		expect(outline).toEqual(
			locale === "en"
				? [
						"H1:Compare unit prices",
						"H2:Worked example",
						"H2:Your turn",
						"LEGEND:Soap costs $3.00 for 750 mL or $7.00 for 2 L. Which bottle costs less per litre?. Select an answer",
					]
				: [
						"H1:Comparer des prix unitaires",
						"H2:Exemple résolu",
						"H2:À vous de jouer",
						"LEGEND:Le savon coûte 3,00\u00a0$ les 750 mL ou 7,00\u00a0$ les 2 L. Quelle bouteille coûte le moins cher au litre\u202f?. Sélectionner une réponse",
					],
		);
		await selectAnswer(page, locale);
		await slide(page).locator("h1").click();
		const order: string[] = [];
		for (let step = 0; step < 3; step++) {
			await page.keyboard.press("Tab");
			order.push(
				await page.evaluate(() => {
					const element = document.activeElement as HTMLInputElement | null;
					if (!element?.closest(".deck-slide")) return "outside";
					return element.type === "radio"
						? `radio:${element.closest("label")?.textContent?.trim()}`
						: `${element.tagName.toLowerCase()}:${element.textContent?.trim()}`;
				}),
			);
		}
		expect(order).toEqual([
			`radio:${copy[locale].correct}`,
			`button:${copy[locale].submit}`,
			"outside",
		]);
	});

	test(`checked feedback stays reachable at 1366x768 (${locale})`, async ({ page }) => {
		await open(page, fixture.page("deck", copy[locale].index), 1366, 768);
		await selectAnswer(page, locale);
		await slide(page).getByRole("button", { name: copy[locale].submit }).click();
		await expectReachable(
			page,
			slide(page).getByRole("button", { name: copy[locale].continue }),
			1366,
		);
	});

	for (const mode of ["default", "larger text", "text spacing"] as const)
		test(`worked example stacks with every field reachable at 320px, ${mode} (${locale})`, async ({
			page,
		}) => {
			await open(page, fixture.page("deck", copy[locale].index), 320, 640);
			const paragraph = slide(page).locator("[data-block-type='columns'] p").first();
			const size = () =>
				paragraph.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
			const baseSize = await size();
			expect(baseSize).toBeGreaterThanOrEqual(16);
			if (mode === "larger text") {
				const larger = page.locator('[data-a11y-action="text"]');
				if (!(await larger.isVisible())) await page.locator("#deck-more-toggle").click();
				await larger.click();
				await expect(page.locator("html")).toHaveAttribute("data-praxity-text-size", "large");
				await page.keyboard.press("Escape");
				expect(await size()).toBeGreaterThan(baseSize);
			}
			if (mode === "text spacing") await applyTextSpacing(page);
			const { example, practice } = await columnBoxes(page);
			expect(practice.y).toBeGreaterThanOrEqual(example.y + example.height);
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				320,
			);
			for (const element of await slide(page)
				.locator("[data-block-type='columns'], .praxity-column, [data-island='assessment']")
				.all())
				expect(
					await element.evaluate((node) => node.scrollWidth - node.clientWidth),
				).toBeLessThanOrEqual(1);
			await selectAnswer(page, locale);
			for (const field of await slide(page).locator("input, button").all())
				if (await field.isVisible()) await expectReachable(page, field, 320);
			for (const id of ["#deck-previous", "#deck-next", "#deck-more-toggle"])
				await expectReachable(page, page.locator(id), 320);
		});
}

test("the fit check catches one planted paragraph", async ({ page }) => {
	await open(page, fixture.page("planted", 0), 1366, 768);
	await selectAnswer(page, "en");
	const result = await measureFit(page);
	expect(result).not.toEqual(fitted);
	expect(result.overflow).toBeGreaterThan(0);
});

for (const width of [1366, 320])
	test(`the Pages rendition keeps the columns readable at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 768 });
		await page.goto(fixture.page("pages", 0));
		await expect(page.locator("[data-island='assessment']")).toHaveAttribute("data-hydrated", "");
		await expect(page.locator(".praxity-deck")).toHaveCount(0);
		const columns = page.locator("[data-block-type='columns'] .praxity-column");
		const [example, practice] = await Promise.all(
			(await columns.all()).map((column) => column.boundingBox()),
		);
		if (!example || !practice) throw new Error("Both columns need layout boxes");
		if (width === 1366) expect(practice.x).toBeGreaterThanOrEqual(example.x + example.width);
		else expect(practice.y).toBeGreaterThanOrEqual(example.y + example.height);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			width,
		);
	});
