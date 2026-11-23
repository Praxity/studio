import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "course-help",
		environment: "node",
		include: ["tests/**/*.test.ts"],
	},
});
