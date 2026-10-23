import {
	link,
	mkdir,
	mkdtemp,
	open,
	readdir,
	readFile,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { withProjectFileTransaction, writeProjectFiles } from "../project-file-transactions";
import { killCommittedJournal } from "./fixtures/kill-journal-writer";

const roots: string[] = [];
const archiveSources = ["live", "crash"] as const;
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function committed(source: (typeof archiveSources)[number]) {
	const root = await mkdtemp(join(tmpdir(), "journal-archive-admission-"));
	roots.push(root);
	await writeFile(join(root, "a.prax"), "A0");
	if (source === "live") {
		// Successful saves populate the archive cache; recovered crashes do not.
		await writeProjectFiles(root, [{ path: "a.prax", content: "A1" }]);
	} else {
		await killCommittedJournal(root, [{ path: "a.prax", content: "A1" }]);
		await withProjectFileTransaction(root, async () => {}, "write", false);
	}
	const name = (await readdir(root)).find((name) => name.startsWith(".praxity-write-"));
	if (!name) throw new Error("Missing committed archive");
	const stage = join(root, name);
	const capture = (await readdir(stage)).find((name) => /^install-0\.capture-/.test(name));
	if (!capture) throw new Error("Missing captured original");
	return { root, stage, capture: join(stage, capture) };
}
it.each(archiveSources)(
	"%s save: non-reclaiming admission preserves an isolated committed archive",
	async (source) => {
		const { root, stage, capture } = await committed(source);
		await withProjectFileTransaction(root, async () => {}, "write", false);
		expect(await readFile(capture, "utf8")).toBe("A0");
		expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A1");
		expect((await readdir(root)).includes(stage.slice(root.length + 1))).toBe(true);
	},
);
it.each(archiveSources)(
	"%s save: same-size outside writes through a stale capture handle remain available until reclaim checks them",
	async (source) => {
		const { root, stage, capture } = await committed(source);
		const handle = await open(capture, "r+");
		try {
			await handle.write("AX", 0, "utf8");
			await handle.sync();
			await withProjectFileTransaction(root, async () => {}, "write", false);
			await withProjectFileTransaction(root, async () => {}, "write", true);
			expect(await readFile(capture, "utf8")).toBe("AX");
			expect(await readFile(join(stage, "conflict"), "utf8")).toMatch(/^[a-f0-9]{64}$/);
			expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A1");
		} finally {
			await handle.close();
		}
	},
);
it.each(archiveSources)(
	"%s save: replacement archives are inspected and their hard links isolated on non-reclaiming admissions",
	async (source) => {
		const { root, stage } = await committed(source);
		await rename(stage, join(root, "original-archive"));
		await mkdir(stage);
		await link(join(root, "a.prax"), join(stage, "outside"));
		await withProjectFileTransaction(root, async () => {}, "write", false);
		await writeFile(join(stage, "outside"), "Outside archive edit");
		expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A1");
	},
);
it.each(archiveSources)(
	"%s save: a symlink replacing an archive cannot bypass containment and cannot poison a restored archive",
	async (source) => {
		const { root, stage, capture } = await committed(source);
		const saved = join(root, "saved-archive");
		await rename(stage, saved);
		await symlink(saved, stage, "junction");
		await withProjectFileTransaction(root, async () => {}, "write", false);
		await rm(stage);
		await rename(saved, stage);
		await withProjectFileTransaction(root, async () => {}, "write", true);
		await expect(readFile(capture)).rejects.toMatchObject({ code: "ENOENT" });
	},
);
