import { expect, test } from "@playwright/test";
import { expectFocusRing, expectForcedEmulationInert, forcedPalette } from "../focus-assertions";
import { readHiddenBlocksFixture, waitForHydration } from "./helpers";

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		const mute = () => {
			for (const media of document.querySelectorAll<HTMLMediaElement>("audio, video"))
				media.muted = true;
		};
		document.addEventListener("DOMContentLoaded", mute);
	});
	const fixture = readHiddenBlocksFixture();
	await page.goto(`${fixture.url}/${fixture.pages[0].slug}.html`);
	await waitForHydration(page);
});

test("signed methods retain one Tab entry and arrow discovery without changing the signature", async ({
	page,
}) => {
	const signature = page.locator('[data-block-type="signature"]');
	const draw = signature.getByRole("tab", { name: "Draw", exact: true });
	const type = signature.getByRole("tab", { name: "Type", exact: true });
	const input = signature.getByRole("textbox");
	await draw.focus();
	await page.keyboard.press("End");
	await page.keyboard.press("Tab");
	await expect(input).toBeFocused();
	await page.keyboard.type("Ada Lovelace");
	await expect(input).toBeFocused();
	for (const tab of [draw, type]) {
		await expect(tab).toHaveAttribute("aria-disabled", "true");
		await expect(tab).toHaveAccessibleDescription(
			"Clear your signature to change the signing method.",
		);
	}
	await expect(
		signature.getByText("Clear your signature to change the signing method."),
	).toBeVisible();
	await page.keyboard.press("Shift+Tab");
	await expect(type).toBeFocused();
	for (const [key, target] of [
		["ArrowLeft", draw],
		["End", type],
		["Home", draw],
		["ArrowRight", type],
	] as const) {
		await page.keyboard.press(key);
		await expect(target).toBeFocused();
		await expect(signature.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
		await expect(type).toHaveAttribute("aria-selected", "true");
		await expect(signature.locator('[data-signature-panel="draw"]')).toBeHidden();
		await expect(input).toHaveValue("Ada Lovelace");
	}
	await page.keyboard.press("Home");
	await page.keyboard.press("Enter");
	await page.keyboard.press("Space");
	// ARIA-disabled still allows a pointer event; the owning action must guard it.
	await draw.evaluate((element: HTMLButtonElement) => element.click());
	await draw.dispatchEvent("click");
	const drawBox = await draw.boundingBox();
	if (!drawBox) throw new Error("Draw tab has no pointer target");
	await page.mouse.click(drawBox.x + drawBox.width / 2, drawBox.y + drawBox.height / 2);
	await expect(type).toHaveAttribute("aria-selected", "true");
	await expect(input).toHaveValue("Ada Lovelace");
	await page.keyboard.press("Tab");
	await expect(input).toBeFocused();
	await page.keyboard.press("Tab");
	const clear = signature.getByRole("button", { name: "Clear", exact: true });
	await expect(clear).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(input).toBeFocused();
	await expect(input).toHaveValue("");
	await expect(type).not.toHaveAttribute("aria-disabled");
	await expect(
		signature.getByText("Clear your signature to change the signing method."),
	).toBeHidden();
	await page.keyboard.press("Shift+Tab");
	await page.keyboard.press("Home");
	await expect(draw).toHaveAttribute("aria-selected", "true");
	// The enhanced signature creates no navigation landmarks of its own.
	await expect(signature.getByRole("region")).toHaveCount(0);
});

test("drawn signatures keep their panel locked and Clear returns focus to the canvas", async ({
	page,
}) => {
	const signature = page.locator('[data-block-type="signature"]');
	const canvas = signature.locator("canvas");
	const draw = signature.getByRole("tab", { name: "Draw", exact: true });
	const type = signature.getByRole("tab", { name: "Type", exact: true });
	await canvas.focus();
	const box = await canvas.boundingBox();
	if (!box) throw new Error("Signature canvas has no drawing target");
	await page.mouse.move(box.x + 30, box.y + 30);
	await page.mouse.down();
	await page.mouse.move(box.x + 70, box.y + 50);
	await page.mouse.up();
	await expect(draw).toHaveAttribute("aria-disabled", "true");
	await expect(canvas).toBeFocused();
	await page.keyboard.press("Shift+Tab");
	await expect(draw).toBeFocused();
	await page.keyboard.press("End");
	await expect(type).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(draw).toHaveAttribute("aria-selected", "true");
	await expect(signature.locator('[data-signature-panel="type"]')).toBeHidden();
	await page.keyboard.press("Tab");
	await expect(canvas).toBeFocused();
	await page.keyboard.press("Tab");
	await page.keyboard.press("Enter");
	await expect(canvas).toBeFocused();
	await expect(draw).not.toHaveAttribute("aria-disabled");
	await page.keyboard.press("Shift+Tab");
	await expect(draw).toBeFocused();
	await page.keyboard.press("End");
	await expect(type).toHaveAttribute("aria-selected", "true");
});

test("restored typed signatures retain unavailable methods and recover with Clear", async ({
	page,
}) => {
	const signature = page.locator('[data-block-type="signature"]');
	await signature.getByRole("tab", { name: "Type", exact: true }).click();
	await signature.getByRole("textbox").fill("Ada Lovelace");
	await page.reload();
	await waitForHydration(page);
	await expect(signature.getByRole("textbox")).toHaveValue("Ada Lovelace");
	const type = signature.getByRole("tab", { name: "Type", exact: true });
	await expect(type).toHaveAttribute("aria-disabled", "true");
	await expect(type).toHaveAttribute("tabindex", "0");
	await expect(type).toHaveAccessibleDescription(
		"Clear your signature to change the signing method.",
	);
	await type.focus();
	await page.keyboard.press("Home");
	await expect(signature.getByRole("tab", { name: "Draw", exact: true })).toBeFocused();
	await expect(type).toHaveAttribute("aria-selected", "true");
	await signature.getByRole("button", { name: "Clear", exact: true }).click();
	await expect(signature.getByRole("textbox")).toBeFocused();
});

test("signed labels and focus remain readable in forced colors", async ({ page }, testInfo) => {
	await page.emulateMedia({ forcedColors: "active" });
	const signature = page.locator('[data-block-type="signature"]');
	await signature.getByRole("tab", { name: "Type", exact: true }).click();
	await signature.getByRole("textbox").fill("Ada");
	const draw = signature.getByRole("tab", { name: "Draw", exact: true });
	await page.keyboard.press("Shift+Tab");
	await page.keyboard.press("Home");
	await expect(draw).toBeFocused();
	if (!(await forcedPalette(page))) {
		await expectForcedEmulationInert(page, [draw, signature.getByRole("textbox")]);
		await expectFocusRing(draw, 2);
	}
	const style = await draw.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			opacity: style.opacity,
			color: style.color,
			outlineStyle: style.outlineStyle,
			outlineWidth: style.outlineWidth,
		};
	});
	expect(style.opacity).toBe("1");
	expect(style.color).not.toBe("rgba(0, 0, 0, 0)");
	expect(style.outlineStyle).toBe("solid");
	expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2);
	await signature.screenshot({ path: testInfo.outputPath("signature-forced-colors.png") });
});
