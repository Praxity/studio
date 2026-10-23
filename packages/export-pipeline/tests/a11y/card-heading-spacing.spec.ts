import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { readLesson as readBlockSource, readLesson as readSource } from "@praxity/grammar";
import { imageFloatRegions } from "@praxity/shared-blocks/image-float";
import type { CardBlockData } from "@praxity/shared-blocks/types";
import { renderBlockHtml } from "../../src/render-block-html";

const styles = [
	"../../../shared-blocks/node_modules/@mantine/core/styles.css",
	"../../../shared-blocks/src/reading-rhythm.css",
	"../../../shared-blocks/src/blocks/shared-blocks.css",
	"../../template/src/styles/global.css",
]
	.map((path) =>
		readFileSync(resolve(import.meta.dirname, path), "utf8").replace(/^@import[^;]+;/gm, ""),
	)
	.join("\n");
for (const renderer of ["canonical"]) {
	for (const width of [768, 1280]) {
		test(`${renderer} flip prompts stay aligned while unequal answers flow below at ${width}px`, async ({
			page,
		}) => {
			const parsed = readBlockSource(`# Fixture {hideTitle}

::: cards {columns=2}
:: Longer card {level=3}
${"A longer statement with several words. ".repeat(12)}
::: back
${"A longer response. ".repeat(12)}
:::
:: Shorter card {level=3}
A short statement.
::: back
A short response.
:::
:::
`);
			const card = parsed.blocks.find((block) => block.type === "card");
			if (!card) throw new Error("Missing card fixture");
			await page.setViewportSize({ width, height: 900 });
			await page.route("**/*", (route) => route.abort());

			await page.setContent(`<main data-praxity-root>${renderBlockHtml(card)}</main>`);

			await page.addStyleTag({ content: styles });

			const cards = page.locator("[data-card-item]");
			await expect(cards).toHaveCount(2);
			const headings = await cards
				.locator(".praxity-flashcard-face-heading")
				.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
			expect(headings[0]).toBeCloseTo(headings[1], 0);
			const fronts = cards.locator('[data-card-side="front"]');
			const initial = await fronts.evaluateAll((nodes) =>
				nodes.map((node) => node.getBoundingClientRect().top),
			);
			expect(initial[0]).toBeCloseTo(initial[1], 0);
			if (renderer === "preview") {
				for (const toggle of await cards.locator(".praxity-flashcard-toggle").all()) {
					await toggle.click();
					await expect(toggle).toHaveAttribute("aria-expanded", "true");
				}
			}
			const revealed = await fronts.evaluateAll((nodes) =>
				nodes.map((node) => node.getBoundingClientRect().top),
			);
			expect(revealed).toEqual(initial);
			for (const card of await cards.all()) {
				const front = await card.locator('[data-card-side="front"]').boundingBox();
				const back = await card.locator('[data-card-side="back"]').boundingBox();
				if (!front || !back) throw new Error("Prompt and answer must be visible");
				expect(back.y).toBeGreaterThan(front.y + front.height);
				await expect(card).toHaveCSS("padding-top", "0px");
				await expect(card.locator(".praxity-flashcard-toggle")).toHaveCSS("min-height", "44px");
			}
		});
	}
}

for (const renderer of ["canonical"]) {
	for (const alignment of ["left", "center", "right"] as const) {
		test(`${renderer} flip title stays left aligned with authored ${alignment} body`, async ({
			page,
		}) => {
			const parsed = readBlockSource(
				"# Untitled {hideTitle}\n\n::: cards {layout=slides}\n:: Face title {level=3}\nShort body.\n\n::: back\nBack body.\n:::\n:::\n",
			);
			const card = parsed.blocks.find((block) => block.type === "card");
			if (!card) throw new Error("Missing card fixture");
			for (const item of (card.data as unknown as CardBlockData).items)
				Object.assign(item, { alignment });
			await page.setViewportSize({ width: 390, height: 900 });
			await page.route("**/*", (route) => route.abort());

			await page.setContent(`<main data-praxity-root>${renderBlockHtml(card)}</main>`);

			await page.addStyleTag({ content: styles });

			await expect(page.locator(".praxity-flashcard-face-heading")).toHaveCSS(
				"text-align",
				"start",
			);
			await expect(page.locator('.praxity-flashcard-face[data-card-side="front"]')).toHaveCSS(
				"text-align",
				alignment,
			);
			const controls = await page.locator(".praxity-card-controls > button").evaluateAll((nodes) =>
				nodes.map((button) => {
					const bounds = button.getBoundingClientRect();
					const grid = button.parentElement?.previousElementSibling;
					if (!grid) throw new Error("Missing adjacent card grid");
					return {
						width: bounds.width,
						height: bounds.height,
						gap: bounds.top - grid.getBoundingClientRect().bottom,
					};
				}),
			);
			expect(controls).toHaveLength(2);
			for (const control of controls) {
				expect(control.width).toBeGreaterThanOrEqual(44);
				expect(control.height).toBeGreaterThanOrEqual(44);
				expect(control.gap).toBeGreaterThanOrEqual(12);
			}
			await page
				.locator("main")
				.screenshot({ path: test.info().outputPath(`${renderer}-face-${alignment}.png`) });
		});
	}
}

for (const renderer of ["canonical"]) {
	for (const width of [320, 1200]) {
		test(`${renderer} team directory heading spacing at ${width}px`, async ({ page }) => {
			const parsed = readBlockSource(
				readFileSync(resolve(import.meta.dirname, "fixtures/team-directory.prax"), "utf8"),
			);
			expect(parsed.warnings).toEqual([]);
			const html = parsed.blocks.map((block) => renderBlockHtml(block)).join("");
			await page.setViewportSize({ width, height: 900 });
			await page.route("**/*", (route) => route.abort());

			await page.setContent(`<main data-praxity-root>${html}</main>`);

			await page.addStyleTag({ content: styles });
			const groupGap = await page.locator('[data-block-type="card"]').evaluate((block) => {
				const heading = block.querySelector("h2");
				const card = block.querySelector(".praxity-card-item");
				if (!heading || !card) throw new Error("Missing directory title or card");
				return {
					actual: card.getBoundingClientRect().top - heading.getBoundingClientRect().bottom,
					expected: innerWidth < 768 ? 12 : 16,
				};
			});
			expect(groupGap.actual).toBeCloseTo(groupGap.expected, 1);
			const headings = page.locator(".praxity-card-item > h3");
			await expect(headings).toHaveText([
				"Alex Chen, team lead",
				"Priya Nair, specialist",
				"Marcus Osei, coordinator",
			]);
			for (const heading of await headings.all()) {
				const spacing = await heading.evaluate((element) => {
					const style = getComputedStyle(element);
					const sibling = element.nextElementSibling;
					if (!sibling) throw new Error("Missing card body");
					const body = getComputedStyle(sibling);
					return {
						top: parseFloat(style.paddingTop),
						left: style.paddingLeft,
						bodyLeft: body.paddingLeft,
						gap: sibling.getBoundingClientRect().top - element.getBoundingClientRect().bottom,
					};
				});
				expect(spacing.top).toBe(0);
				expect(spacing.left).toBe("0px");
				expect(spacing.left).toBe(spacing.bodyLeft);
				expect(spacing.gap).toBeCloseTo(16, 1);
			}
			await test.info().attach("directory-spacing", {
				body: await page.screenshot({ fullPage: true }),
				contentType: "image/png",
			});
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
				true,
			);
		});
	}
}

const afterFloatGrammar =
	"# Scenario\n\n## First section\n\n::: float {side=right}\n![Decorative example](/assets/example.svg){size=small}\n\nFirst paragraph beside the image.\n\nSecond paragraph beside the image.\n\nThird paragraph beside the image.\n:::\n\n## Next section\n\nFirst paragraph in the next section.\n";

for (const renderer of ["canonical"]) {
	for (const width of [390, 1200]) {
		test(`${renderer} heading after a closed float at ${width}px`, async ({ page }, testInfo) => {
			const parsed = readSource(afterFloatGrammar);
			expect(parsed.warnings).toEqual([]);
			const html = imageFloatRegions(parsed.blocks)
				.map((region) => {
					const content = region.blocks.map((block) => renderBlockHtml(block)).join("");
					return region.float ? `<div class="praxity-float-region">${content}</div>` : content;
				})
				.join("");
			await page.setViewportSize({ width, height: 900 });
			await page.route("**/*", (route) => route.abort());
			await page.setContent(`<main data-praxity-root>${html}</main>`);
			await page.addStyleTag({ content: styles });
			await page.locator("figure img").evaluate((image) => {
				image.setAttribute(
					"src",
					`data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#dbe5ee"/></svg>')}`,
				);
				(image as HTMLImageElement).style.height = "120px";
			});
			const geometry = await page
				.getByRole("heading", { name: "Next section" })
				.evaluate((node) => {
					const block = node.closest('[data-block-type="heading"]');
					const before = block?.previousElementSibling;
					const after = block?.nextElementSibling;
					if (!block || !before?.classList.contains("praxity-float-region") || !after)
						throw new Error("Missing float-to-heading flow");
					return {
						before: block.getBoundingClientRect().top - before.getBoundingClientRect().bottom,
						after: after.getBoundingClientRect().top - block.getBoundingClientRect().bottom,
						section: parseFloat(getComputedStyle(document.documentElement).fontSize) * 2.475,
					};
				});
			expect(geometry.before).toBeGreaterThanOrEqual(geometry.section - 1);
			expect(geometry.before).toBeGreaterThan(geometry.after);
			console.log(JSON.stringify({ renderer, width, ...geometry }));
			await page.screenshot({
				fullPage: true,
				path: testInfo.outputPath(`heading-after-float-${renderer}-${width}.png`),
			});
		});
	}
}

const adjacentGrammar =
	"# Page start {hideTitle}\n\n## Page start\n\n### Consecutive heading\n\nOpening prose.\n\n## Before list\n\n- First list item\n- Second list item\n\n## Before accordion\n\n::: accordion\n:: Accordion section\n#### Nested heading\n\nNested paragraph.\n:::\n\n## Before image\n\n![Example illustration](/assets/example.svg)\n\n## Before audio\n\n::: audio /assets/example.mp3\ntitle: Audio title\n:::\n\n## Before video\n\n::: video /assets/example.mp4\ntitle: Video title\n:::\n\n## Before assessment\n\n::: choice Check your understanding\n(x) Correct\n( ) Incorrect\n:::\n\n## Before cards\n\n::: cards Card group {style=outline}\n:: Card one\n##### Nested card heading\n\nNested card paragraph.\n\n:: Card two\nCard body.\n:::\n\n## After cards\n\nClosing prose.\n";

for (const renderer of ["canonical"]) {
	for (const width of [320, 1200]) {
		test(`${renderer} heading adjacency across block types at ${width}px`, async ({ page }) => {
			const parsed = readBlockSource(adjacentGrammar);
			expect(parsed.warnings).toEqual([]);
			await page.setViewportSize({ width, height: 900 });
			await page.route("**/*", (route) => route.abort());

			await page.setContent(
				`<main data-praxity-root>${parsed.blocks.map((block) => renderBlockHtml(block)).join("")}</main>`,
			);

			await page.addStyleTag({ content: styles });
			const evidence = await page.locator("main").evaluate((main) => {
				const first = main.querySelector<HTMLElement>(".praxity-block");
				const headings = Array.from(
					main.querySelectorAll<HTMLElement>('[data-block-type="heading"]'),
				);
				return {
					rootSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
					firstMargin: first ? getComputedStyle(first).marginTop : null,
					pairs: headings.map((heading) => {
						const next = heading.nextElementSibling;
						const previous = heading.previousElementSibling;
						return {
							text: heading.textContent,
							level: heading.dataset.headingLevel,
							before: getComputedStyle(heading).getPropertyValue("--praxity-flow-gap").trim(),
							previousType: previous?.getAttribute("data-block-type"),
							after: next
								? getComputedStyle(next).getPropertyValue("--praxity-flow-gap").trim()
								: null,
							nextType: next?.getAttribute("data-block-type"),
						};
					}),
					media: Array.from(main.querySelectorAll<HTMLElement>(".praxity-block-title"))
						.filter((title) => title.matches("h3"))
						.map((title) => ({
							text: title.textContent,
							gap: title.nextElementSibling
								? title.nextElementSibling.getBoundingClientRect().top -
									title.getBoundingClientRect().bottom
								: null,
						})),
				};
			});
			expect(evidence.media).toHaveLength(2);
			for (const media of evidence.media)
				expect(media.gap, media.text ?? "Media title").toBeCloseTo(8, 1);
			expect(evidence.firstMargin).toBe("0px");
			expect(evidence.pairs.length).toBeGreaterThan(8);
			for (const pair of evidence.pairs) {
				expect(pair.level, pair.text ?? "heading").toMatch(/^[1-6]$/);
				if (pair.previousType === "heading") expect(pair.before).toBe("8px");
				if (pair.previousType && pair.previousType !== "heading" && pair.level === "2")
					expect(pair.before).toBe(width < 768 ? "48px" : "64px");
				if (pair.nextType && pair.nextType !== "heading" && pair.level === "2")
					expect(pair.after).toBe(width < 768 ? "12px" : "16px");
			}
			await test.info().attach("heading-adjacency", {
				body: JSON.stringify(evidence),
				contentType: "application/json",
			});
		});
	}
}
