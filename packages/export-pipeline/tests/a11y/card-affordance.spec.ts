import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { expectFocusRing, expectForcedEmulationInert, forcedPalette } from "../focus-assertions";
import { CARD_SURFACE_LAYOUTS } from "./fixtures/design-container-surfaces-fixture";
import { readTestEnv } from "./helpers";

test.use({ contextOptions: { reducedMotion: "reduce" } });

for (const forcedColors of ["none", "active"] as const) {
	test(`card position uses compact dots and a current pill with ${forcedColors} forced colors`, async ({
		page,
	}) => {
		await page.emulateMedia({ forcedColors });
		await page.goto(`${readTestEnv().url}/design-container-surfaces-light/container-surfaces.html`);
		const root = page.locator("[data-card-root]").filter({ hasText: "Boundary card one" });
		await expect(root).toHaveAttribute("data-card-enhanced", "true");
		const dots = root.locator("[data-card-goto]");
		const geometry = await dots.evaluateAll((nodes) =>
			nodes.map((node) => {
				const bounds = node.getBoundingClientRect();
				const paint = getComputedStyle(node, "::before");
				return {
					targetWidth: bounds.width,
					targetHeight: bounds.height,
					width: parseFloat(paint.width),
					height: parseFloat(paint.height),
					background: paint.backgroundColor,
					border: paint.borderStyle,
				};
			}),
		);
		for (const dot of geometry) {
			expect(dot.targetWidth).toBeGreaterThanOrEqual(24);
			expect(dot.targetHeight).toBeGreaterThanOrEqual(24);
			expect(dot.height).toBe(8);
		}
		expect(geometry[0].width).toBe(16);
		expect(geometry[1].width).toBe(8);
		if (forcedColors === "active" && !(await forcedPalette(page))) {
			await expectForcedEmulationInert(page, [{ locator: dots, pseudo: "::before" }]);
		} else {
			if (forcedColors === "active") for (const dot of geometry) expect(dot.border).toBe("solid");
		}
		const controls = await root.evaluate((node) => {
			const grid = node.querySelector(".praxity-slides-grid");
			if (!grid) throw new Error("Missing card grid");
			return Array.from(node.querySelectorAll("[data-card-next],[data-card-previous]")).map(
				(button) => {
					const bounds = button.getBoundingClientRect();
					return {
						width: bounds.width,
						height: bounds.height,
						gap: bounds.top - grid.getBoundingClientRect().bottom,
					};
				},
			);
		});
		for (const control of controls) {
			expect(control.width).toBeGreaterThanOrEqual(44);
			expect(control.height).toBeGreaterThanOrEqual(44);
			expect(control.gap).toBeGreaterThanOrEqual(12);
		}
		await dots.nth(1).focus();
		await page.keyboard.press("Enter");
		await expect(dots.nth(1)).toBeFocused();
		await expect(dots.nth(1)).toHaveAttribute("aria-current", "step");
		if (forcedColors === "active" && !(await forcedPalette(page))) {
			await expectForcedEmulationInert(page, [dots.nth(1)]);
			await expectFocusRing(dots.nth(1), 2);
		}
		await test.info().attach("card-accessibility-tree", {
			body: await root.ariaSnapshot(),
			contentType: "text/plain",
		});
		await test.info().attach("hydrated-landmarks", {
			body: JSON.stringify(
				await page
					.locator(
						'main,nav,aside,header,footer,[role="region"],section[aria-label],section[aria-labelledby]',
					)
					.evaluateAll((nodes) =>
						nodes.map((node) => ({
							tag: node.tagName,
							role: node.getAttribute("role"),
							name: node.getAttribute("aria-label"),
							labelledBy: node.getAttribute("aria-labelledby"),
							carousel: node.getAttribute("aria-roledescription"),
						})),
					),
			),
			contentType: "application/json",
		});
		await root.screenshot({ path: test.info().outputPath(`card-position-${forcedColors}.png`) });
	});
}

for (const width of [1280, 390]) {
	test(`card boundary navigation preserves focus and Tab order at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`${readTestEnv().url}/design-container-surfaces-light/container-surfaces.html`);
		// The enabled SSR button can receive Enter before its lazy card handler is installed.
		const island = page.locator('[data-island="card"]').filter({ hasText: "Boundary card one" });
		await island.scrollIntoViewIfNeeded();
		await expect(island).toHaveAttribute("data-hydrated", "");
		const root = island.locator("[data-card-root]");
		const previous = root.locator("[data-card-previous]");
		const next = root.locator("[data-card-next]");
		await next.focus();
		await page.keyboard.press("Enter");
		await expect(next).toBeDisabled();
		await expect(previous).toBeEnabled();
		await expect(previous).toBeFocused();
		await expect(previous).toBeInViewport();
		await expect(root.locator('[data-active="true"]')).toContainText("Boundary card two");
		expect(await previous.evaluate((node) => Boolean(node.closest("[hidden],[inert]")))).toBe(
			false,
		);
		await page.keyboard.press("Tab");
		await expect(root.locator('[data-card-goto="0"]')).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect(previous).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(previous).toBeDisabled();
		await expect(next).toBeEnabled();
		await expect(next).toBeFocused();
		await expect(next).toBeInViewport();
		await expect(root.locator('[data-active="true"]')).toContainText("Boundary card one");
		await page.keyboard.press("Shift+Tab");
		await expect(root.locator('[data-card-goto="1"]')).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(next).toBeFocused();
		for (const index of [1, 0]) {
			const dot = root.locator(`[data-card-goto="${index}"]`);
			await dot.focus();
			await page.keyboard.press("Enter");
			await expect(dot).toBeFocused();
			await expect(dot).toHaveAttribute("aria-current", "step");
		}
	});
}

test("one-card navigation stays disabled and keyboard focus stays in active content", async ({
	page,
}) => {
	await page.goto(`${readTestEnv().url}/design-container-surfaces-light/container-surfaces.html`);
	const root = page.locator("[data-card-root]").filter({ hasText: "Card single flip outline" });
	await expect(root.locator("[data-card-previous]")).toBeDisabled();
	await expect(root.locator("[data-card-next]")).toBeDisabled();
	const flip = root.locator("[data-card-flip]");
	await flip.focus();
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowLeft");
	await expect(flip).toBeFocused();
	await expect(flip).toBeVisible();
	expect(await flip.evaluate((node) => Boolean(node.closest("[hidden],[inert]")))).toBe(false);
});

test("unhydrated card links remain clickable on the active face", async ({ browser }) => {
	const css = await readFile(
		new URL("../../../shared-blocks/src/blocks/shared-blocks.css", import.meta.url),
		"utf8",
	);
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		const page = await context.newPage();
		const html = `<style>${css}</style><article class="praxity-card" data-flippable="true"><div class="praxity-flashcard-shell"><div class="praxity-flashcard-toggle"><div class="praxity-flashcard-inner" data-flipped="false" style="min-height:220px"><div class="praxity-flashcard-face" data-card-side="front"><a href="#front-hit">Front link</a></div><div class="praxity-flashcard-face" data-card-side="back"><a href="#back-hit">Back link</a></div></div></div></div></article>`;
		await page.setContent(html);
		await expect(page.locator('[data-card-side="back"]')).not.toHaveAttribute("inert", "");
		await page.getByRole("link", { name: "Front link" }).click();
		await expect(page).toHaveURL(/#front-hit$/);
		await page.setContent(html.replace('data-flipped="false"', 'data-flipped="true"'));
		await expect(page.locator('[data-card-side="back"]')).toHaveCSS("pointer-events", "auto");
		await page.getByRole("link", { name: "Back link" }).click();
		await expect(page).toHaveURL(/#back-hit$/);
	} finally {
		await context.close();
	}
});

for (const appearance of ["light", "dark"]) {
	for (const mode of ["small", "full"]) {
		test(`${appearance} ${mode} cards keep the prompt above a named answer button`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: mode === "small" ? 640 : 1280, height: 900 });
			await page.goto(
				`${readTestEnv().url}/design-container-surfaces-${appearance}/container-surfaces.html${mode === "small" ? "?minimal=1&praxity-small-preview=1" : ""}`,
			);
			await expect(page.locator(".praxity-card-flip-cue")).toHaveCount(0);
			for (const layout of CARD_SURFACE_LAYOUTS) {
				const root = page
					.locator("[data-card-root]")
					.filter({ hasText: `Card ${layout} flip outline` });
				const toggle = root.locator("[data-card-flip]");
				await root.scrollIntoViewIfNeeded();
				const front = root.locator('[data-card-side="front"]');
				const back = root.locator('[data-card-side="back"]');
				await expect(front).toBeVisible();
				if (mode === "small") {
					// Small previews omit the card runtime; both passages remain readable.
					await expect(toggle).toBeHidden();
					await expect(back).toBeVisible();
					continue;
				}
				await expect(toggle).toHaveAttribute("aria-expanded", "false");
				await expect(toggle).toHaveText("I have my answer");
				await expect(back).toBeHidden();
				await toggle.click();
				await expect(toggle).toHaveAttribute("aria-expanded", "true");
				await expect(toggle).toHaveText("Hide answer");
				await expect(front).toBeVisible();
				await expect(back).toBeVisible();
				await toggle.click();
				await expect(toggle).toHaveAttribute("aria-expanded", "false");
			}
		});
	}
}

test("long prompts and answers stay in document flow at every card layout", async ({ page }) => {
	await page.setViewportSize({ width: 640, height: 900 });
	for (const layout of ["grid", "single", "masonry", "rows"] as const) {
		const route =
			layout === "rows"
				? "container-layouts/media-rows-flip.html"
				: "design-container-surfaces-light/container-surfaces.html";
		await page.goto(`${readTestEnv().url}/${route}`);
		const root =
			layout === "rows"
				? page.locator("[data-card-root]")
				: page.locator("[data-card-root]").filter({ hasText: `Card ${layout} flip outline` });
		const island = root.locator("xpath=ancestor::*[@data-island='card'][1]");
		await island.scrollIntoViewIfNeeded();
		await expect(island).toHaveAttribute("data-hydrated", "");
		await root.locator('[data-card-side="front"]').evaluate((node) => {
			const paragraph = document.createElement("p");
			paragraph.textContent = "Long learner content. ".repeat(100);
			node.append(paragraph);
		});
		const height = await root
			.locator(".praxity-flashcard-inner")
			.evaluate((node) => node.getBoundingClientRect().height);
		expect(height).toBeGreaterThan(220);
		const toggle = root.locator("[data-card-flip]");
		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-expanded", "true");
		const bounds = await root.locator(".praxity-flashcard-inner").evaluate((node) => {
			const front = node.querySelector('[data-card-side="front"]')?.getBoundingClientRect();
			const back = node.querySelector('[data-card-side="back"]')?.getBoundingClientRect();
			if (!front || !back) throw new Error("Missing prompt or answer");
			return {
				height: node.getBoundingClientRect().height,
				frontBottom: front.bottom,
				backTop: back.top,
			};
		});
		expect(bounds.height).toBeGreaterThan(height);
		expect(bounds.backTop).toBeGreaterThan(bounds.frontBottom);
	}
});

test("answer space grows and fades over 200 ms, instantly under reduced motion", async ({
	page,
}) => {
	await page.goto(`${readTestEnv().url}/design-container-surfaces-light/container-surfaces.html`);
	const root = page.locator("[data-card-root]").filter({ hasText: "Card grid flip outline" });
	const toggle = root.locator("[data-card-flip]");
	await toggle.scrollIntoViewIfNeeded();
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await toggle.hover();
	await expect(toggle).toHaveAttribute("aria-expanded", "false");
	await toggle.focus();
	await page.keyboard.press("Enter");
	await expect(toggle).toHaveAttribute("aria-expanded", "true");
	const answer = root.locator('[data-card-side="back"]');
	const reveal = root.locator("[data-content-reveal]");
	await expect(answer).toHaveCSS("transform", "none");
	await expect(reveal).toHaveCSS("transition-property", "grid-template-rows, opacity");
	await expect(reveal).toHaveCSS("transition-duration", "0.2s, 0.2s");
	await expect(answer).toHaveCSS("opacity", "1");
	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect(reveal).toHaveCSS("transition-duration", "0s");
	await page.keyboard.press("Space");
	await expect(answer).toBeHidden();
	await expect(root.locator('[data-card-side="front"]')).toBeVisible();
});
