import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readFileWithin, writeFileWithin } from "../path-security";
import { withProjectFileTransaction } from "../project-file-transactions";

const resolution = vi.hoisted(() => ({
	root: "",
	calls: 0,
	during: undefined as
		| undefined
		| ((path: string, resolve: () => Promise<string>) => Promise<string>),
}));
vi.mock("node:fs", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs")>();
	const realpath = Object.assign(fs.realpath.bind(fs), {
		native: (...args: Parameters<typeof fs.realpath.native>) => {
			if (String(args[0]) === resolution.root) resolution.calls++;
			if (resolution.during) {
				const callback = args[args.length - 1] as (
					error: NodeJS.ErrnoException | null,
					path?: string,
				) => void;
				void resolution
					.during(
						String(args[0]),
						() =>
							new Promise<string>((resolve, reject) => {
								fs.realpath.native(args[0], (error, path) =>
									error ? reject(error) : resolve(path),
								);
							}),
					)
					.then(
						(path) => callback(null, path),
						(error) => callback(error),
					);
				return;
			}
			return fs.realpath.native(...args);
		},
	});
	return { ...fs, realpath };
});
const roots: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	resolution.during = undefined;
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it("refuses a junction retargeted during target resolution even after its original directory is restored", async () => {
	const { parent, root } = await fixture();
	const outside = join(parent, "outside");
	await mkdir(outside);
	await writeFile(join(outside, "a.prax"), "outside");
	await withProjectFileTransaction(
		root,
		async (admitted) => {
			resolution.during = async (path, resolve) => {
				if (path !== join(admitted, "a.prax")) return resolve();
				resolution.during = undefined;
				await rename(root, `${root}-saved`);
				await symlink(outside, root, "junction");
				try {
					return await resolve();
				} finally {
					await rm(root);
					await rename(`${root}-saved`, root);
				}
			};
			await expect(readFileWithin(admitted, join(admitted, "a.prax"), "utf8")).rejects.toThrow(
				"Path traversal blocked",
			);
			expect(await readFileWithin(admitted, join(admitted, "a.prax"), "utf8")).toBe("old");
		},
		"write",
	);
	expect(await readFile(join(outside, "a.prax"), "utf8")).toBe("outside");
});
async function fixture() {
	const parent = await mkdtemp(join(tmpdir(), "project-path-admission-"));
	roots.push(parent);
	const root = join(parent, "project");
	await mkdir(root);
	await writeFile(join(root, "a.prax"), "old");
	return { parent, root };
}
it("revokes root evidence before escaped work observes a replacement in a later filesystem state", async () => {
	const { root } = await fixture();
	let release: () => void = () => {
		throw new Error("gate not initialized");
	};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let escaped: Promise<Buffer | string> | undefined;
	await withProjectFileTransaction(
		root,
		async (admitted) => {
			escaped = gate.then(() => readFileWithin(admitted, join(admitted, "a.prax"), "utf8"));
		},
		"write",
	);
	await rename(root, `${root}-saved`);
	await mkdir(root);
	await writeFile(join(root, "a.prax"), "replacement");
	const fresh = await readFileWithin(root, join(root, "a.prax"), "utf8");
	release();
	expect(await escaped).toBe("replacement");
	expect(await escaped).toBe(fresh);
});
it("does not resolve an admitted root again for reads while rechecking its directory identity", async () => {
	const { root } = await fixture();
	resolution.root = root;
	resolution.calls = 0;
	await withProjectFileTransaction(
		root,
		async (admitted) => {
			resolution.calls = 0;
			for (let i = 0; i < 10; i++) {
				expect(await readFileWithin(admitted, join(admitted, "a.prax"), "utf8")).toBe("old");
			}
		},
		"write",
	);
	expect(resolution.calls).toBe(0);
});
for (const mutation of ["junction", "directory", "parent"] as const) {
	it(`refuses an admitted ${mutation} replaced mid-transaction and works after restoration`, async () => {
		const { parent, root } = await fixture();
		const parked = `${root}-saved`;
		await withProjectFileTransaction(
			root,
			async (admitted) => {
				expect(await readFileWithin(admitted, join(admitted, "a.prax"), "utf8")).toBe("old");
				if (mutation === "parent") await rename(parent, `${parent}-saved`);
				else {
					await rename(root, parked);
					if (mutation === "junction") await symlink(parked, root, "junction");
					else {
						await mkdir(root);
						await writeFile(join(root, "a.prax"), "outside");
					}
				}
				try {
					await expect(
						readFileWithin(admitted, join(admitted, "a.prax"), "utf8"),
					).rejects.toThrow();
					await expect(
						writeFileWithin(admitted, join(admitted, "a.prax"), "bad"),
					).rejects.toThrow();
				} finally {
					if (mutation === "parent") await rename(`${parent}-saved`, parent);
					else {
						await rm(root, { recursive: mutation === "directory" });
						await rename(parked, root);
					}
				}
				expect(await readFileWithin(admitted, join(admitted, "a.prax"), "utf8")).toBe("old");
			},
			"write",
		);
		expect(await readFile(join(root, "a.prax"), "utf8")).toBe("old");
	});
}
