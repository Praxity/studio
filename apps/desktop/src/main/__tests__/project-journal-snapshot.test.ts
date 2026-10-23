import { type ChildProcess, fork } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { buildCourseExportInput } from "../export/build-export-input-from-project";
import { inspectProject } from "../export/inspect-project";
import { inspectProjectV1 } from "../export/inspect-project-v1";
import { withProjectFileTransaction } from "../project-file-transactions";
import { killJournalWriter } from "./fixtures/kill-journal-writer";

const observed = vi.hoisted(() => ({ path: "", read: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		open: async (...args: Parameters<typeof fs.open>) => {
			const file = await fs.open(...args);
			if (String(args[0]) === observed.path) {
				const read = file.readFile.bind(file);
				file.readFile = (async (...options: Parameters<typeof file.readFile>) => {
					const result = await read(...options);
					observed.read = true;
					return result;
				}) as typeof file.readFile;
			}
			return file;
		},
	};
});
const roots: string[] = [];
const children: ChildProcess[] = [];
const sources = ["# Café 😀\r\nOld words.\nKeep this.\rLast line", "# Second\n\nsecond old"];

it("T1 excludes reserved recovery paths nested in exported assets", async () => {
	const root = await project();
	await mkdir(join(root, "assets", ".praxity-write-unknown"), { recursive: true });
	await writeFile(join(root, "assets", ".praxity-write-unknown", "private.bin"), "recovery bytes");
	await writeFile(join(root, "assets", ".praxity-transaction.json"), "recovery bytes");
	await writeFile(join(root, "assets", "public.bin"), "authored media");
	const result = await buildCourseExportInput({
		projectDir: root,
		scope: "course",
		completionThreshold: 0,
		viewerVersionPath: join(root, "viewer.json"),
		manifestPolicy: "read-only",
		inheritWorkspaceSettings: false,
	});
	expect([...result.resolvedAssets.keys()]).toEqual(["assets/public.bin"]);
});
async function project() {
	const root = await mkdtemp(join(tmpdir(), "journal-snapshot-"));
	roots.push(root);
	await Promise.all([
		writeFile(join(root, "lesson.prax"), sources[0]),
		writeFile(join(root, "second.prax"), sources[1]),
		writeFile(join(root, "head.json"), "head old"),
		writeFile(
			join(root, "course.yaml"),
			"id: snapshot-course\ntitle: Snapshot\nlessons: [lesson.prax, second.prax]\n",
		),
		writeFile(join(root, "viewer.json"), '{"viewerSourceHash":"snapshot"}'),
	]);
	await persistFixtureIdentity(root);
	return root;
}
afterEach(async () => {
	vi.restoreAllMocks();
	observed.path = "";
	observed.read = false;
	for (const child of children.splice(0)) {
		if (child.exitCode !== null || child.signalCode !== null) continue;
		const exited = once(child, "exit");
		child.kill("SIGKILL");
		await exited;
	}
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

for (const inspect of [inspectProject, inspectProjectV1]) {
	it(`T1 ${inspect.name} reads hashes only after course recovery`, async () => {
		const root = await project();
		await killJournalWriter(root, "installed:0", sources);
		await expect(inspect(root, "test")).rejects.toThrow(/save or the next write/i);
		await withProjectFileTransaction(root, async () => {}, "write");
		const result = await inspect(root, "test");
		expect(result.lessons[0].sha256).toBe(createHash("sha256").update(sources[0]).digest("hex"));
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(sources[0]);
	});
}

for (const reader of ["export", "inspect", "inspect-v1"]) {
	it(`T1 ${reader} holds one admission across a competing complete course write`, async () => {
		const root = await project();
		// An established course has a lock to hold throughout the read snapshot.
		await withProjectFileTransaction(root, async () => {}, "write");
		observed.path = join(root, "lesson.prax");
		const close = DatabaseSync.prototype.close;
		let done: Promise<unknown> | undefined;
		vi.spyOn(DatabaseSync.prototype, "close").mockImplementation(function (this: DatabaseSync) {
			close.call(this);
			if (!observed.read || done) return;
			const child = fork(
				fileURLToPath(new URL("./fixtures/snapshot-writer.ts", import.meta.url)),
				[root],
				{
					execArgv: ["--import", "tsx"],
					stdio: ["ignore", "ignore", "pipe", "ipc"],
				},
			);
			children.push(child);
			done = once(child, "message").then(([message]) => {
				expect(message).toEqual({ done: true });
			});
			// The reviewer used this interleaving: give the other process time to commit after release.
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 700);
		});
		const result =
			reader === "export"
				? await buildCourseExportInput({
						projectDir: root,
						scope: "course",
						completionThreshold: 0,
						viewerVersionPath: join(root, "viewer.json"),
						manifestPolicy: "read-only",
						inheritWorkspaceSettings: false,
						loadAssets: false,
					})
				: await (reader === "inspect" ? inspectProject : inspectProjectV1)(root, "test");
		expect(done).toBeDefined();
		await done;
		const output = JSON.stringify(result);
		expect(output).toContain("Old words.");
		expect(output).toContain("second old");
		expect(output).not.toContain("second new");
		expect(await readFile(join(root, "second.prax"), "utf8")).toBe("second new");
	});
}
