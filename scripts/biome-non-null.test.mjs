import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const config = readFileSync(new URL("../biome.json", import.meta.url));
const biome = fileURLToPath(new URL("../node_modules/@biomejs/biome/bin/biome", import.meta.url));
const source = "const value: string | undefined = undefined;\nconsole.log(value!);\n";

for (const [path, severity] of [
	["apps/example/src/main.ts", "error"],
	["packages/example/src/nested/owner.ts", "error"],
	["tools/example/nested/src/owner.ts", "error"],
	["apps/example/src/main.test.ts", "warning"],
	["packages/example/src/owner.spec.ts", "warning"],
	["tools/example/src/__tests__/owner.ts", "warning"],
	["packages/example/src/test/helpers.ts", "warning"],
	["packages/example/src/tests/helpers.ts", "warning"],
	["apps/example/src/test-utils/setup-tests.ts", "warning"],
	["packages/example/src/test-helpers/fixture.ts", "warning"],
	["packages/example/src/fixtures/owner.ts", "warning"],
	["packages/example/src/__fixtures__/owner.ts", "warning"],
	["packages/example/src/test-utils.ts", "warning"],
]) {
	test(`non-null assertions in ${path} are ${severity}s`, (t) => {
		const root = mkdtempSync(join(tmpdir(), "biome-non-null-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		execFileSync("git", ["init", "--quiet", root]);
		writeFileSync(join(root, "biome.json"), config);
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), source);
		const result = spawnSync(
			process.execPath,
			[biome, "lint", "--only=style/noNonNullAssertion", "--reporter=json", path],
			{ cwd: root, encoding: "utf8" },
		);
		if (result.error) throw result.error;
		const report = JSON.parse(result.stdout);
		assert.equal(report.diagnostics[0]?.category, "lint/style/noNonNullAssertion");
		assert.equal(report.diagnostics[0]?.severity, severity);
		assert.equal(result.status, severity === "error" ? 1 : 0);
	});
}
