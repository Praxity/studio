import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
	...base,
	globalSetup: "./disclosure-design.setup.ts",
	testMatch: "disclosure-design.spec.ts",
});
