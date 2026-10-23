import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { ReviewAnchor } from "@praxity/review-share/review";
import { servedReview } from "./review-fixture";

for (const locale of ["en", "fr"]) {
	test(`a quote in a display:contents matching row stays visible (${locale})`, async ({ page }) => {
		const fixture = await servedReview(locale);
		const matchingRow = () => {
			const row = document.querySelector('[data-node-id="quote"]') as HTMLElement;
			row.style.display = "contents";
			row.className = "praxity-matching-row";
			const prompt = document.createElement("span");
			prompt.className = "praxity-matching-prompt";
			prompt.textContent = row.textContent;
			row.replaceChildren(prompt);
		};
		try {
			await page.goto(fixture.url);
			await page.evaluate(matchingRow);
			const anchor = await page.evaluate(() => {
				const range = document.createRange();
				range.selectNodeContents(document.querySelector(".praxity-matching-prompt") as Element);
				return (
					window as unknown as { PraxityReview: { fromSelection(range: Range): ReviewAnchor } }
				).PraxityReview.fromSelection(range);
			});
			await fixture.seed(anchor, "Matching prompt review");
			await page.reload();
			await page.evaluate(matchingRow);
			await expect(page.locator(".prx-review-marker")).toBeVisible();
			await expect(page.locator(".prx-review-anchor-status")).toBeHidden();
			await expect
				.poll(() => page.evaluate(() => CSS.highlights.get("prx-review-quote")?.size ?? 0))
				.toBe(1);
		} finally {
			await page.goto("about:blank");
			await fixture.close();
		}
	});
	test(`a hidden player step has no quote marker or highlight (${locale})`, async ({ page }) => {
		const fixture = await servedReview(locale);
		try {
			await page.goto(fixture.url);
			await expect(page.locator(".prx-review-status")).not.toHaveText(/Loading|Chargement/);
			const anchor = await page.evaluate(() => {
				const range = document.createRange();
				range.selectNodeContents(document.querySelector('[data-node-id="quote"]')!);
				return (
					window as unknown as { PraxityReview: { fromSelection(range: Range): ReviewAnchor } }
				).PraxityReview.fromSelection(range);
			});
			await fixture.seed(anchor, "Hidden step review");
			await page.reload();
			await expect(page.locator(".prx-review-marker")).toBeVisible();
			await page.evaluate(() => {
				const target = document.querySelector('[data-node-id="quote"]')!;
				const step = document.createElement("section");
				step.className = "praxity-player-step";
				target.before(step);
				step.append(target);
				step.hidden = true;
			});
			await page
				.getByRole("button", {
					name: locale === "fr" ? "Développer les commentaires" : "Expand comments",
				})
				.click();
			await expect(page.locator(".prx-review-anchor-status")).toHaveText(
				locale === "fr" ? "⚠ Pas sur cette page" : "⚠ Not on this page",
			);
			await expect(page.locator(".prx-review-marker")).toBeHidden();
			await expect
				.poll(() => page.evaluate(() => CSS.highlights.get("prx-review-quote")?.size ?? 0))
				.toBe(0);
			await page.evaluate(() => {
				(document.querySelector(".praxity-player-step") as HTMLElement).hidden = false;
			});
			await expect(page.locator(".prx-review-marker")).toBeVisible();
			await expect(page.locator(".prx-review-anchor-status")).toBeHidden();
		} finally {
			await page.goto("about:blank");
			await fixture.close();
		}
	});
	test(`a numbered code quote follows its player step (${locale})`, async ({ page }) => {
		const fixture = await servedReview(locale);
		const codeStep = () => {
			const target = document.querySelector('[data-node-id="quote"]') as HTMLElement;
			const step = document.createElement("section");
			step.className = "praxity-player-step";
			target.before(step);
			step.append(target);
			const code = document.createElement("code");
			["const a = 1;", "const b = 2;"].forEach((text, index) => {
				const line = document.createElement("span");
				line.className = "praxity-code-line";
				line.style.display = "flex";
				const number = document.createElement("span");
				number.className = "praxity-code-line-number";
				number.setAttribute("aria-hidden", "true");
				number.textContent = String(index + 1);
				const source = document.createElement("span");
				source.setAttribute("data-code-line", "");
				source.textContent = text;
				line.append(number, source);
				if (index) code.append("\n");
				code.append(line);
			});
			const pre = document.createElement("pre");
			pre.append(code);
			target.replaceChildren(pre);
		};
		const highlights = () => page.evaluate(() => CSS.highlights.get("prx-review-quote")?.size ?? 0);
		try {
			await page.goto(fixture.url);
			await expect(page.locator(".prx-review-status")).not.toHaveText(/Loading|Chargement/);
			await page.evaluate(codeStep);
			const anchor = await page.evaluate(() => {
				const range = document.createRange();
				range.selectNodeContents(document.querySelector('[data-node-id="quote"] code')!);
				return (
					window as unknown as { PraxityReview: { fromSelection(range: Range): ReviewAnchor } }
				).PraxityReview.fromSelection(range);
			});
			expect(anchor.quote?.exact).toBe("const a = 1; const b = 2;");
			await fixture.seed(anchor, "Code step review");
			await page.reload();
			await page.evaluate(codeStep);
			await expect(page.locator(".prx-review-marker")).toBeVisible();
			await expect(page.locator(".prx-review-anchor-status")).toBeHidden();
			await expect.poll(highlights).toBe(1);
			await page.evaluate(() => {
				(document.querySelector(".praxity-player-step") as HTMLElement).hidden = true;
			});
			await page
				.getByRole("button", {
					name: locale === "fr" ? "Développer les commentaires" : "Expand comments",
				})
				.click();
			await expect(page.locator(".prx-review-anchor-status")).toHaveText(
				locale === "fr" ? "⚠ Pas sur cette page" : "⚠ Not on this page",
			);
			await expect(page.locator(".prx-review-marker")).toBeHidden();
			await expect.poll(highlights).toBe(0);
			await page.evaluate(() => {
				(document.querySelector(".praxity-player-step") as HTMLElement).hidden = false;
			});
			await expect(page.locator(".prx-review-marker")).toBeVisible();
			await expect(page.locator(".prx-review-anchor-status")).toBeHidden();
			await expect.poll(highlights).toBe(1);
		} finally {
			await page.goto("about:blank");
			await fixture.close();
		}
	});
}

test("stored quote and pin follow reflow, expose keyboard names and focus their thread", async ({
	page,
}) => {
	const shots = process.env.PRAXITY_REVIEW_SCREENSHOTS;
	if (shots) await mkdir(shots, { recursive: true });
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	for (const locale of ["en", "fr"]) {
		const fixture = await servedReview(locale);
		try {
			await page.setViewportSize({ width: 1536, height: 900 });
			await page.goto(fixture.url);
			await expect(page.locator(".prx-review-status")).toHaveText(
				locale === "fr"
					? "Aucun commentaire dans cette révision."
					: "No comments in this review yet.",
			);
			const capturedAnchors = await page.evaluate(() => {
				const api = (
					window as unknown as {
						PraxityReview: {
							fromSelection(range: Range): ReviewAnchor;
							fromBlock(target: Element): ReviewAnchor;
							fromPin(target: Element, x: number, y: number): ReviewAnchor;
						};
					}
				).PraxityReview;
				const quote = document.querySelector('[data-node-id="quote"]') as Element;
				const selected = document.createRange();
				selected.selectNodeContents(quote);
				const quoteAnchor = api.fromSelection(selected);
				const link = document.querySelector(".pin-target") as Element;
				const box = link.getBoundingClientRect();
				const pinAnchor = api.fromPin(link, box.left + box.width * 0.6, box.top + box.height * 0.5);
				const changed = api.fromBlock(
					document.querySelector('[data-node-id="changed"]') as Element,
				);
				changed.quote = { type: "TextQuoteSelector", exact: "Old wording", prefix: "", suffix: "" };
				return [quoteAnchor, pinAnchor, changed];
			});
			await fixture.seed(
				capturedAnchors[0],
				locale === "fr" ? "Relire ce passage." : "Review this passage.",
			);
			await fixture.seed(
				capturedAnchors[1],
				locale === "fr" ? "Vérifier le lien." : "Check the link.",
			);
			await fixture.seed(
				capturedAnchors[2],
				locale === "fr" ? "Le texte a changé." : "The wording changed.",
			);
			await page.reload();
			await expect(page.locator(".prx-review-comment")).toHaveCount(3);
			const marker = page.getByRole("button", {
				name: new RegExp(`^${locale === "fr" ? "Commentaire 2 :" : "Comment 2:"}`),
			});
			for (const width of [1536, 720, 390]) {
				await page.setViewportSize({ width, height: 900 });
				await expect(marker).toBeVisible();
				expect(
					await marker.evaluate((node) => {
						const hit = getComputedStyle(node, "::before");
						return { width: hit.width, height: hit.height };
					}),
				).toEqual({ width: "48px", height: "48px" });
				await expect
					.poll(async () =>
						page.evaluate(() => {
							const markers = document.querySelectorAll(".prx-review-marker");
							const pin = markers[1].getBoundingClientRect();
							const link = (
								document.querySelector(".pin-target") as Element
							).getBoundingClientRect();
							const quote = document.createRange();
							quote.selectNodeContents(document.querySelector('[data-node-id="quote"]') as Element);
							const last = Array.from(quote.getClientRects()).at(-1) as DOMRect;
							const end = markers[0].getBoundingClientRect();
							return Math.max(
								Math.abs(pin.left - (link.left + link.width * 0.6)),
								Math.max(0, pin.bottom + 12 - (link.top + link.height * 0.5)),
								Math.abs(end.left - last.right),
								Math.abs(end.bottom + 12 - last.top),
								Math.abs(
									markers[2].getBoundingClientRect().left +
										12 -
										(
											document.querySelector('[data-node-id="changed"]') as Element
										).getBoundingClientRect().left +
										16,
								),
							);
						}),
					)
					.toBeLessThan(1);
			}
			await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
			let reached = false;
			for (let press = 0; press < 20 && !reached; press++) {
				await page.keyboard.press("Tab");
				reached = await marker.evaluate((node) => document.activeElement === node);
			}
			expect(reached).toBe(true);
			await page.keyboard.press("Enter");
			await expect(page.locator(".prx-review-comment").nth(1)).toBeFocused();
			await expect(page.locator(".prx-review-anchor-status").nth(2)).toHaveText(
				locale === "fr" ? "⚠ Texte modifié" : "⚠ Text changed",
			);
			if (shots) {
				for (const width of [390, 1280]) {
					await page.setViewportSize({ width, height: width === 390 ? 1600 : 1100 });
					for (const theme of ["light", "dark"] as const) {
						// Fixed course mode must win even when the OS requests the opposite.
						await page.emulateMedia({ colorScheme: theme === "dark" ? "light" : "dark" });
						await page.evaluate(
							(mode) => document.documentElement.setAttribute("data-praxity-mode", mode),
							theme,
						);
						expect(
							await page.evaluate(
								() =>
									getComputedStyle(document.documentElement)
										.getPropertyValue("--prx-review-quote-strength")
										.trim() || "28%",
							),
						).toBe(theme === "dark" ? "35%" : "28%");
						await expect
							.poll(() => page.evaluate(() => CSS.highlights.get("prx-review-quote")?.size))
							.toBe(1);
						await page.screenshot({ path: join(shots, `c7-${width}-${theme}-${locale}.png`) });
					}
				}
				if (locale === "en") {
					await page.emulateMedia({ forcedColors: "active", colorScheme: "light" });
					await page.evaluate(() =>
						document.documentElement.setAttribute("data-praxity-mode", "light"),
					);
					await page.screenshot({ path: join(shots, "c7-1280-forced-colors-en.png") });
					await page.emulateMedia({ forcedColors: "none" });
				}
			}
		} finally {
			await page.goto("about:blank");
			await fixture.close();
		}
	}
	const deck = await servedReview("en", true);
	try {
		await page.emulateMedia({ colorScheme: "light" });
		await page.setViewportSize({ width: 390, height: 900 });
		await page.goto(deck.url);
		await expect(page.locator(".prx-review-status")).toHaveText("No comments in this review yet.");
		const anchor = await page.evaluate(() =>
			(
				window as unknown as { PraxityReview: { fromBlock(target: Element): ReviewAnchor } }
			).PraxityReview.fromBlock(document.querySelector('[data-node-id="changed"]') as Element),
		);
		await deck.seed(anchor, "Review this deck block.");
		await page.reload();
		const marker = page.locator(".prx-review-marker--block");
		await expect(marker).toBeVisible();
		await page.getByRole("button", { name: "Comment 1:", exact: false }).click();
		await expect(page.locator(".prx-review-comment")).toBeFocused();
		await expect(marker).toBeVisible();
		if (shots) await page.screenshot({ path: join(shots, "c7-390-light-en-deck.png") });
	} finally {
		await page.goto("about:blank");
		await deck.close();
	}
	expect(errors).toEqual([]);
});
