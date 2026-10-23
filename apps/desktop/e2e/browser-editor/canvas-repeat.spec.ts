import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startJourney } from "./global-setup";

test("C06b a CRLF paragraph can be edited again before background refresh", async ({ page }) => {
	const source = "# Practice\r\n\r\nFirst line\r\nsecond line.\r\n\r\nLater paragraph.\r\n";
	const stop = await startJourney(page.context(), { standaloneSource: source });
	let heldBuilds = 0;
	let release = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	try {
		await page.goto(
			`${new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin}/launch?canvas=1`,
		);
		await expect(page.getByRole("status")).toHaveText("Connected");
		await page.route("**/api/rpc", async (route) => {
			if (route.request().postDataJSON().method === "canvasPreviewBuild") {
				expect(route.request().postDataJSON().method).toBe("canvasPreviewBuild");
				heldBuilds++;
				await held;
			}
			await route.continue();
		});
		for (const [before, after] of [
			["First line second line.", "Changed first\nsecond line."],
			["Changed first second line.", "Changed again\nsecond line."],
			["Later paragraph.", "Later changed\nstill later."],
			["Changed again second line.", "First final\nsecond line."],
		]) {
			await page
				.getByRole("button", {
					name: `Edit paragraph ${before === "Later paragraph." ? 2 : 1}: ${before}`,
					exact: true,
				})
				.focus();
			await page.keyboard.press("Enter");
			const field = page.getByRole("textbox", { name: "Paragraph text", exact: true });
			await field.fill(after);
			await field.press("Enter");
			await expect(field).toHaveCount(0);
			await expect(page.getByRole("status")).toHaveText("Saved");
			await expect
				.poll(() => heldBuilds, { message: "The preview refresh hold must engage" })
				.toBeGreaterThan(0);
		}
		expect(
			await readFile(join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax"), "utf8"),
		).toBe(
			"# Practice\r\n\r\nFirst final\r\nsecond line.\r\n\r\nLater changed\r\nstill later.\r\n",
		);
	} finally {
		release();
		await stop();
	}
});
