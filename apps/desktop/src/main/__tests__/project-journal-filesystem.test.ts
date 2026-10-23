import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { projectReadErrorKey } from "../../shared/project-write-errors";
import { writeProjectFiles } from "../project-file-transactions";

const faults = vi.hoisted(() => ({ code: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		link: async (...args: Parameters<typeof fs.link>) => {
			if (faults.code && basename(String(args[1])) === ".praxity-transaction.json")
				throw Object.assign(new Error("Hard link unavailable"), { code: faults.code });
			return fs.link(...args);
		},
	};
});
const roots: string[] = [];
afterEach(async () => {
	faults.code = "";
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
for (const code of ["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV"])
	it(`D4 refuses a volume without hard links with a specific localized error, ${code}`, async () => {
		const root = await mkdtemp(join(tmpdir(), "journal-filesystem-"));
		roots.push(root);
		await writeFile(join(root, "a.prax"), "A0");
		faults.code = code;
		const error = await writeProjectFiles(root, [{ path: "a.prax", content: "A1" }]).catch(
			(error) => error,
		);
		expect(error).toMatchObject({ code: "EPROJECTFILESYSTEM" });
		expect(projectReadErrorKey(error)).toBe("projectFilesystemUnsupported");
		expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A0");
		expect(await readdir(root)).toEqual(["a.prax"]);
	});
