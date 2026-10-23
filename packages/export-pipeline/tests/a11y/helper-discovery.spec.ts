import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { findPageWithSelector } from "./helpers";

test("fixture discovery addresses the indexed page and awaits its delayed island", async ({
	page,
}) => {
	const directory = await mkdtemp(resolve(tmpdir(), "discovery-contract-"));
	const previous = process.env.PRAXITY_A11Y_ENV_PATH;
	const url = "http://fixture.test/indexed";
	const pages = ["empty-a", "empty-b", "interactive"].map((slug) => ({ slug, title: slug }));
	const selector = "[data-block-type='tabs'] [role='tab']";
	let navigations = 0;
	try {
		process.env.PRAXITY_A11Y_ENV_PATH = resolve(directory, "env.json");
		await writeFile(
			process.env.PRAXITY_A11Y_ENV_PATH,
			JSON.stringify({ url, pages, selectorPages: { [url]: { [selector]: [pages[2]] } } }),
		);
		await page.route(`${url}/**`, async (route) => {
			navigations++;
			await route.fulfill({
				contentType: "text/html",
				body: `<html class="praxity-js-loaded"><body>${route.request().url().endsWith("interactive.html") ? '<div data-block-type="tabs" data-island="tabs"><button role="tab">Tab</button></div><script>setTimeout(() => document.querySelector("[data-island]").setAttribute("data-hydrated", ""), 250)</script>' : "Empty"}</body></html>`,
			});
		});
		expect(await findPageWithSelector(page, url, pages, selector)).toEqual(pages[2]);
		expect(navigations).toBe(1);
		await expect(page.locator("[data-island]")).toHaveAttribute("data-hydrated", "");
	} finally {
		if (previous === undefined) delete process.env.PRAXITY_A11Y_ENV_PATH;
		else process.env.PRAXITY_A11Y_ENV_PATH = previous;
		await rm(directory, { recursive: true, force: true });
	}
});

test("a transient selector miss cannot become a permanent cached absence", async ({ page }) => {
	const url = "http://fixture.test/transient";
	const pages = [{ slug: "page", title: "Page" }];
	let ready = false;
	await page.route(`${url}/**`, (route) =>
		route.fulfill({
			contentType: "text/html",
			body: `<html class="praxity-js-loaded"><body>${ready ? '<button id="late-target">Ready</button>' : "Waiting"}</body></html>`,
		}),
	);
	expect(await findPageWithSelector(page, url, pages, "#late-target")).toBeNull();
	ready = true;
	expect(await findPageWithSelector(page, url, pages, "#late-target")).toEqual(pages[0]);
});

test("indexed discovery skips hidden SSR matches and retains a later visible page", async ({
	page,
}) => {
	const directory = await mkdtemp(resolve(tmpdir(), "discovery-hidden-"));
	const previous = process.env.PRAXITY_A11Y_ENV_PATH;
	const url = "http://fixture.test/hidden-first";
	const pages = ["hidden", "visible"].map((slug) => ({ slug, title: slug }));
	const selector = "[data-block-type='assessment']:visible";
	try {
		process.env.PRAXITY_A11Y_ENV_PATH = resolve(directory, "env.json");
		await writeFile(
			process.env.PRAXITY_A11Y_ENV_PATH,
			JSON.stringify({ url, pages, selectorPages: { [url]: { [selector]: pages } } }),
		);
		await page.route(`${url}/**`, (route) =>
			route.fulfill({
				contentType: "text/html",
				body: `<html class="praxity-js-loaded"><body><div data-block-type="assessment" ${route.request().url().endsWith("hidden.html") ? "hidden" : ""}>Question</div></body></html>`,
			}),
		);
		expect(await findPageWithSelector(page, url, pages, selector)).toEqual(pages[1]);
	} finally {
		if (previous === undefined) delete process.env.PRAXITY_A11Y_ENV_PATH;
		else process.env.PRAXITY_A11Y_ENV_PATH = previous;
		await rm(directory, { recursive: true, force: true });
	}
});
