import { expect, test } from "@playwright/test";
import {
	readNavVariantUrl,
	readSlidesNarrationUrl,
	readTestEnv,
	waitForHydration,
} from "./helpers";

test("representative runtimes execute without CSP violations", async ({ page }) => {
	await page.addInitScript(() => {
		const violations: string[] = [];
		(window as typeof window & { __praxityCspViolations?: string[] }).__praxityCspViolations =
			violations;
		document.addEventListener("securitypolicyviolation", (event) => {
			violations.push(`${event.effectiveDirective}: ${event.blockedURI}`);
		});
	});

	const urls = [
		`${readNavVariantUrl("none")}/page-one-static-content.html`,
		`${readNavVariantUrl("sidebar")}/page-two-interactive.html`,
		`${readSlidesNarrationUrl()}/narrated-slide.html`,
	];
	for (const url of urls) {
		await page.goto(url, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);
		expect(
			await page.evaluate(
				() =>
					(window as typeof window & { __praxityCspViolations?: string[] })
						.__praxityCspViolations ?? [],
			),
			url,
		).toEqual([]);
	}
});

test("redirect shell preserves query and fragment under the CSP", async ({ page }) => {
	const baseUrl = readTestEnv().url;
	await page.goto(`${baseUrl}/index.html?sample=1#retained`, { waitUntil: "domcontentloaded" });
	await page.waitForURL((url) => !url.pathname.endsWith("/index.html"));

	expect(new URL(page.url())).toMatchObject({ search: "?sample=1", hash: "#retained" });
});

test("runtime failures leave semantic navigation usable", async ({ page }) => {
	const sidebarUrl = readNavVariantUrl("sidebar");
	await page.route("**/island-loader-*.js", (route) => route.abort());
	await page.goto(`${sidebarUrl}/page-two-interactive.html`, { waitUntil: "domcontentloaded" });
	await expect(page.locator("html")).not.toHaveClass(/\bpraxity-js\b/);
	await expect(page.locator(".praxity-outline-fallback a").first()).toBeVisible();

	await page.goto(`${readSlidesNarrationUrl()}/narrated-slide.html`, {
		waitUntil: "domcontentloaded",
	});
	await expect(page.locator("html")).not.toHaveClass(/\bpraxity-js\b/);
	await expect(page.locator(".praxity-outline-fallback a").first()).toBeVisible();
});

test("tooltip definitions survive disabled or failed JavaScript", async ({ browser, page }) => {
	const url = `${readTestEnv().url}/rich-content-and-typography.html`;
	await page.route("**/island-tooltip-*.js", (route) => route.abort());
	await page.goto(url, { waitUntil: "domcontentloaded" });
	const fallback = page.locator(".inline-tooltip-fallback").first();
	await expect(fallback).toBeVisible();
	await expect(page.locator(".inline-tooltip-trigger").first()).not.toHaveAttribute(
		"data-tooltip-enhanced",
		"",
	);

	const context = await browser.newContext({ javaScriptEnabled: false });
	const noJsPage = await context.newPage();
	try {
		await noJsPage.goto(url, { waitUntil: "domcontentloaded" });
		await expect(noJsPage.locator(".inline-tooltip-fallback").first()).toBeVisible();
	} finally {
		await context.close();
	}
});
