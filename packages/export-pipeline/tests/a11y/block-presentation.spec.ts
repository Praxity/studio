import { expect } from "@playwright/test";
import { catalogSlug } from "../fixtures/authoring-catalog";
import { test } from "../muted-test";
import {
	readNavVariantUrl,
	readSlidesNarrationUrl,
	readTestEnv,
	waitForHydration,
} from "./helpers";

for (const width of [320, 1280]) {
	test(`assessment choices wrap and submit stays usable at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`${readTestEnv().url}/authoring-catalog/${catalogSlug("choose-one")}.html`);
		const assessment = page.locator('[data-island="assessment"]').first();
		await assessment.scrollIntoViewIfNeeded();
		await expect(assessment).toHaveAttribute("data-hydrated", "");
		const firstChoice = assessment.locator(".praxity-choice-label").first();
		await firstChoice.evaluate((node) => {
			node.textContent =
				"Send the complete agenda and every supporting document to participants before the meeting begins.";
		});
		const option = assessment.locator(".praxity-assessment-choice-option").first();
		const label = await firstChoice.evaluate((node) => ({
			height: node.getBoundingClientRect().height,
			lineHeight: Number.parseFloat(getComputedStyle(node).lineHeight),
		}));
		if (width === 320) expect(label.height).toBeGreaterThan(label.lineHeight * 1.5);
		expect(
			await option.evaluate((node) => node.scrollWidth - node.clientWidth),
		).toBeLessThanOrEqual(1);
		await assessment.getByRole("radio").first().check();
		const submit = assessment.locator('[data-assessment-submit="true"]');
		await expect(submit).toBeVisible();
		const sizes = await submit.evaluate((node) => {
			const button = node.getBoundingClientRect();
			const parent = node.parentElement?.getBoundingClientRect();
			if (!parent) throw new Error("Missing assessment stack");
			return { button: button.width, available: parent.width, height: button.height };
		});
		expect(sizes.height).toBeGreaterThanOrEqual(44);
		if (width === 320) expect(sizes.button).toBeGreaterThanOrEqual(sizes.available - 1);
		else expect(sizes.button).toBeLessThan(sizes.available * 0.75);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
		).toBeLessThanOrEqual(1);
		await assessment.screenshot({ path: testInfo.outputPath(`assessment-${width}.png`) });
	});

	test(`group heading and individual cards keep their hierarchy at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`${readNavVariantUrl("sidebar")}/page-3.html`);
		await waitForHydration(page);
		const header = page.locator(".praxity-assessment-group-card").first();
		const member = page.locator(".praxity-block-assessment[data-assessment-group]").first();
		const submit = page.locator(".praxity-ag-submit-btn").first();
		await expect(header).toBeVisible();
		await expect(submit).toBeVisible();
		const appearance = await header.evaluate((node) => {
			const member = document.querySelector<HTMLElement>(
				".praxity-block-assessment[data-assessment-group]",
			);
			if (!member) throw new Error("Missing assessment member");
			const card = member.querySelector(".praxity-block-assessment");
			if (!card) throw new Error("Missing assessment card");
			return {
				header: getComputedStyle(node).backgroundColor,
				member: getComputedStyle(member).backgroundColor,
				perimeter: Number.parseFloat(getComputedStyle(node).borderInlineStartWidth),
				memberBorder: getComputedStyle(card).borderInlineStartWidth,
				memberRadius: getComputedStyle(card).borderRadius,
			};
		});
		expect(appearance.header).toBe(appearance.member);
		expect(appearance.perimeter).toBe(0);
		expect(appearance.memberBorder).toBe("1px");
		expect(appearance.memberRadius).toBe("16px");
		const footerWidth = await submit.evaluate((node) => {
			const footer = node.parentElement;
			if (!footer) throw new Error("Missing assessment footer");
			const style = getComputedStyle(footer);
			return {
				button: node.getBoundingClientRect().width,
				available:
					footer.getBoundingClientRect().width -
					Number.parseFloat(style.paddingInlineStart) -
					Number.parseFloat(style.paddingInlineEnd) -
					Number.parseFloat(style.borderInlineStartWidth) -
					Number.parseFloat(style.borderInlineEndWidth),
				height: node.getBoundingClientRect().height,
			};
		});
		expect(footerWidth.height).toBeGreaterThanOrEqual(44);
		if (width === 320)
			expect(Math.abs(footerWidth.button - footerWidth.available)).toBeLessThanOrEqual(1);
		else expect(footerWidth.button).toBeLessThan(footerWidth.available * 0.75);
		expect(
			await member.evaluate((node) => node.scrollWidth - node.clientWidth),
		).toBeLessThanOrEqual(1);
	});

	test(`stat and image caption reflow at ${width}px`, async ({ page }, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`${readTestEnv().url}/authoring-catalog/${catalogSlug("stats")}.html`);
		const stat = page.locator(".praxity-stats[data-layout='statement']").first();
		await expect(stat).toBeVisible();
		await stat.locator(".praxity-stats-value").evaluate((node) => {
			node.textContent = "123456789012345678901234567890";
		});
		const geometry = await stat.evaluate((node) => {
			const value = node.querySelector<HTMLElement>(".praxity-stats-value");
			const label = node.querySelector<HTMLElement>(".praxity-stats-label");
			if (!value || !label) throw new Error("Missing stat value or label");
			const valueRect = value.getBoundingClientRect();
			const labelRect = label.getBoundingClientRect();
			const style = getComputedStyle(label);
			return {
				overflow: node.scrollWidth - node.clientWidth,
				valueRight: valueRect.right,
				labelLeft: labelRect.left,
				labelTop: labelRect.top,
				valueBottom: valueRect.bottom,
				inlineRule: Number.parseFloat(style.borderInlineStartWidth),
				blockRule: Number.parseFloat(style.borderBlockStartWidth),
			};
		});
		expect(geometry.overflow).toBeLessThanOrEqual(1);
		if (width === 320) {
			expect(geometry.labelTop).toBeGreaterThanOrEqual(geometry.valueBottom);
			expect(geometry.blockRule).toBe(0);
		} else {
			expect(geometry.labelLeft).toBeGreaterThanOrEqual(geometry.valueRight);
			expect(geometry.inlineRule).toBe(0);
		}
		await stat.screenshot({ path: testInfo.outputPath(`stat-${width}.png`) });

		await page.goto(`${readSlidesNarrationUrl()}/accessible-slide-course.html`);
		await waitForHydration(page);
		const figure = page
			.locator(".praxity-block-image figure")
			.filter({ has: page.locator("figcaption") })
			.first();
		await expect(figure).toBeVisible();
		const caption = await figure.evaluate((node) => {
			const image = node.querySelector("img");
			const text = node.querySelector("figcaption");
			if (!image || !text) throw new Error("Missing image or caption");
			return {
				gap: text.getBoundingClientRect().top - image.getBoundingClientRect().bottom,
				margin: Number.parseFloat(getComputedStyle(text).marginBlockStart),
				align: getComputedStyle(text).textAlign,
				fontSize: Number.parseFloat(getComputedStyle(text).fontSize),
				baseSize: Number.parseFloat(getComputedStyle(node).fontSize),
			};
		});
		// Gecko's DOMRects can report an 8px gap as 7.999969482421875px.
		// Keep the 8px minimum exact and verify that layout preserves that margin.
		expect(caption.margin).toBeGreaterThanOrEqual(8);
		expect(caption.gap).toBeCloseTo(caption.margin, 4);
		expect(caption.align).toBe("start");
		expect(caption.fontSize).toBeLessThan(caption.baseSize);
	});

	test(`borderless accordion aligns with reading edge at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`${readTestEnv().url}/design-container-surfaces-light/container-surfaces.html`);
		for (const style of ["none", "outline"]) {
			const accordion = page.locator(`.praxity-accordion-static[data-style="${style}"]`).first();
			await expect(accordion).toBeVisible();
			await accordion.locator("[data-disclosure-trigger]").first().click();
			const padding = await accordion.evaluate((node) => {
				const summary = node.querySelector("[data-disclosure-trigger]");
				const panel = node.querySelector<HTMLElement>(".praxity-accordion-panel");
				if (!summary || !panel) throw new Error("Missing accordion summary or panel");
				return {
					summary: Number.parseFloat(getComputedStyle(summary).paddingInlineStart),
					panel: Number.parseFloat(getComputedStyle(panel).paddingInlineStart),
				};
			});
			expect(padding.summary).toBe(padding.panel);
			expect(padding.panel).toBe(4);
		}
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
		).toBeLessThanOrEqual(1);
	});
}

for (const width of [600, 900]) {
	test(`four authored stats fit their cells at ${width}px`, async ({ page }, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		const base = `${readTestEnv().url}/block-presentation-stats`;
		await page.goto(`${base}/index.html`);
		const slug = await page.evaluate(() => {
			const config = JSON.parse(document.getElementById("praxity-config")?.textContent ?? "{}");
			return config.pages[0]?.slug as string | undefined;
		});
		if (!slug) throw new Error("Missing compiled statistics page");
		await page.goto(`${base}/${slug}.html`);
		const figure = page.locator(".praxity-stats[data-layout='grid']");
		await expect(figure.locator(".praxity-stats-item")).toHaveCount(4);
		await expect(figure.locator(".praxity-stats-value").first()).toHaveText("Nearly 25%");
		await expect(figure.locator(".praxity-stats-label").first()).toContainText(
			"participantes et participants",
		);
		const layout = await figure.evaluate((node) => {
			const grid = node.querySelector<HTMLElement>(".praxity-stats-grid");
			if (!grid) throw new Error("Missing statistics grid");
			return {
				columns: getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length,
				containerWidth:
					grid.closest(".praxity-page-content")?.getBoundingClientRect().width ?? innerWidth,
				items: [...node.querySelectorAll<HTMLElement>(".praxity-stats-item")].map((item) => {
					const value = item.querySelector<HTMLElement>(".praxity-stats-value");
					const label = item.querySelector<HTMLElement>(".praxity-stats-label");
					if (!value || !label) throw new Error("Missing statistic content");
					return {
						width: item.getBoundingClientRect().width,
						font: Number.parseFloat(getComputedStyle(value).fontSize),
						valueOverflow: value.scrollWidth - value.clientWidth,
						labelOverflow: label.scrollWidth - label.clientWidth,
					};
				}),
			};
		});
		expect(layout.columns).toBe(layout.containerWidth <= 768 ? 2 : 4);
		for (const item of layout.items) {
			expect(item.font).toBeLessThan(item.width * 0.4);
			expect(item.valueOverflow).toBeLessThanOrEqual(1);
			expect(item.labelOverflow).toBeLessThanOrEqual(1);
		}
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
		).toBeLessThanOrEqual(1);
		await figure.screenshot({ path: testInfo.outputPath(`stats-grid-${width}.png`) });
	});
}
