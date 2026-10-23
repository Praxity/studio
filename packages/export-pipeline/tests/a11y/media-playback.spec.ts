import { expect, test } from "@playwright/test";
import { silentWav } from "../fixtures/silent-audio";
import { readTestEnv, waitForHydration } from "./helpers";

test("narration advances and ends naturally without a Firefox audio device", async ({
	browserName,
	playwright,
	launchOptions,
}) => {
	// Reproduce a CI host with no audio output, keeping the project's media prefs.
	const browser = await playwright[browserName].launch({
		...launchOptions,
		...(browserName === "firefox"
			? {
					firefoxUserPrefs: {
						...launchOptions.firefoxUserPrefs,
						"media.cubeb.force_null_context": true,
					},
				}
			: {}),
	});
	try {
		const page = await browser.newPage();
		// Stable play/pause/resume must not race the short completion fixture.
		await page.route(/\.(?:mp3|wav)(?:\?.*)?$/, (route) =>
			route.fulfill({ contentType: "audio/wav", body: silentWav(60) }),
		);
		await page.goto(`${readTestEnv().url}/sidebar-narration/narrated-slide.html`);
		await waitForHydration(page);
		const audio = page.locator("audio[data-narration-player]");
		await page.getByRole("button", { name: "Listen", exact: true }).click();
		await page.getByRole("button", { name: "Play", exact: true }).click();
		await expect
			.poll(() =>
				audio.evaluate((element: HTMLAudioElement) => ({
					error: element.error?.message ?? null,
					readyState: element.readyState,
					currentTime: element.currentTime,
					duration: element.duration,
					paused: element.paused,
					ended: element.ended,
					advanced: element.currentTime > 0 && element.currentTime < element.duration,
				})),
			)
			.toMatchObject({ error: null, paused: false, ended: false, advanced: true });
		await page.getByRole("button", { name: "Pause", exact: true }).click();
		await expect
			.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused))
			.toBe(true);
		const pausedTime = await audio.evaluate((element: HTMLAudioElement) => element.currentTime);
		await page.getByRole("button", { name: "Play", exact: true }).click();
		await expect
			.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime))
			.toBeGreaterThan(pausedTime);
		await page.close();

		// A fresh context keeps natural completion on the original short media.
		const completionPage = await browser.newPage();
		await completionPage.goto(`${readTestEnv().url}/sidebar-narration/narrated-slide.html`);
		await waitForHydration(completionPage);
		const completionAudio = completionPage.locator("audio[data-narration-player]");
		await completionPage.getByRole("button", { name: "Listen", exact: true }).click();
		await completionPage.getByRole("button", { name: "Play", exact: true }).click();
		await expect
			.poll(
				() =>
					completionAudio.evaluate((element: HTMLAudioElement) => ({
						error: element.error?.message ?? null,
						readyState: element.readyState,
						currentTime: element.currentTime,
						duration: element.duration,
						paused: element.paused,
						ended: element.ended,
					})),
				{ timeout: 20_000 },
			)
			.toMatchObject({ error: null, ended: true });
		await expect(completionAudio).toHaveJSProperty("error", null);
		await expect(completionPage.getByRole("button", { name: "Play", exact: true })).toBeVisible();
		await expect(completionPage.locator("[data-narration-active]")).toHaveCount(0);
	} finally {
		await browser.close();
	}
});
