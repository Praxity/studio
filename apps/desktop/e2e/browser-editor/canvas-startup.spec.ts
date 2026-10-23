import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startJourney } from "./global-setup";

for (const invalidated of [false, true]) {
	test(`startup reuses captured content with a matching-content invalidation=${invalidated}`, async ({
		page,
	}) => {
		const stop = await startJourney(page.context());
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let snapshots = 0;
		let builds = 0;
		try {
			await page.addInitScript(() => {
				const parse = JSON.parse;
				const observed = window as unknown as { startupEvents: number };
				observed.startupEvents = 0;
				JSON.parse = (...args: Parameters<typeof JSON.parse>) => {
					const value = parse(...args);
					if (value?.type === "editorChanged") observed.startupEvents++;
					return value;
				};
			});
			await page.route("**/api/rpc", async (route) => {
				const method = route.request().postDataJSON().method;
				if (method === "canvasPreviewBuild") builds++;
				if (method !== "canvasTextSnapshot" || ++snapshots !== 1) return route.continue();
				const response = await route.fetch();
				await held;
				await route.fulfill({ response });
			});
			const origin = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
			await page.goto(`${origin}/launch?canvas=1`);
			await expect.poll(() => snapshots).toBe(1);
			const document = page.url();
			if (invalidated) {
				const manifest = join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "course.yaml");
				await writeFile(manifest, `${await readFile(manifest, "utf8")}\n`);
				await expect
					.poll(() =>
						page.evaluate(() => (window as unknown as { startupEvents: number }).startupEvents),
					)
					.toBeGreaterThan(0);
			}
			release();
			await expect(page.getByRole("status")).toHaveText("Connected");
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					),
			);
			expect(snapshots).toBe(invalidated ? 2 : 1);
			expect(builds).toBe(0);
			expect(page.url()).toBe(document);
			await expect(page.getByRole("link", { name: "Read mode", exact: true })).toHaveAttribute(
				"href",
				/praxity-resume=0/,
			);
		} finally {
			release();
			await stop();
		}
	});
}
