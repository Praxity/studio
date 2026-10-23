import { type ChildProcess, execFileSync, fork } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { fixtureTmpdir } from "../../test-utils/fixture-temp";
import { runPraxityCli } from "../cli";
import { resolveLessonSources } from "../lesson-source";
import { withProjectFileTransaction, writeProjectTextFile } from "../project-file-transactions";

const roots: string[] = [];
let writerRoot: string;
let writerEntry: string;
beforeAll(async () => {
	writerRoot = await mkdtemp(join(fixtureTmpdir("project-os-lock"), "os-lock-writer-"));
	writerEntry = join(writerRoot, "writer.mjs");
	// Match the ownership suite: compile once, keep separate real lock contenders.
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
const lookup = vi.hoisted(() => ({ sensitive: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		lstat: async (...args: Parameters<typeof fs.lstat>) => {
			const path = String(args[0]);
			if (
				dirname(path) === lookup.sensitive &&
				!(await fs.readdir(dirname(path))).includes(basename(path))
			)
				throw Object.assign(new Error("Case-sensitive name absent"), { code: "ENOENT" });
			return fs.lstat(...args);
		},
	};
});
const children: ChildProcess[] = [];
type Message = { paused?: boolean; done?: boolean; error?: string; code?: string };
async function project() {
	const root = await mkdtemp(join(fixtureTmpdir("project-os-lock"), "os-project-lock-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: Original\n");
	return root;
}
function writer(mode: string, root: string) {
	const child = fork(writerEntry, [mode, root], {
		execArgv: [],
		stdio: ["ignore", "ignore", "pipe", "ipc"],
	});
	children.push(child);
	const inbox: Message[] = [];
	const waiting = new Map<string, (message: Message) => void>();
	child.on("message", (message: Message) => {
		const key = message.paused ? "paused" : "done";
		const receive = waiting.get(key);
		if (receive) {
			waiting.delete(key);
			receive(message);
		} else inbox.push(message);
	});
	return {
		child,
		message: (key: "paused" | "done") => {
			const index = inbox.findIndex((message) => message[key]);
			if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0]);
			return new Promise<Message>((resolve, reject) => {
				waiting.set(key, resolve);
				child.once("exit", () => reject(new Error(`Writer exited before ${key}`)));
			});
		},
	};
}
afterEach(async () => {
	lookup.sensitive = "";
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

it("serializes identity replacement even when the old lock directory is removed after rename dispatch", async () => {
	const root = await project();
	const first = writer("rename", root);
	await first.message("paused");
	await rm(join(root, ".praxity-identity.lock"), { recursive: true, force: true });
	const second = writer("identity", root);
	let completed = false;
	const secondDone = second.message("done").then((result) => {
		completed = true;
		return result;
	});
	await new Promise((resolve) => setTimeout(resolve, 300));
	expect.soft(completed).toBe(false);
	first.child.send({ resume: true });
	expect.soft((await first.message("done")).error).toBeUndefined();
	expect.soft((await secondDone).error).toBeUndefined();
	expect(
		(await resolveLessonSources(root)).identity.heads
			.map((lesson: { path: string }) => lesson.path)
			.sort(),
	).toEqual(["new.prax", "old.prax"]);
}, 20_000);

it("publishes no owner journal that can be truncated during stage registration", async () => {
	const root = await project();
	expect((await writer("no-journal", root).message("done")).error).toBeUndefined();
	expect(await readFile(join(root, "course.yaml"), "utf8")).toBe("title: Edited\n");
});

for (const marker of [
	"",
	'{"pid":1,"host":"another-host"}',
	`{"pid":${process.pid},"host":"reused-pid"}`,
]) {
	// Confirmation runs in another PID; retain the current-PID fixture with a stable title.
	const label = marker.includes("reused-pid")
		? "current process on reused host"
		: marker || "truncated";
	it(`ignores obsolete owner records without inferring ownership: ${label}`, async () => {
		const root = await project();
		await mkdir(join(root, ".praxity-identity.lock"));
		await writeFile(
			join(root, ".praxity-identity.lock", "owner-00000000-0000-0000-0000-000000000000.json"),
			marker,
		);
		expect((await writer("text", root).message("done")).error).toBeUndefined();
	}, 10_000);
}

it("releases on SIGKILL and cleans stages for every target without an owner journal", async () => {
	const root = await project();
	await mkdir(join(root, ".praxity"));
	await mkdir(join(root, ".praxity", ".praxity-write-content-identity.json.abandoned"));
	const first = writer("staged", root);
	await first.message("paused");
	const exited = once(first.child, "exit");
	first.child.kill("SIGKILL");
	await exited;
	expect(await readFile(join(root, "course.yaml"), "utf8")).toBe("title: Original\n");
	const started = performance.now();
	await writeProjectTextFile(root, "course.yaml", "title: Recovered\n", "title: Original\n");
	// Owner decision 2026-10-12: macOS flush timings are advisory; recovery assertions still run.
	if (process.platform !== "darwin") expect(performance.now() - started).toBeLessThan(2000);
	expect(await readFile(join(root, "course.yaml"), "utf8")).toBe("title: Recovered\n");
	expect(await readdir(join(root, ".praxity"))).toEqual([]);
	expect((await readdir(root)).filter((name) => name.startsWith(".praxity-write-course"))).toEqual(
		[],
	);
}, 15000);

it("times out a hung owner with a busy error, preserves bytes, and permits retry", async () => {
	const root = await project();
	const holder = writer("hold", root);
	await holder.message("paused");
	const started = performance.now();
	const result = await writer("text", root).message("done");
	expect(result.code).toBe("EPROJECTBUSY");
	expect(result.error).toMatch(/project is busy in another Studio window or process/i);
	expect(performance.now() - started).toBeLessThan(6500);
	expect(await readFile(join(root, "course.yaml"), "utf8")).toBe("title: Original\n");
	holder.child.send({ resume: true });
	await holder.message("done");
	await writeProjectTextFile(root, "course.yaml", "title: Retry\n", "title: Original\n");
}, 20_000);

it("does not consult wall time or schedule heartbeat filesystem mutations", async () => {
	const root = await project();
	await withProjectFileTransaction(root, async () => {
		expect(
			(await readdir(root)).some((name) => name.startsWith("owner-") || name.endsWith(".lock")),
		).toBe(false);
	});
});

it("a read-only transaction leaves the course folder's bytes and entries unchanged", async () => {
	const root = await project();
	const stage = join(root, ".praxity-write-course.yaml.abandoned");
	await mkdir(stage);
	await writeFile(join(stage, "course.yaml"), "RECOVERY BYTES");
	expect(
		await withProjectFileTransaction(root, async (canonicalRoot) =>
			readFile(join(canonicalRoot, "course.yaml"), "utf8"),
		),
	).toBe("title: Original\n");
	expect((await readdir(root)).sort()).toEqual([
		".praxity-write-course.yaml.abandoned",
		"course.yaml",
	]);
	expect(await readFile(join(stage, "course.yaml"), "utf8")).toBe("RECOVERY BYTES");
	expect(await readFile(join(root, "course.yaml"), "utf8")).toBe("title: Original\n");
});

for (const marker of ["course.yaml", ".praxity", "praxity.json"]) {
	it(`parent recovery preserves nested project stages marked by ${marker}`, async () => {
		const root = await project();
		const nested = join(root, "child");
		const stage = join(nested, ".praxity-write-course.yaml.abandoned");
		await mkdir(stage, { recursive: true });
		if (marker === ".praxity") await mkdir(join(nested, marker));
		else await writeFile(join(nested, marker), "title: Child\n");
		await writeFile(join(stage, "course.yaml"), "RECOVERY BYTES");
		await writeProjectTextFile(root, "course.yaml", "title: Parent\n", "title: Original\n");
		expect(await readFile(join(stage, "course.yaml"), "utf8")).toBe("RECOVERY BYTES");
	});
}

for (const marker of ["course.yaml", ".praxity", "praxity.json"])
	for (const sensitive of [false, true]) {
		it(`keeps unverified recovery bytes with an uppercase nested ${marker}, case-sensitive=${sensitive}`, async () => {
			const root = await project();
			const nested = join(root, "child");
			const stage = join(nested, ".praxity-write-course.yaml.abandoned");
			await mkdir(stage, { recursive: true });
			if (sensitive && process.platform === "win32") {
				try {
					execFileSync("fsutil", ["file", "setCaseSensitiveInfo", nested, "enable"], {
						windowsHide: true,
						stdio: "pipe",
					});
					console.info("Recovery name lookup: native case-sensitive directory");
				} catch {
					lookup.sensitive = nested;
					console.info("Recovery name lookup: case-sensitive lstat seam; fsutil unavailable");
				}
			}
			if (marker === ".praxity") await mkdir(join(nested, marker.toUpperCase()));
			else await writeFile(join(nested, marker.toUpperCase()), "title: Child\n");
			await writeFile(join(stage, "course.yaml"), "RECOVERY BYTES");
			await writeProjectTextFile(root, "course.yaml", "title: Parent\n", "title: Original\n");
			expect(await readFile(join(stage, "course.yaml"), "utf8")).toBe("RECOVERY BYTES");
			const inventory = await runPraxityCli(["recovery", "list", nested], {
				appVersion: "test",
				exportAssetsDir: "unused",
			});
			expect(inventory.exitCode).toBe(0);
			expect(JSON.parse(inventory.stdout).archives).toContainEqual(
				expect.objectContaining({ stage: basename(stage), status: "unverified" }),
			);
		});
	}
