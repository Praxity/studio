import { expect, test } from "@playwright/test";
import { expectFocusRing, expectForcedEmulationInert } from "../focus-assertions";

for (const inset of [false, true]) {
	test(`focus contrast rejects a translucent white ring on black, inset=${inset}`, async ({
		page,
	}) => {
		await page.setContent(`
			<body style="background: black">
				<button style="background: black; outline: 3px solid rgba(255, 255, 255, 0.1);
					outline-offset: ${inset ? -3 : 2}px; box-shadow: none">Focus</button>
			</body>
		`);
		await expect(expectFocusRing(page.getByRole("button"), 3, inset)).rejects.toThrow(
			"toBeGreaterThanOrEqual",
		);
	});

	test(`focus contrast accepts an opaque white ring on black, inset=${inset}`, async ({ page }) => {
		await page.setContent(`
			<body style="background: black">
				<button style="background: black; outline: 3px solid white;
					outline-offset: ${inset ? -3 : 2}px; box-shadow: none">Focus</button>
			</body>
		`);
		await expectFocusRing(page.getByRole("button"), 3, inset);
	});

	test(`focus contrast rejects a translucent ring, inset=${inset}`, async ({ page }) => {
		await page.setContent(`
			<body style="background: white">
				<button style="background: white; outline: 3px solid rgba(0, 0, 0, 0.1);
					outline-offset: ${inset ? -3 : 2}px; box-shadow: none">Focus</button>
			</body>
		`);
		await expect(expectFocusRing(page.getByRole("button"), 3, inset)).rejects.toThrow(
			"toBeGreaterThanOrEqual",
		);
	});

	test(`focus contrast accepts an opaque ring, inset=${inset}`, async ({ page }) => {
		await page.setContent(`
			<body style="background: white">
				<button style="background: white; outline: 3px solid black;
					outline-offset: ${inset ? -3 : 2}px; box-shadow: none">Focus</button>
			</body>
		`);
		await expectFocusRing(page.getByRole("button"), 3, inset);
	});
}

test("inert emulation guard rejects a changed style", async ({ page }) => {
	await page.setContent(`<style>
		* { forced-color-adjust: none; }
		@media (forced-colors: active) { button { display: none; } }
	</style><button>Focus</button>`);
	await expect(
		expectForcedEmulationInert(page, [page.getByRole("button", { includeHidden: true })]),
	).rejects.toThrow();
});

test("inert emulation guard refuses empty targets", async ({ page }) => {
	await page.setContent("<button>Focus</button>");
	await expect(expectForcedEmulationInert(page, [])).rejects.toThrow();
	await expect(expectForcedEmulationInert(page, [page.locator(".missing")])).rejects.toThrow();
});
