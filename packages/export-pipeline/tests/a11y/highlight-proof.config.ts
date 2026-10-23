import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Focused highlight publication, reporting and print checks.
export default defineConfig({
	...base,
	globalSetup: undefined,
	testMatch: [
		"highlight-print.spec.ts",
		"highlight-advice.spec.ts",
		"highlight-reporting.spec.ts",
		"highlight-published.spec.ts",
	],
});
