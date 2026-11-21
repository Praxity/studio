import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	workers: 1,
	retries: 0,
	use: {
		headless: true,
		trace: "off",
		screenshot: "off",
	},
	timeout: 30 * 60_000,
	expect: { timeout: 10_000 },
	projects: [
		{ name: "rustici", testMatch: "local.spec.ts" },
		{
			name: "chromium",
			testMatch: ["lifecycle.spec.ts", "retry.spec.ts"],
			use: { browserName: "chromium", launchOptions: { args: ["--mute-audio"] } },
		},
		{
			name: "firefox",
			testMatch: ["lifecycle.spec.ts", "retry.spec.ts"],
			use: { browserName: "firefox" },
		},
		{
			name: "webkit",
			testMatch: ["lifecycle.spec.ts", "retry.spec.ts"],
			use: { browserName: "webkit" },
		},
	],
});
