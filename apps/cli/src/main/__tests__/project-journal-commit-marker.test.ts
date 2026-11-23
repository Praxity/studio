import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { withProjectFileTransaction, writeProjectFiles } from "../project-file-transactions";

const fault = vi.hoisted(() => ({ phase: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		rename: async (...args: Parameters<typeof fs.rename>) => {
			if (basename(String(args[1])) !== "committed" || !fault.phase) return fs.rename(...args);
			const phase = fault.phase;
			fault.phase = "";
			if (phase === "after") await fs.rename(...args);
			throw Object.assign(new Error("Commit publication I/O failure"), { code: "EIO" });
		},
	};
});
const roots: string[] = [];
afterEach(async () => {
	fault.phase = "";
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
for (const phase of ["before", "after"])
	it(`keeps durable installed peers when committed publication fails ${phase} rename`, async () => {
		const root = await mkdtemp(join(tmpdir(), "journal-commit-marker-"));
		roots.push(root);
		await writeFile(join(root, "a.prax"), "A0");
		await writeFile(join(root, "b.prax"), "B0");
		fault.phase = phase;
		const result = await writeProjectFiles(root, [
			{ path: "a.prax", content: "A1" },
			{ path: "b.prax", content: "B1", head: true },
		]);
		expect(result.cleanupError).toContain("Commit publication I/O failure");
		await withProjectFileTransaction(root, async () => {}, "write");
		expect(await readFile(join(root, "a.prax"), "utf8")).toBe("A1");
		expect(await readFile(join(root, "b.prax"), "utf8")).toBe("B1");
	});
