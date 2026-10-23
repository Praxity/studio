import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { colorToHex, contrastRatio, hexToOklab } from "@praxity/shared-blocks/color-math";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { renderBlockHtml } from "../../src/render-block-html";
import { test } from "../muted-test";
import { readTestEnv, waitForHydration } from "./helpers";

function renderedHex(color: string): string {
	const hex = colorToHex(color);
	if (hex) return hex;
	const channels = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(color);
	if (!channels) throw new Error(`Expected an opaque sRGB colour, received: ${color}`);
	return `#${channels
		.slice(1)
		.map((channel) => Number(channel).toString(16).padStart(2, "0"))
		.join("")}`;
}

function readingPages() {
	const evidence = process.env.PRAXITY_DESIGN_SYSTEM_ENV;
	if (evidence)
		return JSON.parse(readFileSync(evidence, "utf8")) as {
			name: string;
			url: string;
			entries: string[];
		}[];
	const env = readTestEnv();
	return [
		{
			name: "comprehensive",
			url: env.url,
			entries: [
				"rich-content-and-typography.html",
				"container-blocks.html",
				"block-presentation-stats/statistics.html",
			],
		},
	];
}

for (const width of [1280, 390]) {
	test(`code syntax roles and language gap at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		for (const course of readingPages()) {
			await page.goto(`${course.url}/rich-content-and-typography.html`);
			await waitForHydration(page);
			const html = renderBlockHtml({
				id: "syntax-palette-evidence",
				type: "code",
				data: {
					language: "javascript",
					code: '// A comment\nconst message = "Hello";\nfunction greet() { return 42; }',
				},
			} as PraxityBlock);
			await page
				.locator(".praxity-page-content")
				.first()
				.evaluate((element, markup) => {
					element.insertAdjacentHTML("beforeend", markup);
				}, html);
			const block = page.locator('[data-block-id="syntax-palette-evidence"]');
			const result = await block.evaluate((element) => {
				const color = (role: string) => {
					const probe = document.createElement("span");
					probe.style.color = `var(--${role})`;
					element.append(probe);
					const value = getComputedStyle(probe).color;
					probe.remove();
					return value;
				};
				const mapped = ["keyword", "string", "comment", "function", "number"].map((type) => {
					const token = element.querySelector(`.token.${type}`);
					if (!token) throw new Error(`Missing ${type} token`);
					return {
						type,
						actual: getComputedStyle(token).color,
						fontStyle: getComputedStyle(token).fontStyle,
						expected: color(`syntax-${type === "number" ? "function" : type}`),
					};
				});
				const label = element.querySelector(".praxity-code-language-badge");
				const body = element.querySelector(".praxity-code-body");
				const punctuation = element.querySelector(".token.punctuation");
				if (!label || !body || !punctuation) throw new Error("Missing code structure");
				return {
					mapped,
					punctuation: getComputedStyle(punctuation).color,
					ink: color("ink"),
					paper: color("paper-2"),
					gap: body.getBoundingClientRect().top - label.getBoundingClientRect().bottom,
					space: Number.parseFloat(getComputedStyle(element).getPropertyValue("--space-2")),
				};
			});
			for (const token of result.mapped) {
				expect.soft(token.actual, `${course.name} ${token.type}`).toBe(token.expected);
				expect
					.soft(contrastRatio(renderedHex(token.actual), renderedHex(result.paper)), token.type)
					.toBeGreaterThanOrEqual(4.5);
				expect.soft(token.fontStyle).toBe(token.type === "comment" ? "italic" : "normal");
			}
			const keyword = result.mapped.find((token) => token.type === "keyword");
			const string = result.mapped.find((token) => token.type === "string");
			if (!keyword || !string) throw new Error("Missing coloured syntax roles");
			for (const [first, second] of [
				[keyword.actual, result.ink],
				[string.actual, result.ink],
				[keyword.actual, string.actual],
			]) {
				const a = hexToOklab(renderedHex(first));
				const b = hexToOklab(renderedHex(second));
				expect.soft(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThanOrEqual(0.1);
			}
			expect.soft(new Set(result.mapped.map((token) => token.actual)).size).toBe(4);
			expect.soft(result.punctuation).toBe(result.ink);
			expect.soft(result.gap).toBeCloseTo(result.space, 1);
		}
	});

	test(`text blocks retain quote sizes and nested table measure at ${width}px`, async ({
		page,
	}) => {
		const course = readingPages()[0];
		if (!course) throw new Error("Missing reading fixture");
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`${course.url}/container-blocks.html`);
		await waitForHydration(page);
		const nestedTable = renderBlockHtml({
			id: "nested-table",
			type: "table",
			data: { headers: ["Term", "Meaning"], rows: [["First", "Definition"]], caption: "Reference" },
		} as PraxityBlock);
		await page
			.locator(
				'.praxity-sequence[data-orientation="vertical"][data-alignment="left"] .praxity-sequence-content',
			)
			.first()
			.evaluate((element, html) => element.insertAdjacentHTML("beforeend", html), nestedTable);
		const bounds = await page.locator(".praxity-table-figure").evaluate((element) => {
			const sequence = element.closest(".praxity-sequence");
			if (!sequence) throw new Error("Missing enclosing sequence");
			return {
				left: element.getBoundingClientRect().left,
				width: element.getBoundingClientRect().width,
				outerLeft: sequence.getBoundingClientRect().left,
				outerWidth: sequence.getBoundingClientRect().width,
			};
		});
		expect.soft(bounds.left).toBeCloseTo(bounds.outerLeft, 0);
		expect.soft(bounds.width).toBeCloseTo(bounds.outerWidth, 0);
		const captionStyle = await page
			.locator(".praxity-table-figure figcaption")
			.evaluate((element) => {
				const style = getComputedStyle(element);
				return { size: style.fontSize, weight: style.fontWeight };
			});
		expect(captionStyle).toEqual({ size: "15px", weight: "600" });
		const layouts = ["left", "right", "center", "plain"];
		const sequences = layouts
			.map((layout) =>
				renderBlockHtml({
					id: `table-sequence-${layout}`,
					type: "sequence",
					data: {
						variant: layout === "plain" ? "plain" : "timeline",
						orientation: "vertical",
						alignment: layout === "plain" ? "left" : layout,
						items: [0, 1].map((index) => ({
							id: `${layout}-${index}`,
							label: `Step ${index + 1}`,
							children: [
								{
									id: `table-${layout}-${index}`,
									type: "table",
									data: {
										headers: ["Term", "Meaning"],
										rows: [["First", "Definition"]],
									},
								},
							],
						})),
					},
				} as PraxityBlock),
			)
			.join("");
		await page
			.locator(".praxity-page-content")
			.first()
			.evaluate((element, html) => element.insertAdjacentHTML("beforeend", html), sequences);
		for (const layout of layouts) {
			const tables = await page
				.locator(`[data-block-id="table-sequence-${layout}"] .praxity-table-figure`)
				.evaluateAll((elements) =>
					elements.map((element) => {
						const sequence = element.closest(".praxity-sequence");
						if (!sequence) throw new Error("Missing enclosing sequence");
						return {
							left: element.getBoundingClientRect().left,
							width: element.getBoundingClientRect().width,
							outerLeft: sequence.getBoundingClientRect().left,
							outerWidth: sequence.getBoundingClientRect().width,
						};
					}),
				);
			expect(tables).toHaveLength(2);
			for (const table of tables) {
				expect.soft(table.left, `${layout} table reading edge`).toBeCloseTo(table.outerLeft, 0);
				expect.soft(table.width, `${layout} table measure`).toBeCloseTo(table.outerWidth, 0);
			}
		}
		const quoteSizes = ["default", "large", "very-large"];
		const heading = renderBlockHtml({
			id: "nested-heading",
			type: "heading",
			data: { level: 2, content: "An internal heading" },
		} as PraxityBlock);
		await page
			.locator(".praxity-sequence-content")
			.first()
			.evaluate((element, html) => element.insertAdjacentHTML("beforeend", html), heading);
		const headingStyle = await page.locator('[data-block-id="nested-heading"] h2').evaluate((e) => {
			const s = getComputedStyle(e);
			return { size: s.fontSize, family: s.fontFamily, weight: s.fontWeight, align: s.textAlign };
		});
		expect(headingStyle.size).toBe(width === 390 ? "21px" : "24px");
		expect(headingStyle.family).toContain("Source Sans 3");
		expect(headingStyle.weight).toBe("600");
		expect(headingStyle.align).toBe("start");
		const markup = quoteSizes
			.map((size) =>
				renderBlockHtml({
					id: `quote-${size}`,
					type: "quote",
					data: { size, text: "Words worth reading.", speaker: "Author" },
				} as PraxityBlock),
			)
			.join("");
		await page
			.locator(".praxity-page-content")
			.first()
			.evaluate((element, html) => element.insertAdjacentHTML("beforeend", html), markup);
		for (const [index, size] of quoteSizes.entries()) {
			const fontSize = await page
				.locator(`.praxity-quote[data-size="${size}"]`)
				.last()
				.evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
			expect.soft(fontSize).toBe((width === 390 ? [20, 21, 25] : [22, 24, 30])[index]);
		}
		const scaled = renderBlockHtml({
			id: "scaled-marker-evidence",
			type: "sequence",
			data: {
				variant: "numbered",
				orientation: "horizontal",
				distribution: "scaled",
				items: [
					{ id: "early", label: "1999", children: [] },
					{ id: "late", label: "2023", children: [] },
				],
			},
		} as PraxityBlock);
		await page
			.locator(".praxity-page-content")
			.first()
			.evaluate((element, html) => element.insertAdjacentHTML("beforeend", html), scaled);
		const masked = await page
			.locator('[data-block-id="scaled-marker-evidence"] .praxity-accent-badge')
			.evaluateAll((elements) =>
				elements.map((element) => {
					const probe = document.createElement("span");
					probe.style.backgroundColor = "var(--paper)";
					element.append(probe);
					const paper = getComputedStyle(probe).backgroundColor;
					probe.remove();
					return getComputedStyle(element).backgroundColor === paper;
				}),
			);
		expect(masked).toEqual([true, true]);
		const extraTracks = await page
			.locator('[data-block-id="scaled-marker-evidence"] .praxity-sequence-item')
			.evaluateAll((elements) =>
				elements.map(
					(element) => !["none", "normal"].includes(getComputedStyle(element, "::after").content),
				),
			);
		expect(extraTracks).toEqual([false, false]);
	});
	test(`text blocks follow section 5 at ${width}px`, async ({ page }, info) => {
		const counts = {
			notes: 0,
			quotes: 0,
			code: 0,
			tables: 0,
			images: 0,
			markers: 0,
			comparisons: 0,
			stats: 0,
		};
		await page.setViewportSize({ width, height: 844 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		for (const course of readingPages())
			for (const entry of course.entries) {
				await page.goto(`${course.url}/${entry}`);
				await waitForHydration(page);
				await page.evaluate(async () => {
					await document.fonts.ready;
				});
				const capture = process.env.PRAXITY_TEXT_SHOTS;
				if (capture && info.project.name === "chromium") {
					await mkdir(capture, { recursive: true });
					const blocks = page.locator(
						'[data-block-type="note"], [data-block-type="quote"], [data-block-type="code"], [data-block-type="table"], [data-block-type="image"], [data-block-type="sequence"], [data-block-type="stats"], [data-block-type="columns"]',
					);
					for (const [index, block] of (await blocks.all()).entries()) {
						if (!(await block.isVisible())) continue;
						const type = await block.getAttribute("data-block-type");
						await block.screenshot({
							path: join(
								capture,
								`${course.name}-${width}-${entry.replace(/\.html$/, "")}-${type}-${index}.png`,
							),
						});
					}
				}
				const result = await page.evaluate(() => {
					const errors: string[] = [];
					const counts = {
						notes: 0,
						quotes: 0,
						code: 0,
						tables: 0,
						images: 0,
						markers: 0,
						comparisons: 0,
						stats: 0,
					};
					const check = (ok: boolean, message: string) => {
						if (!ok) errors.push(message);
					};
					const style = (element: Element) => getComputedStyle(element);
					const role = (element: Element, token: string) => {
						const probe = document.createElement("span");
						probe.style.color = `var(${token})`;
						element.append(probe);
						const color = style(probe).color;
						probe.remove();
						return color;
					};
					for (const note of document.querySelectorAll(".praxity-note-base")) {
						counts.notes++;
						const s = style(note),
							label = note.querySelector(".praxity-note-label"),
							body = note.querySelector(".praxity-note-body");
						check(
							s.borderTopWidth === "1px" &&
								s.borderLeftWidth === "0px" &&
								s.borderBottomWidth === "0px" &&
								s.borderRightWidth === "0px",
							"note: one 1px top rule",
						);
						check(
							s.backgroundColor === "rgba(0, 0, 0, 0)" && s.borderRadius === "0px",
							"note: unboxed",
						);
						if (label && body) {
							check(
								style(label).display === "inline" &&
									style(label).fontSize === style(body).fontSize &&
									style(label).fontWeight === "600",
								"note: body-sized run-in label",
							);
							const first = body.querySelector("p");
							check(
								!!first?.contains(label) && first.textContent !== label.textContent,
								"note: label shares its authored first paragraph",
							);
						}
						const warning = ["warning", "error", "danger"].includes(
							note.getAttribute("data-color") ?? "",
						);
						const icon = note.querySelector("svg");
						check(
							warning ? !!icon && icon.getBoundingClientRect().width === 20 : !icon,
							"note: warning icon only, 20px",
						);
					}
					for (const quote of document.querySelectorAll(".praxity-quote")) {
						counts.quotes++;
						const s = style(quote),
							attribution = quote.querySelector("figcaption");
						check(
							s.borderLeftWidth === "2px" && s.borderLeftColor === role(quote, "--line"),
							"quote: 2px neutral left rule",
						);
						check(
							s.fontFamily.includes("Source Sans 3") && s.fontStyle === "italic",
							"quote: serif italic",
						);
						check(
							Number.parseFloat(s.fontSize) === (innerWidth === 390 ? 20 : 22),
							"quote: lead size",
						);
						if (attribution)
							check(
								style(attribution).fontSize === "15px" &&
									!attribution.textContent?.trim().startsWith("—"),
								"quote: 15px attribution without dash",
							);
					}
					for (const body of document.querySelectorAll(".praxity-code-body")) {
						counts.code++;
						const s = style(body),
							pre = body.querySelector("pre"),
							label = body.parentElement?.querySelector(".praxity-code-language-badge");
						check(
							s.backgroundColor === role(body, "--paper-2") &&
								s.borderTopWidth === "0px" &&
								s.borderRadius === "10px" &&
								s.boxShadow === "none",
							"code: paper-2, radius 10, no border/shadow",
						);
						if (pre)
							check(
								style(pre).paddingTop === "16px" && style(pre).fontSize === "15px",
								"code: padding 16 and mono 15",
							);
						if (label)
							check(
								style(label).backgroundColor === "rgba(0, 0, 0, 0)" &&
									style(label).fontSize === "15px" &&
									label.getBoundingClientRect().bottom <= body.getBoundingClientRect().top,
								"code: plain language label above surface",
							);
						const colors = new Set(
							Array.from(body.querySelectorAll(".token")).map((e) => style(e).color),
						);
						check(colors.size <= 4, "code: at most four syntax colors");
					}
					for (const table of document.querySelectorAll(".praxity-data-table")) {
						counts.tables++;
						for (const cell of table.querySelectorAll("th, td")) {
							const s = style(cell);
							check(
								s.borderLeftWidth === "0px" &&
									s.borderRightWidth === "0px" &&
									s.backgroundColor === "rgba(0, 0, 0, 0)",
								"table: horizontal rules and no tinted cells",
							);
						}
						const head = table.querySelector("thead th");
						if (head)
							check(
								style(head).borderBottomWidth === "2px" &&
									style(head).borderBottomColor === role(head, "--ink"),
								"table: 2px ink header rule",
							);
						const caption = table.closest("figure")?.querySelector("figcaption");
						if (caption)
							check(
								style(caption).fontSize === "15px" &&
									style(caption).fontWeight === "600" &&
									caption.getBoundingClientRect().bottom <= table.getBoundingClientRect().top,
								"table: bold small caption above",
							);
						const region = table.parentElement;
						if (region && region.scrollWidth > region.clientWidth + 1) {
							check(style(region).backgroundImage.includes("gradient"), "table: edge fade");
							const hint = region.parentElement?.querySelector(".praxity-table-scroll-hint");
							check(
								!!hint && style(hint).display !== "none" && hint.textContent === "Scroll for more",
								"table: visible scroll hint",
							);
						}
					}
					for (const image of document.querySelectorAll(".praxity-block-image img")) {
						counts.images++;
						check(
							style(image).borderRadius === "0px" && style(image).outlineStyle === "none",
							"image: square corners without frame",
						);
					}
					for (const marker of document.querySelectorAll(
						".praxity-accent-badge, .praxity-sequence-marker .praxity-accent-dot",
					)) {
						counts.markers++;
						const s = style(marker);
						check(
							marker.getBoundingClientRect().width === 28 &&
								marker.getBoundingClientRect().height === 28 &&
								s.borderTopWidth === "1px" &&
								s.borderTopColor === role(marker, "--ink") &&
								s.backgroundColor === "rgba(0, 0, 0, 0)" &&
								s.fontSize === "15px",
							"sequence: 28px outline step circle, 15px numeral",
						);
					}
					for (const columns of document.querySelectorAll(
						'.praxity-columns[data-preset="comparison"], .praxity-columns[data-preset="beforeAfter"]',
					)) {
						counts.comparisons++;
						const second = columns.children[1];
						if (second) {
							const s = style(second);
							check(
								innerWidth === 390
									? s.borderTopWidth === "1px" && s.borderLeftWidth === "0px"
									: getComputedStyle(second, "::before").borderLeftWidth === "1px" &&
											getComputedStyle(second, "::before").left === "-12px" &&
											s.borderTopWidth === "0px",
								"comparison: divider between columns, top rule when stacked",
							);
						}
						for (const heading of columns.querySelectorAll(".praxity-column-preset-header"))
							check(
								style(heading).fontSize === (innerWidth === 390 ? "21px" : "24px") &&
									style(heading).fontFamily.includes("Source Sans 3") &&
									style(heading).fontWeight === "600",
								"comparison: H3 headings",
							);
					}
					for (const stat of document.querySelectorAll(".praxity-stats-item")) {
						counts.stats++;
						const value = stat.querySelector(".praxity-stats-value"),
							label = stat.querySelector(".praxity-stats-label");
						if (value && label)
							check(
								style(value).fontSize === (innerWidth === 390 ? "20px" : "22px") &&
									style(value).fontWeight === "600" &&
									style(value).color === role(value, "--ink") &&
									style(label).fontSize === "15px",
								"stats: lead serif value, small label, neutral ink",
							);
					}
					return { errors: [...new Set(errors)], counts };
				});
				for (const key of Object.keys(counts) as (keyof typeof counts)[])
					counts[key] += result.counts[key];
				expect.soft(result.errors, `${course.name}/${entry}`).toEqual([]);
			}
		for (const [block, count] of Object.entries(counts))
			expect(count, `${block} exercised`).toBeGreaterThan(0);
	});
}
