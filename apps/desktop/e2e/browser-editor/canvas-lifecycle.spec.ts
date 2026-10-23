import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { startJourney } from "./global-setup";

const source =
	"# First page\n\n## Original heading\n\nBody.\n\n# Second page\n\n## Other heading\n\nSecond body.\n";
const origin = () => new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
const ready = () => process.env.PRAXITY_BROWSER_READY_URL ?? "";
const project = () => process.env.PRAXITY_BROWSER_PROJECT ?? "";
const field = (page: Page) => page.getByRole("textbox", { name: "Heading text", exact: true });
const edit = (page: Page, heading: string) =>
	page.getByRole("button", { name: `Edit heading 2: ${heading}`, exact: true });
async function open(page: Page) {
	await page.goto(`${origin()}/launch?canvas=1`);
	await expect(page.getByRole("status").filter({ hasText: /^Connected$/ })).toHaveText("Connected");
}
async function save(page: Page, before: string, after: string) {
	await edit(page, before).click();
	await field(page).fill(after);
	const url = page.url();
	await page.keyboard.press("Enter");
	await expect(page).not.toHaveURL(url);
	await expect(page.getByRole("link", { name: "Read mode", exact: true })).toHaveAttribute(
		"href",
		/praxity-resume=0/,
	);
}

test("a stream dropped after hosting and before reply still allows a second exact save", async ({
	page,
}) => {
	await page.addInitScript(`
        const nativeFetch = window.fetch.bind(window);
        window.fetch = (url, options) => {
            if (!String(url).endsWith('/api/events')) return nativeFetch(url, options);
            const connection = new AbortController();
            window.disconnectEvents = () => connection.abort();
            return nativeFetch(url, { ...options, signal: AbortSignal.any([options.signal, connection.signal]) });
        };
        const nativeOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(...args) {
            if (String(args[1]).endsWith('/api/events')) window.disconnectEvents = () => this.abort();
            return nativeOpen.apply(this, args);
        };
    `);
	const stop = await startJourney(page.context(), { standaloneSource: source });
	try {
		await open(page);
		let disconnected = false;
		const releases: string[] = [];
		page.on("request", (request) => {
			if (
				request.url().endsWith("/api/rpc") &&
				request.postDataJSON().method === "coursePreviewRelease"
			)
				releases.push(request.url());
		});
		await page.route("**/api/rpc", async (route) => {
			if (route.request().postDataJSON().method !== "canvasPreviewBuild" || disconnected)
				return route.continue();
			const response = await route.fetch();
			disconnected = true;
			await page.evaluate(() =>
				(window as unknown as { disconnectEvents(): void }).disconnectEvents(),
			);
			await route.fulfill({ response });
		});
		await save(page, "Original heading", "Saved once");
		expect((await page.request.get(page.url(), { maxRedirects: 0 })).status()).toBe(200);
		await save(page, "Saved once", "Saved twice");
		expect(await readFile(join(project(), "second.prax"), "utf8")).toBe(
			source.replace("Original heading", "Saved twice"),
		);
		expect(releases).toEqual([]);
	} finally {
		await stop();
	}
});

test("an open field on another lesson saves after six revisions evict its document", async ({
	page,
	context,
}) => {
	const stop = await startJourney(page.context());
	try {
		await writeFile(join(project(), "second.prax"), source);
		await writeFile(
			join(project(), "first.prax"),
			"# Other lesson\n\n## Held heading\n\nHeld body.\n",
		);
		await page.goto(`${origin()}/launch?canvas=1`);
		await expect(
			page.getByRole("heading", { name: "Some blocks would get new IDs", exact: true }),
		).toBeVisible();
		await expect(page.locator("main > ul > li")).toHaveText([
			"first.prax: First; First; Line unknown",
			"first.prax: First; title; Line unknown",
			"first.prax: First; Original body.; Line unknown",
			"second.prax: First; First; Line unknown",
			"second.prax: First; title; Line unknown",
			"second.prax: First; Original body.; Line unknown",
		]);
		await page
			.getByRole("button", { name: "I haven't published this course: continue.", exact: true })
			.click();
		await expect(page.getByRole("status").filter({ hasText: /^Connected$/ })).toHaveText(
			"Connected",
		);
		// C05f owns first-write identity promotion across tabs. Establish identity before opening B.
		await save(page, "Original heading", "Established heading");
		const other = await context.newPage();
		await other.goto(`${origin()}/launch?canvas=1`);
		await other.getByRole("link", { name: "Read mode", exact: true }).click();
		await other.goto(new URL("other-lesson.html", other.url()).href);
		await other.getByRole("link", { name: "Edit text", exact: true }).click();
		await edit(other, "Held heading").click();
		await field(other).fill("Held exact *text*");
		const old = other.url();
		let heading = "Established heading";
		for (let i = 0; i < 6; i++) {
			await save(page, heading, `Saved ${i}`);
			heading = `Saved ${i}`;
		}
		expect((await other.request.get(old, { maxRedirects: 0 })).status()).toBe(303);
		await other.keyboard.press("Enter");
		await expect(other.getByRole("status").filter({ hasText: /^Saved$/ })).toHaveText("Saved");
		expect(await readFile(join(project(), "first.prax"), "utf8")).toBe(
			"# Other lesson\n\n## Held exact *text*\n\nHeld body.\n",
		);
	} finally {
		await stop();
	}
});

test("released Read Next, Edit and author reload land on the same second page", async ({
	page,
	context,
}) => {
	const stop = await startJourney(page.context(), { standaloneSource: source });
	try {
		await open(page);
		const read = await context.newPage();
		await read.goto(
			(await page.getByRole("link", { name: "Read mode", exact: true }).getAttribute("href")) ?? "",
		);
		const oldRead = read.url();
		const oldSecond = new URL("second-page.html", oldRead).href;
		const author = await context.newPage();
		await author.goto(oldSecond);
		await author.getByRole("link", { name: "Edit text", exact: true }).click();
		const oldAuthor = author.url();
		await author.close();
		let heading = "Original heading";
		for (let i = 0; i < 6; i++) {
			await save(page, heading, `Fresh ${i}`);
			heading = `Fresh ${i}`;
		}
		expect((await read.request.get(oldRead, { maxRedirects: 0 })).status()).toBe(303);
		await read.locator("a.praxity-nav-next").click();
		await expect(read.getByRole("heading", { name: "Second page", exact: true })).toBeVisible();
		await read.reload();
		// Click the old document's Edit link through the actual cross-origin redirect chain.
		await read.goto(oldSecond);
		await read.getByRole("link", { name: "Edit text", exact: true }).click();
		await expect(edit(read, "Other heading")).toBeVisible();
		await read.goto(oldAuthor);
		await read.reload();
		await expect(edit(read, "Other heading")).toBeVisible();
		await save(read, "Other heading", "Saved from released page");
		expect(await readFile(join(project(), "second.prax"), "utf8")).toBe(
			source
				.replace("Original heading", "Fresh 5")
				.replace("Other heading", "Saved from released page"),
		);
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
			await open(tab);
			let arrived = () => {};
			const built = new Promise<void>((resolve) => {
				arrived = resolve;
			});
			await tab.route("**/api/rpc", async (route) => {
				if (route.request().postDataJSON().method !== "canvasPreviewBuild") return route.continue();
				const response = await route.fetch();
				const descriptor = (await response.json()).result;
				expect(descriptor).not.toHaveProperty("leaseId");
				const url = new URL(`${descriptor.pages[0].slug}.html`, descriptor.entryUrl);
				urls.push(`${url.origin}/canvas${url.pathname}`);
				arrived();
			});
			await edit(tab, `Start ${i}`).click();
			await field(tab).fill(`Start ${i + 1}`);
			await tab.keyboard.press("Enter");
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
	test(`${count} authors keep Read Next correct through six saves`, async ({ page, context }) => {
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
				for (const tab of authors) await expect(edit(tab, heading)).toBeVisible();
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
		await reader.goto(
			(await page.getByRole("link", { name: "Read mode", exact: true }).getAttribute("href")) ?? "",
		);
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

test("idle Read tabs survive a closed author and retain Next and Edit", async ({
	page,
	context,
}) => {
	const stop = await startJourney(page.context(), { standaloneSource: source });
	try {
		const launched = await context.newPage();
		await launched.goto(ready());
		await open(page);
		const read = await context.newPage();
		await read.goto(
			(await page.getByRole("link", { name: "Read mode", exact: true }).getAttribute("href")) ?? "",
		);
		await page.close();
		for (const tab of [launched, read]) {
			await tab.locator("a.praxity-nav-next").click();
			await expect(tab.getByRole("heading", { name: "Second page", exact: true })).toBeVisible();
			await tab.getByRole("link", { name: "Edit text", exact: true }).click();
			await expect(edit(tab, "Other heading")).toBeVisible();
		}
	} finally {
		await stop();
	}
});

test.describe("fifty saves across three authors and two Read tabs", () => {
	test.describe.configure({ mode: "serial" });
	let stop: () => Promise<void>;
	let authors: Page[];
	let readers: Page[];
	let heading = "Original heading";
	const urls: string[] = [];
	test.beforeAll(async ({ browser }) => {
		stop = await startJourney(browser, { standaloneSource: source });
		authors = await Promise.all(Array.from({ length: 3 }, () => browser.newPage()));
		for (const page of authors) await open(page);
		readers = await Promise.all(Array.from({ length: 2 }, () => browser.newPage()));
		for (const page of readers) await page.goto(ready());
	});
	test.afterAll(async () => {
		await Promise.all([...authors, ...readers].map((page) => page.close()));
		await stop();
	});
	for (let batch = 0; batch < 10; batch++) {
		test(`saves ${batch * 5 + 1} through ${batch * 5 + 5} stay within four hosted revisions`, async () => {
			for (let n = batch * 5; n < batch * 5 + 5; n++) {
				const author = authors[n % 3];
				await expect(edit(author, heading)).toBeVisible();
				const next = `Save ${n}`;
				await save(author, heading, next);
				heading = next;
				urls.push(author.url());
				const files = await readdir(join(project(), ".praxity/studio-tmp"));
				const receipt = files.find((file) => /^\d+-/.test(file));
				if (!receipt) throw new Error("Missing temporary-output receipt");
				const temporary = await readFile(
					join(project(), ".praxity/studio-tmp", receipt, "workspace"),
					"utf8",
				);
				// Wait for the refreshing tabs to finish deduplicating their temporary output.
				for (const tab of authors) await expect(edit(tab, heading)).toBeVisible();
				await expect.poll(async () => (await readdir(temporary)).length).toBeLessThanOrEqual(4);
				if (n >= 3) expect((await readdir(temporary)).length).toBe(4);
				for (const url of urls.slice(-4))
					expect((await author.request.get(url, { maxRedirects: 0 })).status()).toBe(200);
				if (n >= 4)
					expect((await author.request.get(urls[n - 4], { maxRedirects: 0 })).status()).toBe(303);
				for (const read of readers) {
					await read.reload();
					await read.locator("a.praxity-nav-next").click();
					await expect(
						read.getByRole("heading", { name: "Second page", exact: true }),
					).toBeVisible();
					await read.goBack();
				}
			}
		});
	}
});
