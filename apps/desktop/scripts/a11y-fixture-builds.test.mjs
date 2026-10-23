import assert from "node:assert/strict";
import test from "node:test";
import { runFixtureBuilds } from "../../../packages/export-pipeline/tests/a11y/fixture-builds.ts";

test("fixture builds run concurrently within the worker limit and finish every course", async () => {
	let active = 0;
	let peak = 0;
	const finished = [];
	const builds = Array.from({ length: 7 }, (_, index) => async () => {
		active++;
		peak = Math.max(peak, active);
		await new Promise((resolve) => setImmediate(resolve));
		finished.push(index);
		active--;
	});
	await runFixtureBuilds(builds, 2);
	assert.equal(peak, 2);
	assert.deepEqual(finished.sort(), [0, 1, 2, 3, 4, 5, 6]);
	assert.equal(active, 0);
});

test("a failed fixture build drains the batch before reporting every error", async () => {
	const failures = [new Error("first course"), new Error("last course")];
	const finished = [];
	await assert.rejects(
		runFixtureBuilds(
			Array.from({ length: 5 }, (_, index) => async () => {
				await new Promise((resolve) => setImmediate(resolve));
				finished.push(index);
				if (index === 0) throw failures[0];
				if (index === 4) throw failures[1];
			}),
			2,
		),
		(error) => {
			assert.deepEqual(error.errors, failures);
			assert.deepEqual(finished.sort(), [0, 1, 2, 3, 4]);
			return true;
		},
	);
});

test("fixture worker counts refuse invalid limits and empty batches finish", async () => {
	for (const workers of [0, -1, 1.5, Infinity, NaN])
		await assert.rejects(runFixtureBuilds([], workers), /positive integer/);
	await runFixtureBuilds([], 2);
});
