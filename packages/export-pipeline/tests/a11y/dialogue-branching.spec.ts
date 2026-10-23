import { expect, test } from "@playwright/test";
import { getCoursePages, readTestEnv, waitForHydration } from "./helpers";

type RetryAudio = HTMLAudioElement & { retryEvents: string[] };

test("submission reveals a branch and retry keeps Play in authored order", async ({ page }) => {
	test.setTimeout(30_000);
	const base = `${readTestEnv().url}/dialogue-branching`;
	const [first] = await getCoursePages(page, base);
	if (!first) throw new Error("Missing branching dialogue page");
	await page.goto(`${base}/${first.slug}.html`);
	await waitForHydration(page);
	const audio = page.locator("audio[data-narration-player]");
	await audio.evaluate((element: HTMLAudioElement) => {
		element.muted = true;
	});
	const choice = page
		.locator("[data-assessment-display]")
		.filter({ hasText: "Que dites-vous à Roxanne ?" });
	const calm = page
		.locator('[data-block-type="dialogue"]')
		.filter({ hasText: "Merci, ça m'aide beaucoup." });
	const tense = page
		.locator('[data-block-type="dialogue"]')
		.filter({ hasText: "Je ne fuis pas, je réfléchis." });
	await page.getByRole("button", { name: "Listen", exact: true }).click();
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect(audio).toHaveAttribute("src", /intro\.mp3/);
	await expect(audio).toHaveAttribute("src", /question\.mp3/, { timeout: 20_000 });
	await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible({
		timeout: 20_000,
	});
	const clipDuration = await audio.evaluate((element: HTMLAudioElement) => element.duration);
	await choice.getByRole("radio", { name: /Tu fuis/ }).check();
	await expect(calm).toBeHidden();
	await expect(tense).toBeHidden();
	await choice.locator("[data-assessment-submit='true']:visible").click();
	await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
	await expect(tense).toBeVisible();
	await expect(calm).toBeHidden();
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect(audio).toHaveAttribute("src", /tense\.wav/);
	// A source change precedes decoded playback. Start retry only once the real
	// clock advances, with a clip longer than this test's entire 30-second budget.
	await expect(audio).toHaveJSProperty("duration", 60);
	await expect
		.poll(() =>
			audio.evaluate((element: HTMLAudioElement) => !element.paused && element.currentTime > 0),
		)
		.toBe(true);
	const retryTime = await audio.evaluate((element: RetryAudio) => {
		element.retryEvents = [];
		for (const event of ["pause", "ended", "emptied", "play", "seeking"]) {
			element.addEventListener(event, () => element.retryEvents.push(event), { once: true });
		}
		return element.currentTime;
	});
	await choice.getByRole("button", { name: "Try again" }).click();
	const calmAnswer = choice.getByRole("radio", { name: /J'ai besoin/ });
	await calmAnswer.focus();
	await expect
		.poll(() =>
			audio.evaluate(
				(element: HTMLAudioElement) =>
					element.paused === false &&
					element.currentTime > 0 &&
					element.currentTime < element.duration,
			),
		)
		.toBe(true);
	await expect(audio).toHaveAttribute("src", /tense\.wav/);
	expect(await audio.evaluate((element: RetryAudio) => element.retryEvents)).toEqual([]);
	expect(
		await audio.evaluate((element: HTMLAudioElement) => element.currentTime),
	).toBeGreaterThanOrEqual(retryTime);
	await calmAnswer.press("Space");
	await expect(calm).toBeHidden();
	await expect(tense).toBeHidden();
	await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
	await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
	await expect(audio).toHaveAttribute("src", /tense\.wav/);
	await expect(calmAnswer).toBeFocused();
	await choice.locator("[data-assessment-submit='true']:visible").click();
	await expect(calm).toBeVisible();
	await expect(tense).toBeHidden();
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect(audio).toHaveAttribute("src", /tense\.wav/);
	await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
	const seek = page.getByRole("slider", { name: "Position in narration" });
	await expect(seek).toBeEnabled();
	expect(Number(await seek.getAttribute("max"))).toBeCloseTo(clipDuration * 3, 1);
	await seek.focus();
	await seek.press("End");
	await expect(audio).not.toHaveAttribute("src", /tense\.wav/);
	await expect(audio).toHaveAttribute("src", /calm\.mp3/);
	await seek.press("ArrowLeft");
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect(audio).toHaveAttribute("src", /calm\.mp3/);
});
