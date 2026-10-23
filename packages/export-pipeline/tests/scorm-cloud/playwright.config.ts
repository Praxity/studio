import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	globalSetup: "./global-setup.ts",
	workers: 1,
	retries: 1,
	use: {
		// Cloud launch URLs are bearer credentials; do not retain browser network traces.
		trace: "off",
		screenshot: "off",
	},
	timeout: 180_000,
	expect: { timeout: 10_000 },
});
