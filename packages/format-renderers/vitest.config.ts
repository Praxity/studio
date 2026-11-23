import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const bundledTypst = fileURLToPath(
	new URL(
		`../../apps/cli/resources/typst/typst${process.platform === "win32" ? ".exe" : ""}`,
		import.meta.url,
	),
);
const typst = process.env.PRAXITY_TEST_TYPST || (existsSync(bundledTypst) ? bundledTypst : "");

export default defineConfig({
	test: {
		name: "format-renderers",
		include: ["__tests__/**/*.test.ts"],
		env: typst ? { PRAXITY_TEST_TYPST: typst } : {},
		testTimeout: typst ? 60_000 : 5_000,
	},
});
