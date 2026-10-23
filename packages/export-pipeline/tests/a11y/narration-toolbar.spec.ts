import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { narrationPlaylistFromConfig } from "../../src/narration-playlist";
import { analyzeAxe, readTestEnv, waitForHydration } from "./helpers";

for (const width of [390, 900, 1280]) {
	for (const locale of ["en", "fr"] as const) {
		test(`Pages reading guide depicts a highlighted text band at ${width}px in ${locale}`, async ({
			page,
		}) => {
			const labels =
				locale === "fr"
					? { guide: "Guide de lecture", larger: "Texte plus grand" }
					: { guide: "Reading guide", larger: "Larger text" };
			await page.setViewportSize({ width, height: 900 });
			const fixture =
				locale === "fr"
					? "visited-status-fr-flat/introduction.html"
					: "sidebar-narration/narrated-slide.html";
			await page.goto(`${readTestEnv().url}/${fixture}`);
			await waitForHydration(page);
			const guide = page.getByRole("button", { name: labels.guide, exact: true });
			const larger = page.getByRole("button", { name: labels.larger, exact: true });
			const icon = guide.locator("svg");
			await expect(guide).toBeVisible();
			await expect(guide).toHaveAttribute("aria-pressed", "false");
			await expect(icon).toHaveAttribute("aria-hidden", "true");
			await expect(icon).toHaveAttribute("viewBox", "0 0 24 24");
			const band = icon.locator("rect");
			await expect(band).toHaveCount(1);
			for (const [attribute, value] of Object.entries({
				x: "3",
				y: "9",
				width: "18",
				height: "6",
				rx: "1",
			})) {
				await expect(band).toHaveAttribute(attribute, value);
			}
			for (const row of ["M4 5h16", "M7 12h10", "M4 19h16"]) {
				await expect(icon.locator(`path[d="${row}"]`)).toHaveCount(1);
			}
			for (const textSize of ["default", "large"]) {
				if (textSize === "large") {
					await larger.focus();
					await page.keyboard.press("Enter");
					await expect(larger).toHaveAttribute("aria-pressed", "true");
				}
				await guide.focus();
				await page.keyboard.press("Space");
				await expect(guide).toHaveAttribute("aria-pressed", "true");
				await expect(guide).toHaveAttribute("data-active", "");
				await expect(guide).toHaveAccessibleName(labels.guide);
				await expect(guide).toBeFocused();
				const drawing = await icon.evaluate((svg) => {
					const marks = [...svg.querySelectorAll("rect, path")];
					return marks.map((mark) => {
						const box = mark.getBoundingClientRect();
						const style = getComputedStyle(mark);
						return {
							width: box.width,
							painted: style.stroke !== "none" || style.fill !== "none",
							display: style.display,
							visibility: style.visibility,
							opacity: Number(style.opacity),
						};
					});
				});
				for (const mark of drawing) {
					expect(mark.width).toBeGreaterThan(0);
					expect(mark.painted).toBe(true);
					expect(mark.display).not.toBe("none");
					expect(mark.visibility).toBe("visible");
					expect(mark.opacity).toBeGreaterThan(0);
				}
				await page.keyboard.press("Enter");
				await expect(guide).toHaveAttribute("aria-pressed", "false");
				await expect(guide).not.toHaveAttribute("data-active");
				await expect(guide).toHaveAccessibleName(labels.guide);
			}
			if (locale === "en") {
				await page.getByRole("button", { name: "Listen", exact: true }).click();
				const controls = page.locator(".praxity-narration-controls");
				if (width < 768) {
					await controls.getByRole("button", { name: "Narration options", exact: true }).click();
				}
				const follow = controls.getByRole("button", { name: "Follow narration", exact: true });
				await expect(follow).toBeVisible();
				await expect(follow).toHaveAttribute("aria-pressed", "true");
				await expect(follow.locator("svg rect")).toHaveCount(0);
				await expect(follow.locator('svg path[d="M7 12h10"]')).toHaveCount(0);
				await follow.focus();
				await page.keyboard.press("Space");
				await expect(follow).toHaveAttribute("aria-pressed", "false");
				await expect(follow).toHaveAccessibleName("Follow narration");
			}
		});
	}
}

for (const feature of [
	"plain",
	"tooltip",
	"footnote",
	"icon",
	"mark",
	"doodle",
	"highlight-doodle",
	"heading",
]) {
	const tooltip = feature === "tooltip";
	const inline = {
		plain: "read",
		tooltip:
			'<span class="inline-tooltip-trigger" data-tooltip-enhanced="" data-tooltip-content="Follow the written instructions.">read<span class="inline-tooltip-fallback"> (Follow the written instructions.)</span><span class="praxity-sr-only praxity-definition-cue"> has definition</span></span>',
		footnote:
			'read<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup>',
		icon: 'read<svg data-praxity-inline-icon="check" aria-hidden="true" focusable="false"><title>Check</title><path d="M1 1 L2 2" /></svg>',
		mark: "<mark>read</mark>",
		doodle: '<span class="praxity-doodle" data-doodle="underline">read</span>',
		"highlight-doodle": '<span class="praxity-doodle" data-doodle="highlight">read</span>',
	}[feature];
	test(`formatted list narration preserves cue text and authored annotations (${feature})`, async ({
		page,
	}) => {
		const cue = "Target sentence: read carefully.";
		const heading = feature === "heading";
		await page.route("**/highlight.vtt", (route) =>
			route.fulfill({
				contentType: "text/vtt",
				body: `WEBVTT\n\n00:00:00.000 --> 00:00:10.000\n${cue}`,
			}),
		);
		await page.route("**/sidebar-narration/narrated-slide.html", async (route) => {
			const response = await route.fetch();
			let html = await response.text();
			html = html.replace(
				/(<script[^>]*id="praxity-config"[^>]*>)([\s\S]*?)(<\/script>)/u,
				(_match, open, json, close) => {
					const config = JSON.parse(json);
					const narrated = config.blocks.find(
						(block: { data: { narrationAudio?: string } }) => block.data.narrationAudio,
					);
					expect(narrated).toBeTruthy();
					config.blocks = [
						...(heading
							? [
									{
										id: "before-heading",
										type: "text",
										data: {
											content: "Earlier narration.",
											narrationAudio: `${narrated.data.narrationAudio}?before=1`,
											narrationDuration: 10,
										},
									},
								]
							: []),
						{
							id: "highlight-list",
							type: heading ? "heading" : "text",
							data: {
								content: cue,
								...(heading ? { level: 1 } : {}),
								narrationAudio: narrated.data.narrationAudio,
								narrationTimings: "highlight.vtt",
								narrationDuration: 10,
							},
						},
					];
					config.narrationPlaylist = narrationPlaylistFromConfig(config);
					expect(config.narrationPlaylist?.items).toContainEqual(
						expect.objectContaining({ blockId: "highlight-list", timingsSrc: "highlight.vtt" }),
					);
					return `${open}${JSON.stringify(config)}${close}`;
				},
			);
			html = html.replace(
				"</main>",
				heading
					? `<div data-block-id="highlight-list"><h1 id="target-sentence">${cue.slice(0, -1)}</h1></div></main>`
					: `<ul data-block-id="highlight-list">
			<li id="previous-sentence"><span aria-hidden="true">✓</span><strong>Previous</strong>  sentence with <span>annotations</span> and its tail.\n</li>
			<li id="target-sentence"><span aria-hidden="true">✓</span>\n  <strong>Target sentence</strong>: ${inline}\n   <span>carefully</span>.  </li>
		</ul></main>`,
			);
			await route.fulfill({ response, body: html });
		});
		// Keep the playhead still while inspecting the real browser Highlight and Range.
		await page.addInitScript(() => {
			HTMLMediaElement.prototype.play = async () => {};
		});
		await page.goto(`${readTestEnv().url}/sidebar-narration/narrated-slide.html`);
		await waitForHydration(page);
		if (tooltip) {
			await expect(page.locator("#target-sentence .inline-tooltip-trigger")).toHaveAttribute(
				"data-tooltip-enhanced",
				"",
			);
			await expect(page.locator("#target-sentence .inline-tooltip-fallback")).toBeHidden();
		}
		await page.getByRole("button", { name: "Listen", exact: true }).click();
		if (heading) {
			const target = page.locator("#target-sentence");
			await target.scrollIntoViewIfNeeded();
			const point = await target.evaluate((element) => {
				const range = document.createRange();
				range.selectNodeContents(element);
				const rect = range.getClientRects()[0];
				return { x: rect.left + 5, y: rect.top + rect.height / 2 };
			});
			await page.mouse.move(point.x, point.y);
			await expect
				.poll(() =>
					page.evaluate(() => {
						const range = CSS.highlights.get("praxity-narration-hover")?.values().next().value as
							| Range
							| undefined;
						return range?.toString();
					}),
				)
				.toBe(cue.slice(0, -1));
			await page.getByRole("button", { name: "Play", exact: true }).click();
			await expect(page.locator("audio[data-narration-player]")).toHaveAttribute(
				"src",
				/before=1/u,
			);
			await page.mouse.click(point.x, point.y);
			await expect(page.locator("audio[data-narration-player]")).not.toHaveAttribute(
				"src",
				/before=1/u,
			);
			await expect
				.poll(() =>
					page.evaluate(() => {
						const range = CSS.highlights.get("praxity-narration-current")?.values().next().value as
							| Range
							| undefined;
						return range?.toString();
					}),
				)
				.toBe(cue.slice(0, -1));
			return;
		}
		const doodle = feature.endsWith("doodle");
		const decorationOffset = () =>
			page.locator("#target-sentence [data-doodle]").evaluate((element) => {
				const style = getComputedStyle(element);
				return {
					position: style.position,
					line: style.textDecorationLine,
					background: style.backgroundColor,
				};
			});
		if (doodle) {
			await expect(page.locator("#target-sentence svg.rough-annotation")).toHaveCount(0);
			expect((await decorationOffset()).position).toBe("static");
		}
		const before = doodle ? await decorationOffset() : null;
		await page.getByRole("button", { name: "Play", exact: true }).click();

		await expect
			.poll(() =>
				page.evaluate(() => {
					const range = CSS.highlights.get("praxity-narration-current")?.values().next().value as
						| Range
						| undefined;
					if (!range) return null;
					const target = document.getElementById("target-sentence");
					return {
						text: (() => {
							const selected = range.cloneContents();
							for (const supplemental of selected.querySelectorAll(
								".inline-tooltip-fallback, .praxity-definition-cue, .praxity-footnote-ref, svg",
							))
								supplemental.remove();
							return selected.textContent;
						})(),
						startInside: target?.contains(range.startContainer),
						endInside: target?.contains(range.endContainer),
						includesPrevious: range.intersectsNode(
							document.getElementById("previous-sentence") as HTMLElement,
						),
						startOffset: range.startOffset,
						endOffset: range.endOffset,
					};
				}),
			)
			.toEqual({
				text: "Target sentence: read\n   carefully.",
				startInside: true,
				endInside: true,
				includesPrevious: false,
				startOffset: 0,
				endOffset: 1,
			});
		await expect(page.locator('[data-block-id="highlight-list"]')).not.toHaveAttribute(
			"data-narration-active",
		);
		if (doodle) {
			expect(await decorationOffset()).toEqual(before);
			await page.getByRole("button", { name: "Pause", exact: true }).click();
			expect(await decorationOffset()).toEqual(before);
			// Missing timings and forced colors use the same fallback marker.
			await page.locator('[data-block-id="highlight-list"]').evaluate((element) => {
				element.setAttribute("data-narration-active", "true");
			});
			expect(await decorationOffset()).toEqual(before);
		}
	});
}

for (const width of [320, 360, 430, 740, 1200]) {
	test(`sidebar narration stays grouped and operable at ${width}px`, async ({
		page,
		browserName,
	}) => {
		await page.setViewportSize({ width, height: 800 });
		await page.goto(`${readTestEnv().url}/sidebar-narration/narrated-slide.html`);
		await waitForHydration(page);
		const header = page.locator(".praxity-top-bar-fallback > header");
		const listen = page.getByRole("button", { name: "Listen", exact: true });
		await expect(listen).toBeVisible();
		expect(
			await header.evaluate((element) => element.getBoundingClientRect().height),
		).toBeLessThanOrEqual(60);
		await listen.click();
		const controls = page.locator(".praxity-narration-controls");
		await expect(controls).toBeVisible();
		expect(
			await controls.evaluate((element) => element.getBoundingClientRect().top),
		).toBeGreaterThanOrEqual(
			await listen.evaluate((element) => element.getBoundingClientRect().bottom),
		);
		if (width < 768) {
			const options = controls.getByRole("button", { name: "Narration options", exact: true });
			const nextSentence = controls.getByRole("button", { name: "Next sentence", exact: true });
			await expect(nextSentence).toBeHidden();
			const primary = await controls.locator("button:visible, input").evaluateAll((elements) =>
				elements.map((element) => {
					const box = element.getBoundingClientRect();
					return { top: box.top, width: box.width, height: box.height };
				}),
			);
			expect(primary).toHaveLength(3);
			for (const box of primary) {
				expect(Math.abs(box.top - primary[0].top)).toBeLessThanOrEqual(1);
				expect(box.width).toBeGreaterThanOrEqual(44);
				expect(box.height).toBeGreaterThanOrEqual(44);
			}
			await options.focus();
			await page.keyboard.press("Enter");
			await expect(options).toHaveAttribute("aria-expanded", "true");
			await expect(options).toBeFocused();
			await page.keyboard.press(
				browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab",
			);
			await expect(
				controls.getByRole("button", { name: "Previous sentence", exact: true }),
			).toBeFocused();
			for (const button of await controls.locator(".praxity-narration-options button").all()) {
				const box = await button.boundingBox();
				expect(box?.width).toBeGreaterThanOrEqual(44);
				expect(box?.height).toBeGreaterThanOrEqual(44);
			}
			await options.focus();
			await page.keyboard.press("Space");
			await expect(nextSentence).toBeHidden();
			await expect(options).toBeFocused();
		}
		// Every control owns its hit target; wrapping must never cover a sibling.
		const geometry = await header.evaluate((element) => {
			const headerBox = element.getBoundingClientRect();
			return [...element.querySelectorAll<HTMLElement>("button, input")]
				.filter((control) => control.getClientRects().length > 0)
				.map((control) => {
					const box = control.getBoundingClientRect();
					return {
						label: control.getAttribute("aria-label"),
						inside: box.left >= 0 && box.right <= innerWidth && box.bottom <= headerBox.bottom,
						hit: control.contains(
							document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
						),
					};
				});
		});
		for (const control of geometry) {
			expect(control.inside, control.label ?? "control bounds").toBe(true);
			expect(control.hit, control.label ?? "control hit target").toBe(true);
		}
		await listen.focus();
		// macOS WebKit uses Option+Tab to include buttons in keyboard navigation.
		await page.keyboard.press(
			browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab",
		);
		await expect(controls.getByRole("button", { name: "Play", exact: true })).toBeFocused();
		expect(
			(await analyzeAxe(page, new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"])))
				.violations,
		).toEqual([]);
		await page.screenshot({ path: test.info().outputPath(`narration-${width}.png`) });
		if (width < 1024) {
			await page.locator(".praxity-native-menu-toggle").click();
		}
		const selected = page.locator(".praxity-native-outline a[aria-current='page']");
		await expect(selected).toBeVisible();
		await expect(selected).toHaveCSS("border-radius", "0px");
		// Switch to keyboard input before checking the focus-visible outline.
		await page.keyboard.press(
			browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab",
		);
		await selected.focus();
		await expect(selected).toHaveCSS("outline-style", "solid");
		if (width < 768) {
			await page.keyboard.press("Escape");
			// Reading tools remain available when the course has no outline trigger.
			await page.locator(".praxity-native-menu-toggle").evaluate((element) => element.remove());
			await expect(listen).toBeVisible();
		}
	});
}

test("fallback narration marker occupies the gutter in both reading directions", async ({
	page,
}) => {
	await page.goto(`${readTestEnv().url}/sidebar-narration/narrated-slide.html`);
	await waitForHydration(page);
	await page.getByRole("button", { name: "Listen", exact: true }).click();
	await page.getByRole("button", { name: "Play", exact: true }).click();
	const block = page.locator("[data-narration-active='true']");
	await expect(block).toHaveCount(1);
	for (const direction of ["ltr", "rtl"]) {
		await page.evaluate((dir) => {
			document.documentElement.dir = dir;
		}, direction);
		const marker = await block.evaluate((element) => {
			const style = getComputedStyle(element, "::before");
			return {
				start: style.insetInlineStart,
				width: style.width,
				pointerEvents: style.pointerEvents,
			};
		});
		expect(marker).toEqual({ start: "-12px", width: "3px", pointerEvents: "none" });
	}
	expect(
		await page.evaluate(() => {
			const turn = document.createElement("div");
			turn.className = "praxity-dialogue-turn";
			turn.setAttribute("aria-current", "true");
			document.body.append(turn);
			const right = getComputedStyle(turn, "::before").right;
			turn.remove();
			return right;
		}),
	).toBe("-12px");
	await page.getByRole("button", { name: "Pause", exact: true }).click();
	await expect(block).toHaveCount(0);
});
