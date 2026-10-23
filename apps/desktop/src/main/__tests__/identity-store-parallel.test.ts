import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { serializeIdentity } from "@praxity/content-identity";
import { afterEach, expect, it, vi } from "vitest";
import { IdentityStoreCache, loadIdentityStore, resolveCourseIdentity } from "../identity-store";

const io = vi.hoisted(() => ({
	enabled: false,
	fail: "",
	active: 0,
	max: 0,
	opened: [] as string[],
	closed: [] as string[],
	read: [] as string[],
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		open: async (...args: Parameters<typeof fs.open>) => {
			const handle = await fs.open(...args);
			const path = String(args[0]).replaceAll("\\", "/");
			if (!io.enabled || !/\/identity\/(snapshots|lessons)\/[^/]+\.json$/.test(path)) return handle;
			io.opened.push(path);
			io.max = Math.max(io.max, ++io.active);
			const readFile = handle.readFile.bind(handle);
			handle.readFile = (async (...readArgs: Parameters<typeof handle.readFile>) => {
				if (path === io.fail) throw new Error("Injected identity read failure");
				await delay(20);
				const result = await readFile(...readArgs);
				io.read.push(path);
				return result;
			}) as typeof handle.readFile;
			const close = handle.close.bind(handle);
			handle.close = async () => {
				try {
					await close();
				} finally {
					io.active--;
					io.closed.push(path);
				}
			};
			return handle;
		},
	};
});
const roots: string[] = [];
afterEach(async () => {
	Object.assign(io, {
		enabled: false,
		fail: "",
		active: 0,
		max: 0,
		opened: [],
		closed: [],
		read: [],
	});
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "identity-parallel-"));
	roots.push(root);
	const paths = Array.from({ length: 9 }, (_, i) => `${i}.prax`);
	await Promise.all(
		paths.map((path, i) => writeFile(join(root, path), `# Lesson ${i}\n\nText ${i}.\n`)),
	);
	const seed = await resolveCourseIdentity(root, { lessonPaths: paths });
	const files = new Map<string, string>([
		[".praxity/identity/course.json", serializeIdentity(seed.identity.course)],
	]);
	for (const snapshot of seed.identity.snapshots) {
		const text = serializeIdentity(snapshot);
		const hash = createHash("sha256").update(text).digest("hex");
		const head = seed.identity.heads.find((head) => head.head === hash);
		if (!head) throw new Error("Missing fixture head");
		files.set(`.praxity/identity/snapshots/${hash}.json`, text);
		files.set(`.praxity/identity/lessons/${snapshot.lessonId}.json`, serializeIdentity(head));
	}
	await mkdir(join(root, ".praxity/identity/lessons"), { recursive: true });
	await mkdir(join(root, ".praxity/identity/snapshots"));
	await Promise.all([...files].map(([path, text]) => writeFile(join(root, path), text)));
	return { root, files };
}
it("reads independent store files concurrently, with a fixed cap and fresh result ordering", async () => {
	const { root } = await fixture();
	const expected = await loadIdentityStore(root, {
		cache: new IdentityStoreCache({ maxBytes: 0 }),
	});
	io.enabled = true;
	const cache = new IdentityStoreCache();
	expect(await loadIdentityStore(root, { cache })).toEqual(expected);
	expect(io.max).toBeGreaterThan(1);
	expect(io.max).toBeLessThanOrEqual(8);
	expect(io.active).toBe(0);
	expect(io.opened).toHaveLength(18);
	expect(io.closed).toHaveLength(18);
	expect(await loadIdentityStore(root, { cache })).toEqual(expected);
	expect(cache.usage()).toMatchObject({ entries: 1, hits: 1 });
});
it("a failed store read drains admitted peers and closes every handle before refusing", async () => {
	const { root, files } = await fixture();
	const snapshots = [...files.keys()].filter((path) => path.includes("/snapshots/")).sort();
	const first = snapshots[0];
	const peer = snapshots[1];
	if (!first || !peer) throw new Error("Missing fixture snapshots");
	const expected = await loadIdentityStore(root, {
		cache: new IdentityStoreCache({ maxBytes: 0 }),
	});
	const cache = new IdentityStoreCache();
	await loadIdentityStore(root, { cache });
	io.enabled = true;
	io.fail = join(root, first).replaceAll("\\", "/");
	await expect(loadIdentityStore(root, { cache })).rejects.toThrow(
		"Injected identity read failure",
	);
	expect(io.read).toContain(join(root, peer).replaceAll("\\", "/"));
	expect(io.active).toBe(0);
	expect(io.closed).toHaveLength(io.opened.length);
	expect(cache.usage()).toMatchObject({ entries: 0, bytes: 0 });
	io.fail = "";
	expect(await loadIdentityStore(root, { cache })).toEqual(expected);
});
