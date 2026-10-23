import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { test } from "../muted-test";
import { readTestEnv, waitForHydration } from "./helpers";

test.use({ deviceScaleFactor: 1 });

for (const width of [1280, 390]) {
	test(`doodle decorations reflow deterministically at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`${readTestEnv().url}/rich-content-and-typography.html`);
		await waitForHydration(page);
		const doodles = page.locator(".praxity-doodle");
		expect(await doodles.count()).toBeGreaterThan(15);
		const styles = () =>
			doodles.evaluateAll((elements) =>
				elements.map((element) => {
					const style = getComputedStyle(element);
					return [
						style.position,
						style.backgroundColor,
						style.textDecorationLine,
						style.textDecorationColor,
						style.textDecorationThickness,
						style.textUnderlineOffset,
						style.outlineStyle,
						style.outlineWidth,
						style.borderInlineStartWidth,
						style.borderRadius,
					];
				}),
			);
		const first = await styles();
		await page.reload();
		await waitForHydration(page);
		expect(await styles()).toEqual(first);
		await expect(
			page.locator("svg[data-praxity-doodle-decoration], svg.rough-annotation"),
		).toHaveCount(0);
		for (const span of await doodles.all()) {
			const kind = await span.getAttribute("data-doodle");
			const mods = (await span.getAttribute("data-doodle-mods")) ?? "";
			const style = await span.evaluate((element) => {
				const s = getComputedStyle(element);
				return {
					position: s.position,
					line: s.textDecorationLine,
					thickness: parseFloat(s.textDecorationThickness),
					offset: parseFloat(s.textUnderlineOffset),
					outline: s.outlineStyle,
					radius: parseFloat(s.borderRadius),
					clone:
						s.getPropertyValue("box-decoration-break") ||
						s.getPropertyValue("-webkit-box-decoration-break"),
					border: s.borderInlineStartStyle,
					background: s.backgroundColor,
				};
			});
			expect(["absolute", "fixed"]).not.toContain(style.position);
			if (kind === "underline") {
				expect(style.line).toBe("underline");
				expect(style.thickness).toBe(
					mods.includes("thin") ? 1 : mods.includes("thick") ? 3 : mods.includes("marker") ? 4 : 2,
				);
				expect(style.offset).toBeGreaterThan(0);
			}
			if (kind === "strike") expect(style.line).toBe("line-through");
			if (kind === "circle" || kind === "box") {
				expect(style.outline).toBe("solid");
				expect(style.clone).toBe("clone");
				expect(style.radius).toBe(kind === "circle" && !mods.includes("box") ? 4 : 0);
			}
			if (kind === "bracket") expect(style.border).toBe("solid");
			if (kind === "highlight") {
				// Resolve the expected 20% accent/status mix through the browser's colour engine.
				const expected = await span.evaluate((element) => {
					const mods = element.getAttribute("data-doodle-mods") ?? "";
					const role = mods.includes("green")
						? "--success-ink"
						: mods.includes("red")
							? "--error-ink"
							: "--accent";
					const probe = document.createElement("span");
					probe.style.backgroundColor = `color-mix(in srgb, var(${role}) 20%, transparent)`;
					element.append(probe);
					const color = getComputedStyle(probe).backgroundColor;
					probe.remove();
					return color;
				});
				expect(style.background).toBe(expected);
			}
		}
		await page.addStyleTag({
			content:
				"html { font-size: 200% !important; } #main-content * { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } #main-content p { margin-bottom: 2em !important; }",
		});
		const failures = await doodles.evaluateAll((elements) =>
			elements.flatMap((element) => {
				const parent = element.closest("p");
				if (!parent) throw new Error("Doodle has no paragraph line box");
				const bounds = parent.getBoundingClientRect();
				const lineHeight = parseFloat(getComputedStyle(parent).lineHeight);
				return Array.from(element.getClientRects()).flatMap((rect) =>
					rect.left < bounds.left - 1 ||
					rect.right > bounds.right + 1 ||
					rect.top < bounds.top - 1 ||
					rect.bottom > bounds.bottom + 1 ||
					rect.height > lineHeight + 1
						? [`${element.textContent}: ${JSON.stringify(rect.toJSON())}`]
						: [],
				);
			}),
		);
		expect(failures).toEqual([]);
		await page.emulateMedia({ reducedMotion: "reduce" });
		for (const animated of await page.locator('[data-doodle-mods~="animated"]').all())
			expect(await animated.evaluate((element) => getComputedStyle(element).animationName)).toBe(
				"none",
			);
	});

	test(`glossary term uses the secondary ink dotted underline at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`${readTestEnv().url}/rich-content-and-typography.html`);
		await waitForHydration(page);
		const term = page.locator(".inline-tooltip-trigger").first();
		await expect(term).toHaveAttribute("data-tooltip-enhanced", "");
		const style = await page
			.locator(".inline-tooltip-trigger")
			.first()
			.evaluate((element) => {
				const probe = document.createElement("span");
				probe.style.color = "var(--ink-2)";
				element.append(probe);
				const result = {
					color: getComputedStyle(element).textDecorationColor,
					expected: getComputedStyle(probe).color,
					style: getComputedStyle(element).textDecorationStyle,
				};
				probe.remove();
				return result;
			});
		expect(style.color).toBe(style.expected);
		expect(style.style).toBe("dotted");
		await term.focus();
		await term.press("Enter");
		const popover = page.locator(".inline-tooltip-popover[data-visible]");
		await expect(popover).toBeVisible();
		const elevation = await popover.evaluate((element) => {
			const style = getComputedStyle(element);
			return {
				shadow: style.boxShadow,
				token: style.getPropertyValue("--shadow-floating").trim(),
				border: parseFloat(style.borderTopWidth),
				size: parseFloat(style.fontSize),
			};
		});
		expect(elevation.shadow).not.toBe("none");
		expect(elevation.token).toBeTruthy();
		expect(elevation.border).toBe(0);
		expect(elevation.size).toBeGreaterThanOrEqual(18);
		await popover.focus();
		await page.keyboard.press("Escape");
		await expect(term).toBeFocused();
	});

	test(`capture doodles and glossary at ${width}px`, async ({ page }) => {
		test.skip(!process.env.PRAXITY_DOODLE_CAPTURE, "On-demand visual evidence");
		await page.emulateMedia({ reducedMotion: "reduce" });
		for (const [name, url] of Object.entries(readTestEnv().fullFixtureVariants ?? {})) {
			await page.setViewportSize({ width, height: 844 });
			await page.goto(`${url}/rich-content-and-typography.html`);
			await waitForHydration(page);
			await page.evaluate(() => document.fonts.ready);
			const directory = join(process.env.PRAXITY_DOODLE_CAPTURE ?? "", name, String(width));
			await mkdir(directory, { recursive: true });
			const blocks = page
				.locator('[data-block-type="text"]')
				.filter({ has: page.locator(".praxity-doodle") });
			for (const [index, block] of (await blocks.all()).entries())
				await block.screenshot({ path: join(directory, `doodles-${index + 1}.png`) });
			await page
				.locator(".inline-tooltip-trigger")
				.first()
				.locator("xpath=ancestor::p")
				.screenshot({ path: join(directory, "glossary-terms.png") });
			const term = page.locator(".inline-tooltip-trigger").first();
			await expect(term).toHaveAttribute("data-tooltip-enhanced", "");
			await term.focus();
			await term.press("Enter");
			await expect(page.locator(".inline-tooltip-popover[data-visible]")).toBeVisible();
			await page.screenshot({ path: join(directory, "glossary-popover.png") });
			await page.goto(`${url}/glossary.html`);
			await page.screenshot({ path: join(directory, "glossary-page.png"), fullPage: true });
		}
	});
}
