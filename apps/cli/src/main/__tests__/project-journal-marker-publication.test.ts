import { constants } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { writeProjectFiles } from "../project-file-transactions";

const race = vi.hoisted(() => ({ mode: "", replacement: "", events: [] as string[] }));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		open: async (...args: Parameters<typeof fs.open>) => {
			const handle = await fs.open(...args);
			const path = String(args[0]);
			if (!path.endsWith("installed-0.tmp")) return handle;
			const sync = handle.sync.bind(handle);
			handle.sync = async () => {
				await sync();
				const info = await handle.stat({ bigint: true });
				if (`${info.dev}:${info.ino}` === race.replacement) race.events.push("flushed replacement");
			};
			if (race.mode && typeof args[1] === "number" && (args[1] & constants.O_CREAT) !== 0) {
				const close = handle.close.bind(handle);
				handle.close = async () => {
					await close();
					const mode = race.mode;
					race.mode = "";
					if (mode === "directory") {
						await fs.rm(path);
						await fs.mkdir(path);
					} else {
						const bytes = await fs.readFile(path);
						await fs.writeFile(`${path}.outside`, bytes);
						await fs.rename(`${path}.outside`, path);
						const info = await fs.lstat(path, { bigint: true });
						race.replacement = `${info.dev}:${info.ino}`;
					}
					race.events.push("replaced");
				};
			}
			return handle;
		},
		rename: async (...args: Parameters<typeof fs.rename>) => {
			if (String(args[0]).endsWith("installed-0.tmp")) race.events.push("published");
			return fs.rename(...args);
		},
	};
});
const roots: string[] = [];
afterEach(async () => {
	race.mode = "";
	race.replacement = "";
	race.events = [];
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function project() {
	const root = await mkdtemp(join(tmpdir(), "journal-marker-publication-"));
	roots.push(root);
	await writeFile(join(root, "a.prax"), "old");
	return root;
}
it("flushes a replaced installed-marker temporary before publishing its name", async () => {
	const root = await project();
	race.mode = "file";
	await writeProjectFiles(root, [{ path: "a.prax", content: "new" }]);
	expect(race.events).toEqual(["replaced", "flushed replacement", "published"]);
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("new");
});
it("refuses a directory replacing an installed-marker temporary before publication and restores source", async () => {
	const root = await project();
	race.mode = "directory";
	await expect(writeProjectFiles(root, [{ path: "a.prax", content: "new" }])).rejects.toThrow();
	expect(race.events).toEqual(["replaced"]);
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("old");
});
