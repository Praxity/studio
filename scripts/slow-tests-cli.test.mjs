import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

test("real workspace config bundles the confirmation CLI without running test suites", () => {
	const root = resolve(import.meta.dirname, "..");
	const result = spawnSync(
		process.execPath,
		[
			resolve(root, "node_modules/vitest/vitest.mjs"),
			"list",
			"--config",
			"vitest.workspace.ts",
			"--project=review-share",
			"--filesOnly",
		],
		{ cwd: root, encoding: "utf8", windowsHide: true, env: { ...process.env, CI: "true" } },
	);
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout, /packages[/\\]review-share[/\\]tests[/\\].+\.test\.ts/);
});

test("confirmation CLI reports asynchronous startup failures", () => {
	const dir = mkdtempSync(resolve(tmpdir(), "slow-cli-rejection-"));
	try {
		const pending = resolve(dir, "pending.json");
		writeFileSync(
			pending,
			JSON.stringify({
				root: dir,
				violations: [
					{
						moduleId: resolve(dir, "slow.test.ts"),
						projectRoot: dir,
						entry: { file: "apps/slow.test.ts", name: "slow" },
						nameParts: ["slow"],
						duration: 2109,
					},
				],
			}),
		);
		const missingTemp = resolve(dir, "absent", "temp");
		const result = spawnSync(
			process.execPath,
			[resolve(import.meta.dirname, "confirm-slow-tests.mjs"), pending],
			{
				encoding: "utf8",
				windowsHide: true,
				env: {
					...process.env,
					CI: "false",
					TMPDIR: missingTemp,
					TEMP: missingTemp,
					TMP: missingTemp,
				},
			},
		);
		assert.equal(result.error, undefined);
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stderr, /Slow-test confirmation infrastructure failed:/);
		assert.match(result.stderr, /ENOENT/);
	} finally {
		rmSync(dir, { recursive: true });
	}
});

for (const [file, args, diagnostic] of [
	["scripts/confirm-slow-tests.mjs", [], /Slow-test confirmation infrastructure failed/],
	["apps/desktop/scripts/test-affected.mjs", ["--invalid-option"], /Summary: FAIL selection/],
]) {
	test(`symlinked ${file} still runs its CLI`, () => {
		const dir = mkdtempSync(resolve(tmpdir(), "slow-cli-"));
		try {
			const link = resolve(dir, "entry.mjs");
			symlinkSync(resolve(import.meta.dirname, "..", file), link);
			const result = spawnSync(process.execPath, [link, ...args], {
				encoding: "utf8",
				windowsHide: true,
			});
			assert.equal(result.status, 1, result.stdout + result.stderr);
			assert.match(result.stderr, diagnostic);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
}
