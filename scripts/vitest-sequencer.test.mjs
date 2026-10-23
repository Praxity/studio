import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { BaseSequencer } from "vitest/node";
import { timingEntries, timingMap } from "./refresh-vitest-timings.mjs";
import DurationSequencer, { FileTimingReporter } from "./vitest-sequencer.ts";

const root = resolve(".");
const spec = (name) => ({ moduleId: resolve(root, name) });
const context = (index, count) => ({ config: { root, shard: { index, count } } });
const files = ["a", "b", "c", "d", "new"].map((name) => spec(`apps/desktop/${name}.test.ts`));
const timings = {
	"apps/desktop/a.test.ts": 16,
	"apps/desktop/b.test.ts": 14,
	"apps/desktop/c.test.ts": 11,
	"apps/desktop/d.test.ts": 9,
};

test("duration shards assign the longest known files to the least loaded shard", async () => {
	const assigned = await Promise.all(
		[1, 2].map((index) =>
			new DurationSequencer(context(index, 2), timings).shard(files.slice(0, 4)),
		),
	);
	assert.deepEqual(assigned, [[files[0]], [files[1], files[2], files[3]]]);
});

test("worker-aware balancing leaves a dominant file alone when other shards finish sooner", async () => {
	const input = ["heavy", "b", "c", "d", "e", "f", "g"].map((name) => spec(`apps/${name}.test.ts`));
	const measured = Object.fromEntries(
		input.map((file, index) => [
			`apps/${["heavy", "b", "c", "d", "e", "f", "g"][index]}.test.ts`,
			[100, 30, 25, 20, 15, 10, 5][index],
		]),
	);
	const assigned = await Promise.all(
		[1, 2].map((index) =>
			new DurationSequencer(
				{ config: { ...context(index, 2).config, maxWorkers: 2 } },
				measured,
			).shard(input),
		),
	);
	assert.deepEqual(assigned, [[input[0]], input.slice(1)]);
});

test("every file belongs to exactly one shard, including unknown and empty inputs", async () => {
	for (const input of [[], files.slice(0, 1), files, [...files].reverse()]) {
		for (const map of [{}, timings]) {
			for (const count of [1, 2, 3, 4, 8]) {
				const assigned = (
					await Promise.all(
						Array.from({ length: count }, (_, index) =>
							new DurationSequencer(context(index + 1, count), map).shard(input),
						),
					)
				).flat();
				assert.equal(assigned.length, input.length);
				for (const file of input)
					assert.equal(assigned.filter((entry) => entry === file).length, 1, file.moduleId);
			}
		}
	}
});

test("the committed timing map assigns every measured file exactly once", async () => {
	const map = JSON.parse(readFileSync(new URL("./vitest-timings.json", import.meta.url), "utf8"));
	const measured = Object.keys(map.files).map(spec);
	const assigned = (
		await Promise.all(
			[1, 2, 3, 4].map((index) => new DurationSequencer(context(index, 4)).shard(measured)),
		)
	).flat();
	assert.equal(assigned.length, measured.length);
	for (const file of measured)
		assert.equal(assigned.filter((entry) => entry === file).length, 1, file.moduleId);
});

test("shards with different runtime worker counts assign every file exactly once", async () => {
	const map = JSON.parse(readFileSync(new URL("./vitest-timings.json", import.meta.url), "utf8"));
	const input = [...Object.keys(map.files).map(spec), spec("apps/desktop/unmeasured.test.ts")];
	const assigned = (
		await Promise.all(
			[2, 4, 2, 2].map((maxWorkers, index) =>
				new DurationSequencer({
					config: { ...context(index + 1, 4).config, maxWorkers },
				}).shard(input),
			),
		)
	).flat();
	assert.equal(assigned.length, input.length);
	for (const file of input)
		assert.equal(assigned.filter((entry) => entry === file).length, 1, file.moduleId);
});

test("unknown files use Vitest's default sharding without changing the input", async () => {
	assert.deepEqual(await new DurationSequencer({ config: { root } }, timings).shard(files), files);
	const unknown = files.slice(4);
	for (const index of [1, 2, 3]) {
		const assigned = await new DurationSequencer(context(index, 3), timings).shard(files);
		assert.deepEqual(
			assigned.filter((file) => unknown.includes(file)),
			await new BaseSequencer(context(index, 3)).shard(unknown),
		);
	}
	assert.deepEqual(
		files.map((file) => file.moduleId),
		["a", "b", "c", "d", "new"].map((name) => resolve(root, `apps/desktop/${name}.test.ts`)),
	);
});

test("CI timing JSON lines refresh the map without depending on human console formatting", () => {
	const log = [];
	const reporter = new FileTimingReporter();
	reporter.onInit({ config: { root }, logger: { log: (line) => log.push(line) } });
	reporter.onTestModuleEnd({ moduleId: files[0].moduleId, diagnostic: () => ({ duration: 16.2 }) });
	assert.deepEqual(timingMap(timingEntries(`2026-10-17T00:00:00Z ${log[0]}`)), {
		"apps/desktop/a.test.ts": 17,
	});
});

test("the timing reporter does not invent durations for uncollected modules", () => {
	const log = [];
	const reporter = new FileTimingReporter();
	const module = { moduleId: files[0].moduleId, diagnostic: () => ({}) };
	reporter.onTestModuleEnd(module);
	reporter.onInit({ config: { root }, logger: { log: (line) => log.push(line) } });
	reporter.onTestModuleEnd(module);
	assert.deepEqual(log, []);
});

test("refresh accepts Vitest JSON reports and bootstraps measured legacy CI logs", () => {
	assert.deepEqual(
		timingEntries(
			JSON.stringify({
				testResults: [
					{
						name: ["", "home", "runner", "work", "studio", "apps", "desktop", "a.test.ts"].join(
							"/",
						),
						startTime: 100,
						endTime: 119,
					},
				],
			}),
		),
		[{ file: "apps/desktop/a.test.ts", duration: 19 }],
	);
	assert.deepEqual(
		timingEntries(
			"2026-10-17T00:00:00Z  +  desktop  a.test.ts (2 tests) 31ms",
			() => "apps/desktop",
		),
		[{ file: "apps/desktop/a.test.ts", duration: 31 }],
	);
	assert.deepEqual(
		timingMap([
			{ file: "apps/desktop/a.test.ts", duration: 19 },
			{ file: "apps/desktop/a.test.ts", duration: 31 },
		]),
		{ "apps/desktop/a.test.ts": 31 },
	);
});

test("refresh refuses missing timings, invalid paths and invalid durations", () => {
	assert.throws(() => timingEntries("no timing evidence"), /No Vitest file timings/);
	assert.throws(() => timingMap(timingEntries('{"testResults":[]}')), /No Vitest file timings/);
	for (const file of [
		"../a.test.ts",
		"apps/../a.test.ts",
		"apps/desktop/../../a.test.ts",
		["C:", "a.test.ts"].join("/"),
		"apps/a.ts",
	])
		assert.throws(() => timingMap([{ file, duration: 1 }]), /Invalid repo-relative/);
	for (const duration of [-1, Infinity, NaN, "20"])
		assert.throws(() => timingMap([{ file: "apps/a.test.ts", duration }]), /Invalid file duration/);
});
