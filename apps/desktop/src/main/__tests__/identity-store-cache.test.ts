import { createHash, randomUUID } from "node:crypto";
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	stat,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as contentIdentity from "@praxity/content-identity";
import { serializeIdentity } from "@praxity/content-identity";
import { afterEach, expect, it, vi } from "vitest";
import { projectDiskSnapshot } from "../../test-utils/interrupted-project-write";
import {
	CourseIdentitySession,
	IdentityStoreCache,
	loadIdentityStore,
	readIdentityRevision,
	resolveCourseIdentity,
} from "../identity-store";

const roots: string[] = [];
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const paths = ["a.prax", "b.prax"];
const sources = ["# Alpha\n\nRepeated.\n\nRepeated.\n", "# Beta\n\nUse safety equipment.\n"];
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

for (const rule of ["slug", "alias", "ancestry"] as const) {
	it(`rechecks historical ${rule} across cached facts and a changed old snapshot`, async () => {
		const { root, files } = await fixture();
		const expected = await fresh(root);
		const historical = structuredClone(expected.snapshots[1]);
		historical.sourceHash = "0".repeat(64);
		const original = serializeIdentity(historical);
		const oldPath = `.praxity/identity/snapshots/${digest(original)}.json`;
		await writeFile(join(root, oldPath), original);
		const cache = new IdentityStoreCache();
		await loadIdentityStore(root, { cache });
		const validation = vi.spyOn(contentIdentity, "parseIdentitySnapshotRecord");
		if (rule === "ancestry") historical.parents = ["0".repeat(64)];
		else {
			const donor = Object.values(expected.snapshots[0].nodes).find((node) => node.kind === "page");
			const page = Object.values(historical.nodes).find((node) => node.kind === "page");
			if (!donor?.slug || !page) throw new Error("Missing fixture page");
			if (rule === "slug") page.slug = donor.slug;
			else page.aliases = [donor.slug];
		}
		const changed = serializeIdentity(historical);
		const newPath = `.praxity/identity/snapshots/${digest(changed)}.json`;
		await rm(join(root, oldPath));
		await writeFile(join(root, newPath), changed);
		await expect(loadIdentityStore(root, { cache })).rejects.toThrow(
			rule === "ancestry" ? /missing parent snapshot/ : /already reserved/,
		);
		expect(validation).toHaveBeenCalledTimes(1);
		expect(validation.mock.calls[0][0]).toBe(changed);
		expect(cache.usage()).toMatchObject({ entries: 0, bytes: 0 });
		for (const [path, text] of files) expect(await readFile(join(root, path), "utf8")).toBe(text);
	});
}

it("revalidates an evicted snapshot and agrees with an independently fresh store", async () => {
	const { root } = await fixture();
	const expected = await fresh(root);
	const probe = new IdentityStoreCache();
	await loadIdentityStore(root, { cache: probe });
	const maxBytes = probe.usage().bytes - 1;
	const cache = new IdentityStoreCache({ maxBytes });
	await loadIdentityStore(root, { cache });
	const validation = vi.spyOn(contentIdentity, "parseIdentitySnapshotRecord");
	expect(await loadIdentityStore(root, { cache })).toEqual(expected);
	expect(validation).toHaveBeenCalledTimes(1);
	expect(cache.usage().bytes).toBeGreaterThan(0);
	expect(cache.usage().bytes).toBeLessThanOrEqual(maxBytes);
	cache.invalidate();
	validation.mockClear();
	expect(await loadIdentityStore(root, { cache })).toEqual(expected);
	expect(validation).toHaveBeenCalledTimes(2);
});

it("parses a historical proof again when it becomes a current head", async () => {
	const { root } = await fixture();
	const initial = await fresh(root);
	const historical = structuredClone(initial.snapshots[0]);
	historical.sourceHash = "0".repeat(64);
	const text = serializeIdentity(historical);
	const hash = digest(text);
	await writeFile(join(root, `.praxity/identity/snapshots/${hash}.json`), text);
	const cache = new IdentityStoreCache();
	await loadIdentityStore(root, { cache });
	const head = initial.heads.find(
		(head) => head.head === digest(serializeIdentity(initial.snapshots[0])),
	);
	if (!head) throw new Error("Missing fixture head");
	await writeFile(
		join(root, `.praxity/identity/lessons/${historical.lessonId}.json`),
		serializeIdentity({ ...head, head: hash }),
	);
	const expected = await fresh(root);
	const validation = vi.spyOn(contentIdentity, "parseIdentitySnapshotRecord");
	expect(await loadIdentityStore(root, { cache })).toEqual(expected);
	expect(validation).toHaveBeenCalledTimes(1);
	expect(validation.mock.calls[0][0]).toBe(text);
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "identity-store-cache-"));
	roots.push(root);
	await Promise.all(paths.map((path, i) => writeFile(join(root, path), sources[i])));
	const seed = await resolveCourseIdentity(root, { lessonPaths: paths });
	const files = new Map<string, string>();
	files.set(".praxity/identity/course.json", serializeIdentity(seed.identity.course));
	for (const snapshot of seed.identity.snapshots) {
		const text = serializeIdentity(snapshot);
		const hash = digest(text);
		files.set(`.praxity/identity/snapshots/${hash}.json`, text);
		const head = seed.identity.heads.find((head) => head.head === hash);
		if (!head) throw new Error("Missing fixture head");
		files.set(`.praxity/identity/lessons/${snapshot.lessonId}.json`, serializeIdentity(head));
	}
	await mkdir(join(root, ".praxity/identity/lessons"), { recursive: true });
	await mkdir(join(root, ".praxity/identity/snapshots"));
	await Promise.all([...files].map(([path, text]) => writeFile(join(root, path), text)));
	return { root, files };
}
const fresh = (root: string, options = {}) =>
	loadIdentityStore(root, { ...options, cache: new IdentityStoreCache({ maxBytes: 0 }) });

for (const maxBytes of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
	it(`refuses an invalid cache byte limit ${maxBytes}`, () => {
		expect(() => new IdentityStoreCache({ maxBytes })).toThrow(/byte limit/);
	});
}

it("invalidation prevents an in-flight load from retaining records again", async () => {
	const { root } = await fixture();
	const expected = await fresh(root);
	const cache = new IdentityStoreCache();
	await loadIdentityStore(root, { cache });
	const loading = loadIdentityStore(root, { cache });
	cache.invalidate();
	expect(await loading).toEqual(expected);
	expect(cache.usage()).toMatchObject({ entries: 0, bytes: 0 });
});

it("retains identical validated bytes and returns owned copies, including IDs and status", async () => {
	const { root, files } = await fixture();
	const { activeHistoryIds, ...expected } = readIdentityRevision(files);
	expect(activeHistoryIds).toEqual(
		new Set(expected.snapshots.flatMap((snapshot) => Object.keys(snapshot.nodes))),
	);
	const uncached = await fresh(root);
	expect(uncached).toEqual(expected);
	const cache = new IdentityStoreCache();
	const result = await loadIdentityStore(root, { cache });
	expect(result).toEqual(expected);
	expect(cache.usage()).toMatchObject({ entries: 1, hits: 0 });
	result.course = null;
	result.heads[0].path = "caller.prax";
	result.snapshots[0].nodes = {};
	result.snapshots[1].parents.push("0".repeat(64));
	expect(await loadIdentityStore(root, { cache })).toEqual(expected);
	expect(cache.usage()).toMatchObject({ entries: 1, hits: 1 });
});

it("same-size store rewrites in the same second match independent fresh results", async () => {
	const { root, files } = await fixture();
	const cache = new IdentityStoreCache();
	const expected = await fresh(root);
	await loadIdentityStore(root, { cache });
	const entry = [...files].find(([path]) => path.includes("/lessons/"));
	if (!entry) throw new Error("Missing fixture head");
	const [path, original] = entry;
	const before = await stat(join(root, path));
	const changed = original.replace("a.prax", "c.prax");
	expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(original));
	await writeFile(join(root, path), changed);
	await utimes(join(root, path), before.atime, before.mtime);
	expect(Math.floor((await stat(join(root, path))).mtimeMs / 1000)).toBe(
		Math.floor(before.mtimeMs / 1000),
	);
	const uncached = await fresh(root);
	expect(uncached.heads).not.toEqual(expected.heads);
	expect(uncached.heads.some((head) => head.path === "c.prax")).toBe(true);
	expect(await loadIdentityStore(root, { cache })).toEqual(uncached);
	expect(cache.usage().hits).toBe(0);
});

it("identical-byte file replacement discards validation instead of reusing the old record", async () => {
	const { root, files } = await fixture();
	const expected = await fresh(root);
	const cache = new IdentityStoreCache();
	await loadIdentityStore(root, { cache });
	const head = [...files].find(([path]) => path.includes("/lessons/"));
	if (!head) throw new Error("Missing fixture head");
	await writeFile(join(root, "replacement.json"), head[1]);
	await rename(join(root, "replacement.json"), join(root, head[0]));
	expect(await loadIdentityStore(root, { cache })).toEqual(expected);
	expect(cache.usage().hits).toBe(0);
});

for (const change of ["hash", "schema", "missing", "replaced"] as const) {
	it(`refuses ${change} store tampering after warming, then recovers with fresh equality`, async () => {
		const { root, files } = await fixture();
		const cache = new IdentityStoreCache();
		const expected = await fresh(root);
		await loadIdentityStore(root, { cache });
		const entry = [...files].find(([path]) => path.includes("/snapshots/"));
		if (!entry) throw new Error("Missing fixture snapshot");
		const [path, original] = entry;
		if (change === "missing") await rm(join(root, path));
		else if (change === "replaced") {
			await writeFile(join(root, "replacement.json"), "{broken}");
			await rename(join(root, "replacement.json"), join(root, path));
		} else
			await writeFile(
				join(root, path),
				change === "schema"
					? original.replace('"schema":1', '"schema":2')
					: original.replace("Repeated.", "Tampered."),
			);
		const uncached = await fresh(root).catch((error: Error) => error.message);
		expect(typeof uncached).toBe("string");
		await expect(loadIdentityStore(root, { cache })).rejects.toThrow(String(uncached));
		expect(cache.usage().entries).toBe(0);
		await writeFile(join(root, path), original);
		expect(await loadIdentityStore(root, { cache })).toEqual(expected);
	});
}

it("changed namespace configuration cannot reuse validation and has zero writes", async () => {
	const { root, files } = await fixture();
	const expected = await fresh(root);
	if (!expected.course) throw new Error("Missing fixture namespace");
	const cache = new IdentityStoreCache();
	const options = { expectedCourseId: expected.course.courseId, cache };
	await loadIdentityStore(root, options);
	options.expectedCourseId = randomUUID();
	const uncached = await fresh(root, options).catch((error: Error) => error.message);
	await expect(loadIdentityStore(root, options)).rejects.toThrow(String(uncached));
	expect(cache.usage().entries).toBe(0);
	for (const [path, text] of files) expect(await readFile(join(root, path), "utf8")).toBe(text);
	options.expectedCourseId = expected.course.courseId;
	expect(await loadIdentityStore(root, options)).toEqual(expected);
});

it("a warmed admission session still refuses an empty expected namespace", async () => {
	const { root } = await fixture();
	const options = { lessonPaths: paths, expectedCourseId: "" };
	await expect(resolveCourseIdentity(root, options)).rejects.toThrow(/invalid UUID/);
	const identitySession = new CourseIdentitySession(root);
	await resolveCourseIdentity(root, { lessonPaths: paths, identitySession });
	await expect(resolveCourseIdentity(root, { ...options, identitySession })).rejects.toThrow(
		/invalid UUID/,
	);
});

it("a mutable namespace getter cannot certify a record under a different configuration", async () => {
	const { root } = await fixture();
	const expected = await fresh(root);
	if (!expected.course) throw new Error("Missing fixture namespace");
	const courseId = expected.course.courseId;
	const foreign = randomUUID();
	let reads = 0;
	await resolveCourseIdentity(root, {
		lessonPaths: paths,
		get expectedCourseId() {
			return reads++ === 0 ? courseId : foreign;
		},
	});
	await expect(loadIdentityStore(root, { expectedCourseId: foreign })).rejects.toThrow(
		/namespace mismatch/,
	);
	expect(await loadIdentityStore(root, { expectedCourseId: courseId })).toEqual(expected);
});

it("evicts individual snapshots by retained bytes and never exceeds the budget", async () => {
	const first = await fixture();
	const second = await fixture();
	const probe = new IdentityStoreCache();
	await loadIdentityStore(first.root, { cache: probe });
	const firstBytes = probe.usage().bytes;
	probe.invalidate();
	await loadIdentityStore(second.root, { cache: probe });
	const limit = Math.max(firstBytes, probe.usage().bytes);
	const configuration = { maxBytes: limit };
	const cache = new IdentityStoreCache(configuration);
	configuration.maxBytes = Number.MAX_SAFE_INTEGER;
	const firstFresh = await fresh(first.root);
	const secondFresh = await fresh(second.root);
	expect(await loadIdentityStore(first.root, { cache })).toEqual(firstFresh);
	expect(await loadIdentityStore(second.root, { cache })).toEqual(secondFresh);
	expect(cache.usage()).toMatchObject({ entries: 1, hits: 0 });
	expect(cache.usage().bytes).toBeLessThanOrEqual(limit);
	expect(await loadIdentityStore(first.root, { cache })).toEqual(firstFresh);
	expect(cache.usage().hits).toBe(0);
	const tiny = new IdentityStoreCache({ maxBytes: firstBytes - 1 });
	expect(await loadIdentityStore(first.root, { cache: tiny })).toEqual(firstFresh);
	expect(tiny.usage().bytes).toBeGreaterThan(0);
	expect(tiny.usage().bytes).toBeLessThan(firstBytes);
	const disabled = new IdentityStoreCache({ maxBytes: 1 });
	expect(await loadIdentityStore(first.root, { cache: disabled })).toEqual(firstFresh);
	expect(disabled.usage().bytes).toBe(0);
});

it("entry eviction retains recently used stores and returns fresh results for evicted stores", async () => {
	const fixtures = await Promise.all(Array.from({ length: 9 }, () => fixture()));
	const expected = await Promise.all(fixtures.map(({ root }) => fresh(root)));
	const cache = new IdentityStoreCache();
	for (let i = 0; i < 8; i++)
		expect(await loadIdentityStore(fixtures[i].root, { cache })).toEqual(expected[i]);
	expect(await loadIdentityStore(fixtures[0].root, { cache })).toEqual(expected[0]);
	expect(cache.usage()).toMatchObject({ entries: 8, hits: 1 });
	expect(await loadIdentityStore(fixtures[8].root, { cache })).toEqual(expected[8]);
	expect(await loadIdentityStore(fixtures[0].root, { cache })).toEqual(expected[0]);
	expect(cache.usage().hits).toBe(2);
	expect(await loadIdentityStore(fixtures[1].root, { cache })).toEqual(expected[1]);
	expect(cache.usage()).toMatchObject({ entries: 8, hits: 2 });
});

it("validly hashed additional history still runs the original ancestry checks", async () => {
	const { root } = await fixture();
	const expected = await fresh(root);
	const cache = new IdentityStoreCache();
	await loadIdentityStore(root, { cache });
	const snapshot = structuredClone(expected.snapshots[0]);
	snapshot.parents = ["0".repeat(64)];
	const text = serializeIdentity(snapshot);
	const path = join(root, `.praxity/identity/snapshots/${digest(text)}.json`);
	await writeFile(path, text);
	await expect(fresh(root)).rejects.toThrow(/missing parent snapshot/);
	await expect(loadIdentityStore(root, { cache })).rejects.toThrow(/missing parent snapshot/);
	expect(cache.usage().entries).toBe(0);
	await rm(path);
	expect(await loadIdentityStore(root, { cache })).toEqual(expected);
});

it("retargeted and restored store junctions retain path refusals even for identical bytes", async () => {
	const { root } = await fixture();
	const cache = new IdentityStoreCache();
	const expected = await fresh(root);
	await loadIdentityStore(root, { cache });
	const saved = join(root, "saved-store");
	const link = join(root, ".praxity");
	await rename(link, saved);
	await symlink(saved, link, "junction");
	expect(await loadIdentityStore(root, { cache })).toEqual(expected);
	const before = await projectDiskSnapshot(saved);
	const refusal = {
		messageRef: { key: "desktop.identity.plainStoreRequired", args: { path: ".praxity" } },
	};
	await expect(resolveCourseIdentity(root, { lessonPaths: paths })).rejects.toMatchObject(refusal);
	expect(await projectDiskSnapshot(saved)).toEqual(before);
	const outside = await mkdtemp(join(tmpdir(), "identity-store-outside-"));
	roots.push(outside);
	await cp(saved, outside, { recursive: true });
	await rm(link);
	await symlink(outside, link, "junction");
	const uncached = await fresh(root).catch((error: Error) => error.message);
	await expect(loadIdentityStore(root, { cache })).rejects.toThrow(String(uncached));
	expect(cache.usage().entries).toBe(0);
	await rm(link);
	await symlink(saved, link, "junction");
	await expect(resolveCourseIdentity(root, { lessonPaths: paths })).rejects.toMatchObject(refusal);
	expect(await projectDiskSnapshot(saved)).toEqual(before);
	await rm(link);
	await rename(saved, link);
	expect(await loadIdentityStore(root, { cache })).toEqual(expected);
});

it("cached stores equal independent fresh stores through randomized mutations and caller edits", async () => {
	const { root, files } = await fixture();
	const cache = new IdentityStoreCache();
	let state = 0x4c414e;
	const random = () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state;
	};
	const expected = await fresh(root);
	await loadIdentityStore(root, { cache });
	const head = [...files].find(([path]) => path.includes("/lessons/"));
	const snapshot = [...files].find(([path]) => path.includes("/snapshots/"));
	if (!head || !snapshot) throw new Error("Missing fixture files");
	for (let i = 0; i < 40; i++) {
		const step = random() % 6;
		await writeFile(
			join(root, head[0]),
			step === 0 ? head[1].replace("a.prax", "c.prax") : head[1],
		);
		await writeFile(join(root, snapshot[0]), step === 1 ? "{broken}" : snapshot[1]);
		if (step === 2) cache.invalidate();
		if (step === 3) {
			// The other lesson's source is outside the stored validation. Resolution must still read it.
			await writeFile(join(root, "b.prax"), sources[1].replace("equipment", `equipment ${i}`));
		}
		const uncached = await fresh(root).then(
			(store) => ({ store }),
			(error: Error) => ({ error: error.message }),
		);
		const cached = await loadIdentityStore(root, { cache }).then(
			(store) => ({ store }),
			(error: Error) => ({ error: error.message }),
		);
		expect(cached, `step ${i}, mutation ${step}`).toEqual(uncached);
		if ("store" in cached) {
			cached.store.snapshots[0].nodes = {};
			cached.store.heads.reverse();
		}
	}
	await writeFile(join(root, head[0]), head[1]);
	await writeFile(join(root, snapshot[0]), snapshot[1]);
	expect(await loadIdentityStore(root, { cache })).toEqual(expected);
});
