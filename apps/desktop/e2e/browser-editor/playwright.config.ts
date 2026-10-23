import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: import.meta.dirname,
	testMatch: "*.spec.ts",
	globalSetup: "./global-setup.ts",
	workers: 1,
	retries: 0,
	// CI's default dot reporter prints failures only at the end, so a step timeout hid them.
	reporter: process.env.CI ? "line" : "list",
	use: { headless: true, viewport: { width: 1280, height: 900 }, trace: "retain-on-failure" },
	outputDir: join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "browser-editor-results"),
	projects: [
		{
			name: "chromium",
			use: { browserName: "chromium", launchOptions: { args: ["--mute-audio"] } },
		},
		{
			name: "firefox",
			use: {
				browserName: "firefox",
				launchOptions: { firefoxUserPrefs: { "media.default_volume": "0.0" } },
			},
		},
		{ name: "webkit", use: { browserName: "webkit" } },
	],
});
