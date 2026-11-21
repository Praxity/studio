import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	globalSetup: "./global-setup.ts",
	workers: 1,
	retries: 1,
	use: {
		trace: "off",
		screenshot: "off",
	},
	timeout: 180_000,
	expect: { timeout: 10_000 },
});
