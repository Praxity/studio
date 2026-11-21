import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const preparedTypst = resolve(
	__dirname,
	`resources/typst/typst${process.platform === "win32" ? ".exe" : ""}`,
);
const typst =
	process.env.PRAXITY_STUDIO_TYPST ||
	process.env.PRAXITY_TEST_TYPST ||
	(existsSync(preparedTypst) ? preparedTypst : "");

export default defineConfig({
	test: {
		name: "desktop",
		environment: "node",
		env: typst ? { PRAXITY_STUDIO_TYPST: typst } : {},
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
