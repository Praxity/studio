import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
	...base,
	globalSetup: "./standalone-outcome.setup.ts",
	testMatch: "standalone-outcome.spec.ts",
});
