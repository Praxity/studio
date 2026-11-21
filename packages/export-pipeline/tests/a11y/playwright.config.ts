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
	retries: process.env.CI ? 1 : 0,
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
