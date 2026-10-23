import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// External review exports are served by the capture runner. Normal a11y CI uses
// the canonical setup and public fixtures through playwright.config.ts.
export default defineConfig({
	...base,
	globalSetup: undefined,
	testMatch: "design-system.spec.ts",
});
