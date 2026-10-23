import { expect, test } from "@playwright/test";
import { startJourney } from "./global-setup";

for (const scope of ["page", "second page", "context"] as const) {
	test(`journey shutdown drains an in-flight ${scope} route before stopping Studio`, async ({
		page,
		context,
		browser,
	}) => {
		const stop = await startJourney(scope === "second page" ? browser : context, {
			standaloneSource: "# Teardown\n",
		});
		const origin = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
		const target = scope === "second page" ? await context.newPage() : page;
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let entered = () => {};
		const routed = new Promise<void>((resolve) => {
			entered = resolve;
		});
		let completed = false;
		await (scope === "context" ? context : target).route("**/api/session", async (route) => {
			entered();
			await held;
			const response = await route.fetch();
			expect(response.status()).toBe(401);
			await route.fulfill({ response });
			completed = true;
		});
		const navigation = target.goto(`${origin}/api/session`);
		await routed;
		let stopped = false;
		const stopping = stop().then(() => {
			stopped = true;
		});
		try {
			// Keep the upstream fetch held while teardown has a chance to close its listener.
			await page.waitForTimeout(100);
			expect(stopped).toBe(false);
			expect(completed).toBe(false);
		} finally {
			release();
			await Promise.all([navigation, stopping]);
		}
		expect(completed).toBe(true);
		expect(stopped).toBe(true);
	});
}
