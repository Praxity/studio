import { expect, test } from "@playwright/test";
import { findPageWithSelector, getCoursePages, readTestEnv, waitForHydration } from "./helpers";

test.describe("typography", () => {
	test("fonts are loaded and heading size is greater than body text", async ({ page }) => {
		const env = readTestEnv();
		const pages = await getCoursePages(page, env.url);
		const first = pages[0];
		expect(first?.slug, "fixture should expose at least one page slug").toBeTruthy();
		if (!first?.slug) return;

		await page.goto(`${env.url}/${first.slug}.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);

		const fontLoaded = await page.evaluate(async () => {
			if (!("fonts" in document) || !document.fonts) return false;
			await document.fonts.ready;

			const bodyFont = getComputedStyle(document.body).fontFamily;
			const firstFamily = bodyFont
				.split(",")
				.map((item) => item.replaceAll('"', "").replaceAll("'", "").trim())
				.find((value) => value.length > 0);
			if (!firstFamily) return false;

			const checks = [firstFamily, "Source Sans 3", "Atkinson Hyperlegible Next"];
			return checks.some((family) => document.fonts.check(`16px "${family}"`));
		});
		expect(fontLoaded, "expected configured font face to be loaded").toBe(true);

		const typography = await page.evaluate(() => {
			const heading = document.querySelector<HTMLElement>("h1, h2, h3");
			const body =
				document.querySelector<HTMLElement>("p") ??
				document.querySelector<HTMLElement>("#main-content");
			if (!heading || !body) return null;
			return {
				headingSize: Number.parseFloat(getComputedStyle(heading).fontSize),
				bodySize: Number.parseFloat(getComputedStyle(body).fontSize),
			};
		});
		expect(typography, "expected heading and body elements").not.toBeNull();
		if (!typography) return;
		expect(
			typography.headingSize,
			"heading font size should be larger than body text",
		).toBeGreaterThan(typography.bodySize);
	});

	test("heading ratios hold at every text-size step, including container headings", async ({
		page,
	}) => {
		const env = readTestEnv();
		const pages = await getCoursePages(page, env.url);
		const first = pages[0];
		expect(first?.slug, "fixture should expose at least one page slug").toBeTruthy();
		if (!first?.slug) return;

		await page.goto(`${env.url}/${first.slug}.html`, { waitUntil: "domcontentloaded" });
		await waitForHydration(page);

		const measurements = await page.evaluate(() => {
			const main = document.querySelector<HTMLElement>("#main-content");
			if (!main) return null;
			const probe = document.createElement("div");
			probe.className = "praxity-column";
			probe.hidden = true;
			probe.innerHTML = Array.from({ length: 6 }, (_, index) => {
				const level = index + 1;
				return `<h${level} data-type-scale-probe="${level}">Heading ${level}</h${level}>`;
			}).join("");
			main.append(probe);

			return ["default", "large"].map((mode) => {
				if (mode === "large") document.documentElement.dataset.praxityTextSize = "large";
				else delete document.documentElement.dataset.praxityTextSize;
				const bodySize = Number.parseFloat(getComputedStyle(main).fontSize);
				return {
					mode,
					bodySize,
					headings: Array.from(probe.children, (heading) => {
						const fontSize = Number.parseFloat(getComputedStyle(heading).fontSize);
						return { fontSize, ratio: fontSize / bodySize };
					}),
				};
			});
		});

		expect(measurements).not.toBeNull();
		if (!measurements) return;
		const expectedRatios = [38 / 19, 30 / 19, 24 / 19, 24 / 19, 24 / 19, 24 / 19];
		for (const measurement of measurements) {
			measurement.headings.forEach((heading, index) => {
				expect(heading.ratio).toBeCloseTo(expectedRatios[index] ?? 1, 5);
			});
		}
		expect(measurements[0]?.bodySize).toBe(19);
		expect(measurements[1]?.bodySize).toBe(23.75);
	});

	test("question stems grow with the learner text-size preference", async ({ page }) => {
		const env = readTestEnv();
		const pages = await getCoursePages(page, env.url);
		const assessmentPage = await findPageWithSelector(
			page,
			env.url,
			pages,
			".praxity-assessment-stem",
		);
		if (!assessmentPage) throw new Error("No assessment question found in fixture");

		const assessmentIsland = page
			.locator('[data-island="assessment"]')
			.filter({ has: page.locator(".praxity-assessment-stem") })
			.first();
		await assessmentIsland.scrollIntoViewIfNeeded();
		await expect(assessmentIsland).toHaveAttribute("data-hydrated", "");
		const stem = page.locator(".praxity-assessment-stem").first();
		const before = await stem.evaluate((element) =>
			Number.parseFloat(getComputedStyle(element).fontSize),
		);
		await page.evaluate(() => {
			document.documentElement.dataset.praxityTextSize = "large";
		});
		const after = await stem.evaluate((element) =>
			Number.parseFloat(getComputedStyle(element).fontSize),
		);

		expect(after).toBeGreaterThan(before);
	});

	test("fill-blank fields keep body leading and fit the prose at every text-size step", async ({
		page,
	}) => {
		const env = readTestEnv();
		const pages = await getCoursePages(page, env.url);
		const fillBlankPage = await findPageWithSelector(
			page,
			env.url,
			pages,
			".praxity-fill-blank-input",
		);
		if (!fillBlankPage) throw new Error("No fill-blank assessment found in fixture");

		const assessmentIsland = page
			.locator('[data-island="assessment"]')
			.filter({ has: page.locator(".praxity-fill-blank-input") })
			.first();
		await assessmentIsland.scrollIntoViewIfNeeded();
		await expect(assessmentIsland).toHaveAttribute("data-hydrated", "");

		const measurements = await page.evaluate(() =>
			["default", "large"].map((mode) => {
				if (mode === "large") document.documentElement.dataset.praxityTextSize = "large";
				else delete document.documentElement.dataset.praxityTextSize;
				const input = document.querySelector<HTMLInputElement>(".praxity-fill-blank-input");
				const line = input?.closest<HTMLElement>(".praxity-fill-blank-template");
				if (!input || !line) return null;
				const inputBounds = input.getBoundingClientRect();
				const lineBounds = line.getBoundingClientRect();
				const style = getComputedStyle(line);
				return {
					mode,
					inputHeight: inputBounds.height,
					leading: Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize),
					topInset: inputBounds.top - lineBounds.top,
					bottomInset: lineBounds.bottom - inputBounds.bottom,
					verticalAlign: getComputedStyle(input).verticalAlign,
				};
			}),
		);

		for (const measurement of measurements) {
			expect(measurement).not.toBeNull();
			if (!measurement) continue;
			expect(measurement.inputHeight).toBeGreaterThanOrEqual(44);
			expect(measurement.leading).toBeCloseTo(1.55, 2);
			expect(measurement.topInset).toBeGreaterThanOrEqual(0);
			expect(measurement.bottomInset).toBeGreaterThanOrEqual(0);
			expect(measurement.verticalAlign).toBe("middle");
		}
	});
});
