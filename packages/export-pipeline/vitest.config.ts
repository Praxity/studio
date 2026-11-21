import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "export-pipeline",
		environment: "node",
		globalSetup: ["./vitest.global-setup.ts"],
		include: ["tests/**/*.test.ts", "src/__tests__/**/*.test.ts"],
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
});
