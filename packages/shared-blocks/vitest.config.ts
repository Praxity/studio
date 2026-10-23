import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "shared-blocks",
		environment: "jsdom",
		css: { include: [/shared-blocks\.css\?raw$/] },
		setupFiles: ["./tests/setup.ts"],
	},
});
