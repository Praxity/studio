import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Native PDF tests compile with the Typst that ships in the app. It exists after
// `pnpm --filter @praxity/desktop prepare:typst`, which `dev` and `build` also run.
const bundledTypst = fileURLToPath(
	new URL(
		`../../apps/desktop/resources/typst/typst${process.platform === "win32" ? ".exe" : ""}`,
		import.meta.url,
	),
);
const typst = process.env.PRAXITY_TEST_TYPST || (existsSync(bundledTypst) ? bundledTypst : "");

export default defineConfig({
	test: {
		name: "format-renderers",
		include: ["__tests__/**/*.test.ts"],
		env: typst ? { PRAXITY_TEST_TYPST: typst } : {},
		// Real Typst compiles take a few seconds each, longer on a loaded machine.
		testTimeout: typst ? 60_000 : 5_000,
	},
});
