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
			use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--mute-audio"] } },
		},
		{ name: "webkit", use: { ...devices["Desktop Safari"] } },
		{
			name: "firefox",
			use: {
				...devices["Desktop Firefox"],
				launchOptions: {
					firefoxUserPrefs: {
						"media.default_volume": "0.0",
					},
				},
			},
		},
	],
});
