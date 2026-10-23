import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { realpath as fsRealpath } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { assertAllowedProjectRoot, projectLockCacheDirectory } from "../path-security";
import { withProjectFileTransaction, writeProjectFiles } from "../project-file-transactions";
import { killJournalWriter } from "./fixtures/kill-journal-writer";

const filesystem = vi.hoisted(() => ({ callerCase: false, windows: process.platform === "win32" }));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		// Model JS realpath retaining the caller's spelling, as in the review probe.
		realpath: async (...args: Parameters<typeof fs.realpath>) =>
			filesystem.callerCase ? String(args[0]) : fs.realpath(...args),
		open: async (...args: Parameters<typeof fs.open>) => {
			if (
				filesystem.windows &&
				process.platform === "darwin" &&
				(
					await fs.lstat(args[0]).catch((error) => {
						if (error.code !== "ENOENT") throw error;
						return undefined;
					})
				)?.isDirectory()
			)
				return { sync: async () => {}, close: async () => {} };
			return fs.open(...args);
		},
	};
});

vi.mock("node:path", async (importOriginal) => {
	const path = await importOriginal<typeof import("node:path")>();
	return {
		...path,
		relative: (...args: Parameters<typeof path.relative>) => {
			const value = path.relative(...args);
			return process.platform === "win32" ? value : value.replaceAll("\\", "/");
		},
	};
});
const roots: string[] = [];
const platform = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
afterEach(async () => {
	filesystem.callerCase = false;
	Object.defineProperty(process, "platform", platform);
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function project() {
	const root = await mkdtemp(join(tmpdir(), "Journal-Case-"));
	roots.push(root);
	await writeFile(join(root, "a.prax"), "A0");
	return root;
}
it("D6 resolves an admitted case alias to the native filesystem spelling", async () => {
	const root = await project();
	const native = await promisify(fsRealpath.native)(root);
	const alias = root.toLowerCase();
	const exists = await lstat(alias).catch((error) => {
		if (error.code !== "ENOENT") throw error;
		return undefined;
	});
	filesystem.callerCase = Boolean(exists);
	// Linux/case-sensitive APFS still checks native canonical admission of its existing name.
	expect(await assertAllowedProjectRoot(exists ? alias : root)).toBe(native);
});
it("D6 folds Darwin lock keys and durable course binding together", async () => {
	const root = await project();
	Object.defineProperty(process, "platform", { value: "darwin" });
	await writeProjectFiles(root, [{ path: "a.prax", content: "A1" }], {
		onStep: async ({ kind }) => {
			if (kind !== "journal") return;
			const native = await promisify(fsRealpath.native)(root);
			const journal = JSON.parse(await readFile(join(root, ".praxity-transaction.json"), "utf8"));
			expect(journal.plan.course).toBe(native.toLowerCase());
			const key = createHash("sha256").update(native.toLowerCase()).digest("hex");
			expect((await lstat(join(projectLockCacheDirectory(), `${key}.sqlite`))).isFile()).toBe(true);
		},
	});
});
it("D6 recovers a dead writer's legacy Darwin journal with a mixed-case course binding", async () => {
	const root = await project();
	await writeFile(join(root, "b.prax"), "B0");
	await killJournalWriter(root, "design:staged:1");
	const journal = JSON.parse(await readFile(join(root, ".praxity-transaction.json"), "utf8"));
	const stage = join(root, journal.plan.stage);
	// Recreate main's pre-D6 Darwin binding and directory layout at this death point.
	journal.plan.course = await promisify(fsRealpath.native)(root);
	journal.plan.captureVersion = 1;
	delete journal.plan.stageVersion;
	journal.checksum = createHash("sha256").update(JSON.stringify(journal.plan)).digest("hex");
	for (const [index, file] of journal.plan.files.entries()) {
		await mkdir(join(stage, String(index)));
		await rename(join(stage, `install-${index}`), join(stage, String(index), basename(file.path)));
		await writeFile(join(stage, `staged-${index}`), journal.checksum);
	}
	for (const path of [join(root, ".praxity-transaction.json"), join(stage, "journal.tmp")])
		await writeFile(path, JSON.stringify(journal));
	Object.defineProperty(process, "platform", { value: "darwin" });
	await withProjectFileTransaction(root, async () => {}, "write");
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A0");
	expect(await readFile(join(root, "b.prax"), "utf8")).toBe("B0");
	await expect(lstat(join(root, ".praxity-transaction.json"))).rejects.toMatchObject({
		code: "ENOENT",
	});
	await expect(lstat(stage)).rejects.toMatchObject({ code: "ENOENT" });
});
it("D6 keeps case aliases excluded by the same real process lock under Darwin policy", async () => {
	const root = await project();
	const child = fork(
		fileURLToPath(new URL("./fixtures/os-lock-writer.ts", import.meta.url)),
		["hold", root, "darwin"],
		{
			execArgv: ["--import", "tsx"],
			stdio: ["ignore", "ignore", "pipe", "ipc"],
		},
	);
	const exited = once(child, "exit");
	try {
		const [paused] = await once(child, "message");
		expect(paused.paused).toBe(true);
		Object.defineProperty(process, "platform", { value: "darwin" });
		const alias = root.toLowerCase();
		const exists = await lstat(alias).catch((error) => {
			if (error.code !== "ENOENT") throw error;
			return undefined;
		});
		let entered = false;
		const admission = withProjectFileTransaction(
			exists ? alias : root,
			async () => {
				entered = true;
			},
			"write",
		);
		await delay(100);
		expect.soft(entered).toBe(false);
		child.send({ resume: true });
		await admission;
		expect(entered).toBe(true);
	} finally {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		await exited;
	}
});
