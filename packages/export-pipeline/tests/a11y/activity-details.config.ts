import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
	...base,
	globalSetup: undefined,
	testMatch: "activity-details.spec.ts",
});
