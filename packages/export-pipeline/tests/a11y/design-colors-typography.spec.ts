import { createHash } from "node:crypto";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { DESIGN_COLORS } from "./fixtures/design-colors-typography-fixture";
import { readTestEnv, readThemeVariantUrl } from "./helpers";

async function openDesign(page: Page, name: string, small: boolean) {
	await page.goto(
		`${readTestEnv().url}/design-${name}/heading-one.html${small ? "?praxity-small-preview=1&minimal=1" : ""}`,
	);
	await page.evaluate(() => document.fonts.ready);
	if (small)
		await expect(page.locator("html")).toHaveAttribute("data-praxity-small-preview-ready", "true");
}

async function expectPaintColor(locator: Locator, property: string, hex: string) {
	const actual = await locator.evaluate((el, property) => {
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = 1;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas color conversion unavailable");
		context.fillStyle = getComputedStyle(el).getPropertyValue(property);
		context.fillRect(0, 0, 1, 1);
		return Array.from(context.getImageData(0, 0, 1, 1).data);
	}, property);
	const expected = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
	for (const [index, channel] of expected.entries())
		expect(Math.abs(actual[index] - channel)).toBeLessThanOrEqual(1);
	expect(actual[3]).toBe(255);
}

async function typography(page: Page) {
	return page.evaluate(() => {
		const main = document.querySelector("main");
		if (!main) throw new Error("Missing learner content");
		const inspect = (el: Element) => {
			const style = getComputedStyle(el);
			const range = document.createRange();
			range.selectNodeContents(el);
			return {
				family: style.fontFamily,
				weight: style.fontWeight,
				size: Number.parseFloat(style.fontSize),
				lineHeight: Number.parseFloat(style.lineHeight),
				textHeight: range.getBoundingClientRect().height,
			};
		};
		const body = Array.from(main.querySelectorAll("p")).find((el) =>
			el.textContent?.startsWith("Body sample"),
		);
		if (!body) throw new Error("Missing body sample");
		return {
			headings: Array.from(
				main.querySelectorAll(
					"h1:not(.praxity-pages-completion *),h2:not(.praxity-pages-completion *),h3,h4,h5,h6",
				),
				inspect,
			),
			body: inspect(body),
			code: Array.from(main.querySelectorAll("code"), inspect),
			faces: Array.from(document.fonts)
				.filter((face) => face.status === "loaded")
				.map((face) => face.family.replaceAll('"', "").replaceAll("'", "")),
		};
	});
}

for (const small of [true, false]) {
	const context = small ? "small" : "full";
	test(`${context}: Clear loads real French regular, bold, italic and ExtraBold faces offline`, async ({
		page,
		browserName,
	}) => {
		const failures: string[] = [];
		const extraBoldResponse = page.waitForResponse((response) =>
			response.url().endsWith("/atkinson-hyperlegible-next-latin-800-normal.woff2"),
		);
		page.on("requestfailed", (request) => failures.push(request.url()));
		await page.route("**/*", (route) =>
			route.request().url().startsWith(readTestEnv().url) ? route.continue() : route.abort(),
		);
		await openDesign(page, "custom-light", small);
		await expect(page.locator("main h1").first()).toHaveCSS("font-weight", "800");
		expect(
			createHash("sha256")
				.update(await (await extraBoldResponse).body())
				.digest("hex"),
		).toBe("377d6c32d80cdc2c257b48b4e02a6437ff1019c77e49c160ede8ebd6453be061");
		const french = page.locator("main p").filter({ hasText: "Élève à Noël" });
		await expect(french).toBeVisible();
		for (const [weight, style] of [
			[400, "normal"],
			[600, "normal"],
			[700, "normal"],
			[800, "normal"],
			[400, "italic"],
			[700, "italic"],
		] as const) {
			const loaded = await page.evaluate(
				async ({ weight, style }) => {
					const faces = await document.fonts.load(
						`${style} ${weight} 20px "Atkinson Hyperlegible Next"`,
						"ÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸàâæçéèêëîïôœùûüÿ",
					);
					return faces.map((face) => ({
						family: face.family.replaceAll('"', "").replaceAll("'", ""),
						weight: face.weight,
						style: face.style,
						status: face.status,
					}));
				},
				{ weight, style },
			);
			expect(loaded).toEqual([
				{ family: "Atkinson Hyperlegible Next", weight: String(weight), style, status: "loaded" },
				{ family: "Atkinson Hyperlegible Next", weight: String(weight), style, status: "loaded" },
			]);
		}
		await expect(french.locator("strong").first()).toHaveCSS("font-weight", "700");
		await expect(french.locator("em").first()).toHaveCSS("font-style", "italic");
		if (browserName === "chromium") {
			await french.evaluate((element) => {
				element.id = "clear-font-probe";
			});
			const session = await page.context().newCDPSession(page);
			await session.send("DOM.enable");
			await session.send("CSS.enable");
			const { root } = await session.send("DOM.getDocument");
			const { nodeId } = await session.send("DOM.querySelector", {
				nodeId: root.nodeId,
				selector: "#clear-font-probe",
			});
			const { fonts } = await session.send("CSS.getPlatformFontsForNode", { nodeId });
			expect(fonts.length).toBeGreaterThan(0);
			expect(
				fonts
					.filter((font) => font.glyphCount > 0)
					.every(
						(font) => font.isCustomFont && font.familyName.startsWith("Atkinson Hyperlegible Next"),
					),
			).toBe(true);
			const { nodeId: headingId } = await session.send("DOM.querySelector", {
				nodeId: root.nodeId,
				selector: "main h1",
			});
			const { fonts: headingFonts } = await session.send("CSS.getPlatformFontsForNode", {
				nodeId: headingId,
			});
			expect(headingFonts.length).toBeGreaterThan(0);
			for (const font of headingFonts) {
				expect(font.isCustomFont).toBe(true);
				expect(font.postScriptName).toBe("AtkinsonHyperlegibleNext-ExtraBold");
				expect(font.glyphCount).toBeGreaterThan(0);
			}
			await session.detach();
		}
		expect(failures).toEqual([]);
	});
	test(`${context}: heading, body and code typography reaches actual text`, async ({ page }) => {
		await openDesign(page, "minimum", small);
		const before = await typography(page);
		await openDesign(page, "custom-light", small);
		const after = await typography(page);
		expect(after.headings).toHaveLength(4);
		for (const [index, heading] of after.headings.entries()) {
			expect(heading.family).toContain("Atkinson Hyperlegible Next");
			expect(heading.weight).toBe("800");
			expect(heading.size).toBeGreaterThanOrEqual(before.headings[index].size);
		}
		expect(before.headings[0].family).toContain("Source Sans 3");
		expect(after.headings[0].textHeight).toBeGreaterThan(0);
		expect(after.body.family).toContain("Atkinson Hyperlegible Next");
		expect(after.body.weight).toBe("400");
		expect(before.body.weight).toBe("400");
		expect(after.body.lineHeight / after.body.size).toBeCloseTo(1.55, 2);
		expect(before.body.lineHeight / before.body.size).toBeCloseTo(1.55, 2);
		expect(after.body.lineHeight).toBeCloseTo(before.body.lineHeight, 1);
		expect(after.code.length).toBeGreaterThanOrEqual(2);
		for (const code of after.code) expect(code.family).toContain("monospace");
		for (const family of ["Atkinson Hyperlegible Next"]) expect(after.faces).toContain(family);
		await page.screenshot({ path: test.info().outputPath(`typography-${context}.png`) });
	});

	test(`${context}: explicit Book pairing loads serif headings offline`, async ({ page }) => {
		await openDesign(page, "book", small);
		const result = await typography(page);
		for (const heading of result.headings) expect(heading.family).toContain("Source Serif 4");
		expect(result.body.family).toContain("Source Sans 3");
		expect(result.faces).toContain("Source Serif 4");
	});

	for (const mode of ["light", "dark"] as const) {
		test(`${context}: ${mode} backgrounds, accent and every status color paint`, async ({
			page,
		}) => {
			await page.emulateMedia({ colorScheme: mode === "light" ? "dark" : "light" });
			await openDesign(page, "baseline", small);
			const buttonBefore = await page
				.getByRole("link", { name: "Accent button" })
				.evaluate((el) => getComputedStyle(el).backgroundColor);
			await openDesign(page, `custom-${mode}`, small);
			await expectPaintColor(
				page.locator("body"),
				"background-color",
				mode === "light" ? DESIGN_COLORS.colorBackgroundLight : DESIGN_COLORS.colorBackgroundDark,
			);
			const accent = page.getByRole("link", { name: "Accent button" });
			await expect(accent).toBeVisible();
			expect(await accent.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
				buttonBefore,
			);
			const pair =
				mode === "light"
					? {
							success: DESIGN_COLORS.colorSuccessOnLight,
							warning: DESIGN_COLORS.colorWarningOnLight,
							error: DESIGN_COLORS.colorErrorOnLight,
						}
					: {
							success: DESIGN_COLORS.colorSuccessOnDark,
							warning: DESIGN_COLORS.colorWarningOnDark,
							error: DESIGN_COLORS.colorErrorOnDark,
						};
			for (const status of ["warning"] as const) {
				const note = page.locator(`.praxity-note-base[data-color="${status}"]`);
				await expect(note).toBeVisible();
				await expectPaintColor(note.locator(".praxity-note-label"), "color", pair[status]);
				expect(
					await note.evaluate((el) => Number.parseFloat(getComputedStyle(el).borderTopWidth)),
				).toBeGreaterThan(0);
			}
			const note = page.locator('.praxity-note-base[data-color="note"]');
			await expect(note).toBeVisible();
			await expect(note.locator(".praxity-note-label")).toHaveText("Note");
			await expect(note).toHaveCSS("border-top-width", "1px");
			await expectPaintColor(page.getByText("Error sample", { exact: true }), "color", pair.error);
			await page.screenshot({
				path: test.info().outputPath(`colors-${context}-${mode}.png`),
				fullPage: true,
			});
		});
	}

	test(`${context}: automatic appearance follows the device preference`, async ({ page }) => {
		for (const mode of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: mode });
			await openDesign(page, "custom-auto", small);
			await expectPaintColor(
				page.locator("body"),
				"background-color",
				mode === "light" ? DESIGN_COLORS.colorBackgroundLight : DESIGN_COLORS.colorBackgroundDark,
			);
		}
	});

	test(`${context}: all five presets paint their palette and pairing`, async ({ page }) => {
		const themes = [
			["ink", "Source Sans 3", "Source Sans 3"],
			["forest", "Source Sans 3", "Source Sans 3"],
			["plum", "Source Sans 3", "Source Sans 3"],
			["clay", "Source Sans 3", "Source Sans 3"],
			["clear", "Atkinson Hyperlegible Next", "Atkinson Hyperlegible Next"],
		];
		const appearances = new Set<string>();
		for (const [theme, headingFont, bodyFont] of themes) {
			const name = `${theme}-light`;
			await page.goto(
				`${readThemeVariantUrl(name)}/page-one-static-content.html${small ? "?praxity-small-preview=1&minimal=1" : ""}`,
			);
			await page.evaluate(() => document.fonts.ready);
			const heading = page.locator("main h1").first();
			await expect(heading).toBeVisible();
			expect(await heading.evaluate((el) => getComputedStyle(el).fontFamily)).toContain(
				headingFont,
			);
			const body = page.locator('main .praxity-block[data-block-type="text"]').first();
			expect(await body.evaluate((el) => getComputedStyle(el).fontFamily)).toContain(bodyFont);
			appearances.add(
				await page.evaluate(
					() =>
						`${getComputedStyle(document.documentElement).getPropertyValue("--accent")}|${getComputedStyle(document.body).backgroundColor}|${getComputedStyle(document.querySelector("main h1") ?? document.body).fontFamily}`,
				),
			);
		}
		expect(appearances.size).toBe(5);
	});
}
