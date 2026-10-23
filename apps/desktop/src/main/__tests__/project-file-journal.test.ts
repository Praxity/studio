import { type ChildProcess, execFile, fork } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { writeLessonSource } from "../lesson-source";
import {
	withProjectFileTransaction,
	writeProjectFiles,
	writeProjectTextFile,
} from "../project-file-transactions";
import { readProjectTree } from "../project-tree";

const roots: string[] = [];
const children: ChildProcess[] = [];
const original = ["# Café 😀\r\nOld words.\nKeep this.\rLast line", "second old", "head old"];
const edited = ["# Café 😀\r\nNew words.\nKeep this.\rLast line", "second new", "head new"];
const paths = ["lesson.prax", "second.prax", "head.json"];

it("T1 excludes course recovery artifacts from git add and the file tree", async () => {
	const root = await project();
	const git = promisify(execFile);
	await git("git", ["-C", root, "init"]);
	await killedWriter(root, "staged:0");
	const status = (await git("git", ["-C", root, "status", "--porcelain", "--untracked-files=all"]))
		.stdout;
	expect(status).not.toContain(".praxity-transaction");
	expect(status).not.toContain(".praxity-write-");
	await git("git", ["-C", root, "add", "."]);
	const tracked = (await git("git", ["-C", root, "ls-files"])).stdout;
	expect(tracked).not.toContain(".praxity-transaction");
	expect(tracked).not.toContain(".praxity-write-");
	await expect(readProjectTree(root)).rejects.toMatchObject({ code: "ERECOVERYREQUIRED" });
	await withProjectFileTransaction(root, async () => {}, "write");
	expect((await readProjectTree(root)).map((node) => node.name)).toEqual(paths.slice().sort());
});

for (const layout of ["nested [course]", "linked worktree"]) {
	it(`T1 installs course-scoped Git exclusions in a ${layout}`, async () => {
		const repository = await project();
		const git = promisify(execFile);
		await git("git", ["-C", repository, "init"]);
		const root = join(repository, layout === "linked worktree" ? "linked" : layout);
		if (layout === "linked worktree") {
			await git("git", [
				"-C",
				repository,
				"-c",
				"user.name=Ariel Harlap",
				"-c",
				"user.email=3870784+aharlap@users.noreply.github.com",
				"commit",
				"--allow-empty",
				"-m",
				"Test fixture",
			]);
			await git("git", ["-C", repository, "worktree", "add", "--detach", root]);
		} else await mkdir(root);
		await Promise.all(paths.map((path, index) => writeFile(join(root, path), original[index])));
		const exclude = join(repository, ".git", "info", "exclude");
		const authoredPolicy = "# Existing policy\r\nexisting-rule\n";
		await writeFile(exclude, authoredPolicy);
		await killedWriter(root, "staged:0");
		const status = (
			await git("git", ["-C", root, "status", "--porcelain", "--untracked-files=all"])
		).stdout;
		expect(status).not.toContain(".praxity-transaction");
		expect(status).not.toContain(".praxity-write-");
		expect((await readFile(exclude, "utf8")).startsWith(authoredPolicy)).toBe(true);
		await withProjectFileTransaction(root, async () => {}, "write");
	});
}

it("T1 reclaims a verified cleanup orphan on write admission and keeps unverified bytes", async () => {
	const root = await project();
	await killedWriter(root, "cleanup-orphan");
	const stage = (await readdir(root)).find((name) => name.startsWith(".praxity-write-")) as string;
	expect(stage).toBeDefined();
	const unverified = ".praxity-write-12345678-1234-4234-8234-123456789abc";
	await mkdir(join(root, unverified));
	await writeFile(join(root, unverified, "unknown"), "authored recovery bytes");
	await expect(withProjectFileTransaction(root, () => bytes(root), "write")).resolves.toEqual(
		edited,
	);
	await expect(readFile(join(root, stage, "journal.tmp"))).rejects.toMatchObject({
		code: "ENOENT",
	});
	await writeProjectFiles(root, [{ path: paths[0], content: original[0] }]);
	expect(await readFile(join(root, unverified, "unknown"), "utf8")).toBe("authored recovery bytes");
}, 15_000);
for (const marker of ["journal", "staged-0", "ready", "abort"]) {
	for (const phase of ["empty", "partial"]) {
		it(`T1 admits after death inside ${phase} ${marker} publication`, async () => {
			const root = await project();
			await killedWriter(root, `marker:${marker}:${phase}`);
			await expect(withProjectFileTransaction(root, () => bytes(root), "write")).resolves.toEqual(
				marker === "abort" ? edited : original,
			);
			await expect(withProjectFileTransaction(root, () => bytes(root), "write")).resolves.toEqual(
				marker === "abort" ? edited : original,
			);
		});
	}
}
for (const phase of ["empty", "partial"]) {
	it(`T1 repeats conflict recovery after death inside ${phase} conflict publication`, async () => {
		const root = await project();
		await killedWriter(root, "installed:0");
		await writeFile(join(root, paths[1]), "outside");
		await killedWriter(root, `marker:conflict:${phase}`);
		await expect(withProjectFileTransaction(root, () => bytes(root), "write")).rejects.toThrow(
			/conflict/i,
		);
		await expect(withProjectFileTransaction(root, () => bytes(root), "write")).resolves.toEqual([
			original[0],
			"outside",
			original[2],
		]);
	}, 10_000);
}
async function project() {
	const root = await mkdtemp(join(tmpdir(), "project-journal-"));
	roots.push(root);
	await Promise.all(paths.map((path, index) => writeFile(join(root, path), original[index])));
	return root;
}
async function bytes(root: string) {
	return Promise.all(paths.map((path) => readFile(join(root, path), "utf8")));
}
async function killedWriter(root: string, step: string) {
	const child = fork(
		fileURLToPath(new URL("./fixtures/journal-writer.ts", import.meta.url)),
		[root, step],
		{
			execArgv: ["--import", "tsx"],
			stdio: ["ignore", "ignore", "pipe", "ipc"],
		},
	);
	children.push(child);
	let errors = "";
	child.stderr?.on("data", (chunk) => {
		errors += chunk;
	});
	await new Promise<void>((resolve, reject) => {
		child.once("message", (message: { paused?: boolean; error?: string }) => {
			if (message.paused) resolve();
			else reject(new Error(message.error ?? "Writer did not pause"));
		});
		child.once("exit", (code) => reject(new Error(`Writer exited ${code}: ${errors}`)));
	});
	const exited = once(child, "exit");
	expect(child.kill("SIGKILL")).toBe(true);
	await exited;
}
afterEach(async () => {
	for (const child of children.splice(0)) {
		if (child.exitCode !== null || child.signalCode !== null) continue;
		const exited = once(child, "exit");
		child.kill("SIGKILL");
		await exited;
	}
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("T1 refuses a stale second file before any project write", async () => {
	const root = await project();
	const before = await readdir(root);
	const stamps = await Promise.all(paths.map((path) => lstat(join(root, path))));
	await expect(
		writeProjectFiles(root, [
			{ path: paths[0], content: edited[0], expectedContent: original[0] },
			{ path: paths[1], content: edited[1], expectedContent: "stale" },
		]),
	).rejects.toThrow(/changed on disk/i);
	expect(await bytes(root)).toEqual(original);
	expect(await readdir(root)).toEqual(before);
	for (const [index, path] of paths.entries()) {
		const after = await lstat(join(root, path));
		expect([after.ino, after.mtimeMs, after.ctimeMs]).toEqual([
			stamps[index].ino,
			stamps[index].mtimeMs,
			stamps[index].ctimeMs,
		]);
	}
});

it("T1 preserves every other byte in a mixed-ending text edit", async () => {
	const root = await project();
	await writeProjectTextFile(root, paths[0], edited[0], original[0]);
	expect(await bytes(root)).toEqual([edited[0], original[1], original[2]]);
});

it("T1 journals a valid long filename using a bounded UUID-only stage", async () => {
	const root = await project();
	const filename = `${"a".repeat(215)}.prax`;
	await writeFile(join(root, filename), "old");
	await writeProjectFiles(root, [{ path: filename, content: "new", expectedContent: "old" }], {
		onStep: async ({ kind }) => {
			if (kind === "journal") {
				const record = JSON.parse(await readFile(join(root, ".praxity-transaction.json"), "utf8"));
				expect(record.plan.stage).toMatch(
					/^\.praxity-write-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
				);
			}
		},
	});
	expect(await readFile(join(root, filename), "utf8")).toBe("new");
});

for (const step of [
	"journal",
	"staged:0",
	"staged:1",
	"staged:2",
	"installed:0",
	"installed:1",
	"head:2",
]) {
	it(`T1 recovers after real process death at ${step}`, async () => {
		const root = await project();
		await killedWriter(root, step);
		const expected = step === "head:2" ? edited : original;
		await expect(withProjectFileTransaction(root, () => bytes(root), "write")).resolves.toEqual(
			expected,
		);
		if (["installed:0", "installed:1", "head:2"].includes(step))
			expect(
				(await readdir(root)).filter((name) => name.startsWith(".praxity-write-")),
			).toHaveLength(1);
		await expect(withProjectFileTransaction(root, () => bytes(root), "write")).resolves.toEqual(
			expected,
		);
		expect(await readdir(root)).toEqual(paths.slice().sort());
	}, 15000);
}

it("T1 installs all content before heads even when the head is first in the plan", async () => {
	const root = await project();
	const observations: string[][] = [];
	await writeProjectFiles(
		root,
		[
			{ path: paths[2], content: edited[2], expectedContent: original[2], head: true },
			{ path: paths[0], content: edited[0], expectedContent: original[0] },
			{ path: paths[1], content: edited[1], expectedContent: original[1] },
		],
		{
			onStep: async ({ kind }) => {
				if (kind === "installed" || kind === "head") observations.push(await bytes(root));
			},
		},
	);
	expect(observations).toEqual([
		[edited[0], original[1], original[2]],
		[edited[0], edited[1], original[2]],
		edited,
	]);
});

it("T1 preserves unknown lesson bytes and reports a conflict before the durable final head", async () => {
	const root = await project();
	await killedWriter(root, "installed:1");
	await writeFile(join(root, paths[0]), "# Café 😀\r\nPARTIAL");
	await expect(withProjectFileTransaction(root, () => bytes(root), "write")).rejects.toThrow(
		/conflict/i,
	);
	expect(await bytes(root)).toEqual(["# Café 😀\r\nPARTIAL", original[1], original[2]]);
	await expect(withProjectFileTransaction(root, () => bytes(root), "write")).resolves.toEqual([
		"# Café 😀\r\nPARTIAL",
		original[1],
		original[2],
	]);
}, 10_000);

it("T1 repeats rollback after the recovering process dies", async () => {
	const root = await project();
	await killedWriter(root, "installed:0");
	await killedWriter(root, "recovery");
	await expect(withProjectFileTransaction(root, () => bytes(root), "write")).resolves.toEqual(
		original,
	);
	expect((await readdir(root)).filter((name) => name.startsWith(".praxity-write-"))).toHaveLength(
		1,
	);
	await expect(withProjectFileTransaction(root, () => bytes(root), "write")).resolves.toEqual(
		original,
	);
	expect(await readdir(root)).toEqual(paths.slice().sort());
}, 10_000);

for (const step of ["journal", "staged:0", "installed:0", "abort"]) {
	it(`T1 keeps outside edits to untouched targets after death at ${step}`, async () => {
		const root = await project();
		await killedWriter(root, step);
		await writeFile(join(root, paths[1]), "outside authored bytes");
		await expect(withProjectFileTransaction(root, () => bytes(root), "write")).rejects.toThrow(
			/conflict/i,
		);
		expect(await bytes(root)).toEqual([original[0], "outside authored bytes", original[2]]);
		await expect(withProjectFileTransaction(root, () => bytes(root), "write")).resolves.toEqual([
			original[0],
			"outside authored bytes",
			original[2],
		]);
		const stage = (await readdir(root)).find((name) => name.startsWith(".praxity-write-"));
		expect(stage).toBeDefined();
		expect(await readFile(join(root, stage as string, "journal.tmp"), "utf8")).toContain(
			Buffer.from(original[1]).toString("base64"),
		);
	}, 15_000);
}

it("T1 parent admission preserves a nested course journal and its staged bytes", async () => {
	const root = await project();
	const nested = join(root, "nested");
	await mkdir(nested);
	await Promise.all(paths.map((path, index) => writeFile(join(nested, path), original[index])));
	await killedWriter(nested, "staged:0");
	await writeProjectTextFile(root, paths[0], edited[0], original[0]);
	await expect(withProjectFileTransaction(nested, () => bytes(nested), "write")).resolves.toEqual(
		original,
	);
});

it("T1 finishes a durable abort even when every installed byte matches to", async () => {
	const root = await project();
	await killedWriter(root, "abort");
	expect(await bytes(root)).toEqual(edited);
	await expect(withProjectFileTransaction(root, () => bytes(root), "write")).resolves.toEqual(
		original,
	);
}, 15_000);

for (const step of ["lesson-source", "lesson-head"]) {
	it(`T1 keeps the existing lesson caller and identity in one journal after death at ${step}`, async () => {
		const root = await project();
		await writeLessonSource(root, paths[0], original[0]);
		const before = await readFile(join(root, paths[0]), "utf8");
		const headNames = await readdir(join(root, ".praxity", "identity", "lessons"));
		const headName = (
			await Promise.all(
				headNames.map(async (name) => ({
					name,
					head: JSON.parse(
						await readFile(join(root, ".praxity", "identity", "lessons", name), "utf8"),
					),
				})),
			)
		).find(({ head }) => head.path === paths[0])?.name;
		expect(headName).toBeDefined();
		const identityPath = join(root, ".praxity", "identity", "lessons", headName as string);
		const identityBefore = await readFile(identityPath, "utf8");
		await killedWriter(root, step);
		await withProjectFileTransaction(root, async () => {}, "write");
		const expected = step === "lesson-head" ? before.replace("Old words.", "New words.") : before;
		expect(await readFile(join(root, paths[0]), "utf8")).toBe(expected);
		if (step === "lesson-source") expect(await readFile(identityPath, "utf8")).toBe(identityBefore);
		else {
			const head = JSON.parse(await readFile(identityPath, "utf8"));
			const snapshot = JSON.parse(
				await readFile(
					join(root, ".praxity", "identity", "snapshots", `${head.head}.json`),
					"utf8",
				),
			);
			expect(snapshot.sourceHash).toBe(createHash("sha256").update(expected).digest("hex"));
			expect(await readFile(identityPath, "utf8")).not.toBe(identityBefore);
		}
	}, 15000);
}

for (const damage of [
	"corrupt journal",
	"different course",
	"missing stage",
	"corrupt stage",
	"missing readiness",
	"missing preparation stage",
]) {
	it(`T1 refuses ${damage} without touching any course bytes`, async () => {
		const root = await project();
		await killedWriter(root, damage === "missing preparation stage" ? "staged:0" : "installed:0");
		const journal = join(root, ".praxity-transaction.json");
		if (damage === "corrupt journal") await writeFile(journal, "{truncated");
		if (damage === "different course") {
			const other = await project();
			await writeFile(join(other, ".praxity-transaction.json"), await readFile(journal));
			const before = await bytes(other);
			await expect(withProjectFileTransaction(other, () => bytes(other), "write")).rejects.toThrow(
				/journal|course/i,
			);
			expect(await bytes(other)).toEqual(before);
			return;
		}
		if (damage.includes("stage")) {
			const record = JSON.parse(await readFile(journal, "utf8"));
			// Installed sources are consumed. Damage a completed, uninstalled source.
			const index = damage === "missing preparation stage" ? 0 : 1;
			const stage =
				record.plan.stageVersion === 1
					? join(root, record.plan.stage, `install-${index}`)
					: join(root, record.plan.stage, String(index), paths[index]);
			if (damage.startsWith("missing")) await rm(stage);
			else await writeFile(stage, "damaged");
		}
		if (damage === "missing readiness") {
			const record = JSON.parse(await readFile(journal, "utf8"));
			await rm(join(root, record.plan.stage, "ready"));
			const before = await bytes(root);
			await expect(withProjectFileTransaction(root, () => bytes(root), "write")).rejects.toThrow(
				/recovery conflict/i,
			);
			expect(await bytes(root)).toEqual(before);
			await expect(readFile(journal)).rejects.toMatchObject({ code: "ENOENT" });
			expect(await readFile(join(root, record.plan.stage, "journal.tmp"), "utf8")).toBe(
				JSON.stringify(record),
			);
			await expect(withProjectFileTransaction(root, () => bytes(root), "write")).resolves.toEqual(
				before,
			);
			return;
		}
		const before = await bytes(root);
		const journalBefore = await readFile(journal);
		await expect(withProjectFileTransaction(root, () => bytes(root), "write")).rejects.toThrow(
			/journal|stag/i,
		);
		expect(await bytes(root)).toEqual(before);
		expect(await readFile(journal)).toEqual(journalBefore);
	});
}

it("T1 preserves mixed endings through the existing lesson caller", async () => {
	const root = await project();
	await writeLessonSource(root, paths[0], edited[0], original[0]);
	expect(await bytes(root)).toEqual([edited[0], original[1], original[2]]);
}, 15_000);

it("T1 retains recovery copies for a file named install.tmp", async () => {
	const root = await project();
	await writeFile(join(root, "install.tmp"), "old");
	await killedWriter(root, "temporary-name");
	await withProjectFileTransaction(root, async () => {}, "write");
	expect(await readFile(join(root, "install.tmp"), "utf8")).toBe("old");
	expect(await bytes(root)).toEqual(original);
});

it("T1 atomically creates, deletes and restores arbitrary binary files", async () => {
	const root = await project();
	await mkdir(join(root, "assets"));
	await writeProjectFiles(root, [
		{ path: "assets/data.bin", content: Buffer.from([0, 255, 128]), expectedContent: null },
		{ path: paths[1], content: null, expectedContent: original[1] },
	]);
	expect(await readFile(join(root, "assets/data.bin"))).toEqual(Buffer.from([0, 255, 128]));
	await expect(readFile(join(root, paths[1]))).rejects.toMatchObject({ code: "ENOENT" });
});

it("T1 restores absence and deleted bytes after a killed binary plan", async () => {
	const root = await project();
	await killedWriter(root, "binary");
	await expect(readFile(join(root, paths[1]))).rejects.toMatchObject({ code: "ENOENT" });
	expect(await readFile(join(root, "data.bin"))).toEqual(Buffer.from([0, 255, 128]));
	await expect(withProjectFileTransaction(root, () => bytes(root), "write")).resolves.toEqual(
		original,
	);
	await expect(readFile(join(root, "data.bin"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("T1 rolls back when one of several heads has advanced", async () => {
	const root = await project();
	await killedWriter(root, "first-head");
	await expect(withProjectFileTransaction(root, () => bytes(root), "write")).resolves.toEqual(
		original,
	);
}, 15_000);

it("T1 refuses duplicate targets, escaping paths and symlinks before journalling", async () => {
	const root = await project();
	for (const plan of [
		[
			{ path: paths[0], content: "a" },
			{ path: `./${paths[0]}`, content: "b" },
		],
		[{ path: "../escaped.prax", content: "bad" }],
		[{ path: ".praxity-transaction.json", content: "bad" }],
	]) {
		await expect(writeProjectFiles(root, plan)).rejects.toThrow();
		expect(await bytes(root)).toEqual(original);
		expect(await readdir(root)).toEqual(paths.slice().sort());
	}
	const outside = await project();
	await symlink(join(outside, paths[0]), join(root, "link.prax"));
	await expect(writeProjectFiles(root, [{ path: "link.prax", content: "bad" }])).rejects.toThrow(
		/symbolic/i,
	);
	expect(await bytes(root)).toEqual(original);
	expect(await bytes(outside)).toEqual(original);
});

it("T1 rechecks all files after staging before installing the first file", async () => {
	const root = await project();
	await expect(
		writeProjectFiles(
			root,
			[
				{ path: paths[0], content: edited[0], expectedContent: original[0] },
				{ path: paths[1], content: edited[1], expectedContent: original[1] },
			],
			{
				onStep: async ({ kind, index }) => {
					if (kind === "staged" && index === 1) await writeFile(join(root, paths[1]), "external");
				},
			},
		),
	).rejects.toThrow(/changed on disk/i);
	expect(await bytes(root)).toEqual([original[0], "external", original[2]]);
	const entries = await readdir(root);
	const stages = entries.filter((name) => name.startsWith(".praxity-write-"));
	expect(stages).toHaveLength(1);
	expect(entries.filter((name) => !stages.includes(name))).toEqual(paths.slice().sort());
	const record = JSON.parse(await readFile(join(root, stages[0], "journal.tmp"), "utf8"));
	expect(Buffer.from(record.plan.files[1].from, "base64").toString()).toBe(original[1]);
	expect(Buffer.from(record.plan.files[1].to, "base64").toString()).toBe(edited[1]);
});
