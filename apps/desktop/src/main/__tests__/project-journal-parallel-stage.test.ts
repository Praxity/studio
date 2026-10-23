import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { writeProjectFiles } from "../project-file-transactions";

const io = vi.hoisted(() => ({
	enabled: false,
	fail: false,
	active: 0,
	max: 0,
	opened: [] as number[],
	closed: [] as number[],
	synced: [] as number[],
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		open: async (...args: Parameters<typeof fs.open>) => {
			const handle = await fs.open(...args);
			const match = /[\\/]install-(\d+)$/.exec(String(args[0]));
			if (!io.enabled || !match) return handle;
			const index = Number(match[1]);
			io.opened.push(index);
			io.max = Math.max(io.max, ++io.active);
			const sync = handle.sync.bind(handle);
			handle.sync = async () => {
				await delay(20);
				if (io.fail && index === 0) throw new Error("Injected staging flush failure");
				await sync();
				io.synced.push(index);
			};
			const close = handle.close.bind(handle);
			handle.close = async () => {
				try {
					await close();
				} finally {
					io.active--;
					io.closed.push(index);
				}
			};
			return handle;
		},
	};
});
const roots: string[] = [];
afterEach(async () => {
	io.enabled = false;
	io.fail = false;
	io.active = 0;
	io.max = 0;
	io.opened = [];
	io.closed = [];
	io.synced = [];
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function project(count: number) {
	const root = await mkdtemp(join(tmpdir(), "journal-parallel-stage-"));
	roots.push(root);
	await Promise.all(
		Array.from({ length: count }, (_, i) => writeFile(join(root, `${i}.prax`), `old ${i}`)),
	);
	return root;
}
it("stages and flushes independent files concurrently with a fixed cap and ordered checkpoints", async () => {
	const root = await project(9);
	const checkpoints: number[] = [];
	const installed: string[] = [];
	await writeProjectFiles(
		root,
		Array.from({ length: 9 }, (_, i) => ({
			path: `${i}.prax`,
			content: `new ${i}`,
			head: i === 8,
		})),
		{
			onStep: async ({ kind, index }) => {
				if (kind === "journal") io.enabled = true;
				if (kind === "staged" && index !== undefined) {
					checkpoints.push(index);
					expect(io.synced).toContain(index);
				}
				if (kind === "installed" || kind === "head") {
					io.enabled = false;
					installed.push(kind);
					expect(checkpoints).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
					expect(io.active).toBe(0);
				}
			},
		},
	);
	expect(io.max).toBeGreaterThan(1);
	expect(io.max).toBeLessThanOrEqual(4);
	expect(io.closed).toHaveLength(io.opened.length);
	expect(installed).toEqual([...Array(8).fill("installed"), "head"]);
}, 30_000);
it("a failed staging flush drains admitted peers and closes every handle before rollback", async () => {
	const root = await project(4);
	const checkpoints: string[] = [];
	await expect(
		writeProjectFiles(
			root,
			Array.from({ length: 4 }, (_, i) => ({
				path: `${i}.prax`,
				content: `new ${i}`,
				head: i === 3,
			})),
			{
				onStep: async ({ kind }) => {
					checkpoints.push(kind);
					if (kind === "journal") {
						io.enabled = true;
						io.fail = true;
					}
				},
			},
		),
	).rejects.toThrow("Injected staging flush failure");
	expect(io.opened).toContain(1);
	expect(io.synced).toContain(1);
	expect(io.active).toBe(0);
	expect(io.closed).toHaveLength(io.opened.length);
	expect(checkpoints).toEqual(["journal"]);
	for (let i = 0; i < 4; i++)
		expect(await readFile(join(root, `${i}.prax`), "utf8")).toBe(`old ${i}`);
});
