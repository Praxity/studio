import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "export-pipeline",
		environment: "node",
		globalSetup: ["./vitest.global-setup.ts"],
		// Collect all of src/__tests__, not just build-desktop-mode. The narrow
		// pattern silently skipped 9 of the 10 files here, including html-gen's —
		// which is why PR #991's own assertion did not catch that its fallback-hiding
		// rule left static pages with no navigation at all.
		include: ["tests/**/*.test.ts", "src/__tests__/**/*.test.ts"],
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
});
