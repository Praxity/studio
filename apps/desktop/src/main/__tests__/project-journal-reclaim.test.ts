import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
	projectRecoveryArchives,
	withProjectFileTransaction,
	writeProjectFiles,
} from "../project-file-transactions";
import { killCommittedJournal } from "./fixtures/kill-journal-writer";

const race = vi.hoisted(() => ({ stage: "", capture: "", hit: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	async function edit(path: string) {
		if (path !== race.stage || race.hit) return;
		race.hit = true;
		await fs.writeFile(race.capture, "Outside bytes before quarantine");
	}
	return {
		...fs,
		rename: async (...args: Parameters<typeof fs.rename>) => {
			await edit(String(args[0]));
			return fs.rename(...args);
		},
		rm: async (...args: Parameters<typeof fs.rm>) => {
			await edit(String(args[0]));
			return fs.rm(...args);
		},
	};
});
const roots: string[] = [];
afterEach(async () => {
	race.stage = "";
	race.capture = "";
	race.hit = false;
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
for (const outcome of ["save", "crash admission"])
	it(`D3 rechecks captured bytes after quarantine on a later admission after ${outcome}`, async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "journal-reclaim-")));
		roots.push(root);
		await writeFile(join(root, "a.prax"), "A0");
		const prepareRace = async () => {
			const stage = (await readdir(root)).find((name) =>
				name.startsWith(".praxity-write-"),
			) as string;
			race.stage = join(root, stage);
			race.capture = join(
				race.stage,
				(await readdir(race.stage)).find((name) => /^install-0\.capture-/.test(name)) as string,
			);
		};
		if (outcome === "save") {
			await writeProjectFiles(root, [{ path: "a.prax", content: "A1" }], {
				onStep: async ({ kind }) => {
					if (kind === "installed") await prepareRace();
				},
			});
			await withProjectFileTransaction(root, async () => {}, "write");
		} else {
			await killCommittedJournal(root, [{ path: "a.prax", content: "A1" }]);
			await withProjectFileTransaction(root, async () => {}, "write", false);
			await prepareRace();
			await withProjectFileTransaction(root, async () => {}, "write");
		}
		await withProjectFileTransaction(
			root,
			async (canonical) => {
				expect(race.hit).toBe(true);
				const [archive] = await projectRecoveryArchives(canonical);
				expect(archive).toBeDefined();
				const capture = (await readdir(join(canonical, archive))).find((name) =>
					/^install-0\.capture-/.test(name),
				) as string;
				expect(await readFile(join(canonical, archive, capture), "utf8")).toBe(
					"Outside bytes before quarantine",
				);
			},
			"read",
		);
		expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A1");
	});
