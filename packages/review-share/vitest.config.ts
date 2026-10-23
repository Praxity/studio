import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "review-share",
		environment: "node",
		include: ["tests/**/*.test.ts"],
	},
});
