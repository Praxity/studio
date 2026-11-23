import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { saveExport } from "../export/save-export";

it("replaces completed output atomically and preserves it on cancellation or unsafe paths", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "praxity-save-export-"));
	try {
		const output = path.join(root, "course.pdf");
		await writeFile(output, "previous");
		const controller = new AbortController();
		controller.abort();
		await expect(
			saveExport(root, output, Buffer.from("cancelled"), controller.signal),
		).rejects.toThrow();
		expect(await readFile(output, "utf8")).toBe("previous");
		await saveExport(root, output, Buffer.from("complete"));
		expect(await readFile(output, "utf8")).toBe("complete");
		const linked = path.join(root, "linked.pdf");
		await symlink(output, linked);
		await expect(saveExport(root, linked, Buffer.from("unsafe"))).rejects.toThrow("Symbolic links");
		expect(await readFile(output, "utf8")).toBe("complete");
		expect((await readdir(root)).sort()).toEqual(["course.pdf", "linked.pdf"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
