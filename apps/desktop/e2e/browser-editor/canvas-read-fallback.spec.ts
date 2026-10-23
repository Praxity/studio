import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { startJourney } from "./global-setup";

for (const outside of ["delete", "rename", "revert"] as const) {
	test(`Read and refresh recover after the saved slide is ${outside} outside the canvas`, async ({
		page,
		context,
	}) => {
		const stop = await startJourney(page.context(), {
			courseFixture: resolve(import.meta.dirname, "fixtures/canvas-deck"),
		});
		try {
			const origin = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
			const file = join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "lesson.prax");
			const original = await readFile(file, "utf8");
			await page.goto(`${origin}/launch?canvas=1`);
			await page.getByRole("button", { name: "Edit heading 3: Second slide", exact: true }).click();
			await page.getByRole("textbox", { name: "Heading text", exact: true }).fill("Saved second");
			let revision = page.url();
			await page.keyboard.press("Enter");
			await expect(page).not.toHaveURL(revision);
			const read = page.getByRole("link", { name: "Read mode", exact: true });
			await expect(read).toHaveAttribute("href", /praxity-resume=0/);
			const disk = await readFile(file, "utf8");
			const changed =
				outside === "delete"
					? disk.slice(0, disk.indexOf("\n# Saved second"))
					: outside === "rename"
						? disk.replace("# Saved second", "# Renamed outside")
						: original;
			revision = page.url();
			await writeFile(file, changed.replace("First slide body.", "Outside body."));
			await expect(page).not.toHaveURL(revision);
			await expect(
				page.locator(".deck-slide").getByText("Outside body.", { exact: true }),
			).toBeVisible();
			await expect(read).toHaveAttribute("href", /praxity-resume=0/);
			const tab = await context.newPage();
			await tab.goto((await read.getAttribute("href")) ?? "");
			await expect(tab.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await expect(tab.getByRole("heading", { name: "Opening slide", exact: true })).toBeVisible();
			await tab.close();
			await page.goto(`${origin}/launch?canvas=1`);
			await expect(page.locator("main > ul > li")).toHaveText([
				"lesson.prax: Opening slide; First slide body.; Line unknown",
				"lesson.prax: Saved second; Saved second; Line unknown",
				"lesson.prax: Saved second; title; Line unknown",
				...(outside === "delete"
					? ["lesson.prax: Saved second; Second slide body.; Line unknown"]
					: []),
			]);
			await page
				.getByRole("button", { name: "I haven't published this course: continue.", exact: true })
				.click();
			let heading = "Authored heading";
			for (const next of ["Save after outside one", "Save after outside two"]) {
				await page.getByRole("button", { name: `Edit heading 2: ${heading}`, exact: true }).click();
				await page.getByRole("textbox", { name: "Heading text", exact: true }).fill(next);
				revision = page.url();
				await page.keyboard.press("Enter");
				await expect(page).not.toHaveURL(revision);
				await expect(read).toHaveAttribute("href", /praxity-resume=0/);
				heading = next;
			}
			await read.click();
			await expect(
				page.getByRole("heading", { name: "Save after outside two", exact: true }),
			).toBeVisible();
		} finally {
			await stop();
		}
	});
}

test("Read falls back to the first lesson page when the current last page disappears", async ({
	page,
}) => {
	const stop = await startJourney(page.context(), {
		standaloneSource:
			"# First page\n\nFirst body.\n\n# Last page\n\n## Last heading\n\nLast body.\n",
	});
	try {
		const origin = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
		await page.goto(`${origin}/launch?canvas=1`);
		await page.getByRole("link", { name: "Read mode", exact: true }).click();
		await page.locator("a.praxity-nav-next").click();
		await page.getByRole("link", { name: "Edit text", exact: true }).click();
		await page.getByRole("button", { name: "Edit heading 2: Last heading", exact: true }).click();
		await page
			.getByRole("textbox", { name: "Heading text", exact: true })
			.fill("Saved last heading");
		let revision = page.url();
		await page.keyboard.press("Enter");
		await expect(page).not.toHaveURL(revision);
		const read = page.getByRole("link", { name: "Read mode", exact: true });
		await expect(read).toHaveAttribute("href", /praxity-resume=0/);
		const file = join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax");
		revision = page.url();
		await writeFile(file, "# First page\n\nFirst body outside.\n");
		await expect(page).not.toHaveURL(revision);
		await expect(page.getByText("First body outside.", { exact: true })).toBeVisible();
		await page.goto(`${origin}/launch?canvas=1`);
		await expect(page.locator("main > ul > li")).toHaveText([
			"second.prax: First page; First body.; Line unknown",
			"second.prax: Last page; Last page; Line unknown",
			"second.prax: Last page; title; Line unknown",
			"second.prax: Last page; Saved last heading; Line unknown",
			"second.prax: Last page; Last body.; Line unknown",
		]);
		await page
			.getByRole("button", { name: "I haven't published this course: continue.", exact: true })
			.click();
		await expect(page.getByText("First body outside.", { exact: true })).toBeVisible();
		for (const [from, to] of [
			["First page", "First saved once"],
			["First saved once", "First saved twice"],
		]) {
			await page.getByRole("button", { name: `Edit heading 1: ${from}`, exact: true }).click();
			await page.getByRole("textbox", { name: "Heading text", exact: true }).fill(to);
			revision = page.url();
			await page.keyboard.press("Enter");
			await expect(page).not.toHaveURL(revision);
			await expect(read).toHaveAttribute("href", /praxity-resume=0/);
		}
		await read.click();
		await expect(
			page.getByRole("heading", { name: "First saved twice", exact: true }),
		).toBeVisible();
	} finally {
		await stop();
	}
});

async function settled(page: Page) {
	const read = page.getByRole("link", { name: "Read mode", exact: true });
	await expect(read).toHaveAttribute("href", /praxity-resume=0/);
	await expect(read).not.toHaveAttribute("aria-busy", "true");
	return (await read.getAttribute("href")) ?? "";
}
async function save(page: Page, from: string, to: string) {
	await page.getByRole("button", { name: `Edit heading 2: ${from}`, exact: true }).click();
	await page.getByRole("textbox", { name: "Heading text", exact: true }).fill(to);
	const revision = page.url();
	await page.keyboard.press("Enter");
	await expect(page).not.toHaveURL(revision);
	return settled(page);
}
for (const removed of ["First", "Middle", "Last"]) {
	test(`removed ${removed} page falls back by identity`, async ({ page }) => {
		const source =
			"# First\n\n## First heading\n\nFirst body.\n\n# Middle\n\n## Middle heading\n\nMiddle body.\n\n# Last\n\n## Last heading\n\nLast body.\n";
		const stop = await startJourney(page.context(), { standaloneSource: source });
		try {
			const origin = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
			await page.goto(`${origin}/launch?canvas=1`);
			await page.getByRole("link", { name: "Read mode", exact: true }).click();
			for (let i = 0; i < ["First", "Middle", "Last"].indexOf(removed); i++)
				await page.locator("a.praxity-nav-next").click();
			await page.getByRole("link", { name: "Edit text", exact: true }).click();
			await save(page, `${removed} heading`, "Saved heading");
			const file = join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax");
			const disk = await readFile(file, "utf8");
			const pages = disk.split(/(?=^# )/m).filter(Boolean);
			const revision = page.url();
			await writeFile(file, pages.filter((part) => !part.startsWith(`# ${removed}\n`)).join(""));
			await expect(page).not.toHaveURL(revision);
			await settled(page);
			const expected = removed === "First" ? "Middle" : "First";
			await page.getByRole("link", { name: "Read mode", exact: true }).click();
			await expect(page.getByRole("heading", { name: expected, exact: true })).toBeVisible();
		} finally {
			await stop();
		}
	});
}
