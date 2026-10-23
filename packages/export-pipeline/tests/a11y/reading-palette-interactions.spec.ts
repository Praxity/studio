import { expect, test } from "@playwright/test";
import { READING_PALETTES } from "@praxity/shared-blocks/themes/reading-palettes";
import { readTestEnv, readThemeVariantUrl, waitForHydration } from "./helpers";

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		document.addEventListener(
			"play",
			(event) => {
				if (event.target instanceof HTMLMediaElement) event.target.muted = true;
			},
			true,
		);
	});
});

for (const locale of ["en", "fr"] as const) {
	for (const storage of ["local", "session", "blocked"] as const) {
		test(`${locale} reading preferences use pressed state alone with ${storage} storage`, async ({
			page,
		}) => {
			if (storage !== "local") {
				await page.addInitScript((blockBoth) => {
					for (const name of blockBoth ? ["localStorage", "sessionStorage"] : ["localStorage"]) {
						Object.defineProperty(window, name, {
							configurable: true,
							get() {
								throw new DOMException("Storage disabled", "SecurityError");
							},
						});
					}
				}, storage === "blocked");
			}
			const baseUrl = `${readTestEnv().url}/visited-status-${locale}-flat`;
			await page.goto(`${baseUrl}/index.html`);
			await waitForHydration(page);
			const labels =
				locale === "en"
					? ["Larger text", "Reading guide"]
					: ["Texte plus grand", "Guide de lecture"];
			const live = page.locator("#praxity-live-region");
			const messages = await live.evaluateHandle((region) => {
				const messages: string[] = [];
				const observer = new MutationObserver(() => messages.push(region.textContent ?? ""));
				observer.observe(region, { childList: true, characterData: true, subtree: true });
				return { messages, observer };
			});
			const initialFontSize = await page
				.locator("main")
				.evaluate((main) => Number.parseFloat(getComputedStyle(main).fontSize));
			for (const label of labels) {
				const button = page.getByRole("button", { name: label, exact: true });
				await expect(button).toHaveAttribute("aria-pressed", "false");
				await button.focus();
				for (const key of ["Enter", "Space", "Enter"]) {
					await button.press(key);
					await expect(button).toHaveAccessibleName(label);
					await expect(button).toHaveAttribute("aria-pressed", key === "Space" ? "false" : "true");
					await expect(button).toBeFocused();
				}
			}
			await expect(page.locator("html")).toHaveAttribute("data-praxity-text-size", "large");
			await expect(page.locator("html")).toHaveAttribute("data-praxity-focus-mode", "true");
			expect(
				await page
					.locator("main")
					.evaluate((main) => Number.parseFloat(getComputedStyle(main).fontSize)),
			).toBeGreaterThan(initialFontSize);
			expect(
				await messages.evaluate(async ({ messages }) => {
					await new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					);
					return messages;
				}),
			).toEqual([]);
			await messages.evaluate(({ observer }) => observer.disconnect());
			const next = page.locator(".praxity-native-page-nav .praxity-nav-next");
			const nextHref = await next.getAttribute("href");
			if (!nextHref) throw new Error("Missing next page destination");
			const nextUrl = new URL(nextHref, page.url()).href;
			await next.focus();
			await next.press("Enter");
			await page.waitForURL(nextUrl);
			await waitForHydration(page);
			// Arrival orients through heading focus alone. Without session storage the
			// focus request cannot cross the document load, so arrival behaves like a
			// direct visit and the reader starts at the document title.
			const heading = page.locator("#main-content h1").first();
			await expect(heading).toHaveText(
				locale === "en" ? "Check your understanding" : "Vérifiez votre compréhension",
			);
			if (storage === "blocked") await expect(heading).not.toBeFocused();
			else await expect(heading).toBeFocused();
			await page.waitForTimeout(300);
			await expect(live).toBeEmpty();
			for (const label of labels) {
				await expect(page.getByRole("button", { name: label, exact: true })).toHaveAttribute(
					"aria-pressed",
					storage === "blocked" ? "false" : "true",
				);
			}
			if (storage !== "blocked") {
				await expect(page.locator("html")).toHaveAttribute("data-praxity-text-size", "large");
				await expect(page.locator("html")).toHaveAttribute("data-praxity-focus-mode", "true");
			}
			await test.info().attach("hydrated-accessibility", {
				body: await page.locator("body").ariaSnapshot(),
				contentType: "text/yaml",
			});
		});
	}
}

test("Guided Larger text keeps its French name and pressed state without live speech", async ({
	page,
}) => {
	const url = readTestEnv().frenchMatrixUrls?.[1];
	if (!url) throw new Error("Missing French Guided fixture");
	await page.goto(url);
	await expect(page.locator("#deck-next")).toBeVisible();
	await page.getByRole("button", { name: "Outils", exact: true }).click();
	const button = page.getByRole("button", { name: "Texte plus grand", exact: true });
	const live = page.locator("#praxity-live-region");
	await expect(live).toBeEmpty();
	await button.focus();
	for (const key of ["Enter", "Space", "Enter"]) {
		await button.press(key);
		await expect(button).toHaveAccessibleName("Texte plus grand");
		await expect(button).toHaveAttribute("aria-pressed", key === "Space" ? "false" : "true");
		await expect(live).toBeEmpty();
	}
	await page.reload();
	await page.getByRole("button", { name: "Outils", exact: true }).click();
	await expect(button).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator("html")).toHaveAttribute("data-praxity-text-size", "large");
	await expect(live).toBeEmpty();
	await test.info().attach("hydrated-accessibility", {
		body: await page.locator("body").ariaSnapshot(),
		contentType: "text/yaml",
	});
});

test("Reading guide still dims inactive content and clears the effect when disabled", async ({
	page,
}) => {
	// A compact no-hover page that fits without scrolling intentionally leaves all
	// rows readable. Linux headless Firefox reports no hover (Mozilla bug 2037020),
	// so exercise the guide on a scrollable page rather than assuming mouse input.
	await page.setViewportSize({ width: 1280, height: 500 });
	const baseUrl = readThemeVariantUrl("light");
	if (!baseUrl) throw new Error("Missing reading fixture");
	await page.goto(`${baseUrl}/page-2.html`);
	await waitForHydration(page);
	const live = page.locator("#praxity-live-region");
	await expect(live).toBeEmpty();
	const guide = page.getByRole("button", { name: "Reading guide", exact: true });
	const geometry = await page.evaluate(() => ({
		scrollHeight: document.documentElement.scrollHeight,
		viewportHeight: window.innerHeight,
		hover: window.matchMedia("(hover: hover)").matches,
	}));
	expect(geometry.scrollHeight).toBeGreaterThan(geometry.viewportHeight + 4);
	await test.info().attach("reading-guide-viewport", {
		body: JSON.stringify(geometry),
		contentType: "application/json",
	});
	await expect(guide).toHaveAttribute("aria-pressed", "false");
	await guide.focus();
	await guide.press("Enter");
	await expect(guide).toHaveAttribute("aria-pressed", "true");
	await expect(guide).toBeFocused();
	const dimmed = page.locator("main [data-focus-dimmed]").first();
	await expect(dimmed).toBeVisible();
	await expect
		.poll(() => dimmed.evaluate((row) => Number.parseFloat(getComputedStyle(row).opacity)))
		.toBeLessThan(1);
	await expect(live).toBeEmpty();
	await guide.press("Space");
	await expect(guide).toHaveAttribute("aria-pressed", "false");
	await expect(guide).toBeFocused();
	await expect(page.locator("main [data-focus-dimmed]")).toHaveCount(0);
	await expect(live).toBeEmpty();
	await test.info().attach("hydrated-accessibility", {
		body: await page.locator("body").ariaSnapshot(),
		contentType: "text/yaml",
	});
});

const THEMES = [
	{ id: "ink", name: "Ink", body: "Source Sans 3", heading: "Source Sans 3" },
	{ id: "forest", name: "Forest", body: "Source Sans 3", heading: "Source Sans 3" },
	{ id: "plum", name: "Plum", body: "Source Sans 3", heading: "Source Sans 3" },
	{ id: "clay", name: "Clay", body: "Source Sans 3", heading: "Source Sans 3" },
	{
		id: "clear",
		name: "Clear",
		body: "Atkinson Hyperlegible Next",
		heading: "Atkinson Hyperlegible Next",
	},
	{ id: "clean", name: "Legacy Minimal", body: "Source Sans 3", heading: "Source Sans 3" },
	{ id: "waves", name: "Legacy Waves", body: "Source Sans 3", heading: "Source Sans 3" },
	{ id: "standard", name: "Legacy Standard", body: "Source Sans 3", heading: "Source Sans 3" },
	{ id: "bauhaus", name: "Legacy Bauhaus", body: "Source Sans 3", heading: "Source Sans 3" },
	{ id: "campfire", name: "Legacy Campfire", body: "Source Sans 3", heading: "Source Sans 3" },
	{ id: "darkroom", name: "Legacy Darkroom", body: "Source Sans 3", heading: "Source Sans 3" },
] as const;

for (const theme of THEMES) {
	for (const mode of ["light", "dark"] as const) {
		const variant = theme.id === "standard" ? mode : `${theme.id}-${mode}`;

		test(`${theme.name} ${mode} keeps hydrated fonts and narrow controls usable`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: 320, height: 800 });
			await page.route("**/*", (route) =>
				["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
					? route.continue()
					: route.abort(),
			);
			const baseUrl = readThemeVariantUrl(variant);
			expect(baseUrl, `Missing theme fixture '${variant}'`).toBeTruthy();
			if (!baseUrl) throw new Error(`Missing theme fixture '${variant}'`);

			await page.goto(`${baseUrl}/page-2.html`, { waitUntil: "domcontentloaded" });
			await waitForHydration(page);

			const fontEvidence = await page.evaluate(async (theme) => {
				const sample = "Équité et compréhension : développer des connaissances transférables";
				const h2 = Array.from(document.querySelectorAll("main h2:not(.praxity-sr-only)")).find(
					(heading) => heading.getBoundingClientRect().width > 0,
				);
				if (!h2) throw new Error("Missing sample heading");
				h2.textContent = sample;
				const h3 = document.createElement("h3");
				h3.textContent = "Précisions et étapes suivantes";
				h2.after(h3);
				const requests = [
					[400, theme.body],
					[theme.id === "clear" ? 800 : 600, theme.heading],
					[600, theme.body],
				] as const;
				const loaded = await Promise.all(
					requests.map(async ([weight, family]) => {
						const faces = await document.fonts.load(`${weight} 20px "${family}"`, sample);
						return {
							family,
							weight,
							count: faces.length,
							loaded: faces.every((face) => face.status === "loaded"),
						};
					}),
				);
				await document.fonts.ready;
				return {
					loaded,
					heading: getComputedStyle(h2).fontFamily,
					smallHeading: getComputedStyle(h3).fontFamily,
					fontUrls: performance
						.getEntriesByType("resource")
						.map((entry) => entry.name)
						.filter((name) => /\.woff2?/.test(name)),
				};
			}, theme);
			for (const face of fontEvidence.loaded) {
				expect(face.count, `${face.family} ${face.weight} bundled faces`).toBeGreaterThan(0);
				expect(face.loaded).toBe(true);
			}
			expect(fontEvidence.heading).toContain(theme.heading);
			expect(fontEvidence.smallHeading).toContain(theme.heading);
			expect(fontEvidence.fontUrls.length).toBeGreaterThan(0);
			await test.info().attach("offline-fonts", {
				body: JSON.stringify(fontEvidence),
				contentType: "application/json",
			});
			await test.info().attach("french-heading-mobile", {
				body: await page.screenshot({ fullPage: true }),
				contentType: "image/png",
			});

			const palette = READING_PALETTES[theme.id][mode];
			const renderedTheme = await page.evaluate(() => {
				const root = getComputedStyle(document.documentElement);
				const navigation = document.querySelector<HTMLElement>(".praxity-native-outline");
				if (!navigation) throw new Error("Missing native course outline");
				const normalize = (value: string): string => {
					const canvas = document.createElement("canvas");
					canvas.width = canvas.height = 1;
					const context = canvas.getContext("2d");
					if (!context) throw new Error("Canvas unavailable");
					context.fillStyle = value;
					context.fillRect(0, 0, 1, 1);
					return `#${Array.from(context.getImageData(0, 0, 1, 1).data)
						.slice(0, 3)
						.map((channel) => channel.toString(16).padStart(2, "0"))
						.join("")}`;
				};
				const config = JSON.parse(
					document.getElementById("praxity-config")?.textContent ?? "{}",
				) as { colorShades?: Record<string, string[]> };
				return {
					mode: document.documentElement.dataset.praxityMode,
					background: normalize(root.getPropertyValue("--praxity-color-background")),
					navigationSurface: normalize(root.getPropertyValue("--praxity-color-navigation-surface")),
					navigationBackground: normalize(getComputedStyle(navigation).backgroundColor),
					colorShadeLengths: Object.values(config.colorShades ?? {}).map((shades) => shades.length),
					overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
				};
			});
			expect(renderedTheme.mode).toBe(mode);
			expect(renderedTheme.background).toBe(palette.colorBackground);
			expect(renderedTheme.navigationBackground).toBe(renderedTheme.navigationSurface);
			expect(renderedTheme.navigationSurface).toBe(palette.colorNavigationSurface);
			expect(renderedTheme.colorShadeLengths).toEqual([10, 10, 10, 10]);
			expect(renderedTheme.overflow).toBeLessThanOrEqual(1);

			if (["clean", "waves", "darkroom"].includes(theme.id)) {
				await page.setViewportSize({ width: 1280, height: 900 });
				await test.info().attach("french-heading-desktop", {
					body: await page.screenshot({ fullPage: true }),
					contentType: "image/png",
				});
				await page.setViewportSize({ width: 320, height: 800 });
			}

			const next = page.locator(".praxity-native-page-nav .praxity-nav-next");
			await next.focus();
			await Promise.all([
				page.waitForURL((url) => url.pathname.endsWith("/page-three-assessment.html")),
				next.press("Enter"),
			]);
			await waitForHydration(page);

			const assessment = page
				.locator(".praxity-block-assessment[data-assessment-display]")
				.filter({ hasText: "Which answer is correct?" });
			const assessmentIsland = page
				.locator('[data-island="assessment"]')
				.filter({ hasText: "Which answer is correct?" });
			await assessmentIsland.scrollIntoViewIfNeeded();
			await expect(assessmentIsland).toHaveAttribute("data-hydrated", "");
			// Minimal light and Plum dark cover the shared answer cycle across both modes
			// and the distinctive serif/font fallback. Every palette retains its layout checks.
			const answerJourney =
				(theme.id === "clean" && mode === "light") || (theme.id === "darkroom" && mode === "dark");
			if (answerJourney) {
				const wrong = assessment.getByRole("radio", { name: "Wrong answer A" });
				await wrong.focus();
				await page.keyboard.press("Space");
				await expect(wrong).toBeChecked();
				await expect(wrong).toBeFocused();
			}

			const submit = assessment
				.locator("[data-assessment-submit='true']:visible")
				.or(page.locator("button.praxity-ag-submit-btn:visible"))
				.first();
			const buttonColors = await submit.evaluate((button) => {
				const style = getComputedStyle(button);
				const root = getComputedStyle(document.documentElement);
				const normalize = (value: string): string => {
					const canvas = document.createElement("canvas");
					canvas.width = canvas.height = 1;
					const context = canvas.getContext("2d");
					if (!context) throw new Error("Canvas unavailable");
					context.fillStyle = value;
					context.fillRect(0, 0, 1, 1);
					return `#${Array.from(context.getImageData(0, 0, 1, 1).data)
						.slice(0, 3)
						.map((channel) => channel.toString(16).padStart(2, "0"))
						.join("")}`;
				};
				return {
					background: normalize(style.backgroundColor),
					color: normalize(style.color),
					expectedBackground: normalize(root.getPropertyValue("--praxity-color-button-background")),
					expectedColor: normalize(root.getPropertyValue("--praxity-color-button-text")),
				};
			});
			expect(buttonColors.background).toBe(buttonColors.expectedBackground);
			expect(buttonColors.color).toBe(buttonColors.expectedColor);

			if (answerJourney) {
				await submit.click();
				await expect(assessment).toHaveAttribute("data-result", "incorrect");
				const feedback = assessment.locator("[data-assessment-feedback]");
				const retry = assessment.getByRole("button", { name: "Try again", exact: true });
				await expect(retry).toBeFocused();
				await expect(retry).toHaveAccessibleDescription("Not quite");
				await expect(feedback.locator("[data-assessment-status]")).toHaveText(
					"1 of 2 attempts used",
				);
				const result = assessment.locator(".praxity-choice-status").first();
				await expect(result).toContainText("Not quite");
				const errorColor = await result.evaluate((element) => getComputedStyle(element).color);

				await assessment.getByRole("button", { name: "Try again" }).click();
				await expect(assessment.getByRole("radio").first()).toBeFocused();
				await assessment.getByRole("radio", { name: "Correct answer" }).check();
				await assessment
					.locator("[data-assessment-submit='true']:visible")
					.or(page.locator("button.praxity-ag-submit-btn:visible"))
					.first()
					.click();
				await expect(assessment).toHaveAttribute("data-result", "correct");
				await expect(
					assessment.locator("[data-assessment-retry], [data-assessment-continue]"),
				).toHaveCount(0);
				await expect(feedback.locator("[data-assessment-status]")).toBeFocused();
				await expect(feedback.locator("[data-assessment-status]")).toHaveAttribute(
					"tabindex",
					"-1",
				);
				await expect(feedback.locator("[data-assessment-status]")).toHaveText(
					"2 of 2 attempts used",
				);
				await expect(result).toContainText("Correct");
				expect(await result.evaluate((element) => getComputedStyle(element).color)).not.toBe(
					errorColor,
				);
			}

			const matchingControls = page.locator(".praxity-matching-select input");
			await expect(matchingControls).toHaveCount(2);
			for (const select of await matchingControls.all()) {
				const overflow = await select.evaluate((input) => {
					const grid = input.closest(".praxity-matching-grid");
					if (!grid) throw new Error("Missing matching grid");
					return input.getBoundingClientRect().right - grid.getBoundingClientRect().right;
				});
				expect(overflow, "Matching control stays inside its card").toBeLessThanOrEqual(1);
			}

			const response = page.getByRole("textbox", { name: "Reflection" });
			await response.fill("The controls remain readable.");
			await expect(response).toBeFocused();
			await expect(response).toHaveValue("The controls remain readable.");
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
				),
			).toBeLessThanOrEqual(1);

			await test.info().attach("final-screen", {
				body: await page.screenshot({ fullPage: true }),
				contentType: "image/png",
			});
		});
	}
}
