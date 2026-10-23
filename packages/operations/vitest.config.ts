import { defineConfig } from "vitest/config";

export default defineConfig({
	test: { name: "operations", include: ["__tests__/**/*.test.ts"], forbidOnly: true },
});
