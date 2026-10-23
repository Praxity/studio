import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "grammar",
		include: ["__tests__/**/*.test.ts"],
		typecheck: {
			enabled: true,
			tsconfig: "tsconfig.type-tests.json",
		},
	},
});
