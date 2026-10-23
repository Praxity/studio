import { constants } from "node:fs";
import { chmod, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { writeProjectTextFile } from "../project-file-transactions";

const faults = vi.hoisted(() => ({
	afterWrite: null as (() => Promise<void>) | null,
	partial: false,
	cleanup: false,
	renameCodes: [] as string[],
	onRenameFailure: null as (() => Promise<void>) | null,
}));
// Inject storage failures at the platform boundary; retain real guarded reads and staging.
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		rename: async (...args: Parameters<typeof fs.rename>) => {
			// Sharing failures belong to the authored capture, not metadata publication.
			const code =
				basename(String(args[0])) === "course.yaml" && !String(args[0]).includes(".praxity-write-")
					? faults.renameCodes.shift()
					: undefined;
			if (code) {
				await faults.onRenameFailure?.();
				throw Object.assign(new Error("File sharing refused"), { code });
			}
			return fs.rename(...args);
		},
		unlink: async (...args: Parameters<typeof fs.unlink>) => {
			if (faults.cleanup && basename(String(args[0])) === "journal.retired") {
				faults.cleanup = false;
				throw new Error("Stage cleanup denied");
			}
			return fs.unlink(...args);
		},
		rm: async (...args: Parameters<typeof fs.rm>) => {
			if (
				faults.cleanup &&
				(basename(String(args[0])) === ".praxity-transaction.json" ||
					basename(String(args[0])).startsWith(".praxity-write-"))
			) {
				faults.cleanup = false;
				throw new Error("Stage cleanup denied");
			}
			return fs.rm(...args);
		},
		open: async (...args: Parameters<typeof fs.open>) => {
			const handle = await fs.open(...args);
			if (typeof args[1] === "number" && args[1] & constants.O_WRONLY && faults.afterWrite) {
				const afterWrite = faults.afterWrite;
				const partial = faults.partial;
				faults.afterWrite = null;
				const write = handle.writeFile.bind(handle);
				handle.writeFile = async (...data) => {
					if (partial) await write("partial", "utf8");
					else await write(...data);
					await afterWrite();
				};
			}
			return handle;
		},
	};
});

const roots: string[] = [];
async function project() {
	const root = await mkdtemp(join(tmpdir(), "text-transaction-"));
	roots.push(root);
	return root;
}
afterEach(async () => {
	vi.restoreAllMocks();
	faults.renameCodes = [];
	faults.onRenameFailure = null;
	faults.afterWrite = null;
	faults.partial = false;
	faults.cleanup = false;
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("acknowledges a committed replacement separately from a cleanup failure", async () => {
	const root = await project();
	await writeFile(join(root, "course.yaml"), "title: Original\n");
	faults.cleanup = true;
	await expect(
		writeProjectTextFile(root, "course.yaml", "title: Committed\n", "title: Original\n"),
	).resolves.toMatchObject({ cleanupError: expect.stringContaining("Stage cleanup denied") });
	expect(await readFile(join(root, "course.yaml"), "utf8")).toBe("title: Committed\n");
	await writeProjectTextFile(root, "course.yaml", "title: Next\n", "title: Committed\n");
	expect((await readdir(root)).filter((name) => name.startsWith(".praxity-write-course"))).toEqual(
		[],
	);
});

it("retains original bytes after a partial staged write fails, then permits retry", async () => {
	const root = await project();
	const target = join(root, "course.yaml");
	await writeFile(target, "title: Original\n");
	faults.partial = true;
	faults.afterWrite = async () => {
		throw new Error("Disk full");
	};
	await expect(
		writeProjectTextFile(root, "course.yaml", "title: Edited\n", "title: Original\n"),
	).rejects.toThrow("Disk full");
	expect(await readFile(target, "utf8")).toBe("title: Original\n");
	expect(await readdir(root)).toEqual(["course.yaml"]);
	await writeProjectTextFile(root, "course.yaml", "title: Edited\n", "title: Original\n");
	expect(await readFile(target, "utf8")).toBe("title: Edited\n");
});

it("preserves both refusal and cleanup errors without acknowledging a failed stage", async () => {
	const root = await project();
	await writeFile(join(root, "course.yaml"), "title: Original\n");
	faults.partial = true;
	faults.cleanup = true;
	faults.afterWrite = async () => {
		throw new Error("Disk full");
	};
	await expect(
		writeProjectTextFile(root, "course.yaml", "title: Edited\n", "title: Original\n"),
	).rejects.toMatchObject({
		errors: [
			expect.objectContaining({ message: "Disk full" }),
			expect.objectContaining({ message: "Stage cleanup denied" }),
		],
	});
	expect(await readFile(join(root, "course.yaml"), "utf8")).toBe("title: Original\n");
});

it("detects an external edit made during staging", async () => {
	const root = await project();
	const target = join(root, "course.yaml");
	await writeFile(target, "title: Original\n");
	faults.afterWrite = async () => {
		await writeFile(target, "title: External\n");
	};
	await expect(
		writeProjectTextFile(root, "course.yaml", "title: Edited\n", "title: Original\n"),
	).rejects.toThrow("File changed on disk");
	expect(await readFile(target, "utf8")).toBe("title: External\n");
});

it("does not replace an externally created file while staging a new manifest", async () => {
	const root = await project();
	const target = join(root, "course.yaml");
	faults.afterWrite = async () => {
		await writeFile(target, "title: External\n");
	};
	await expect(writeProjectTextFile(root, "course.yaml", "title: Edited\n")).rejects.toMatchObject({
		code: "EEXIST",
	});
	expect(await readFile(target, "utf8")).toBe("title: External\n");
});

it("rejects escaping symlinks and read-only replacement without changing either file", async () => {
	const root = await project();
	const outside = await project();
	const target = join(outside, "course.yaml");
	await writeFile(target, "title: Outside\n");
	await symlink(target, join(root, "course.yaml"));
	await expect(
		writeProjectTextFile(root, "course.yaml", "bad", "title: Outside\n"),
	).rejects.toThrow("Symbolic links");
	expect(await readFile(target, "utf8")).toBe("title: Outside\n");
	await rm(join(root, "course.yaml"));
	await writeFile(join(root, "course.yaml"), "original");
	await chmod(join(root, "course.yaml"), 0o444);
	try {
		await expect(writeProjectTextFile(root, "course.yaml", "bad", "original")).rejects.toThrow();
		expect(await readFile(join(root, "course.yaml"), "utf8")).toBe("original");
	} finally {
		await chmod(join(root, "course.yaml"), 0o666);
	}
});

it.each(["EPERM", "EBUSY", "EACCES"])(
	"retries transient %s through the atomic text writer",
	async (code) => {
		const root = await project();
		await writeFile(join(root, "course.yaml"), "old");
		faults.renameCodes = [code, code];
		await expect(writeProjectTextFile(root, "course.yaml", "new", "old")).resolves.toEqual({});
		expect(await readFile(join(root, "course.yaml"), "utf8")).toBe("new");
	},
);
it("rechecks the save baseline after a sharing failure", async () => {
	const root = await project();
	await writeFile(join(root, "course.yaml"), "old");
	faults.renameCodes = ["EPERM"];
	faults.onRenameFailure = () => writeFile(join(root, "course.yaml"), "external");
	await expect(writeProjectTextFile(root, "course.yaml", "draft", "old")).rejects.toThrow(
		"changed on disk",
	);
	expect(await readFile(join(root, "course.yaml"), "utf8")).toBe("external");
});
it("preserves non-sharing rename errors", async () => {
	const root = await project();
	await writeFile(join(root, "course.yaml"), "old");
	faults.renameCodes = ["EIO"];
	await expect(writeProjectTextFile(root, "course.yaml", "new", "old")).rejects.toMatchObject({
		code: "EIO",
	});
	expect(await readFile(join(root, "course.yaml"), "utf8")).toBe("old");
});
