import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startJourney } from "./global-setup";

for (const removed of ["First", "Middle", "Last"]) {
	test(`removed ${removed} page falls back by identity in Read`, async ({ page, context }) => {
		const pages = ["First", "Middle", "Last"];
		const source = pages
			.map((name) => `# ${name}\n\n## ${name} heading\n\n${name} body.\n`)
			.join("\n");
		const stop = await startJourney(context, { standaloneSource: source });
		try {
			const ready = process.env.PRAXITY_BROWSER_READY_URL ?? "";
			await page.goto(ready);
			for (let i = 0; i < pages.indexOf(removed); i++)
				await page.locator("a.praxity-nav-next").click();
			const old = page.url();
			const builder = await context.newPage();
			for (let i = 0; i < 5; i++) {
				await writeFile(
					join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax"),
					pages
						.filter((name) => name !== removed)
						.map((name) => `# ${name}\n\n${name} body ${i}.\n`)
						.join("\n"),
				);
				await builder.goto(ready);
			}
			expect((await page.request.get(old, { maxRedirects: 0 })).status()).toBe(303);
			await page.reload();
			await expect(
				page.getByRole("heading", { name: removed === "First" ? "Middle" : "First", exact: true }),
			).toBeVisible();
		} finally {
			await stop();
		}
	});
}
