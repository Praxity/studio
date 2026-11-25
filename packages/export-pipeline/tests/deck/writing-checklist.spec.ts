import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import AdmZip from "adm-zip";
import { exampleCourseServer } from "../fixtures/example-course-server";

const copy = {
	en: {
		index: 0,
		response: "Your handover note",
		complete: "Complete reflection",
		continue: "Continue",
		downloads: ["Download as text", "Download as Word"],
		judgment:
			"The ticks are your own judgment. They don't submit or grade your note, and you can change them at any time.",
		items: [
			"Which task it is and where its files are",
			"What is done and what is left",
			"The next deadline",
			"Who can help if something goes wrong",
		],
		draft: "Task: monthly budget report. Files are in the team drive.",
	},
	fr: {
		index: 1,
		response: "Votre note de passation",
		complete: "Terminer la réflexion",
		continue: "Continuer",
		downloads: ["Télécharger en texte", "Télécharger en Word"],
		judgment:
			"Ces cases reflètent votre propre jugement. Elles ne soumettent pas votre note et ne l’évaluent pas.",
		items: [
			"La tâche visée et l’emplacement de ses fichiers",
			"Ce qui est fait et ce qui reste à faire",
			"La prochaine échéance",
			"La personne à joindre en cas de problème",
		],
		draft: "Tâche : rapport budgétaire mensuel. Les fichiers sont dans le dossier d’équipe.",
	},
};
let fixture: Awaited<ReturnType<typeof exampleCourseServer<"authored">>>;

test.skip(
	({ browserName }) => browserName !== "chromium",
	"The authored composition is checked in Chromium.",
);

test.beforeAll(async () => {
	fixture = await exampleCourseServer("patterns/writing-checklist", {
		authored: (_file, source) => source,
	});
});
test.afterAll(async () => {
	await fixture?.close();
});

function auditRequests(page: Page) {
	const urls: string[] = [];
	page.on("request", (request) => urls.push(request.url()));
	return () => {
		for (const url of urls) {
			expect(url.startsWith(`${fixture.url}/`), url).toBe(true);
			const path = new URL(url).pathname;
			expect(fixture.has(path), path).toBe(true);
			expect(path).not.toContain("self-check");
		}
	};
}

async function open(page: Page, locale: keyof typeof copy) {
	await page.goto(fixture.page("authored", copy[locale].index));
	for (const island of ["assessment", "checklist"])
		await expect(page.locator(`[data-island='${island}']`)).toHaveAttribute("data-hydrated", "");
}

function columns(page: Page) {
	return page.locator("[data-block-type='columns'] .praxity-column");
}

for (const locale of ["en", "fr"] as const) {
	const text = copy[locale];

	test(`keyboard order runs from the response to the checklist (${locale})`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await open(page, locale);
		const [response, checklist] = await Promise.all(
			(await columns(page).all()).map((column) => column.boundingBox()),
		);
		if (!response || !checklist) throw new Error("Both columns need layout boxes");
		expect(Math.abs(response.y - checklist.y)).toBeLessThan(1);
		expect(checklist.x).toBeGreaterThanOrEqual(response.x + response.width);
		await page.getByRole("textbox", { name: text.response }).fill(text.draft);
		await page.locator("h1").click();
		const order: string[] = [];
		for (let step = 0; step < 9; step++) {
			await page.keyboard.press("Tab");
			order.push(
				await page.evaluate(() => {
					const element = document.activeElement as HTMLInputElement | null;
					if (!element?.closest("[data-block-type='columns']")) return "outside";
					const name =
						element.type === "checkbox"
							? element.closest("label")?.textContent
							: (element.getAttribute("aria-label") ?? element.textContent);
					return name?.trim() ?? "";
				}),
			);
		}
		expect(order).toEqual([
			text.response,
			...text.downloads,
			text.complete,
			...text.items,
			"outside",
		]);
	});

	test(`the checklist stacks after the prompt and response at 320px (${locale})`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 320, height: 700 });
		await open(page, locale);
		const prompt = await page.locator("[data-block-type='columns']").evaluate((element) => {
			const previous = element.closest(".praxity-block")?.previousElementSibling;
			return previous?.getBoundingClientRect().bottom ?? Number.NaN;
		});
		const [response, checklist] = await Promise.all(
			(await columns(page).all()).map((column) => column.boundingBox()),
		);
		if (!response || !checklist) throw new Error("Both columns need layout boxes");
		expect(response.y).toBeGreaterThanOrEqual(prompt);
		expect(checklist.y).toBeGreaterThanOrEqual(response.y + response.height);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			320,
		);
		for (const field of await page
			.locator(
				"[data-block-type='columns'] textarea:visible, [data-block-type='columns'] input, [data-block-type='columns'] button",
			)
			.all()) {
			await field.scrollIntoViewIfNeeded();
			const box = await field.boundingBox();
			if (!box) throw new Error("Field needs a layout box");
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(320);
		}
	});

	test(`ticks stay independent of the response through every saved state (${locale})`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		const audit = auditRequests(page);
		await open(page, locale);
		const response = page.getByRole("textbox", { name: text.response });
		const complete = page.getByRole("button", { name: text.complete });
		const next = page.getByRole("button", { name: text.continue });
		const boxes = text.items.map((name) => page.getByRole("checkbox", { name }));
		const ticks = () => Promise.all(boxes.map((box) => box.isChecked()));
		await expect(page.getByText(text.judgment)).toBeVisible();
		await expect(page.locator("[data-island='self-check']")).toHaveCount(0);

		await page.reload();
		await open(page, locale);
		await expect(response).toHaveValue("");
		expect(await ticks()).toEqual([false, false, false, false]);

		await response.fill(text.draft);
		await expect(complete).toBeVisible();
		await page.reload();
		await open(page, locale);
		await expect(response).toHaveValue(text.draft);
		await expect(complete).toBeVisible();

		for (const box of boxes) await box.check();
		await expect(complete).toBeVisible();
		await expect(next).toHaveCount(0);
		await page.reload();
		await open(page, locale);
		expect(await ticks()).toEqual([true, true, true, true]);
		await expect(response).toHaveValue(text.draft);
		await expect(complete).toBeVisible();
		await expect(next).toHaveCount(0);

		await boxes[2].uncheck();
		await complete.click();
		await expect(next).toBeVisible();
		expect(await ticks()).toEqual([true, true, false, true]);
		await page.reload();
		await open(page, locale);
		await expect(response).toHaveValue(text.draft);
		await expect(complete).toHaveCount(0);
		expect(await ticks()).toEqual([true, true, false, true]);
		await boxes[2].check();
		await expect(complete).toHaveCount(0);
		audit();
	});

	test(`the response downloads as text and Word (${locale})`, async ({ page }) => {
		await open(page, locale);
		await page.getByRole("textbox", { name: text.response }).fill(text.draft);
		const [plain, word] = text.downloads;
		const textDownload = page.waitForEvent("download");
		await page.getByRole("button", { name: plain }).click();
		const textPath = await (await textDownload).path();
		expect(await readFile(textPath, "utf8")).toContain(text.draft);
		const wordDownload = page.waitForEvent("download");
		await page.getByRole("button", { name: word }).click();
		const wordPath = await (await wordDownload).path();
		const xml = new AdmZip(await readFile(wordPath)).readAsText("word/document.xml");
		expect(xml.replace(/<[^>]+>/g, "")).toContain(text.draft);
	});

	test.describe(`without JavaScript (${locale})`, () => {
		test.use({ javaScriptEnabled: false });
		test("the prompt, instructions and checklist stay readable", async ({ page }) => {
			await page.goto(fixture.page("authored", copy[locale].index));
			await expect(page.locator("h1")).toBeVisible();
			await expect(page.getByText(text.judgment)).toBeVisible();
			await expect(page.getByRole("textbox", { name: text.response })).toBeVisible();
			await expect(page.locator(".praxity-assessment-needs-script")).toContainText("JavaScript");
			for (const name of text.items) {
				const box = page.getByRole("checkbox", { name });
				await box.check();
				await expect(box).toBeChecked();
			}
		});
	});
}
