import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const differential = fileURLToPath(new URL("./inventory-native-differential.mts", import.meta.url));

for (const { skew, iterations, error } of [
	{ skew: "NaN", iterations: "0", error: "Clock skew must be finite milliseconds" },
	{ skew: "0", iterations: "0", error: "Iterations per mode must be a positive integer" },
	{ skew: "0", iterations: "0.5", error: "Iterations per mode must be a positive integer" },
]) {
	test(`native differential refuses skew ${skew}, iterations ${iterations} before writes`, () => {
		const scratch = mkdtempSync(join(tmpdir(), "inventory-arguments-"));
		try {
			const result = spawnSync(
				process.execPath,
				["--import", "tsx", differential, scratch, skew, iterations],
				{ encoding: "utf8" },
			);
			assert.ifError(result.error);
			assert.notEqual(result.status, 0);
			assert.ok(result.stderr.includes(error), result.stderr);
			assert.deepEqual(readdirSync(scratch), []);
		} finally {
			rmSync(scratch, { recursive: true, force: true });
		}
	});
}

test("native writer refuses execution outside a worker thread", () => {
	const writer = fileURLToPath(new URL("./inventory-native-writer.mjs", import.meta.url));
	const result = spawnSync(process.execPath, [writer], { encoding: "utf8" });
	assert.ifError(result.error);
	assert.notEqual(result.status, 0);
	assert.ok(
		result.stderr.includes("Native inventory writer requires a worker thread"),
		result.stderr,
	);
});
