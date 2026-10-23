import { defineConfig } from "vitest/config";

export default defineConfig({
	test: { name: "content-identity", include: ["__tests__/**/*.test.ts"], forbidOnly: true },
});
