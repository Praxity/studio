import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Direct presentation fixture while course publication remains refused.
export default defineConfig({
	...base,
	globalSetup: undefined,
	testMatch: "highlight-delivery.spec.ts",
});
