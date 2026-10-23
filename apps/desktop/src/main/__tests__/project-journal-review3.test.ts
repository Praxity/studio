import { type ChildProcess, execFileSync, fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { parseCourseManifest } from "../../shared/course-manifest";
import { projectReadErrorKey } from "../../shared/project-write-errors";
import { writeManifestFixtureLessons } from "../../test-utils/manifest-fixture";
import { readCourseManifestData } from "../course-manifest-io";
import { deleteLessonSource, readLessonSource } from "../lesson-source";
import {
	applyProjectFilePlan,
	extractProjectRecovery,
	listProjectRecovery,
	projectRecoveryArchives,
	withProjectFileTransaction,
	writeProjectFiles,
} from "../project-file-transactions";

const fault = vi.hoisted(() => ({ append: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		open: async (...args: Parameters<typeof fs.open>) => {
			const handle = await fs.open(...args);
			if (fault.append && basename(String(args[0])) === "exclude") {
				fault.append = false;
				const write = handle.writeFile.bind(handle);
				handle.writeFile = async (...values: Parameters<typeof handle.writeFile>) => {
					execFileSync(process.execPath, [
						"-e",
						'require("node:fs").appendFileSync(process.argv[1],"AUTHOR-WITHOUT-NEWLINE")',
						String(args[0]),
					]);
					return write(...values);
				};
			}
			return handle;
		},
	};
});
const roots: string[] = [];
const children: ChildProcess[] = [];
async function project() {
	const root = await mkdtemp(join(tmpdir(), "journal-review3-"));
	roots.push(root);
	await Promise.all([
		writeFile(join(root, "a.prax"), "A old"),
		writeFile(join(root, "b.prax"), "B old"),
		writeFile(join(root, "head.json"), "H old"),
		writeFile(join(root, "course.yaml"), "id: review\nlessons: [a.prax, b.prax]\n"),
	]);
	return root;
}
async function kill(child: ChildProcess) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const end = once(child, "exit");
	child.kill("SIGKILL");
	await end;
}
async function death(root: string, mode: string, stop: string) {
	const child = fork(
		fileURLToPath(new URL("./fixtures/review3-writer.mjs", import.meta.url)),
		[root, mode, stop],
		{ execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] },
	);
	children.push(child);
	const message = (await once(child, "message", { signal: AbortSignal.timeout(12000) }))[0];
	expect(message.paused, JSON.stringify(message)).toBe(true);
	await kill(child);
}
async function stage(root: string) {
	return (await readdir(root)).find((name) => name.startsWith(".praxity-write-")) as string;
}
afterEach(async () => {
	fault.append = false;
	await Promise.all(children.splice(0).map(kill));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

for (const mode of ["forward", "recovery"]) {
	it(`B1 archives a displaced open file until a later admission, ${mode}`, async () => {
		const root = await project(),
			handle = await open(join(root, "a.prax"), "r+");
		try {
			if (mode === "recovery") {
				await death(root, "forward", "installed-first");
				await withProjectFileTransaction(root, async () => {}, "write");
			} else
				await writeProjectFiles(root, [
					{ path: "a.prax", content: "A new", expectedContent: "A old" },
				]);
			const archive = await stage(root);
			expect(archive).toBeTruthy();
			await handle.truncate(0);
			await handle.writeFile("OUTSIDE AUTHOR DURABLE BYTES");
			await handle.sync();
			const list = await listProjectRecovery(root);
			expect(list).toHaveLength(1);
			// Ordinary admission discovers changed archived bytes; inspection never discards archives.
			await withProjectFileTransaction(root, async () => {}, "write");
			expect((await listProjectRecovery(root))[0].status).toBe("conflict");
			const output = join(root, "extracted");
			await extractProjectRecovery(root, archive, output);
			const capture = (await readdir(join(output, "captured"))).find((name) =>
				name.startsWith("install-0.capture-"),
			) as string;
			expect(await readFile(join(output, "captured", capture), "utf8")).toBe(
				"OUTSIDE AUTHOR DURABLE BYTES",
			);
			expect(await readFile(join(root, "a.prax"), "utf8")).toBe(
				mode === "forward" ? "A new" : "A old",
			);
		} finally {
			await handle.close();
		}
	}, 15_000);
}
it("B1 lists intact captures for inspection without raising a recovery notice", async () => {
	const root = await project();
	await withProjectFileTransaction(
		root,
		async (root) => {
			await applyProjectFilePlan(root, [{ path: "a.prax", content: "A new" }]);
			expect(await projectRecoveryArchives(root)).toEqual([]);
			expect(await listProjectRecovery(root)).toHaveLength(1);
		},
		"write",
	);
});

it("B1 reclaims unchanged captures only on a later admission", async () => {
	const root = await project();
	await writeProjectFiles(root, [{ path: "a.prax", content: "A new" }]);
	expect(await stage(root)).toBeTruthy();
	await withProjectFileTransaction(root, async () => {}, "write");
	expect(await stage(root)).toBeUndefined();
});
for (const mode of ["recovery", "abort"])
	for (const stop of [
		"capture-before",
		"capture-after",
		"link-before",
		"link-after",
		"rollback-intent-after",
		"rollback-displaced-after",
		"rollback-completed-after",
	]) {
		it(`B2 resumes ${mode} death at ${stop} before admitting a lesson reader`, async () => {
			const root = await project();
			if (mode === "recovery") await death(root, "forward", "installed-first");
			await death(root, mode, stop);
			await expect(readLessonSource(root, "a.prax")).rejects.toThrow(/save or the next write/i);
			await withProjectFileTransaction(root, async () => {}, "write");
			for (let i = 0; i < 2; i++) expect(await readLessonSource(root, "a.prax")).toBe("A old");
			expect(await readFile(join(root, "b.prax"), "utf8")).toBe("B old");
		}, 10_000);
	}
for (const stop of [
	"rollback-displaced-after",
	"link-before",
	"link-after",
	"rollback-completed-after",
]) {
	it(`B2 resumes a second recovery death at ${stop}`, async () => {
		const root = await project();
		await death(root, "forward", "installed-first");
		await death(root, "recovery", "capture-after");
		await death(root, "recovery", stop);
		await expect(readLessonSource(root, "a.prax")).rejects.toThrow(/save or the next write/i);
		await withProjectFileTransaction(root, async () => {}, "write");
		for (let i = 0; i < 2; i++) expect(await readLessonSource(root, "a.prax")).toBe("A old");
	});
}
it("B2 preserves an outside deletion after rollback completion", async () => {
	const root = await project();
	await death(root, "forward", "installed-first");
	await death(root, "recovery", "rollback-completed-after");
	await rm(join(root, "a.prax"));
	await expect(withProjectFileTransaction(root, async () => {}, "write")).rejects.toThrow(
		/recovery conflict/i,
	);
	await expect(readFile(join(root, "a.prax"))).rejects.toMatchObject({ code: "ENOENT" });
	expect(await listProjectRecovery(root)).toHaveLength(1);
});

for (const mode of ["forward", "recovery", "abort"]) {
	const stops = [
		"temp-empty",
		"temp-partial",
		"temp-prefix",
		"temp-written",
		"temp-flushed",
		"temp-chmod",
		"journal-remove-before",
		"journal-remove-after",
		"stage-remove-before",
		...(mode === "forward"
			? [
					"capture-before",
					"capture-after",
					"link-before",
					"link-after",
					"marker-before",
					"marker-after",
					"committed-head",
				]
			: []),
	];
	for (const stop of stops)
		it(`storage death ${mode} ${stop} preserves every course file`, async () => {
			const root = await project();
			if (mode === "recovery") await death(root, "forward", "installed-first");
			await death(root, mode, stop);
			for (let i = 0; i < 2; i++) await withProjectFileTransaction(root, async () => {}, "write");
			const committed =
				mode === "forward" &&
				[
					"journal-remove-before",
					"journal-remove-after",
					"stage-remove-before",
					"committed-head",
				].includes(stop);
			expect(
				await Promise.all(
					["a.prax", "b.prax", "head.json"].map((path) => readFile(join(root, path), "utf8")),
				),
			).toEqual(committed ? ["A new", "B new", "H new"] : ["A old", "B old", "H old"]);
			const inventory = await listProjectRecovery(root);
			if (stop === "temp-partial") {
				// The fixture writes differing bytes, not a planned prefix. Keep them
				// even before readiness; empty/planned-prefix deaths leave no archive.
				expect(inventory).toHaveLength(1);
				expect(inventory[0].status).toBe("unverified");
				const output = join(root, "extracted");
				await extractProjectRecovery(root, inventory[0].stage, output);
				const copies = await readdir(join(output, "captured"));
				expect(
					await Promise.all(
						copies
							.filter((name) => /^(?:install-0|rollback-0\.attempt-[0-9a-f-]+)$/.test(name))
							.map((name) => readFile(join(output, "captured", name), "utf8")),
					),
				).toContain("partial");
			} else expect(inventory).toEqual([]);
		}, 15_000);
}

it("M1 separates a concurrent Git append without a final newline from recovery rules", async () => {
	const root = await project();
	execFileSync("git", ["init", "-q", root]);
	fault.append = true;
	await writeProjectFiles(root, [{ path: "a.prax", content: "A new" }]);
	const exclude = await readFile(join(root, ".git", "info", "exclude"), "utf8");
	expect(exclude).toContain("AUTHOR-WITHOUT-NEWLINE\n/**/.praxity-transaction.json\n");
});

const unsafeManifest = [
	'id: &empty ""\ndescription: *empty\nlessons: [a.prax, b.prax]\n',
	"unused: &empty null\nid: *empty\nlessons: [a.prax, b.prax]\n",
	"{title: Author, lessons: [a.prax, b.prax],}\n",
	"{title: Author, # author\n lessons: [a.prax, b.prax]}\n",
	"# author notes\r\n",
	"",
	"---\ntitle: Author\n...\n---\n\n# Untitled {hideTitle}\n\nprivate: authored\n",
];
for (const source of unsafeManifest)
	it(`S1 refuses a non-plain inventory edit without any writes: ${JSON.stringify(source)}`, async () => {
		const root = await project();
		await writeFile(join(root, "course.yaml"), source);
		const entries = await readdir(root);
		const error = await writeManifestFixtureLessons(root).catch((error) => error);
		expect(projectReadErrorKey(error)).toBe("plainYamlRequired");
		expect(await readFile(join(root, "course.yaml"), "utf8")).toBe(source);
		expect(await readdir(root)).toEqual(entries);
	});
it("S1 changes exactly the lesson inventory and validates the complete manifest through its reader", async () => {
	const root = await project(),
		source =
			'﻿---\r\n"title": Author # title\r\nid: null # id\r\nlessons: [a.prax, b.prax]\r\n...\r\n# end\r\n';
	await writeFile(join(root, "course.yaml"), source);
	const _result = await writeManifestFixtureLessons(root);
	const after = await readFile(join(root, "course.yaml"), "utf8");
	expect(after).toBe(source.replace("[a.prax, b.prax]", '["b.prax"]'));
	expect(parseCourseManifest(after)).toEqual({
		...parseCourseManifest(source),
		lessons: ["b.prax"],
	});
});
