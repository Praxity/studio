import { expect, type Frame, type Locator, type Page } from "@playwright/test";

/** Enter through Tab, then use the browser's native radio navigation. */
export async function arrowRadio(page: Page, first: Locator, next: Locator) {
	await first.focus();
	await page.keyboard.press("Shift+Tab");
	await page.keyboard.press("Tab");
	await expect(first).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(next).toBeFocused();
	await expect(next).toBeChecked();
}

export async function expectFocusRing(
	target: Locator,
	width: number,
	inset = false,
	systemColor: "CanvasText" | "Highlight" = "CanvasText",
) {
	const painted = await target.evaluate((element, expectedSystemColor) => {
		const style = getComputedStyle(element);
		const forcedColors = matchMedia("(forced-colors: active)").matches;
		const probe = document.createElement("span");
		probe.style.outline = `2px solid ${expectedSystemColor}`;
		document.body.append(probe);
		const resolvedSystemColor = getComputedStyle(probe).outlineColor;
		probe.remove();
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = 1;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Missing canvas color conversion");
		const rgba = (color: string) => {
			context.clearRect(0, 0, 1, 1);
			context.fillStyle = color;
			context.fillRect(0, 0, 1, 1);
			return Array.from(context.getImageData(0, 0, 1, 1).data);
		};
		let background = [255, 255, 255];
		const ancestors: Element[] = [];
		for (
			let node: Element | null =
				Number.parseFloat(style.outlineOffset) < 0 ? element : element.parentElement;
			node;
			node = node.parentElement
		)
			ancestors.unshift(node);
		for (const node of ancestors) {
			const color = rgba(getComputedStyle(node).backgroundColor);
			const alpha = color[3] / 255;
			background = background.map((channel, index) => channel * (1 - alpha) + color[index] * alpha);
		}
		const luminance = (color: number[]) =>
			color
				.slice(0, 3)
				.map((channel) => {
					const srgb = channel / 255;
					return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
				})
				.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
		const ring = rgba(style.outlineColor);
		const ringAlpha = ring[3] / 255;
		const ringLuminance = luminance(
			background.map((channel, index) => channel * (1 - ringAlpha) + ring[index] * ringAlpha),
		);
		const backgroundLuminance = luminance(background);
		return {
			forcedColors,
			supportsForcedColorAdjust: CSS.supports("forced-color-adjust", "auto"),
			forcedColorAdjust: style.getPropertyValue("forced-color-adjust"),
			resolvedSystemColor,
			width: Number.parseFloat(style.outlineWidth),
			style: style.outlineStyle,
			color: style.outlineColor,
			offset: Number.parseFloat(style.outlineOffset),
			shadow: style.boxShadow,
			contrast:
				(Math.max(ringLuminance, backgroundLuminance) + 0.05) /
				(Math.min(ringLuminance, backgroundLuminance) + 0.05),
		};
	}, systemColor);
	expect(painted.style).toBe("solid");
	expect(painted.width).toBe(width);
	expect(painted.color).not.toBe("rgba(0, 0, 0, 0)");
	expect(painted.shadow).toBe("none");
	if (painted.forcedColors && painted.supportsForcedColorAdjust) {
		// A user-selected forced palette controls contrast; honor its system colors.
		expect(painted.forcedColorAdjust).toBe("auto");
		expect(painted.color).toBe(painted.resolvedSystemColor);
		expect(painted.contrast).toBeGreaterThan(1);
	} else {
		// WebKit emulates the media query without replacing authored colors.
		expect(painted.contrast).toBeGreaterThanOrEqual(3);
	}
	if (inset) expect(painted.offset).toBeLessThanOrEqual(-width);
}

export async function expectNoFocusRing(target: Locator) {
	const painted = await target.evaluate((element) => {
		const style = getComputedStyle(element);
		return { outline: style.outlineStyle, shadow: style.boxShadow };
	});
	expect(painted.outline).toBe("none");
	expect(painted.shadow).toBe("none");
}

/** Check the actual ring rectangle against every clipping ancestor. */
export async function expectUnclippedRing(target: Locator) {
	await expect
		.poll(() =>
			target.evaluate((element) => {
				const style = getComputedStyle(element);
				const spread =
					Number.parseFloat(style.outlineOffset) + Number.parseFloat(style.outlineWidth);
				const rect = element.getBoundingClientRect();
				const failures: string[] = [];
				for (let parent = element.parentElement; parent; parent = parent.parentElement) {
					const css = getComputedStyle(parent);
					const bounds = parent.getBoundingClientRect();
					if (
						css.overflowX !== "visible" &&
						(rect.left - spread < bounds.left - 1 || rect.right + spread > bounds.right + 1)
					)
						failures.push(`${parent.className}: horizontal`);
					if (
						css.overflowY !== "visible" &&
						(rect.top - spread < bounds.top - 1 || rect.bottom + spread > bounds.bottom + 1)
					)
						failures.push(`${parent.className}: vertical`);
				}
				return failures;
			}),
		)
		.toEqual([]);
}

/** Match the shipped predicate without importing the production rule into its oracle. */
export async function forcedPalette(page: Page | Frame): Promise<boolean> {
	return page.evaluate(
		() =>
			matchMedia("(forced-colors: active)").matches && CSS.supports("forced-color-adjust", "auto"),
	);
}

/** Unsupported emulation must paint the same authored theme, including pseudo-elements. */
export async function expectForcedEmulationInert(
	page: Page,
	targets: (Locator | { locator: Locator; pseudo: string })[],
) {
	expect(targets.length).toBeGreaterThan(0);
	const read = async () =>
		Promise.all(
			targets.map(async (target) => {
				const locator = "pseudo" in target ? target.locator : target;
				const pseudo = "pseudo" in target ? target.pseudo : null;
				expect(await locator.count()).toBeGreaterThan(0);
				return locator.evaluateAll(
					(elements, pseudo) =>
						elements.map((element) => {
							const style = getComputedStyle(element, pseudo);
							const properties = [
								"outline-color",
								"outline-style",
								"outline-width",
								"outline-offset",
								"border-top",
								"border-right",
								"border-bottom",
								"border-left",
								"background-color",
								"color",
								"display",
								"opacity",
								"appearance",
								"box-shadow",
							];
							return Object.fromEntries(
								properties.map((name) => [name, style.getPropertyValue(name)]),
							);
						}),
					pseudo,
				);
			}),
		);
	try {
		await page.emulateMedia({ forcedColors: "none" });
		const normal = await read();
		await page.emulateMedia({ forcedColors: "active" });
		await expect.poll(read).toEqual(normal);
	} finally {
		await page.emulateMedia({ forcedColors: "active" });
	}
}
