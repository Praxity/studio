import { expect, type Page } from "@playwright/test";

export async function applyTwoHundredPercentZoom(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	expect(viewport, "browser-zoom test requires a fixed physical viewport").not.toBeNull();
	if (!viewport) throw new Error("browser-zoom test requires a fixed physical viewport");

	const session = await page.context().newCDPSession(page);
	await session.send("Emulation.setDeviceMetricsOverride", {
		width: Math.floor(viewport.width / 2),
		height: Math.floor(viewport.height / 2),
		screenWidth: viewport.width,
		screenHeight: viewport.height,
		deviceScaleFactor: 2,
		mobile: false,
	});

	const metrics = await page.evaluate(() => ({
		devicePixelRatio: window.devicePixelRatio,
		innerWidth: window.innerWidth,
	}));
	expect(metrics.devicePixelRatio, "200% zoom should double the CSS pixel scale").toBe(2);
	expect(metrics.innerWidth, "200% zoom should halve the CSS layout viewport").toBe(
		Math.floor(viewport.width / 2),
	);
}

export async function applyTextSpacing(page: Page): Promise<void> {
	await page.addStyleTag({
		content: `
			* {
				line-height: 1.5 !important;
				letter-spacing: 0.12em !important;
				word-spacing: 0.16em !important;
			}
			p {
				margin-bottom: 2em !important;
			}
		`,
	});
}
