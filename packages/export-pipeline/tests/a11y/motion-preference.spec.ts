import { expect, test } from "@playwright/test";
import { readTestEnv } from "./helpers";

type MotionProof = {
	firstPaint?: { reduced: boolean; bodyParsed: boolean };
	entrance?: { reduced: boolean; pending: number; visible: number };
};

declare global {
	interface Window {
		__motionProof?: MotionProof;
	}
}

for (const [choice, device, reduced] of [
	["off", "no-preference", true],
	[null, "reduce", true],
	[null, "no-preference", false],
] as const) {
	test(`motion choice ${choice} with device ${device} resolves before first paint and entrance`, async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: device });
		await page.addInitScript((motionChoice) => {
			localStorage.setItem("praxity-a11y", JSON.stringify({ motionChoice, focusChoice: null }));
			window.__motionProof = {};
			let initialize: ((root: HTMLElement) => void) | undefined;
			Object.defineProperty(window, "__PRAXITY_INIT_ENTRANCE_MOTION__", {
				configurable: true,
				get: () => initialize,
				set: (original: (root: HTMLElement) => void) => {
					initialize = (root) => {
						const reduced = root.hasAttribute("data-praxity-reduced-motion");
						const result = original(root);
						if (window.__motionProof)
							window.__motionProof.entrance = {
								reduced,
								pending: root.querySelectorAll('[data-entrance="pending"]').length,
								visible: root.querySelectorAll('[data-entrance="visible"]').length,
							};
						return result;
					};
				},
			});
		}, choice);
		await page.route(/\/course-shell-[A-Z0-9]{8}\.js$/, async (route) => {
			const response = await route.fetch();
			const script = await response.text();
			await route.fulfill({
				response,
				body: `${script}\n;window.__motionProof.firstPaint = { reduced: document.documentElement.hasAttribute("data-praxity-reduced-motion"), bodyParsed: document.body !== null };`,
			});
		});
		await page.goto(`${readTestEnv().url}/design-layout-motionEntrance-slide/layout-audit.html`);
		const proof = await page.evaluate(() => window.__motionProof);
		expect(proof?.firstPaint).toEqual({ reduced, bodyParsed: false });
		expect(proof?.entrance?.reduced).toBe(reduced);
		if (reduced) {
			expect(proof?.entrance?.pending).toBe(0);
			expect(proof?.entrance?.visible).toBeGreaterThan(0);
			const blocks = page.locator(".praxity-block");
			expect(await blocks.count()).toBeGreaterThan(0);
			for (const block of await blocks.all()) {
				await expect(block).toHaveCSS("opacity", "1");
				await expect(block).toHaveCSS("transform", "none");
				await expect(block).toHaveCSS("transition-duration", "0s");
			}
		} else expect(proof?.entrance?.pending).toBeGreaterThan(0);
	});
}

test("saved motion off survives reading controls and a compiled page reload", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.addInitScript(() => {
		if (localStorage.getItem("praxity-a11y") === null)
			localStorage.setItem(
				"praxity-a11y",
				JSON.stringify({ motionChoice: "off", focusChoice: null }),
			);
	});
	await page.goto(`${readTestEnv().url}/visited-status-en-flat/index.html`);
	await expect(page.locator("html")).toHaveAttribute("data-praxity-reduced-motion", "true");
	for (const name of ["Larger text", "Reading guide"]) {
		const button = page.getByRole("button", { name, exact: true });
		await button.click();
		await expect(button).toHaveAttribute("aria-pressed", "true");
	}
	const saved = { textSize: "large", focusChoice: true, focusMode: true, motionChoice: "off" };
	expect(
		await page.evaluate(() => JSON.parse(localStorage.getItem("praxity-a11y") ?? "{}")),
	).toEqual(saved);
	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("data-praxity-reduced-motion", "true");
	await expect(page.getByRole("button", { name: "Larger text", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(page.getByRole("button", { name: "Reading guide", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	expect(
		await page.evaluate(() => JSON.parse(localStorage.getItem("praxity-a11y") ?? "{}")),
	).toEqual(saved);
});
