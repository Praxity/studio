import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	globalSetup: "./global-setup.ts",
	fullyParallel: false,
	workers: 2,
	outputDir: "../../test-results/a11y/artifacts",
	reporter: [["list"], ["json", { outputFile: "../../test-results/a11y/results.json" }]],
	use: {
		headless: true,
		trace: "on-first-retry",
	},
	// Linux WebKit occasionally aborts a `page.goto` with "WebKit encountered an
	// internal error" (seen on design-navigation's repeated navigations). One CI
	// retry absorbs that crash; Playwright still reports the test as flaky.
	retries: process.env.CI ? 1 : 0,
	// Published output reaches learners through Chromium, WebKit (Safari), and
	// Gecko (Firefox, including NVDA). Keyboard, focus and visual-state defects
	// can be reproducible in only one engine. See `/a11y` §2.2.
	projects: [
		{
			name: "chromium",
			// Only Chromium accepts --mute-audio; Linux WebKit refuses to launch with it.
			use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--mute-audio"] } },
		},
		{ name: "webkit", use: { ...devices["Desktop Safari"] } },
		{
			name: "firefox",
			use: {
				...devices["Desktop Firefox"],
				launchOptions: {
					firefoxUserPrefs: {
						// Mute at the media element, so headless hosts without an audio
						// device keep decoding and advancing on Gecko's system clock.
						// media.volume_scale alone still opens the failing audio sink.
						"media.default_volume": "0.0",
					},
				},
			},
		},
	],
});
