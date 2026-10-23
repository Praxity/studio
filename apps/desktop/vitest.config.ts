import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "desktop",
		environment: "node",
		setupFiles: [resolve(__dirname, "src/test-utils/setup-tests.ts")],
		clearMocks: true,
		restoreMocks: true,
		include: ["src/**/*.test.ts", "src/**/*.test.tsx", "e2e/browser-editor/*.test.ts"],
	},
	resolve: {
		alias: {
			"@renderer": resolve(__dirname, "src/renderer"),
		},
	},
});
