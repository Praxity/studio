import { expect, test } from "@playwright/test";
import { catalogSlug } from "../fixtures/authoring-catalog";
import { readTestEnv, waitForHydration } from "./helpers";

test("hydration readiness waits for visible authored entrance paint", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.addInitScript(() => {
		document.addEventListener("DOMContentLoaded", () => {
			const style = document.createElement("style");
			// Keep the real entrance running long enough to expose readiness that
			// only waits for island hydration. The test deadline stays unchanged.
			style.textContent =
				'[data-praxity-root][data-praxity-motion-entrance] .praxity-block[data-entrance="visible"] { transition-duration: 1s, 1s; }';
			document.head.append(style);
		});
	});
	await page.goto(`${readTestEnv().url}/design-layout-motionEntrance-fade/layout-audit.html`);
	await waitForHydration(page);
	const opacity = await page
		.locator('.praxity-block[data-entrance="visible"]')
		.first()
		.evaluate((element) => getComputedStyle(element).opacity);
	expect(opacity).toBe("1");
});

for (const transition of ["fade", "slide", "zoom"]) {
	test(`card ${transition} finishes outgoing text before revealing incoming text`, async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "no-preference" });
		await page.goto(`${readTestEnv().url}/design-container-surfaces-light/container-surfaces.html`);
		const root = page.locator("[data-card-root]").filter({ hasText: "Boundary card one" });
		await expect(root).toHaveAttribute("data-card-enhanced", "true");
		await root.scrollIntoViewIfNeeded();
		const evidence = await root.evaluate((node, transition) => {
			const grid = node.querySelector<HTMLElement>(".praxity-slides-grid");
			if (!grid) throw new Error("Missing slides grid");
			grid.dataset.transition = transition;
			const slides = Array.from(grid.querySelectorAll<HTMLElement>(".praxity-slides-item"));
			slides.forEach((slide) => getComputedStyle(slide).opacity);
			node.querySelector<HTMLButtonElement>("[data-card-next]")?.click();
			slides.forEach((slide) => getComputedStyle(slide).opacity);
			const animations = slides.flatMap((slide) => slide.getAnimations());
			animations.forEach((animation) => animation.pause());
			const timings = animations
				.filter(
					(animation) =>
						animation instanceof CSSTransition && animation.transitionProperty === "opacity",
				)
				.map((animation) => animation.effect?.getTiming());
			const frames = [0, 30, 60, 90, 120, 150, 210, 270, 300].map((time) => {
				animations.forEach((animation) => {
					animation.currentTime = time;
				});
				return { time, opacity: slides.map((slide) => Number(getComputedStyle(slide).opacity)) };
			});
			// Keep the transitions in progress so getAnimations can seek the screenshot frames.
			animations.forEach((animation) => {
				animation.currentTime = 60;
			});
			slides.forEach((slide) => getComputedStyle(slide).opacity);
			return { timings, frames };
		}, transition);
		expect(evidence.timings).toHaveLength(2);
		expect(evidence.timings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ duration: 120, delay: 0 }),
				expect.objectContaining({ duration: 120, delay: 120 }),
			]),
		);
		// 10% is the readability cutoff for this regression; incoming text stays at zero until 120ms.
		for (const frame of evidence.frames) {
			expect(
				frame.opacity.filter((opacity) => opacity > 0.1),
				`frame at ${frame.time}ms`,
			).toHaveLength(frame.time === 120 ? 0 : 1);
			if (frame.time <= 120) expect(frame.opacity[1]).toBe(0);
			if (frame.time >= 120) expect(frame.opacity[0]).toBe(0);
		}
		await expect(root.locator('[data-active="false"]')).toHaveAttribute("inert", "");
		await expect(root.locator('[data-active="false"]')).toHaveAttribute("aria-hidden", "true");
		await test.info().attach(`card-${transition}-timing`, {
			body: JSON.stringify(evidence),
			contentType: "application/json",
		});
		for (const time of [60, 180]) {
			await root.locator(".praxity-slides-grid").evaluate((grid, time) => {
				for (const animation of grid.getAnimations({ subtree: true })) animation.currentTime = time;
			}, time);
			await root.screenshot({
				path: test.info().outputPath(`card-${transition}-${time}ms.png`),
				animations: "allow",
			});
		}
		await root.locator(".praxity-slides-grid").evaluate((grid) => {
			for (const animation of grid.getAnimations({ subtree: true })) animation.finish();
		});
		await root.screenshot({
			path: test.info().outputPath(`card-${transition}-end.png`),
			animations: "allow",
		});
	});
}

for (const interruption of [60, 180]) {
	test(`card fade reverses safely after ${interruption}ms and retains boundary focus`, async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "no-preference" });
		await page.goto(`${readTestEnv().url}/design-container-surfaces-light/container-surfaces.html`);
		const root = page.locator("[data-card-root]").filter({ hasText: "Boundary card one" });
		await expect(root).toHaveAttribute("data-card-enhanced", "true");
		await root.scrollIntoViewIfNeeded();
		await root.locator("[data-card-next]").focus();
		const frames = await root.evaluate((node, interruption) => {
			const grid = node.querySelector<HTMLElement>(".praxity-slides-grid");
			if (!grid) throw new Error("Missing slides grid");
			grid.dataset.transition = "fade";
			const slides = Array.from(grid.querySelectorAll<HTMLElement>(".praxity-slides-item"));
			const flush = () => slides.map((slide) => Number(getComputedStyle(slide).opacity));
			flush();
			node.querySelector<HTMLButtonElement>("[data-card-next]")?.click();
			flush();
			for (const animation of grid.getAnimations({ subtree: true })) {
				animation.pause();
				animation.currentTime = interruption;
			}
			flush();
			node.querySelector<HTMLButtonElement>("[data-card-previous]")?.click();
			flush();
			const animations = grid.getAnimations({ subtree: true });
			animations.forEach((animation) => animation.pause());
			const frames = [0, 30, 60, 90, 120, 150, 210, 300].map((time) => {
				animations.forEach((animation) => {
					animation.currentTime = time;
				});
				return flush();
			});
			animations.forEach((animation) => animation.finish());
			return frames;
		}, interruption);
		for (const opacity of frames)
			expect(opacity.filter((value) => value > 0.1).length).toBeLessThanOrEqual(1);
		await expect(root.locator("[data-card-next]")).toBeFocused();
		await expect(root.locator('[data-active="true"]')).toContainText("Boundary card one");
		await expect(root.locator('[data-active="true"]')).toHaveCSS("opacity", "1");
		await expect(root.locator('[data-active="false"]')).toHaveAttribute("inert", "");
	});
}

for (const preference of ["os", "course"] as const) {
	test(`card authored transition choices are instant with ${preference} reduced motion`, async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: preference === "os" ? "reduce" : "no-preference" });
		await page.goto(`${readTestEnv().url}/design-container-surfaces-light/container-surfaces.html`);
		const root = page.locator("[data-card-root]").filter({ hasText: "Boundary card one" });
		await expect(root).toHaveAttribute("data-card-enhanced", "true");
		await root.scrollIntoViewIfNeeded();
		if (preference === "course")
			await root.evaluate((node) => node.setAttribute("data-praxity-reduced-motion", ""));
		const testInfo = test.info();
		for (const transition of ["none", "fade", "slide", "zoom"]) {
			const state = await root.evaluate((node, transition) => {
				const grid = node.querySelector<HTMLElement>(".praxity-slides-grid");
				if (!grid) throw new Error("Missing slides grid");
				grid.dataset.transition = transition;
				const slides = Array.from(grid.querySelectorAll<HTMLElement>(".praxity-slides-item"));
				slides.forEach((slide) => getComputedStyle(slide).opacity);
				node.querySelector<HTMLButtonElement>("[data-card-next]")?.click();
				slides.forEach((slide) => getComputedStyle(slide).opacity);
				return {
					animations: slides.flatMap((slide) => slide.getAnimations()).length,
					transforms: slides.map((slide) => getComputedStyle(slide).transform),
					descendants: grid.getAnimations({ subtree: true }).map((animation) => ({
						target:
							animation.effect instanceof KeyframeEffect &&
							animation.effect.target instanceof Element
								? animation.effect.target.className
								: null,
						property: animation instanceof CSSTransition ? animation.transitionProperty : null,
						timing: animation.effect?.getTiming(),
					})),
					activeOpacity: getComputedStyle(slides[1]).opacity,
				};
			}, transition);
			await testInfo.attach(`${transition}-${preference}-motion`, {
				body: JSON.stringify(state),
				contentType: "application/json",
			});
			expect(state.animations).toBe(0);
			for (const transform of state.transforms) expect(transform).toBe("none");
			expect(state.activeOpacity).toBe("1");
			await root.locator("[data-card-previous]").click();
		}
	});
}

test("static loading and hotspot cues preserve text and graphic controls", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto(`${readTestEnv().url}/design-layout-bounded-motion/bounded-motion.html`);
	const dot = page.getByRole("button", { name: /First area$/ });
	await expect(dot).toBeVisible();
	// Hold a pending placeholder through the natural wait. LazyLoading.test.tsx
	// checks this fallback's actual React markup and both locales.
	const loading =
		'<div class="praxity-block-loading" role="status" style="min-height:3em">Loading…</div>';
	await page
		.locator("#main-content")
		.evaluate((main, html) => main.insertAdjacentHTML("beforeend", html), loading);
	const placeholder = page.locator(".praxity-block-loading");
	await expect(placeholder).toBeVisible();
	for (const cue of [placeholder, dot]) {
		const style = await cue.evaluate((e) => {
			const s = getComputedStyle(e, "::before");
			return { animation: s.animationName, opacity: s.opacity };
		});
		expect(style).toEqual({ animation: "none", opacity: "0.6" });
	}
	await expect(page.getByRole("status")).toHaveText("Loading…");
	await expect(page.getByRole("status")).toHaveCSS("opacity", "1");
	await dot.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByText("First explanation.", { exact: true }).first()).toBeVisible();
	await expect(page.getByRole("button", { name: /Second area$/ })).toBeEnabled();
});

test("rating selection changes digit colors instantly and keeps the native value", async ({
	page,
}) => {
	await page.goto(`${readTestEnv().url}/design-layout-bounded-motion/bounded-motion.html`);
	const input = page.locator(".praxity-rating-input").first();
	await input.focus();
	await page.keyboard.press("Space");
	await expect(input).toBeChecked();
	const digit = page.locator(".praxity-rating-numeric").first();
	const properties = await digit.evaluate((element) =>
		getComputedStyle(element).transitionProperty.split(", "),
	);
	expect(properties).not.toContain("color");
	expect(properties).not.toContain("background-color");
});

test("choice keys select without translating or fading", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto(`${readTestEnv().url}/authoring-catalog/${catalogSlug("choose-one")}.html`);
	const assessment = page.locator('[data-island="assessment"]').first();
	await assessment.scrollIntoViewIfNeeded();
	await expect(assessment).toHaveAttribute("data-hydrated", "");
	await page.evaluate(() => document.fonts.ready);
	const radio = page.locator(".praxity-assessment-choice-option input[type=radio]").first();
	await expect(radio).toBeVisible();
	const key = page.locator(".praxity-choice-key").first();
	const initial = await key.evaluate((element) => {
		const style = getComputedStyle(element);
		const transform = new DOMMatrixReadOnly(style.transform);
		return {
			opacity: style.opacity,
			properties: style.transitionProperty.split(",").map((value) => value.trim()),
			x: transform.e,
			y: transform.f,
		};
	});
	expect(initial.opacity).toBe("1");
	expect(initial.x).toBe(0);
	expect(initial.y).toBe(0);
	expect(initial.properties).not.toContain("opacity");
	expect(initial.properties).not.toContain("transform");
	const before = await key.boundingBox();
	await radio.focus();
	await page.keyboard.press("Space");
	await expect(radio).toBeChecked();
	await expect(key).toHaveCSS("transform", "none");
	await expect(key).toHaveCSS("opacity", "1");
	expect(await key.boundingBox()).toEqual(before);
	await expect(radio).toBeFocused();
});

for (const mode of ["small", "full"]) {
	const query = mode === "small" ? "?minimal=1&praxity-small-preview=1" : "";
	for (const [key, values, selector, property, expected] of [
		[
			"density",
			["compact", "comfortable", "spacious"],
			".praxity-card-body--outline",
			"paddingLeft",
			["0px", "0px", "0px"],
		],
		[
			"borderRadius",
			[0, 3, 6, 10],
			".praxity-card-item",
			"borderTopLeftRadius",
			["0px", "0px", "0px", "0px"],
		],
		["shadowIntensity", ["flat", "subtle", "elevated"], ".praxity-card-item", "boxShadow", null],
	] as const) {
		test(`${mode} retired ${key} keeps fixed card ${property}`, async ({ page }) => {
			const observed: string[] = [];
			for (const value of values) {
				await page.goto(
					`${readTestEnv().url}/design-layout-${key}-${value}/layout-audit.html${query}`,
				);
				const target = page.locator(selector).first();
				await expect(target).toBeVisible();
				observed.push(
					await target.evaluate(
						(element, property) => getComputedStyle(element)[property],
						property,
					),
				);
			}
			if (expected) expect(observed).toEqual(expected);
			else {
				expect(observed[0]).toBe("none");
				expect(observed).toEqual(values.map(() => "none"));
			}
		});
	}
	for (const [key, values, selector] of [
		["blockSpacing", ["compact", "default", "spacious"], '[data-block-type="text"]'],
		["sectionGap", [24, 48, 80], '[data-heading-level="2"]'],
	] as const) {
		test(`${mode} retired ${key} keeps fixed semantic flow geometry`, async ({ page }) => {
			const gaps: number[] = [];
			for (const value of values) {
				await page.goto(
					`${readTestEnv().url}/design-layout-${key}-${value}/layout-audit.html${query}`,
				);
				const target =
					key === "blockSpacing" ? page.locator(selector).nth(1) : page.locator(selector).first();
				gaps.push(
					await target.evaluate((element) => {
						const previous = element.previousElementSibling;
						if (!previous) throw new Error("Missing preceding block");
						return element.getBoundingClientRect().top - previous.getBoundingClientRect().bottom;
					}),
				);
			}
			expect(gaps[0]).toBeGreaterThan(0);
			expect(gaps).toEqual([
				key === "blockSpacing" ? 16 : 64,
				key === "blockSpacing" ? 16 : 64,
				key === "blockSpacing" ? 16 : 64,
			]);
		});
	}
	test(`${mode} saved content widths keep the fixed reading measure and reflow narrowly`, async ({
		page,
	}) => {
		for (const width of [580, 690, 800]) {
			await page.setViewportSize({ width: 1280, height: 800 });
			await page.goto(
				`${readTestEnv().url}/design-layout-contentMaxWidth-${width}/layout-audit.html${query}`,
			);
			const paragraph = page.locator('[data-block-type="text"]').first();
			const geometry = await paragraph.evaluate((element) => {
				const content = element.closest(".praxity-page-content");
				if (!content) throw new Error("Missing content column");
				const style = getComputedStyle(content);
				return {
					column: content.getBoundingClientRect().width,
					paragraph: element.getBoundingClientRect().width,
					padding: Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight),
				};
			});
			const measure = await paragraph.evaluate((element) => {
				const probe = document.createElement("div");
				probe.style.width = "66ch";
				element.append(probe);
				const measure = probe.getBoundingClientRect().width;
				probe.remove();
				return measure;
			});
			expect(geometry.column - geometry.padding).toBeCloseTo(measure, 0);
			expect(geometry.paragraph).toBeCloseTo(measure, 0);
			await page.setViewportSize({ width: 360, height: 800 });
			expect(
				await paragraph.evaluate((element) => element.getBoundingClientRect().width),
			).toBeLessThanOrEqual(360);
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
			).toBeLessThanOrEqual(1);
		}
	});
	for (const reducedMotion of ["no-preference", "reduce"] as const) {
		test(`${mode} entrance modes respect ${reducedMotion}`, async ({ page }) => {
			await page.emulateMedia({ reducedMotion });
			await page.setViewportSize({ width: 1024, height: 250 });
			for (const entrance of ["none", "fade", "slide", "scale"]) {
				await page.goto(
					`${readTestEnv().url}/design-layout-motionEntrance-${entrance}/layout-audit.html${query}`,
				);
				const target = page.locator('[data-block-type="sequence"]');
				if (mode === "small" || reducedMotion === "reduce" || entrance === "none") {
					await expect(target).toHaveCSS("opacity", "1");
					await expect(target).toHaveCSS("transform", "none");
					await target.scrollIntoViewIfNeeded();
					expect(await target.evaluate((element) => element.getAnimations())).toEqual([]);
				} else {
					await expect(target).toHaveAttribute("data-entrance", "pending");
					await expect(target).toHaveCSS("opacity", "0");
					await expect(target).toHaveCSS(
						"transform",
						entrance === "fade"
							? "none"
							: entrance === "slide"
								? "matrix(1, 0, 0, 1, 0, 12)"
								: "matrix(0.985, 0, 0, 0.985, 0, 0)",
					);
					await target.scrollIntoViewIfNeeded();
					await expect(target).toHaveAttribute("data-entrance", "visible");
					await expect(target).toHaveCSS("transition-duration", "0.2s, 0.2s");
					await expect(target).toHaveCSS("opacity", "1");
					await expect(target).toHaveCSS("transform", "none");
					// Returning to an entered block must not re-hide or dim its text.
					await page.locator('[data-block-type="text"]').first().scrollIntoViewIfNeeded();
					await target.scrollIntoViewIfNeeded();
					await expect(target).toHaveCSS("opacity", "1");
				}
			}
		});
	}
	test(`${mode} sequential stagger delays successive items only in active motion`, async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "no-preference" });
		for (const stagger of ["none", "sequential"]) {
			await page.goto(
				`${readTestEnv().url}/design-layout-motionStagger-${stagger}/layout-audit.html${query}`,
			);
			const items = page.locator(".praxity-sequence-item");
			await items.last().scrollIntoViewIfNeeded();
			await expect(items.last()).toHaveCSS("opacity", "1");
			const delays = await items.evaluateAll((elements) =>
				elements.map((element) => getComputedStyle(element).transitionDelay),
			);
			expect(delays).toEqual(
				mode === "full" && stagger === "sequential" ? ["0s", "0.01s"] : ["0s", "0s"],
			);
		}
	});
}
