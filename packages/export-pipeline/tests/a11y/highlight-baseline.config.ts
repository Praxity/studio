import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// This direct renderer fixture has no course publication or learner-bundle admission.
export default defineConfig({
	...base,
	globalSetup: undefined,
	testMatch: "highlight-baseline.spec.ts",
});
