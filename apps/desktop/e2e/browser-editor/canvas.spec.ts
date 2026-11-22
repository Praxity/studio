import { expect, test } from "@playwright/test";
import { startJourney } from "./global-setup";

test("compiled Read keeps learner controls and separate authority", async ({ page, request }) => {
	const stop = await startJourney(page.context(), {
		standaloneSource:
			"# First page\n\nA **nested** word.\n\n::: accordion More\n:: Item\nDisclosure body.\n:::\n\n# Second page\n\nSecond page body.\n",
	});
	try {
		const ready = process.env.PRAXITY_BROWSER_READY_URL ?? "";
		const origin = new URL(ready).origin;
		const token = new URL(ready).hash.slice("#session=".length);
		const response = await page.goto(ready);
		expect(response?.headers()["cache-control"]).toBe("no-store");
		expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
		const learnerOrigin = new URL(page.url()).origin;
		expect(learnerOrigin).not.toBe(origin);
		const plain = new URL(page.url());
		plain.pathname = plain.pathname.slice("/canvas".length);
		expect(await (await request.get(page.url())).text()).toBe(
			await (await request.get(plain.href)).text(),
		);
		expect(await page.evaluate(() => sessionStorage.getItem("praxity.studio.session"))).toBeNull();
		expect(await page.evaluate(() => Object.values(sessionStorage))).not.toContain(token);
		expect(await page.content()).not.toContain(token);
		expect(await page.locator("script[src]").count()).toBeGreaterThan(0);

		const disclosure = page.getByRole("button", { name: "More", exact: false });
		await disclosure.click();
		await expect(disclosure).toHaveAttribute("aria-expanded", "true");
		await page.locator("a.praxity-nav-next").click();
		await expect(page.getByText("Second page body.", { exact: true })).toBeVisible();
		await expect(page.getByRole("link", { name: "Edit text", exact: true })).toHaveCount(0);
		await page.locator("a.praxity-nav-prev").click();
		await expect(page.locator("p strong")).toHaveText("nested");
		await page.setViewportSize({ width: 600, height: 900 });
		await page.locator("[data-nav-menu-toggle]").click();
		await page.locator("#course-nav-sidebar a").filter({ hasText: "Second page" }).click();
		await expect(page.getByText("Second page body.", { exact: true })).toBeVisible();
		await expect(page.getByRole("link", { name: "Edit text", exact: true })).toHaveCount(0);
		for (const path of ["/api/rpc", "/api/events", "/api/session"]) {
			const response = await request.get(`${learnerOrigin}${path}`);
			expect(response.status()).toBe(404);
			expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
		}
		for (const method of [
			"projectSave",
			"courseWriteLesson",
			"operationApply",
			"draftPut",
			"draftDelete",
			"historyApply",
		]) {
			const response = await request.post(`${learnerOrigin}/api/rpc`, {
				data: { method, args: {} },
			});
			expect(response.status()).toBe(405);
			const credentialed = await request.post(`${learnerOrigin}/api/rpc`, {
				headers: { Authorization: `Bearer ${token}` },
				data: { method, args: {} },
			});
			expect(credentialed.status()).toBe(403);
		}
		for (const route of ["/api/rpc", "/api/events"]) {
			const refused = await request.get(`${origin}${route}`, {
				headers: { Origin: "null", Authorization: `Bearer ${token}` },
			});
			expect(refused.status()).toBe(403);
		}
	} finally {
		await stop();
	}
});
