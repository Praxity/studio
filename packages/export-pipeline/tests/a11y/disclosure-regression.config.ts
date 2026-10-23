import { defineConfig } from "@playwright/test";
import base from "./disclosure-design.config";

export default defineConfig({
	...base,
	testMatch: [
		"card-affordance.spec.ts",
		"tabs-reflow.spec.ts",
		"native-container-settings.spec.ts",
	],
	grep: /card-affordance|tabs-reflow|saved tab styles/,
});
