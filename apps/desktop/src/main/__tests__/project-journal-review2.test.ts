import { type ChildProcess, execFileSync, fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { parseDocument } from "yaml";
import { writeManifestFixtureLessons } from "../../test-utils/manifest-fixture";
import { runPraxityCli } from "../cli";
import { readCourseManifestData } from "../course-manifest-io";
import { deleteLessonSource, renameProjectSource } from "../lesson-source";
import { withProjectFileTransaction, writeProjectFiles } from "../project-file-transactions";

const faults = vi.hoisted(() => ({
	linkAcknowledgement: false,
	stageFailure: false,
	race: "",
	raceTarget: "",
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		link: async (...args: Parameters<typeof fs.link>) => {
			if (
				["creation", "same-creation"].includes(faults.race) &&
				String(args[1]) === faults.raceTarget
			) {
				const content = faults.race === "same-creation" ? "A new" : "CONCURRENT CREATION";
				faults.race = "";
				await fs.writeFile(args[1], content);
			}
			await fs.link(...args);
			if (faults.linkAcknowledgement && basename(String(args[1])) === ".praxity-transaction.json") {
				faults.linkAcknowledgement = false;
				throw Object.assign(new Error("link acknowledgement EIO"), { code: "EIO" });
			}
		},
		rename: async (...args: Parameters<typeof fs.rename>) => {
			if (
				faults.race === "edit" &&
				[String(args[0]), String(args[1])].includes(faults.raceTarget)
			) {
				faults.race = "";
				execFileSync(process.execPath, [
					"-e",
					'require("node:fs").writeFileSync(process.argv[1], "OUTSIDE AUTHOR")',
					faults.raceTarget,
				]);
			}
			return fs.rename(...args);
		},
		open: async (...args: Parameters<typeof fs.open>) => {
			if (faults.stageFailure && String(args[0]).endsWith("journal.tmp")) {
				faults.stageFailure = false;
				throw new Error("journal staging failure");
			}
			return fs.open(...args);
		},
	};
});
const roots: string[] = [];
const children: ChildProcess[] = [];
const paths = ["a.prax", "b.prax", "head.json"];
const original = ["A old", "B old", "H old"];
const runtime = { appVersion: "test", exportAssetsDir: "unused" };
async function project() {
	const root = await mkdtemp(join(tmpdir(), "journal-review2-"));
	roots.push(root);
	await setup(root);
	return root;
}
async function setup(root: string) {
	await mkdir(root, { recursive: true });
	await Promise.all(paths.map((path, i) => writeFile(join(root, path), original[i])));
}
function worker(root: string, scenario: string, stop = "installed:0") {
	const child = fork(
		fileURLToPath(new URL("./fixtures/review2-writer.mjs", import.meta.url)),
		[root, scenario, stop],
		{
			execArgv: ["--import", "tsx"],
			stdio: ["ignore", "ignore", "pipe", "ipc"],
		},
	);
	children.push(child);
	return child;
}
async function message(child: ChildProcess) {
	return (await once(child, "message", { signal: AbortSignal.timeout(10000) }))[0];
}
async function kill(child: ChildProcess) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = once(child, "exit");
	child.kill("SIGKILL");
	await exited;
}
async function death(root: string, scenario: string, stop?: string) {
	const child = worker(root, scenario, stop);
	expect((await message(child)).paused).toBe(true);
	await kill(child);
}
async function archives(root: string) {
	return (await readdir(root)).filter((name) => name.startsWith(".praxity-write-"));
}
async function recover(root: string) {
	return withProjectFileTransaction(root, async () => {}, "write");
}
afterEach(async () => {
	faults.linkAcknowledgement = false;
	faults.stageFailure = false;
	faults.race = "";
	await Promise.all(children.splice(0).map(kill));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("F1 refuses an inventory edit that would erase a block scalar header comment", async () => {
	const root = await project();
	const source = "title: Author\nlessons: | # AUTHOR LESSONS COMMENT\n  a.prax\n";
	await writeFile(join(root, "course.yaml"), source);
	await expect(writeManifestFixtureLessons(root)).rejects.toThrow("Plain YAML required");
	expect(await readFile(join(root, "course.yaml"), "utf8")).toBe(source);
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A old");
});

it.each([
	"  - a.prax\n  - b.prax # AUTHOR B COMMENT\n",
	"  - a.prax\n  # AUTHOR BETWEEN ENTRIES\n  - b.prax\n",
])("F1 refuses deletion that would erase a surviving comment: %s", async (entries) => {
	const root = await project();
	const source = `id: review\ntitle: Author\nlessons:\n${entries}`;
	await writeFile(join(root, "course.yaml"), source);
	await expect(deleteLessonSource(root, "a.prax")).rejects.toThrow("Plain YAML required");
	expect(await readFile(join(root, "course.yaml"), "utf8")).toBe(source);
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A old");
	expect(await readFile(join(root, "b.prax"), "utf8")).toBe("B old");
});

it("F1 permits removing the deleted lesson's own trailing comment", async () => {
	const root = await project();
	await writeFile(
		join(root, "course.yaml"),
		"id: review\ntitle: Author\nlessons:\n  - a.prax # AUTHOR A COMMENT\n  - b.prax\n",
	);
	await deleteLessonSource(root, "a.prax");
	expect(await readFile(join(root, "course.yaml"), "utf8")).toBe(
		'id: review\ntitle: Author\nlessons:\n  ["b.prax"]\n',
	);
	await expect(readFile(join(root, "a.prax"))).rejects.toMatchObject({ code: "ENOENT" });
	expect(await readFile(join(root, "b.prax"), "utf8")).toBe("B old");
}, 15_000);

for (const stop of ["journal", "staged:0"]) {
	it(`B1 retains a preparation outside edit equal to the planned bytes at ${stop}`, async () => {
		const root = await project();
		await death(root, "normal", stop);
		await writeFile(join(root, "b.prax"), "B new");
		await expect(recover(root)).rejects.toThrow(/recovery conflict/i);
		await expect(recover(root)).resolves.toBeUndefined();
		expect(await readFile(join(root, "b.prax"), "utf8")).toBe("B new");
		const [stage] = await archives(root);
		const journal = JSON.parse(await readFile(join(root, stage, "journal.tmp"), "utf8"));
		expect(Buffer.from(journal.plan.files[1].from, "base64").toString()).toBe("B old");
	});
}
it("B2 survives journal link success followed by an acknowledgement failure", async () => {
	const root = await project();
	faults.linkAcknowledgement = true;
	await expect(writeProjectFiles(root, [{ path: "a.prax", content: "new" }])).rejects.toThrow(
		/EIO/,
	);
	await expect(recover(root)).resolves.toBeUndefined();
	await expect(recover(root)).resolves.toBeUndefined();
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A old");
});
for (const outsideEdit of [false, true]) {
	it(`B3 admits after death in the capture interval, captured outside edit=${outsideEdit}`, async () => {
		const root = await project();
		await death(root, "capture-death");
		await expect(readFile(join(root, "a.prax"))).rejects.toMatchObject({ code: "ENOENT" });
		const [stage] = await archives(root);
		if (outsideEdit) {
			const capture = (await readdir(join(root, stage))).find((name) =>
				name.startsWith("install-0.capture-"),
			) as string;
			await writeFile(join(root, stage, capture), "OUTSIDE CAPTURED INODE");
			await expect(recover(root)).rejects.toThrow(/conflict/i);
		} else await recover(root);
		expect(await readFile(join(root, "a.prax"), "utf8")).toBe(
			outsideEdit ? "OUTSIDE CAPTURED INODE" : "A old",
		);
		await expect(recover(root)).resolves.toBeUndefined();
	});
}
for (const race of ["edit", "creation"]) {
	it(`B3 retains a racing outside author's ${race} during recovery`, async () => {
		const root = await project();
		await death(root, "normal");
		faults.raceTarget = join(root, "a.prax");
		faults.race = race;
		await expect(recover(root)).rejects.toThrow(/conflict/i);
		expect(await readFile(faults.raceTarget, "utf8")).toBe(
			race === "edit" ? "OUTSIDE AUTHOR" : "CONCURRENT CREATION",
		);
		expect((await archives(root)).length).toBe(1);
		await expect(recover(root)).resolves.toBeUndefined();
	}, 15_000);
}
for (const recovering of [false, true]) {
	it(`B3 keeps a concurrent creation equal to planned bytes, recovering=${recovering}`, async () => {
		const root = await project();
		if (recovering) await death(root, "normal");
		faults.raceTarget = join(root, "a.prax");
		faults.race = "same-creation";
		await expect(
			recovering
				? recover(root)
				: writeProjectFiles(root, [{ path: "a.prax", content: "A new", expectedContent: "A old" }]),
		).rejects.toThrow(/conflict/i);
		expect(await readFile(faults.raceTarget, "utf8")).toBe("A new");
		await expect(recover(root)).resolves.toBeUndefined();
		expect(await readFile(faults.raceTarget, "utf8")).toBe("A new");
		expect(await archives(root)).toHaveLength(1);
	});
}
it("B3 retains equal outside bytes after death before a collision is acknowledged", async () => {
	const root = await project();
	await death(root, "collision-death");
	await expect(recover(root)).rejects.toThrow(/conflict/i);
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A new");
	await expect(recover(root)).resolves.toBeUndefined();
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A new");
	expect(await archives(root)).toHaveLength(1);
});
it("B3 preserves an outside deletion after installation and keeps the authored replacement", async () => {
	const root = await project();
	await expect(
		writeProjectFiles(root, [{ path: "a.prax", content: "A new", expectedContent: "A old" }], {
			onStep: async ({ kind }) => {
				if (kind === "installed") {
					await rm(join(root, "a.prax"));
					throw new Error("outside deletion");
				}
			},
		}),
	).rejects.toThrow(/conflict/i);
	await expect(readFile(join(root, "a.prax"))).rejects.toMatchObject({ code: "ENOENT" });
	const [stage] = await archives(root);
	const journal = JSON.parse(await readFile(join(root, stage, "journal.tmp"), "utf8"));
	expect(Buffer.from(journal.plan.files[0].to, "base64").toString()).toBe("A new");
	await expect(recover(root)).resolves.toBeUndefined();
	await expect(readFile(join(root, "a.prax"))).rejects.toMatchObject({ code: "ENOENT" });
});
for (const source of [
	"---\ntitle: Author title\nlessons: [a.prax, b.prax]\ndesign: {palette: darkroom}\n...\n",
	"title: Author title\nid: null # keep comment\nlessons: [a.prax, b.prax]\ndesign: {palette: darkroom}\n",
	"{title: Author title, id: null, lessons: [a.prax, b.prax], design: {palette: darkroom}}\n",
	"title: Author title\nid: # keep comment\nlessons: [a.prax, b.prax]\ndesign: {palette: darkroom}\n...\n",
]) {
	it(`B4 edits the lesson inventory without corrupting YAML ${JSON.stringify(source)}`, async () => {
		const root = await project();
		await writeFile(join(root, "course.yaml"), source);
		const first = await writeManifestFixtureLessons(root);
		const candidate = await readFile(join(root, "course.yaml"), "utf8");
		expect(parseDocument(candidate).errors).toEqual([]);
		const second = await readCourseManifestData(root);
		expect(second.manifest).toEqual(first.manifest);
		expect(second.manifest.title).toBe("Author title");
		expect(second.manifest.lessons).toEqual(["b.prax"]);
		expect(candidate).toContain("design: {palette: darkroom}");
	});
}
it("S1 refuses an info junction before writing outside Git metadata", async () => {
	const root = await project(),
		outside = await project();
	execFileSync("git", ["init", "-q", root]);
	await writeFile(join(outside, "exclude"), "AUTHOR BYTES\n");
	await rm(join(root, ".git", "info"), { recursive: true });
	await symlink(
		outside,
		join(root, ".git", "info"),
		process.platform === "win32" ? "junction" : "dir",
	);
	await expect(writeProjectFiles(root, [{ path: "a.prax", content: "new" }])).rejects.toThrow();
	expect(await readFile(join(outside, "exclude"), "utf8")).toBe("AUTHOR BYTES\n");
});
it("S2 serializes two courses' Git exclusions and retains an author's concurrent append", async () => {
	const root = await project();
	execFileSync("git", ["init", "-q", root]);
	const a = join(root, "one"),
		b = join(root, "two");
	await setup(a);
	await setup(b);
	const ca = worker(a, "git-exclude-race");
	expect((await message(ca)).paused).toBe(true);
	const cb = worker(b, "git-exclude-race");
	const pausedB = message(cb);
	await delay(500);
	const nextA = message(ca);
	ca.send("resume");
	expect((await nextA).paused).toBe(true);
	expect((await pausedB).paused).toBe(true);
	const nextB = message(cb);
	await writeFile(join(root, ".git", "info", "exclude"), "AUTHOR APPEND\n", { flag: "a" });
	cb.send("resume");
	expect((await nextB).paused).toBe(true);
	const status = execFileSync("git", ["-C", root, "status", "--short", "--untracked-files=all"], {
		encoding: "utf8",
	});
	expect(status).not.toContain(".praxity-");
	expect(await readFile(join(root, ".git", "info", "exclude"), "utf8")).toContain(
		"AUTHOR APPEND\n",
	);
}, 20000);
it("S3 parent admission keeps a running manifest-free nested stage", async () => {
	const root = await project(),
		nested = join(root, "nested");
	await setup(nested);
	const child = worker(nested, "stage-before-journal");
	expect((await message(child)).paused).toBe(true);
	const [stage] = await archives(nested);
	await recover(root);
	expect(await archives(nested)).toContain(stage);
	const next = message(child);
	child.send("resume");
	expect(await next).toEqual({ done: true });
});
it("S4 CLI discovers, extracts and explicitly resolves retained recovery bytes", async () => {
	const root = await project();
	await death(root, "normal");
	await writeFile(join(root, "b.prax"), "OUTSIDE AUTHOR");
	await expect(recover(root)).rejects.toThrow(/conflict/i);
	const list = await runPraxityCli(["recovery", "list", root], runtime);
	expect(list.exitCode).toBe(0);
	const [archive] = JSON.parse(list.stdout).archives;
	expect(archive.files).toContainEqual(expect.objectContaining({ path: "b.prax" }));
	const destination = join(root, "extracted");
	const extract = await runPraxityCli(
		["recovery", "extract", root, archive.stage, destination],
		runtime,
	);
	expect(extract.exitCode).toBe(0);
	expect(await readFile(join(destination, "original", "b.prax"), "utf8")).toBe("B old");
	expect(await readFile(join(destination, "replacement", "b.prax"), "utf8")).toBe("B new");
	expect(
		(await runPraxityCli(["recovery", "extract", root, archive.stage, destination], runtime))
			.exitCode,
	).toBe(1);
	expect(await archives(root)).toContain(archive.stage);
	expect(
		(await runPraxityCli(["recovery", "resolve", root, archive.stage], runtime)).exitCode,
	).toBe(0);
	expect(await archives(root)).toEqual([]);
	expect(await readFile(join(root, "b.prax"), "utf8")).toBe("OUTSIDE AUTHOR");
}, 25_000);
it("S4 exposes unverified copies and refuses archive traversal", async () => {
	const root = await project();
	const stage = ".praxity-write-unverified";
	await mkdir(join(root, stage));
	await writeFile(join(root, stage, "authored.bin"), Buffer.from([0, 128, 255]));
	const list = await runPraxityCli(["recovery", "list", root], runtime);
	expect(list.exitCode).toBe(0);
	expect(JSON.parse(list.stdout).archives).toEqual([{ stage, status: "unverified", files: [] }]);
	const output = join(root, "extracted");
	expect(
		(await runPraxityCli(["recovery", "extract", root, stage, output], runtime)).exitCode,
	).toBe(0);
	expect(await readFile(join(output, "captured", "authored.bin"))).toEqual(
		Buffer.from([0, 128, 255]),
	);
	expect(
		(await runPraxityCli(["recovery", "resolve", root, `${stage}/..`], runtime)).exitCode,
	).toBe(1);
	expect(await archives(root)).toContain(stage);
	expect((await runPraxityCli(["recovery", "resolve", root, stage], runtime)).exitCode).toBe(0);
});
it("S5 removes only empty destination directories after failed staging and permits retry", async () => {
	const root = await project();
	await mkdir(join(root, "old", "nested"), { recursive: true });
	await writeFile(join(root, "old", "nested", "asset.txt"), "AUTHORED");
	faults.stageFailure = true;
	await expect(renameProjectSource(root, "old", "new")).rejects.toThrow(/staging failure/);
	expect(await readdir(root)).not.toContain("new");
	expect(await readFile(join(root, "old", "nested", "asset.txt"), "utf8")).toBe("AUTHORED");
	await renameProjectSource(root, "old", "new");
	expect(await readFile(join(root, "new", "nested", "asset.txt"), "utf8")).toBe("AUTHORED");
});
for (const outsideCreation of [false, true]) {
	it(`S5 recovers directory rename death and keeps outside creations=${outsideCreation}`, async () => {
		const root = await project();
		await mkdir(join(root, "old", "nested"), { recursive: true });
		await writeFile(join(root, "old", "nested", "asset.txt"), "AUTHORED");
		await death(root, "directory");
		if (outsideCreation) await writeFile(join(root, "new", "author.txt"), "KEEP OUTSIDE");
		await recover(root);
		expect(await readFile(join(root, "old", "nested", "asset.txt"), "utf8")).toBe("AUTHORED");
		if (outsideCreation)
			expect(await readFile(join(root, "new", "author.txt"), "utf8")).toBe("KEEP OUTSIDE");
		else {
			expect(await readdir(root)).not.toContain("new");
			await renameProjectSource(root, "old", "new");
			expect(await readFile(join(root, "new", "nested", "asset.txt"), "utf8")).toBe("AUTHORED");
		}
	}, 15_000);
}
