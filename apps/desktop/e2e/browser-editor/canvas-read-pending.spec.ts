import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { startJourney } from "./global-setup";

for (const departure of ["Enter", "Read"] as const) {
	test(`Read stays unavailable when an open field defers a superseding refresh after ${departure}`, async ({
		page,
	}) => {
		const stop = await startJourney(page.context(), {
			courseFixture: resolve(import.meta.dirname, "fixtures/canvas-deck"),
		});
		let release = () => {};
		const held = new Promise<void>((done) => {
			release = done;
		});
		try {
			const origin = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
			await page.goto(`${origin}/launch?canvas=1`);
			let builds = 0;
			await page.route("**/api/rpc", async (route) => {
				if (route.request().postDataJSON().method === "canvasPreviewBuild") {
					builds++;
					await held;
				}
				await route.continue();
			});
			await page.getByRole("button", { name: "Edit heading 3: Second slide", exact: true }).click();
			await page.getByRole("textbox", { name: "Heading text", exact: true }).fill("Saved second");
			if (departure === "Enter") await page.keyboard.press("Enter");
			else
				await page
					.getByRole("link", { name: "Read mode", exact: true })
					.click({ noWaitAfter: true });
			await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toHaveText("Saved");
			await expect.poll(() => builds).toBeGreaterThan(0);
			await page
				.getByRole("button", { name: "Edit heading 2: Authored heading", exact: true })
				.click();
			await page.getByRole("textbox", { name: "Heading text", exact: true }).fill("Saved first");
			const released = page.waitForResponse(
				(response) =>
					response.request().method() === "POST" &&
					response.url().endsWith("/api/rpc") &&
					response.request().postDataJSON().method === "canvasPreviewBuild",
			);
			release();
			await (await released).finished();
			await page.getByRole("textbox", { name: "Heading text", exact: true }).press("ArrowLeft");
			const updating = page.getByRole("link", { name: /Read mode/ });
			await expect(updating).not.toHaveAttribute("href");
			await expect(updating).toHaveAccessibleName("Read mode: Updating");
			await expect(page.getByRole("textbox", { name: "Heading text", exact: true })).toHaveValue(
				"Saved first",
			);
			await page.keyboard.press("Enter");
			if (departure === "Enter") {
				const read = page.getByRole("link", { name: "Read mode", exact: true });
				await expect(read).toHaveAttribute("href", /praxity-resume=0/);
				await read.click();
			}
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await expect(page.getByRole("heading", { name: "Saved first", exact: true })).toBeVisible();
		} finally {
			release();
			await stop();
		}
	});
}

for (const gesture of ["click", "middle", "Control", "Meta", "Enter", "context menu"] as const) {
	test(`Read has no destination during compilation with ${gesture}`, async ({ page, context }) => {
		const stop = await startJourney(page.context(), {
			courseFixture: resolve(import.meta.dirname, "fixtures/canvas-deck"),
		});
		let release = () => {};
		const held = new Promise<void>((done) => {
			release = done;
		});
		try {
			const origin = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
			await page.goto(`${origin}/launch?canvas=1`);
			await expect(page.getByRole("link", { name: "Read mode", exact: true })).toHaveAttribute(
				"href",
				/praxity-resume=0/,
			);
			let builds = 0;
			await page.route("**/api/rpc", async (route) => {
				if (route.request().postDataJSON().method === "canvasPreviewBuild") {
					builds++;
					await held;
				}
				await route.continue();
			});
			await page.getByRole("button", { name: "Edit heading 3: Second slide", exact: true }).click();
			await page
				.getByRole("textbox", { name: "Heading text", exact: true })
				.fill("Held second slide");
			const revision = page.url();
			await page.keyboard.press("Enter");
			await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toHaveText("Saved");
			await expect.poll(() => builds).toBeGreaterThan(0);
			expect(
				await readFile(join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "lesson.prax"), "utf8"),
			).toContain("# Held second slide\n");
			const read = page.getByRole("link", { name: /Read mode/ });
			await expect(read).toHaveAccessibleName("Read mode: Updating");
			await expect(read).toHaveText("Read mode: Updating");
			await expect(read).toHaveAttribute("aria-busy", "true");
			await expect(read).toHaveAttribute("aria-disabled", "true");
			// A context menu can only offer link navigation when the browser has an href.
			await expect(read).not.toHaveAttribute("href");
			const tabs = context.pages().length;
			if (gesture === "Enter") {
				await read.focus();
				await page.keyboard.press("Enter");
			} else {
				await read.click({
					force: true,
					button: gesture === "middle" ? "middle" : gesture === "context menu" ? "right" : "left",
					modifiers: gesture === "Control" || gesture === "Meta" ? [gesture] : [],
				});
			}
			expect(page.url()).toBe(revision);
			expect(context.pages()).toHaveLength(tabs);
			release();
			await expect(page).not.toHaveURL(revision);
			await expect(read).toHaveAccessibleName("Read mode");
			await expect(read).toHaveAttribute("href", /praxity-resume=0/);
			await expect(read).not.toHaveAttribute("aria-disabled");
			await page.keyboard.press("Escape");
			if (gesture === "context menu" || gesture === "middle") {
				// Native context menus and Windows Firefox autoscroll consume the next pointer click.
				await read.focus();
				await page.keyboard.press("Enter");
			} else await read.click();
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await expect(
				page.getByRole("heading", { name: "Held second slide", exact: true }),
			).toBeVisible();
		} finally {
			release();
			await stop();
		}
	});
}
