import { type ChildProcess, fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { resolveLessonSources } from "../lesson-source";
import { withProjectFileTransaction, writeProjectTextFile } from "../project-file-transactions";

const roots: string[] = [];
const children: ChildProcess[] = [];
let writerRoot: string;
let writerEntry: string;
beforeAll(async () => {
	writerRoot = await mkdtemp(join(tmpdir(), "lock-ownership-writer-"));
	writerEntry = join(writerRoot, "writer.mjs");
	// Compile once; each contender still runs the real writer in a separate process.
	await build({
		entryPoints: [fileURLToPath(new URL("./fixtures/os-lock-writer.ts", import.meta.url))],
		outfile: writerEntry,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		banner: {
			js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
		},
	});
});
afterAll(async () => {
	if (writerRoot) await rm(writerRoot, { recursive: true, force: true });
});
async function project() {
	const root = await mkdtemp(join(tmpdir(), "lock-ownership-"));
	roots.push(root);
	return root;
}
function writer(mode: string, root: string) {
	const child = fork(writerEntry, [mode, root], {
		execArgv: [],
		stdio: ["ignore", "ignore", "pipe", "ipc"],
	});
	children.push(child);
	return child;
}
function message(child: ChildProcess, key: string): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		let errors = "";
		child.stderr?.on("data", (chunk) => {
			errors += chunk;
		});
		const onExit = (code: number | null) =>
			reject(new Error(`${key}: child exited ${code}: ${errors}`));
		const onMessage = (value: Record<string, unknown>) => {
			if (!value[key]) return;
			child.off("message", onMessage);
			child.off("exit", onExit);
			resolve(value);
		};
		child.on("message", onMessage);
		child.once("exit", onExit);
	});
}
afterEach(async () => {
	await Promise.all(
		children.splice(0).map(async (child) => {
			if (child.exitCode !== null || child.signalCode !== null) return;
			const exited = once(child, "exit");
			child.kill("SIGKILL");
			await exited;
		}),
	);
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("does not recover a live writer while staged filesystem I/O is indefinitely stalled", async () => {
	const root = await project();
	const old = writer("rename", root);
	await message(old, "paused");
	const replacement = writer("identity", root);
	expect((await message(replacement, "done")).code).toBe("EPROJECTBUSY");
	const done = message(old, "done");
	old.send({ resume: true });
	expect((await done).error).toBeUndefined();
	const retry = writer("identity", root);
	expect((await message(retry, "done")).error).toBeUndefined();
	const metadata = (await resolveLessonSources(root)).identity;
	expect(metadata.heads.map((lesson: { path: string }) => lesson.path).sort()).toEqual([
		"new.prax",
		"old.prax",
	]);
}, 25_000);

// Two child writers: Intel Mac max 6426.2 ms, Linux CI 876 ms; allow twice the slower run.
it("removing obsolete ownership files cannot displace a staged writer", async () => {
	const root = await project();
	const old = writer("rename", root);
	await message(old, "paused");
	await rm(join(root, ".praxity-identity.lock"), { recursive: true, force: true });
	const replacement = writer("identity-waiting", root);
	const waiting = message(replacement, "waiting");
	let held = false;
	const replacementDone = message(replacement, "done").then((result) => {
		held = true;
		return result;
	});
	await waiting;
	expect(held).toBe(false);
	const done = message(old, "done");
	old.send({ resume: true });
	expect((await done).error).toBeUndefined();
	expect((await replacementDone).error).toBeUndefined();
	expect(
		(await resolveLessonSources(root)).identity.heads
			.map((lesson: { path: string }) => lesson.path)
			.sort(),
	).toEqual(["new.prax", "old.prax"]);
}, 12_853); // timeout: docs/context/testing-strategy.md; run 38146537167

it("recovers a killed staged text writer and removes abandoned staging directories", async () => {
	const root = await project();
	await writeFile(join(root, "course.yaml"), "title: Original\n");
	const old = writer("staged", root);
	await message(old, "paused");
	const exited = once(old, "exit");
	old.kill("SIGKILL");
	await exited;
	expect(await readFile(join(root, "course.yaml"), "utf8")).toBe("title: Original\n");
	await writeProjectTextFile(root, "course.yaml", "title: Recovered\n", "title: Original\n");
	expect(await readFile(join(root, "course.yaml"), "utf8")).toBe("title: Recovered\n");
	expect((await readdir(root)).filter((name) => name.startsWith(".praxity-write-"))).toHaveLength(
		1,
	);
	await withProjectFileTransaction(root, async () => {}, "write");
	expect(await readdir(root)).toEqual(["course.yaml"]);
});

it("retains differing staging bytes after a writer death without blocking a later save", async () => {
	const root = await project();
	await writeFile(join(root, "course.yaml"), "title: Original\n");
	const old = writer("staged-differing", root);
	await message(old, "paused");
	const exited = once(old, "exit");
	old.kill("SIGKILL");
	await exited;
	await writeProjectTextFile(root, "course.yaml", "title: Recovered\n", "title: Original\n");
	await withProjectFileTransaction(root, async () => {}, "write");
	const archives = (await readdir(root)).filter((name) => name.startsWith(".praxity-write-"));
	expect(archives).toHaveLength(1);
	expect(await readFile(join(root, archives[0], "install-0"), "utf8")).toBe("PARTIAL BYTES");
	expect(await readFile(join(root, "course.yaml"), "utf8")).toBe("title: Recovered\n");
});

it("mtime changes cannot compromise an owner or crash its process", async () => {
	const root = await project();
	const old = writer("rename", root);
	const paused = await message(old, "paused");
	const future = new Date(Date.now() + 60000);
	await utimes(String(paused.lockPath), future, future);
	expect(old.exitCode).toBeNull();
	const done = message(old, "done");
	old.send({ resume: true });
	expect((await done).error).toBeUndefined();
	await writeProjectTextFile(root, "course.yaml", "title: Retry\n");
	expect(await readdir(root)).toEqual([".praxity", "course.yaml", "old.prax"]);
}, 20_000);
