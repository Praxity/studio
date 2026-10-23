import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, type Response, test } from "@playwright/test";
import { startJourney } from "./global-setup";

test("concurrent root tabs recover replaced and busy admissions into Read mode", async ({
	context,
}) => {
	const stop = await startJourney(context, {
		standaloneSource: "# Concurrent launch\n\nLearner text.\n",
	});
	try {
		const ready = process.env.PRAXITY_BROWSER_READY_URL ?? "";
		const tabs = await Promise.all(Array.from({ length: 6 }, () => context.newPage()));
		let release: (() => void) | undefined;
		const bothLaunched = new Promise<void>((resolve) => {
			release = resolve;
		});
		let launches = 0;
		await context.route("**/canvas?admission=*", async (route) => {
			if (++launches === 6) release?.();
			await bothLaunched;
			await route.continue();
		});
		const token = new URL(ready).hash.slice("#session=".length);
		const responses: Response[] = [];
		context.on("response", (response) => {
			if (response.request().resourceType() === "document") responses.push(response);
		});
		await Promise.all(tabs.map((tab) => tab.goto(ready)));
		for (const response of responses) {
			expect(JSON.stringify(response.headers())).not.toContain(token);
			expect([200, 303]).toContain(response.status());
			if (response.status() === 200) expect(await response.text()).not.toContain(token);
		}
		for (const tab of tabs) {
			expect(new URL(tab.url()).origin).not.toBe(new URL(ready).origin);
			expect(tab.url()).not.toContain(token);
			expect(await tab.content()).not.toContain(token);
			await expect(
				tab.getByRole("heading", { name: "Concurrent launch", exact: true }),
			).toBeVisible();
			await expect(tab.getByRole("link", { name: "Edit text", exact: true })).toBeVisible();
		}
	} finally {
		await stop();
	}
});

for (const deck of [false, true]) {
	test(`CLI root opens Read mode and admits text editing, deck=${deck}`, async ({
		page,
		request,
	}) => {
		await page.addInitScript(() => {
			// Observe admission before the learner deck writes its own slide fragment.
			Reflect.set(window, "studioTestInitialFragment", location.hash);
		});
		const stop = await startJourney(
			page.context(),
			deck
				? { courseFixture: resolve(import.meta.dirname, "fixtures/canvas-deck") }
				: { standaloneSource: "# Opening slide\n\nLearner text.\n" },
		);
		try {
			const ready = process.env.PRAXITY_BROWSER_READY_URL ?? "";
			const editor = new URL(ready).origin;
			const token = new URL(ready).hash.slice("#session=".length);
			const file = join(
				process.env.PRAXITY_BROWSER_PROJECT ?? "",
				deck ? "lesson.prax" : "second.prax",
			);
			const original = await readFile(file, "utf8");
			await page.goto(ready);
			expect(new URL(page.url()).origin).not.toBe(editor);
			expect(await page.evaluate(() => Reflect.get(window, "studioTestInitialFragment"))).toBe("");
			expect(new URL(page.url()).hash).not.toContain(token);
			expect(
				await page.evaluate(() => sessionStorage.getItem("praxity.studio.session")),
			).toBeNull();
			expect(await page.content()).not.toContain(token);
			await expect(
				page.getByRole("button", { name: "Edit heading 1: Opening slide", exact: true }),
			).toHaveCount(0);
			if (deck) await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await page.getByRole("link", { name: "Edit text", exact: true }).click();
			expect(new URL(page.url()).origin).toBe(editor);
			await expect(page.getByRole("status").filter({ hasText: "Connected" })).toHaveText(
				"Connected",
			);
			await page
				.getByRole("button", { name: "Edit heading 1: Opening slide", exact: true })
				.first()
				.click();
			await page
				.getByRole("textbox", { name: "Heading text", exact: true })
				.fill("Saved from the thin canvas");
			await page.keyboard.press("Enter");
			await expect(page.getByRole("status").filter({ hasText: "Saved" })).toHaveText("Saved");
			expect(await readFile(file, "utf8")).toBe(
				original.replace("Opening slide", "Saved from the thin canvas"),
			);
			// Reopening the root builds saved bytes; an existing Read link identifies its immutable capture.
			await page.goto(ready);
			await expect(
				page.getByRole("heading", { name: "Saved from the thin canvas", exact: true }).first(),
			).toBeVisible();
			for (const path of ["/index.html", "/entry.ts", "/canvas.js"])
				expect((await request.get(`${editor}${path}`)).status()).toBe(404);
		} finally {
			await stop();
		}
	});
}
