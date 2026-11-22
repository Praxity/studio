import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { startJourney } from "./global-setup";

const source =
	"# First page\n\n## Original heading\n\nBody.\n\n# Second page\n\n## Other heading\n\nSecond body.\n";
const origin = () => new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
const ready = () => process.env.PRAXITY_BROWSER_READY_URL ?? "";
const project = () => process.env.PRAXITY_BROWSER_PROJECT ?? "";
async function open(page: Page) {
	await page.goto(ready());
}
async function save(page: Page, before: string, after: string) {
	const file = join(
		project(),
		(await readdir(project())).includes("lesson.prax") ? "lesson.prax" : "second.prax",
	);
	await writeFile(file, (await readFile(file, "utf8")).replace(before, after));
	await open(page);
}

test("released Read Next and reload land on the same second page", async ({ page, context }) => {
	const stop = await startJourney(page.context(), { standaloneSource: source });
	try {
		await open(page);
		const read = await context.newPage();
		await read.goto(page.url());
		const oldRead = read.url();
		const oldSecond = new URL("second-page.html", oldRead).href;
		let heading = "Original heading";
		for (let i = 0; i < 6; i++) {
			await save(page, heading, `Fresh ${i}`);
			heading = `Fresh ${i}`;
		}
		expect((await read.request.get(oldRead, { maxRedirects: 0 })).status()).toBe(303);
		await read.locator("a.praxity-nav-next").click();
		await expect(read.getByRole("heading", { name: "Second page", exact: true })).toBeVisible();
		await read.reload();
		await read.goto(oldSecond);
		await expect(read.getByRole("heading", { name: "Other heading", exact: true })).toBeVisible();
	} finally {
		await stop();
	}
});

test("nine tabs closed before their build replies leave four live revisions", async ({
	context,
	request,
}) => {
	const stop = await startJourney(context, { standaloneSource: "# Page\n\n## Start 0\n\nBody.\n" });
	const urls: string[] = [];
	try {
		for (let i = 0; i < 9; i++) {
			const tab = await context.newPage();
			await writeFile(join(project(), "second.prax"), `# Page\n\n## Start ${i + 1}\n\nBody.\n`);
			let arrived = () => {};
			const built = new Promise<void>((resolve) => {
				arrived = resolve;
			});
			await tab.route("**/canvas?admission=*", async (route) => {
				const response = await route.fetch({ maxRedirects: 0 });
				urls.push(response.headers().location);
				arrived();
			});
			void tab.goto(ready()).catch(() => {});
			await built;
			await tab.close();
		}
		expect(new Set(urls).size).toBe(9);
		const statuses = [];
		for (const url of urls) statuses.push((await request.get(url, { maxRedirects: 0 })).status());
		expect(statuses).toEqual([303, 303, 303, 303, 303, 200, 200, 200, 200]);
	} finally {
		await stop();
	}
});

for (const deck of [false, true]) {
	for (const delay of [300, 700]) {
		test(`staggered root tabs ${delay}ms apart keep deck=${deck} resources and navigation`, async ({
			page,
			context,
		}) => {
			const stop = await startJourney(
				page.context(),
				deck
					? { courseFixture: resolve(import.meta.dirname, "fixtures/canvas-deck") }
					: { standaloneSource: source },
			);
			const failures: string[] = [];
			context.on("response", (response) => {
				if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
			});
			try {
				const second = await context.newPage();
				await Promise.all([
					page.goto(ready()),
					(async () => {
						await new Promise((done) => setTimeout(done, delay));
						await second.goto(ready());
					})(),
				]);
				for (const tab of [page, second]) {
					if (deck)
						await expect(tab.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
					else {
						await tab.locator("a.praxity-nav-next").click();
						await expect(
							tab.getByRole("heading", { name: "Second page", exact: true }),
						).toBeVisible();
					}
				}
				expect(failures).toEqual([]);
			} finally {
				await stop();
			}
		});
	}
}

for (const deck of [false, true])
	test(`eight simultaneous root tabs retain deck=${deck} documents and subresources`, async ({
		context,
	}) => {
		const stop = await startJourney(
			context,
			deck
				? { courseFixture: resolve(import.meta.dirname, "fixtures/canvas-deck") }
				: { standaloneSource: source },
		);
		const failures: string[] = [];
		context.on("response", (response) => {
			if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
		});
		try {
			const tabs = await Promise.all(Array.from({ length: 8 }, () => context.newPage()));
			await Promise.all(tabs.map((tab) => tab.goto(ready())));
			for (const tab of tabs) {
				if (deck) await expect(tab.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
				else
					await expect(tab.getByRole("heading", { name: "First page", exact: true })).toBeVisible();
			}
			expect(failures).toEqual([]);
		} finally {
			await stop();
		}
	});

for (const count of [2, 3])
	test(`${count} Read tabs keep Next correct through six source edits`, async ({
		page,
		context,
	}) => {
		const stop = await startJourney(page.context(), { standaloneSource: source });
		try {
			await open(page);
			await save(page, "Original heading", "Established heading");
			const authors = [page];
			for (let i = 1; i < count; i++) {
				const tab = await context.newPage();
				await open(tab);
				authors.push(tab);
			}
			const reader = await context.newPage();
			await reader.goto(ready());
			let heading = "Established heading";
			for (let i = 0; i < 6; i++) {
				await save(authors[i % count], heading, `Shared ${i}`);
				heading = `Shared ${i}`;

				await reader.locator("a.praxity-nav-next").click();
				await expect(
					reader.getByRole("heading", { name: "Second page", exact: true }),
				).toBeVisible();
				await reader.goBack();
			}
		} finally {
			await stop();
		}
	});

for (const deck of [false, true])
	test(`source edit between root tabs preserves earlier deck=${deck} navigation`, async ({
		page,
		context,
	}) => {
		const stop = await startJourney(
			page.context(),
			deck
				? { courseFixture: resolve(import.meta.dirname, "fixtures/canvas-deck") }
				: { standaloneSource: source },
		);
		const failures: string[] = [];
		context.on("response", (response) => {
			if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
		});
		try {
			await page.goto(ready());
			if (deck) await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			const filename = join(project(), deck ? "lesson.prax" : "second.prax");
			await writeFile(
				filename,
				(await readFile(filename, "utf8")).replace(
					deck ? "First" : "Original heading",
					deck ? "Changed first" : "Changed heading",
				),
			);
			const second = await context.newPage();
			await second.goto(ready());
			if (deck) {
				await expect(second.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
				await page.locator("#deck-next").click();
			} else {
				await page.locator("a.praxity-nav-next").click();
				await expect(page.getByRole("heading", { name: "Second page", exact: true })).toBeVisible();
			}
			await page.reload();
			if (deck) await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			expect(failures).toEqual([]);
		} finally {
			await stop();
		}
	});

test("a released deck document keeps its slide fragment through the 303", async ({
	page,
	context,
}) => {
	const stop = await startJourney(page.context(), {
		courseFixture: resolve(import.meta.dirname, "fixtures/canvas-deck"),
	});
	try {
		await open(page);
		await save(page, "Authored heading", "Established heading");
		const reader = await context.newPage();
		await reader.goto(page.url());
		await expect(reader.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await reader.locator("#deck-next").click();
		await expect(reader.getByRole("heading", { name: "Second slide", exact: true })).toBeVisible();
		const old = reader.url();
		expect(new URL(old).hash).not.toBe("");
		let heading = "Established heading";
		for (let i = 0; i < 6; i++) {
			await save(page, heading, `Deck ${i}`);
			heading = `Deck ${i}`;
		}
		const response = await reader.request.get(old, { maxRedirects: 0 });
		expect(response.status()).toBe(303);
		expect(response.headers().location).not.toContain("#");
		await reader.reload();
		expect(new URL(reader.url()).hash).toBe(new URL(old).hash);
		await expect(reader.getByRole("heading", { name: "Second slide", exact: true })).toBeVisible();
	} finally {
		await stop();
	}
});

test("idle Read tabs survive a closed launcher and retain Next", async ({ page, context }) => {
	const stop = await startJourney(page.context(), { standaloneSource: source });
	try {
		const launched = await context.newPage();
		await launched.goto(ready());
		await open(page);
		const read = await context.newPage();
		await read.goto(page.url());
		await page.close();
		for (const tab of [launched, read]) {
			await tab.locator("a.praxity-nav-next").click();
			await expect(tab.getByRole("heading", { name: "Second page", exact: true })).toBeVisible();
		}
	} finally {
		await stop();
	}
});
