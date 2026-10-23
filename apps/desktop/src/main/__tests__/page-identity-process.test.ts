import { type ChildProcess, fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { parseLessonSource, resolveLessonSources, writeLessonSource } from "../lesson-source";

const roots: string[] = [];
const children: ChildProcess[] = [];
const source = "---\ntitle: Probe\n---\n\n# First\n\nText.\n";
async function cleanup() {
	await Promise.all(
		children.splice(0).map(async (child) => {
			if (child.exitCode !== null || child.signalCode !== null) return;
			const exited = once(child, "exit");
			child.kill();
			await exited;
		}),
	);
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}
afterEach(cleanup);
afterAll(cleanup);

async function writer() {
	const child = fork(fileURLToPath(new URL("./fixtures/identity-writer.ts", import.meta.url)), {
		execArgv: ["--import", "tsx"],
		stdio: ["ignore", "ignore", "pipe", "ipc"],
	});
	children.push(child);
	let errors = "";
	child.stderr?.on("data", (chunk) => {
		errors += chunk;
	});
	const [ready] = await Promise.race([
		once(child, "message"),
		once(child, "exit").then(() => {
			throw new Error(errors || "Identity writer exited");
		}),
	]);
	expect(ready).toEqual({ ready: true });
	return child;
}

const trials: { root: string; results: Awaited<ReturnType<typeof once>>[] }[] = [];
let writers: ChildProcess[];
beforeAll(async () => {
	writers = await Promise.all([writer(), writer()]);
});
for (let trial = 0; trial < 5; trial++) {
	beforeAll(async () => {
		const root = await mkdtemp(join(tmpdir(), "identity-race-"));
		roots.push(root);
		const done = writers.map((child) => once(child, "message"));
		writers.forEach((child, index) =>
			child.send({ root, filename: `lesson-${index}.prax`, source }),
		);
		const results = await Promise.all(done);
		trials.push({ root, results });
	});
}

it("retains both lessons when two processes add identities in five trials", async () => {
	for (const { root, results } of trials) {
		for (const [message] of results) expect.soft(message.error).toBeUndefined();
		const metadata = (await resolveLessonSources(root)).identity;
		// Keep all five race trials in the failure evidence instead of stopping at the first loss.
		expect
			.soft(metadata.heads.map((lesson: { path: string }) => lesson.path).sort())
			.toEqual(["lesson-0.prax", "lesson-1.prax"]);
		for (let index = 0; index < 2; index++) {
			expect
				.soft(
					(await parseLessonSource(root, `lesson-${index}.prax`, source)).pages.map(
						(page) => page.id,
					),
				)
				.toEqual(results[index][0].result);
		}
	}
}, 30_000);

it("refuses a hung live owner, then recovers immediately after its process crashes", async () => {
	const root = await mkdtemp(join(tmpdir(), "identity-crash-"));
	roots.push(root);
	const child = await writer();
	const held = once(child, "message");
	child.send({ root, hold: true });
	expect((await held)[0]).toEqual({ held: true });
	// Advance only the contention clock; the child still owns the real SQLite lock.
	const clock = vi
		.spyOn(performance, "now")
		.mockReturnValueOnce(0)
		.mockReturnValue(Number.MAX_SAFE_INTEGER);
	try {
		await expect(
			writeLessonSource(root, "after-crash.prax", "# Recovered\n"),
		).rejects.toMatchObject({
			code: "EPROJECTBUSY",
		});
	} finally {
		clock.mockRestore();
	}
	const exited = once(child, "exit");
	child.kill("SIGKILL");
	await exited;
	await writeLessonSource(root, "after-crash.prax", "# Recovered\n");
	expect(
		(await resolveLessonSources(root)).identity.heads.map(
			(lesson: { path: string }) => lesson.path,
		),
	).toEqual(["after-crash.prax"]);
}, 30_000);
