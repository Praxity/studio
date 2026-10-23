import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "editor-core",
		environment: "jsdom",
		// Collect co-located test files too. The previous `__tests__`-only pattern
		// silently skipped more test files than it ran, including the a11y checker's —
		// which is how an image-alt regression reached the publish gate.
		include: ["src/**/*.test.{ts,tsx}"],
		// The Page lens reads its handle colours from the raw token sheet, which Vitest
		// would otherwise replace with an empty string.
		css: { include: [/editor-tokens\.css/u] },
	},
});
