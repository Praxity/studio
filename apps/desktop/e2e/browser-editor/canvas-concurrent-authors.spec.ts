import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startJourney } from "./global-setup";

for (const count of [2, 3]) {
	test(`${count} authors in one context connect and each save`, async ({ page, context }) => {
		const stop = await startJourney(context, {
			standaloneSource: "# Canvas\n\n## Original heading\n\nBody.\n",
		});
		const pages = [page];
		try {
			const origin = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
			for (let index = 0; index < count; index++) {
				const author = index === 0 ? page : await context.newPage();
				if (index > 0) pages.push(author);
				const [events] = await Promise.all([
					author.waitForResponse(`${origin}/api/events`),
					author
						.goto(`${origin}/launch?canvas=1`)
						.then(() => expect(author.getByRole("status")).toHaveText("Connected")),
				]);
				expect(events.headers()["cache-control"]).toBe("no-store");
			}
			let heading = "Original heading";
			for (const [index, author] of pages.entries()) {
				await author
					.getByRole("button", { name: `Edit heading 2: ${heading}`, exact: true })
					.click();
				const saved = `Saved by author ${index + 1}`;
				await author.getByRole("textbox").fill(saved);
				await author.getByRole("textbox").press("Enter");
				for (const peer of pages) {
					await expect(
						peer.getByRole("button", { name: `Edit heading 2: ${saved}`, exact: true }),
					).toBeVisible();
				}
				expect(
					await readFile(join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax"), "utf8"),
				).toBe(`# Canvas\n\n## ${saved}\n\nBody.\n`);
				heading = saved;
			}
		} finally {
			for (const author of pages) await author.close();
			await stop();
		}
	});
}
