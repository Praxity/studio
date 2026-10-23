import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
	copyFile,
	link,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
	extractProjectRecovery,
	listProjectRecovery,
	projectRecoveryArchives,
	resolveProjectRecovery,
	withProjectFileTransaction,
	writeProjectFiles,
} from "../project-file-transactions";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function project() {
	const root = await mkdtemp(join(tmpdir(), "journal-review-fix-"));
	roots.push(root);
	await writeFile(join(root, "a.prax"), "A0");
	await writeFile(join(root, "b.prax"), "B0");
	return root;
}
async function death(root: string, mode: string, stop: string, prefix?: number): Promise<string[]> {
	const child = fork(
		fileURLToPath(new URL("./fixtures/journal-review-writer.ts", import.meta.url)),
		[root, mode, stop, ...(prefix === undefined ? [] : [String(prefix)])],
		{ execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] },
	);
	const exited = once(child, "exit");
	let errors = "";
	child.stderr?.on("data", (data) => {
		errors += data;
	});
	try {
		const message = await Promise.race([
			once(child, "message").then(([message]) => message),
			exited.then(([code]) => {
				throw new Error(`Writer exited ${code}: ${errors}`);
			}),
		]);
		expect(message.paused, message.error).toBe(true);
		return message.events;
	} finally {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		await exited;
	}
}
async function admit(root: string) {
	await withProjectFileTransaction(root, async () => {}, "write");
}
async function clean(root: string, a = "A0", b = "B0") {
	await admit(root);
	await admit(root);
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe(a);
	expect(await readFile(join(root, "b.prax"), "utf8")).toBe(b);
	expect(await readdir(root)).toEqual(["a.prax", "b.prax"]);
}
async function independent(directory: string): Promise<void> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) await independent(path);
		else expect((await lstat(path)).nlink, path).toBe(1);
	}
}
for (const malformed of [false, true])
	it(`P1 recovers a torn identity and identical outside bytes, malformed published=${malformed}`, async () => {
		const root = await project();
		await death(root, "save", "^after:open:.*install-0\\.identity(?:\\.tmp)?$");
		const journal = JSON.parse(await readFile(join(root, ".praxity-transaction.json"), "utf8"));
		const stage = join(root, journal.plan.stage);
		if (malformed) await writeFile(join(stage, "install-0.identity"), "{broken");
		else
			await expect(lstat(join(stage, "install-0.identity"))).rejects.toMatchObject({
				code: "ENOENT",
			});
		await writeFile(join(root, "a.prax"), "A1");
		await expect(admit(root)).rejects.toThrow(/Project recovery conflict/);
		await admit(root);
		expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A1");
		expect(await readFile(join(root, "b.prax"), "utf8")).toBe("B0");
		expect((await listProjectRecovery(root)).map(({ stage }) => stage)).toEqual([
			journal.plan.stage,
		]);
		await extractProjectRecovery(root, journal.plan.stage, join(root, "extracted"));
		expect(await readFile(join(root, "extracted", "replacement", "a.prax"), "utf8")).toBe("A1");
		await independent(stage);
		await resolveProjectRecovery(root, journal.plan.stage);
		expect(await projectRecoveryArchives(root, true)).toEqual([]);
	});
for (const abandoned of [false, true])
	it(`P2 resumes death during isolation, abandoned=${abandoned}`, async () => {
		const root = await project();
		await death(root, "save", "^after:link:.*install-0\\|a\\.prax$");
		await death(root, "recover", "^after:rename:.*install-0\\|.*install-0\\.reclaim-");
		if (abandoned) await rm(join(root, ".praxity-transaction.json"));
		await admit(root);
		await independent(root);
		await clean(root);
	});
it("P1 retains a malformed identity after source consumption and permits archive commands", async () => {
	const root = await project();
	await death(root, "save", "^after:step-installed-0:$");
	const journal = JSON.parse(await readFile(join(root, ".praxity-transaction.json"), "utf8"));
	await writeFile(join(root, journal.plan.stage, "install-0.identity"), "{broken");
	await expect(admit(root)).rejects.toThrow(/Project recovery conflict/);
	await admit(root);
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A1");
	expect((await listProjectRecovery(root)).map(({ stage }) => stage)).toEqual([journal.plan.stage]);
	await resolveProjectRecovery(root, journal.plan.stage);
});
for (const prefix of [7, 30, 80, 160])
	it(`P2 reclaims an unpublished journal prefix of ${prefix} bytes after death`, async () => {
		const root = await project();
		await death(root, "save", "^after:writeFile:.*[\\/]journal\\.tmp$", prefix);
		await clean(root);
	});
for (const name of [
	"journal.tmp",
	"journal.publish",
	"install-0",
	"ready.tmp",
	"installed-0.tmp",
	"committed.tmp",
	"install-0.identity",
	"rollback-0.attempt-[0-9a-f-]+",
	"rollback-0.attempt-[0-9a-f-]+.identity",
	"rollback-0.attempt-[0-9a-f-]+.capture-[0-9a-f-]+.intent.tmp",
]) {
	for (const prefix of [0, 1])
		it(`P2 silently reclaims ${name} with ${prefix} planned bytes after death`, async () => {
			const root = await project();
			const pattern = name.replaceAll(".", "\\.");
			await death(
				root,
				name.startsWith("rollback") ? "rollback" : "save",
				`^after:writeFile:.*[\\/]${pattern}(?:\\.tmp)?$`,
				prefix,
			);
			await clean(
				root,
				name === "committed.tmp" ? "A1" : "A0",
				name === "committed.tmp" ? "B1" : "B0",
			);
		});
}
it("P3 refuses an uppercase reserved journal after a real writer death", async () => {
	const root = await project();
	await death(root, "save", "^after:step-journal-undefined:$");
	await expect(
		writeProjectFiles(root, [
			{ path: ".PRAXITY-TRANSACTION.JSON", content: "outside", expectedContent: null },
		]),
	).rejects.toThrow(/Invalid project journal file path/);
	await clean(root);
});
for (const copy of ["restore", "independent"])
	for (const prefix of [0, 1])
		it(`P2 reclaims a torn ${copy} copy with ${prefix} planned bytes after recovery death`, async () => {
			const root = await project();
			await death(
				root,
				"save",
				copy === "restore"
					? "^after:rename:a\\.prax\\|.*install-0\\.capture-"
					: "^after:link:.*install-0\\|a\\.prax$",
			);
			await death(
				root,
				"recover",
				`^after:writeFile:.*install-0(?:\\.capture-[0-9a-f-]+)?\\.${copy}-[0-9a-f-]+$`,
				prefix,
			);
			await clean(root);
		});
for (const name of ["journal.tmp", "installed-0.tmp"])
	it(`retains differing ${name} bytes after real death`, async () => {
		const root = await project();
		await death(root, "save", `^after:writeFile:.*[\\/]${name.replaceAll(".", "\\.")}$`, 0);
		const stageName = (await readdir(root)).find((entry) =>
			entry.startsWith(".praxity-write-"),
		) as string;
		await writeFile(join(root, stageName, name), "outside bytes");
		await admit(root);
		await admit(root);
		const [archive] = await projectRecoveryArchives(root);
		expect(archive).toBeTruthy();
		expect(await readFile(join(root, archive, name), "utf8")).toBe("outside bytes");
		expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A0");
		await independent(join(root, archive));
	});
if (process.platform === "win32")
	for (const marker of ["installed-0", "committed", "journal.retired"])
		it(`P3 flushes renamed ${marker} before its next boundary and real death`, async () => {
			const root = await project();
			const checkpoint =
				marker === "installed-0"
					? "^after:step-installed-0:$"
					: marker === "committed"
						? "^after:rename:.*\\.praxity-transaction\\.json\\|.*journal\\.retired$"
						: "^after:unlink:.*journal\\.retired$";
			const events = await death(root, "save", checkpoint);
			const renamed = events.findIndex(
				(event) => event.startsWith("after:rename:") && event.endsWith(`/${marker}`),
			);
			expect(renamed).toBeGreaterThan(-1);
			expect(
				events
					.slice(renamed + 1)
					.some((event) => event.startsWith("after:sync:") && event.endsWith(`/${marker}`)),
			).toBe(true);
			await clean(
				root,
				marker === "installed-0" ? "A0" : "A1",
				marker === "installed-0" ? "B0" : "B1",
			);
		});
it("recovers a legacy post-ready linked installation after real death", async () => {
	const root = await project();
	await death(root, "save", "^after:step-staged-1:$");
	const journal = JSON.parse(await readFile(join(root, ".praxity-transaction.json"), "utf8"));
	const stage = join(root, journal.plan.stage);
	journal.plan.captureVersion = 1;
	delete journal.plan.stageVersion;
	journal.checksum = createHash("sha256").update(JSON.stringify(journal.plan)).digest("hex");
	for (const [index, file] of journal.plan.files.entries()) {
		await mkdir(join(stage, String(index)));
		await rename(join(stage, `install-${index}`), join(stage, String(index), basename(file.path)));
		await writeFile(join(stage, `staged-${index}`), journal.checksum);
	}
	await writeFile(join(stage, "ready"), journal.checksum);
	await copyFile(join(stage, "0", "a.prax"), join(stage, "install-0"));
	await rename(
		join(root, "a.prax"),
		join(stage, "install-0.capture-11111111-2222-4333-8444-555555555555"),
	);
	await link(join(stage, "install-0"), join(root, "a.prax"));
	for (const path of [join(root, ".praxity-transaction.json"), join(stage, "journal.tmp")])
		await writeFile(path, JSON.stringify(journal));
	await clean(root);
});
