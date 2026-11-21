import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "editor-core",
		environment: "jsdom",
		include: ["src/**/*.test.{ts,tsx}"],
		css: { include: [/editor-tokens\.css/u] },
	},
});
