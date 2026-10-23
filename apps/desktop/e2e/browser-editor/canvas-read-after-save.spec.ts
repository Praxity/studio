import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { startJourney } from "./global-setup";

for (const saves of [1, 2]) {
	test(`Read opens a ready learner deck after ${saves} heading saves`, async ({ page }) => {
		const stop = await startJourney(page.context(), {
			courseFixture: resolve(import.meta.dirname, "fixtures/canvas-deck"),
		});
		try {
			const origin = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
			await page.goto(`${origin}/launch?canvas=1`);
			let heading = "Authored heading";
			for (let index = 1; index <= saves; index++) {
				await page.getByRole("button", { name: `Edit heading 2: ${heading}`, exact: true }).click();
				heading = `Saved heading ${index}`;
				await page.getByRole("textbox", { name: "Heading text", exact: true }).fill(heading);
				const revision = page.url();
				await page.keyboard.press("Enter");
				await expect(page).not.toHaveURL(revision);
				await expect(page.getByRole("link", { name: "Read mode", exact: true })).toHaveAttribute(
					"href",
					/praxity-resume=0/,
				);
				await expect(
					page.getByRole("button", { name: `Edit heading 2: ${heading}`, exact: true }),
				).toBeFocused();
			}
			const read = page.getByRole("link", { name: "Read mode", exact: true });
			expect(
				new URL((await read.getAttribute("href")) ?? "").searchParams.get("praxity-resume"),
			).toBe("0");
			await read.click();
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
			expect(new URL(page.url()).origin).not.toBe(origin);
			expect(
				await page.evaluate(() => sessionStorage.getItem("praxity.studio.session")),
			).toBeNull();
			await page.locator("#deck-next").click();
			await expect(
				page.locator(".deck-slide").getByRole("heading", { name: "Second slide", exact: true }),
			).toBeVisible();
			expect(
				await readFile(join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "lesson.prax"), "utf8"),
			).toContain(`## ${heading}\n`);
		} finally {
			await stop();
		}
	});
}

test("Read after two saves opens the edited non-deck page despite another page's bookmark", async ({
	page,
}) => {
	const stop = await startJourney(page.context(), {
		standaloneSource:
			"---\ntitle: Saved course\n---\n\n# Bookmarked page\n\nBookmarked body.\n\n# Middle page\n\nMiddle body.\n\n# Edited page\n\n## Original heading\n\nEdited body.\n",
	});
	try {
		const origin = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
		await page.goto(`${origin}/launch?canvas=1`);
		await page.getByRole("link", { name: "Read mode", exact: true }).click();
		await page.locator("a.praxity-nav-next").click();
		await page.locator("a.praxity-nav-next").click();
		await expect(page.getByText("Edited body.", { exact: true })).toBeVisible();
		await page.getByRole("link", { name: "Edit text", exact: true }).click();
		// Save first so the bookmark belongs to the durable course identity used by later saves.
		await page
			.getByRole("button", { name: "Edit heading 2: Original heading", exact: true })
			.click();
		await page
			.getByRole("textbox", { name: "Heading text", exact: true })
			.fill("Persisted heading");
		const initialRevision = page.url();
		await page.keyboard.press("Enter");
		await expect(page).not.toHaveURL(initialRevision);
		const editedDocument = page.url();
		await page.getByRole("link", { name: "Read mode", exact: true }).click();
		const learnerOrigin = new URL(page.url()).origin;
		await page.locator("a.praxity-nav-prev").click();
		await page.locator("a.praxity-nav-prev").click();
		await expect(page.getByText("Bookmarked body.", { exact: true })).toBeVisible();
		await page.reload();
		await expect(page.getByText("Bookmarked body.", { exact: true })).toBeVisible();
		await page.goto(editedDocument);
		let heading = "Persisted heading";
		for (const saved of ["First saved heading", "Second saved heading"]) {
			await page.getByRole("button", { name: `Edit heading 2: ${heading}`, exact: true }).click();
			await page.getByRole("textbox", { name: "Heading text", exact: true }).fill(saved);
			const revision = page.url();
			await page.keyboard.press("Enter");
			await expect(page).not.toHaveURL(revision);
			await expect(page.getByRole("link", { name: "Read mode", exact: true })).toHaveAttribute(
				"href",
				/praxity-resume=0/,
			);
			heading = saved;
		}
		const read = page.getByRole("link", { name: "Read mode", exact: true });
		expect(
			new URL((await read.getAttribute("href")) ?? "").searchParams.get("praxity-resume"),
		).toBe("0");
		await read.click();
		expect(new URL(page.url()).origin).toBe(learnerOrigin);
		await expect(
			page.getByRole("heading", { name: "Second saved heading", exact: true }),
		).toBeVisible();
		expect(new URL(page.url()).pathname).toMatch(/\/edited-page[.]html$/);
		await expect(page.getByText("Bookmarked body.", { exact: true })).toHaveCount(0);
		await page.locator("a.praxity-nav-prev").click();
		await expect(page.getByText("Middle body.", { exact: true })).toBeVisible();
	} finally {
		await stop();
	}
});
for (const saves of [1, 2, 3]) {
	test(`Read opens the edited second deck slide after ${saves} saves`, async ({ page }) => {
		const stop = await startJourney(page.context(), {
			courseFixture: resolve(import.meta.dirname, "fixtures/canvas-deck"),
		});
		try {
			const origin = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
			await page.goto(`${origin}/launch?canvas=1`);
			let heading = "Second slide";
			for (let index = 1; index <= saves; index++) {
				await page.getByRole("button", { name: `Edit heading 3: ${heading}`, exact: true }).click();
				heading = `Saved second slide ${index}`;
				await page.getByRole("textbox", { name: "Heading text", exact: true }).fill(heading);
				const revision = page.url();
				await page.keyboard.press("Enter");
				await expect(page).not.toHaveURL(revision);
				await expect(page.getByRole("link", { name: "Read mode", exact: true })).toHaveAttribute(
					"href",
					/praxity-resume=0/,
				);
			}
			expect(
				await readFile(join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "lesson.prax"), "utf8"),
			).toContain(`# ${heading}\n`);
			const bookmark = await page.context().newPage();
			await bookmark.goto(
				(await page.getByRole("link", { name: "Read mode", exact: true }).getAttribute("href")) ??
					"",
			);
			await expect(bookmark.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await expect(bookmark.getByRole("heading", { name: heading, exact: true })).toBeVisible();
			await bookmark.locator("#deck-previous").click();
			await expect(
				bookmark
					.locator(".deck-slide")
					.getByRole("heading", { name: "Opening slide", exact: true }),
			).toBeVisible();
			await bookmark.reload();
			await expect(
				bookmark.locator(".deck-slide").getByRole("heading", { name: /Opening slide$/ }),
			).toBeVisible();
			await bookmark.close();
			await page.getByRole("link", { name: "Read mode", exact: true }).click();
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
		} finally {
			await stop();
		}
	});
}
