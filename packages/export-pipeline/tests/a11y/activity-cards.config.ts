import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
	...base,
	globalSetup: "./activity-cards.setup.ts",
	testMatch: "activity-cards.spec.ts",
	outputDir: "../../test-results/activity-cards/artifacts",
	reporter: [["list"], ["json", { outputFile: "../../test-results/activity-cards/results.json" }]],
});
