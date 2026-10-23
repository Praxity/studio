import { mkdir, readFile } from "node:fs/promises";
import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "../muted-test";
import { readTestEnv } from "./helpers";

async function open(page: Page, palette: string, title: string) {
	const env = readTestEnv();
	const base = env.coursePages?.[`${env.url}/${palette}`]
		? `${env.url}/${palette}`
		: (env.fullFixtureVariants?.[`theme-${palette.endsWith("dark") ? "dark" : "light"}`] ??
			env.url);
	const entry = env.coursePages?.[base]?.find((p) => p.title === title);
	if (!entry) throw new Error(`Missing ${title} in ${palette}`);
	await page.goto(`${base}/${entry.slug}.html?praxity-resume=0`);
}

async function capture(block: Locator, name: string) {
	const directory = process.env.DISCLOSURE_SCREENSHOTS;
	if (!directory || test.info().project.name !== "chromium") return;
	await mkdir(directory, { recursive: true });
	await block.scrollIntoViewIfNeeded();
	await block.hover();
	await expect(block).not.toHaveAttribute("data-entrance", "pending");
	for (const video of await block.locator("video").all()) {
		// Decode the tiny local fixture before capturing native browser controls.
		await video.evaluate(async (element: HTMLVideoElement) => {
			await element.play();
			element.pause();
		});
	}
	await expect
		.poll(() =>
			block.evaluate(
				(element) =>
					element
						.getAnimations({ subtree: true })
						.filter((animation) => animation.playState === "running").length,
			),
		)
		.toBe(0);
	await block.screenshot({ path: `${directory}/${name}.png` });
}

async function expectDisclosureAffordance(block: Locator) {
	const buttons = block.locator(".praxity-tabs-tab");
	for (const button of await buttons.all()) {
		expect.soft(await button.locator("svg.praxity-disclosure-icon").count()).toBe(1);
		await expect.soft(button).toHaveCSS("font-weight", "600");
		await expect(button).toHaveCSS("padding", "12px 4px");
		const geometry = await button.evaluate((element) => {
			const icon = element.querySelector("svg");
			const label = element.querySelector(".praxity-disclosure-title");
			if (!icon || !label) throw new Error("Missing disclosure chevron or label");
			return {
				icon: icon.getBoundingClientRect().right,
				label: label.getBoundingClientRect().left,
			};
		});
		expect(geometry.icon).toBeLessThan(geometry.label);
		expect
			.soft(
				await button.evaluate((element) => {
					const style = getComputedStyle(element);
					const probe = document.createElement("span");
					probe.style.color = "var(--ink)";
					element.append(probe);
					const ink = getComputedStyle(probe).color;
					probe.remove();
					return style.color === ink;
				}),
			)
			.toBe(true);
	}
	const borders = await block.evaluate((root) => {
		const lines: number[] = [];
		for (const element of root.querySelectorAll<HTMLElement>("*")) {
			const rect = element.getBoundingClientRect();
			if (!rect.width || !rect.height) continue;
			const style = getComputedStyle(element);
			if (parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none")
				lines.push(rect.top);
			if (parseFloat(style.borderBottomWidth) > 0 && style.borderBottomStyle !== "none")
				lines.push(rect.bottom);
			for (const pseudo of ["::before", "::after"]) {
				const decoration = getComputedStyle(element, pseudo);
				if (decoration.content === "none" || decoration.display === "none") continue;
				const height = parseFloat(decoration.height);
				const bottom = parseFloat(decoration.bottom);
				if (height > 0 && height <= 2 && Number.isFinite(bottom))
					lines.push(rect.bottom - bottom - height);
			}
		}
		return lines.sort((a, b) => a - b);
	});
	for (let index = 1; index < borders.length; index++) {
		expect
			.soft(borders[index] - borders[index - 1], `horizontal borders at ${borders.join(", ")}`)
			.toBeGreaterThanOrEqual(12);
	}
}

for (const palette of ["ink-light", "clay-dark"]) {
	for (const width of [1280, 390]) {
		test.describe(`${palette} ${width}`, () => {
			test.use({ viewport: { width, height: 900 } });
			test("media uses compact audio and a usable blocked embed frame", async ({ page }) => {
				// The thumbnail route remains deterministic under the full suite's stricter CSP.
				// Permit its one image origin while retaining the blocked-frame policy.
				await page.route(
					(url) => url.pathname.endsWith(".html"),
					async (route) => {
						const response = await route.fetch();
						const headers = response.headers();
						const policy = headers["content-security-policy"];
						if (!policy) throw new Error("Media fixtures must define their frame policy");
						await route.fulfill({
							response,
							headers: {
								...headers,
								"content-security-policy": (policy.includes("https://i.ytimg.com")
									? policy
									: policy.replace(/img-src[^;]*/, "$& https://i.ytimg.com")
								).replace(/media-src[^;]*/, "$& https://interactive-examples.mdn.mozilla.net"),
							},
						});
					},
				);
				await page.route("https://i.ytimg.com/**", async (route) =>
					route.fulfill({
						contentType: "image/webp",
						body: await readFile(
							new URL(
								"../../../../docs/test-fixtures/assets/test-image-wide.webp",
								import.meta.url,
							),
						),
					}),
				);
				await page.route("**/flower.mp4", async (route) =>
					route.fulfill({
						contentType: "video/mp4",
						body: await readFile(
							new URL("../../../../docs/test-fixtures/assets/test-video.mp4", import.meta.url),
						),
					}),
				);
				await open(page, palette, "Media & Embeds");
				const embeddedVideo = page.locator('[data-block-type="video"] iframe').first();
				await expect(embeddedVideo).toBeVisible();
				const frame = await embeddedVideo.boundingBox();
				if (!frame) throw new Error("Missing video frame");
				expect(frame.width / frame.height).toBeCloseTo(16 / 9, 1);
				await expect
					.poll(() =>
						embeddedVideo.evaluate((element: HTMLIFrameElement) => {
							const image = element.contentDocument?.querySelector("img");
							return image?.complete && image.naturalWidth > 0;
						}),
					)
					.toBe(true);
				if (!process.env.DISCLOSURE_CAPTURE_ONLY) {
					const direct = page.locator('[data-block-type="video"] video').first();
					await direct.scrollIntoViewIfNeeded();
					await expect
						.poll(() => direct.evaluate((element: HTMLVideoElement) => element.readyState))
						.toBeGreaterThanOrEqual(1);
					expect(
						await direct.evaluate((element: HTMLVideoElement) => element.duration),
					).toBeCloseTo(0.28, 2);
					await direct.evaluate(async (element: HTMLVideoElement) => {
						element.muted = true;
						await element.play();
					});
					await expect
						.poll(() => direct.evaluate((element: HTMLVideoElement) => element.readyState))
						.toBeGreaterThanOrEqual(4);
					await expect
						.poll(() =>
							direct.evaluate(
								(element: HTMLVideoElement) => element.currentTime > 0 || element.ended,
							),
						)
						.toBe(true);
					expect(await direct.evaluate((element: HTMLVideoElement) => element.error)).toBeNull();
				}
				for (const type of ["video", "audio"]) {
					let index = 0;
					for (const block of await page.locator(`[data-block-type="${type}"]`).all())
						await capture(block, `${palette}-${width}-${type}-${index++}`);
				}
				if (process.env.DISCLOSURE_CAPTURE_ONLY) {
					await open(page, palette, "Rich Content & Typography");
					await capture(
						page
							.locator('[data-block-type="embed"]')
							.filter({ has: page.locator("iframe") })
							.first(),
						`${palette}-${width}-embed`,
					);
					return;
				}
				const audio = page.locator('[data-block-type="audio"]').first();
				await audio.scrollIntoViewIfNeeded();
				await expect(audio.getByRole("button", { name: "Play", exact: true })).toBeVisible();
				await expect(audio.locator("audio[controls]")).toHaveCount(0);
				await expect(audio.locator(".praxity-narration-controls")).toBeVisible();
				const video = page.locator('[data-block-type="video"] video').first();
				await expect(video).toHaveCSS("border-radius", "10px");
				await expect(video).toHaveAttribute("preload", "metadata");
				const title = page.locator('[data-block-type="video"] .praxity-block-title').first();
				await expect(title).toHaveCSS("font-size", width === 1280 ? "24px" : "21px");
				await expect(title).toHaveCSS("font-weight", "600");
				await open(page, palette, "Rich Content & Typography");
				const embed = page
					.locator('[data-block-type="embed"]')
					.filter({ has: page.locator("iframe") })
					.first();
				await embed.scrollIntoViewIfNeeded();
				const fallback = embed.getByRole("link", { name: /Open .+ in a new tab/ });
				await expect(fallback).toBeVisible();
				await expect(fallback).toHaveAttribute("target", "_blank");
				await expect(embed.locator(".praxity-media-frame")).toContainText("https://");
				await expect(embed.locator("iframe")).toBeHidden();
				await capture(embed, `${palette}-${width}-embed`);
			});
			test("accordion rows have leading chevrons and Show all", async ({ page }) => {
				await open(page, palette, "Container Blocks");
				const block = page.locator('[data-block-type="accordion"]').first();
				await block.scrollIntoViewIfNeeded();
				await expect(block).toHaveAttribute("data-hydrated", "");
				await capture(block, `${palette}-${width}-accordion`);
				if (process.env.DISCLOSURE_CAPTURE_ONLY) return;
				const trigger = block.locator("[data-disclosure-trigger]").first();
				await expect(trigger).toHaveCSS("padding", "12px 4px");
				await expect(trigger).toHaveCSS("font-size", width === 1280 ? "19px" : "18px");
				await trigger.focus();
				await page.keyboard.press("Enter");
				await expect(trigger).toHaveAttribute("aria-expanded", "true");
				const geometry = await trigger.evaluate((button) => {
					const icon = button.querySelector("svg");
					const label = button.querySelector("[data-disclosure-label]");
					if (!icon || !label) throw new Error("Missing chevron or label");
					return {
						icon: icon.getBoundingClientRect().right,
						label: label.getBoundingClientRect().left,
						transform: getComputedStyle(icon).transform,
					};
				});
				expect(geometry.icon).toBeLessThan(geometry.label);
				expect(geometry.transform).toBe("matrix(0, 1, -1, 0, 0, 0)");
				if ((await block.locator("[data-accordion-item]").count()) >= 3) {
					await block.getByRole("button", { name: "Show all", exact: true }).click();
					for (const button of await block.locator("[data-disclosure-trigger]").all())
						await expect(button).toHaveAttribute("aria-expanded", "true");
				}
			});
			test("tabs become single-open disclosures when labels no longer fit", async ({ page }) => {
				await open(page, palette, "Container Blocks");
				const block = page.locator('[data-block-type="tabs"]').first();
				await block.scrollIntoViewIfNeeded();
				await expect(block).toHaveAttribute("data-hydrated", "");
				await capture(block, `${palette}-${width}-tabs`);
				if (process.env.DISCLOSURE_CAPTURE_ONLY) return;
				if (width === 1280) {
					const right = await block.evaluate((element) => element.getBoundingClientRect().right);
					for (const tab of await block.getByRole("tab").all()) {
						expect
							.soft(await tab.evaluate((element) => element.getBoundingClientRect().right))
							.toBeLessThanOrEqual(right);
					}
					const selected = block.getByRole("tab", { selected: true });
					await expect(selected).toHaveCSS("font-weight", "600");
					expect(await selected.evaluate((e) => getComputedStyle(e, "::after").height)).toBe("2px");
					await selected.focus();
					await page.keyboard.press("ArrowRight");
					await page.keyboard.press("Enter");
					await expect(block.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
				}
				// Authored long labels also require disclosure at wider widths.
				await block.locator(".praxity-tabs-tab").evaluateAll((buttons) =>
					buttons.forEach((button, i) => {
						const label = button.querySelector(".praxity-disclosure-title") ?? button;
						label.textContent = `A long section label describing technique ${i + 1} in full`;
					}),
				);
				await expect(block.getByRole("tablist")).toHaveCount(0);
				const buttons = block.locator(".praxity-tabs-tab");
				await expect(buttons.first()).toHaveAttribute("aria-expanded", /true|false/);
				for (const button of await buttons.all()) await expect(button).toBeVisible();
				await buttons.first().click();
				await buttons.nth(1).focus();
				await page.keyboard.press("Space");
				await expect(buttons.nth(1)).toHaveAttribute("aria-expanded", "true");
				await expect(buttons.first()).toHaveAttribute("aria-expanded", "false");
				await expect(block.locator(".praxity-tabs-panel:visible")).toHaveCount(1);
				await expect(buttons.nth(1)).toBeFocused();
				// Capture resting separators after verifying keyboard focus and activation.
				await buttons.nth(1).evaluate((button: HTMLButtonElement) => button.blur());
				await expectDisclosureAffordance(block);
				const openIcon = buttons.nth(1).locator("svg.praxity-disclosure-icon");
				await expect.soft(openIcon).toHaveCSS("transform", "matrix(0, 1, -1, 0, 0, 0)");
				await capture(block, `${palette}-${width}-tabs-long-disclosure`);
			});
			test("recall card keeps its prompt while the answer space grows and fades", async ({
				page,
			}) => {
				await open(page, palette, "Container Blocks");
				const card = page.locator('[data-flippable="true"]').first();
				await card.scrollIntoViewIfNeeded();
				await capture(card, `${palette}-${width}-flip-card-front`);
				if (process.env.DISCLOSURE_CAPTURE_ONLY) return;
				const button = card.getByRole("button", { name: "I have my answer", exact: true });
				await expect(button).toHaveAttribute("aria-expanded", "false");
				await expect(card).toHaveCSS("padding", "0px");
				const heading = card.locator(".praxity-flashcard-face-heading");
				const before = await heading.boundingBox();
				await button.focus();
				await page.keyboard.press("Enter");
				await expect(
					card.getByRole("button", { name: "Hide answer", exact: true }),
				).toHaveAttribute("aria-expanded", "true");
				await expect(card.locator('[data-card-side="front"]')).toBeVisible();
				const answer = card.locator('[data-card-side="back"]');
				const reveal = card.locator("[data-content-reveal]");
				await expect(answer).toBeVisible();
				await expect(answer).toHaveCSS("transform", "none");
				await expect(reveal).toHaveCSS("transition-property", "grid-template-rows, opacity");
				await expect(reveal).toHaveCSS("transition-duration", "0.2s, 0.2s");
				await expect(answer).toHaveCSS("opacity", "1");
				expect((await heading.boundingBox())?.y).toBe(before?.y);
				await capture(card, `${palette}-${width}-flip-card-answer`);
				await page.emulateMedia({ reducedMotion: "reduce" });
				await expect(reveal).toHaveCSS("transition-duration", "0s");
				await page.keyboard.press("Space");
				await expect(answer).toBeHidden();
			});
		});
	}
}
