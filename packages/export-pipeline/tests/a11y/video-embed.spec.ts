import { expect, test } from "@playwright/test";
import { findPageWithSelector, getCoursePages, readTestEnv } from "./helpers";

test.describe("video and embed blocks", () => {
	test("packaged WebVTT cues load in the native video track", async ({ page }) => {
		const { captionedVideoUrl } = readTestEnv();
		if (!captionedVideoUrl) throw new Error("Missing captioned video fixture");
		await page.goto(captionedVideoUrl, { waitUntil: "domcontentloaded" });
		const video = page.locator("[data-block-type='video'] video");
		await expect(video).toBeVisible();
		await expect
			.poll(() =>
				video.evaluate((element) => {
					const track = element.querySelector("track");
					if (!track) return null;
					track.track.mode = "showing";
					return {
						readyState: track.readyState,
						cues: Array.from(track.track.cues ?? [], (cue) => (cue as VTTCue).text),
					};
				}),
			)
			.toEqual({ readyState: 2, cues: ["Bonjour."] });
	});

	test("video iframe has src and title", async ({ page }) => {
		const env = readTestEnv();
		const pages = await getCoursePages(page, env.url);
		const videoPage = await findPageWithSelector(
			page,
			env.url,
			pages,
			"[data-block-type='video'] iframe",
		);
		if (!videoPage) throw new Error("No video iframe found in fixture");

		const iframe = page.locator("[data-block-type='video'] iframe").first();
		await expect(iframe).toBeVisible();
		await expect(iframe).toHaveAttribute("src", /.+/);
		await expect(iframe).toHaveAttribute("title", /.+/);
		await expect(iframe).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
	});

	test("blocked embed keeps its safe iframe attributes and an in-frame fallback", async ({
		page,
	}) => {
		const env = readTestEnv();
		const pages = await getCoursePages(page, env.url);
		const embedPage = await findPageWithSelector(
			page,
			env.url,
			pages,
			"[data-block-type='embed'] .praxity-embed-frame",
		);
		if (!embedPage) throw new Error("No embed iframe found in fixture");

		const iframe = page.locator("[data-block-type='embed'] iframe").first();
		await expect(iframe).toBeHidden();
		await expect(
			page.locator("[data-block-type='embed'] .praxity-embed-fallback a").first(),
		).toBeVisible();
		await expect(iframe).toHaveAttribute("sandbox", /.+/);
		await expect(iframe).toHaveAttribute("src", /^https:\/\//);
		await expect(iframe).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
	});
});
