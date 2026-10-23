import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Exercise the presentation directly while course publication remains refused.
export default defineConfig({
	...base,
	globalSetup: undefined,
	testMatch: ["highlight-enhance.spec.ts", "highlight-delivery.spec.ts"],
});
