import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	// No globalSetup needed — the harness is set up per-test.
	workers: 1,
	retries: 0,
	use: {
		// Headless works here: the driver uses <frameset>, not window.open().
		headless: true,
		// Disable trace/screenshot — these tests manage their own browser instances
		// (chromium.launch + context.newPage) rather than using Playwright fixtures,
		// so the trace artifact system cannot hook into them and produces ENOENT errors.
		trace: "off",
		screenshot: "off",
	},
	// The full local Rustici suite is serial and can take 10-15 minutes when
	// proprietary driver files are present. Keep the per-test timeout generous
	// so long comprehensive runs do not fail after the learner flow has completed.
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
