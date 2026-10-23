import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	workers: 2,
	fullyParallel: false,
	outputDir: "../../test-results/deck/artifacts",
	reporter: [["list"], ["json", { outputFile: "../../test-results/deck/results.json" }]],
	retries: process.env.CI ? 1 : 0,
	timeout: 45_000,
	use: {
		headless: true,
		trace: "on-first-retry",
	},
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
						// Gecko must advance its real media clock without opening an audio device.
						"media.default_volume": "0.0",
					},
				},
			},
		},
	],
});
