import { type ChildProcess, execFile, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
	chmod,
	cp,
	link,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	readlink,
	realpath,
	rename,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type {
	ReviewAnchor,
	ReviewPrincipal,
	ReviewThreadList,
	ReviewVisibilityPolicy,
} from "@praxity/review-share/review";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { ProjectFilesystemUnsupportedError } from "../../shared/project-write-errors";
import {
	defaultProjectFileFlushes,
	withProjectFileFlushes,
	writeProjectFiles,
} from "../project-file-transactions";
import {
	openReviewStore,
	type ReviewStore,
	type ReviewStoreCommandResult,
} from "../studio/review-store";

const run = promisify(execFile);
const roots: string[] = [];
const concurrentRoots: string[] = [];
let concurrent: { root: string; store: ReviewStore };
let gitRoot: string;
let probeEntry: string;
let busyRefusal: unknown;
let busyOpenElapsed: number;
const concurrentWriters: ChildProcess[] = [];
const firstUseWriters: ChildProcess[] = [];
let firstUseRoot: string;
let heldFile: Awaited<ReturnType<typeof seeded>>;
let fileHolder: ChildProcess;
const children: ChildProcess[] = [];
type Boundary = { kind: "file" | "directory"; path: string };
type LedgerEntry = Boundary | { kind: "rename"; path: string };
const publicationSize = process.platform === "win32" ? 9 : 11;
const recordedBoundaries: Boundary[] = [];
const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu;

function normalizedPath(root: string, target: string) {
	return relative(root, target).replaceAll("\\", "/").replace(uuidPattern, "<uuid>") || ".";
}
/** Observe publication at the public flush seam: the staged inode becomes the target. */
function flushLedger(root: string, beforeFlush?: (boundary: Boundary) => void) {
	const entries: LedgerEntry[] = [];
	const staged = new Map<string, { temporary: string; ino: number }>();
	async function observeRenames(directory: string) {
		for (const [target, { temporary, ino }] of staged) {
			if (dirname(target) !== directory) continue;
			const installed = await stat(target).catch(() => null);
			if (installed?.ino !== ino) continue;
			await expect(stat(temporary)).rejects.toMatchObject({ code: "ENOENT" });
			entries.push({ kind: "rename", path: normalizedPath(root, target) });
			staged.delete(target);
		}
	}
	function record(kind: Boundary["kind"], target: string) {
		const entry = { kind, path: normalizedPath(root, target) };
		entries.push(entry);
		beforeFlush?.(entry);
	}
	return {
		entries,
		flushes: {
			async syncFile(base: string, target: string) {
				if (target.endsWith(".tmp")) {
					const name = basename(target)
						.replace(/^\./u, "")
						.replace(/\.[0-9a-f-]{36}\.tmp$/u, "");
					staged.set(join(dirname(target), name), {
						temporary: target,
						ino: (await stat(target)).ino,
					});
				} else await observeRenames(dirname(target));
				record("file", target);
				await defaultProjectFileFlushes.syncFile(base, target);
			},
			async syncDirectory(directory: string) {
				await observeRenames(directory);
				record("directory", directory);
				await defaultProjectFileFlushes.syncDirectory(directory);
			},
		},
	};
}
const reader: ReviewPrincipal = {
	id: "test-reader",
	displayName: "Reader",
	role: "reviewer",
	provenance: "local-preview",
};
const anchor: ReviewAnchor = {
	courseId: null,
	lessonId: null,
	pageId: "page-1",
	nodeId: null,
	blockId: null,
	revision: null,
	quote: null,
	pin: null,
	tab: null,
	revealPath: [],
	cssPath: null,
	context: { pageTitle: "Page one", targetLabel: null },
};
const preserved = {
	"course.yaml": "title: Course\nlessons: [a.prax]\n",
	"a.prax": "# Page one\n\nSource text\n",
	"narration.yaml": "schema: 2\n",
	".praxity/identity/keep.json": "identity bytes\n",
	".praxity/local/keep": "local bytes\n",
	".praxity/review/keep": "retired bytes\n",
};

async function fixture(cleanup = roots) {
	const root = await realpath(await mkdtemp(join(tmpdir(), "review-store-")));
	cleanup.push(root);
	for (const directory of ["identity", "local", "review"])
		await mkdir(join(root, ".praxity", directory), { recursive: true });
	for (const [path, bytes] of Object.entries(preserved)) await writeFile(join(root, path), bytes);
	return root;
}
async function gitFixture() {
	const root = await fixture();
	const target = join(gitRoot, basename(root));
	await rename(root, target);
	roots[roots.indexOf(root)] = target;
	return target;
}
async function unchanged(root: string) {
	for (const [path, bytes] of Object.entries(preserved))
		expect(await readFile(join(root, path), "utf8")).toBe(bytes);
}
async function tree(
	root: string,
	directory = "",
): Promise<Record<string, Buffer | null | { link: string }>> {
	const result: Record<string, Buffer | null | { link: string }> = {};
	for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
		const path = directory ? `${directory}/${entry.name}` : entry.name;
		if (entry.isSymbolicLink()) result[path] = { link: await readlink(join(root, path)) };
		else if (entry.isDirectory()) {
			result[path] = null;
			Object.assign(result, await tree(root, path));
		} else result[path] = await readFile(join(root, path));
	}
	return result;
}
function success(result: ReviewStoreCommandResult) {
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error(JSON.stringify(result));
	if (!result.thread) throw new Error("Expected visible thread");
	return { ...result, thread: result.thread };
}
async function seeded(cleanup = roots) {
	const root = await fixture(cleanup);
	const store = await openReviewStore(root);
	const principal = await store.principalFor("reviewer", "local-preview");
	const payload = { reviewId: store.reviewId, requestId: randomUUID(), anchor, body: "Original" };
	const result = success(await store.create(principal, payload));
	const path = join(root, ".praxity/reviews", store.reviewId, "comments.json");
	return { root, store, principal, payload, result, path };
}

beforeAll(async () => {
	gitRoot = await mkdtemp(join(tmpdir(), "review-git-"));
	concurrentRoots.push(gitRoot);
	await run("git", ["init", "--quiet", gitRoot]);
	const tools = await mkdtemp(join(tmpdir(), "review-probe-"));
	concurrentRoots.push(tools);
	probeEntry = join(tools, "probe.mjs");
	await build({
		entryPoints: [fileURLToPath(new URL("./fixtures/review-store-probe.ts", import.meta.url))],
		outfile: probeEntry,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		banner: {
			js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
		},
	});
	const writerEntry = join(tools, "writer.mjs");
	await build({
		entryPoints: [fileURLToPath(new URL("./fixtures/review-store-writer.ts", import.meta.url))],
		outfile: writerEntry,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		banner: {
			js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
		},
	});
	// Both independent processes wait at one barrier before the timed contention case.
	const root = await fixture(concurrentRoots);
	const store = await openReviewStore(root);
	concurrent = { root, store };
	await Promise.all(
		[0, 1].map(async (index) => {
			const child = fork(writerEntry, [], {
				execArgv: [],
				silent: true,
			});
			children.push(child);
			concurrentWriters.push(child);
			await once(child, "message");
			const prepared = once(child, "message");
			child.send({
				root,
				payload: {
					reviewId: store.reviewId,
					requestId: randomUUID(),
					anchor,
					body: `Process ${index}`,
				},
			});
			expect((await prepared)[0]).toBe("prepared");
		}),
	);
	firstUseRoot = await realpath(await fixture(concurrentRoots));
	await Promise.all(
		[0, 1].map(async (index) => {
			const child = fork(probeEntry, ["first-use", firstUseRoot], {
				execArgv:
					index === 0
						? [
								"--require",
								fileURLToPath(new URL("./fixtures/review-store-cold-read.cjs", import.meta.url)),
							]
						: [],
				silent: true,
			});
			children.push(child);
			firstUseWriters.push(child);
			expect((await once(child, "message"))[0]).toBe("ready");
		}),
	);
	if (process.platform === "win32") {
		heldFile = await seeded(concurrentRoots);
		fileHolder = fork(probeEntry, ["file-hold", heldFile.path], { execArgv: [], silent: true });
		children.push(fileHolder);
		expect((await once(fileHolder, "message"))[0]).toBe("file-open");
	}
	const baselineRoot = await realpath(await fixture(concurrentRoots));
	const baseline = flushLedger(baselineRoot);
	await withProjectFileFlushes(baseline.flushes, async () => {
		const store = await openReviewStore(baselineRoot);
		const input = { reviewId: store.reviewId, requestId: randomUUID(), anchor, body: "Baseline" };
		success(await store.create(reader, input));
		expect(success(await store.create(reader, input)).replayed).toBe(true);
	});
	recordedBoundaries.push(
		...baseline.entries.filter((entry): entry is Boundary => entry.kind !== "rename"),
	);

	const busyRoot = await fixture(concurrentRoots);
	await openReviewStore(busyRoot);
	const holder = fork(probeEntry, ["hold", busyRoot], { execArgv: [], silent: true });
	children.push(holder);
	expect((await once(holder, "message"))[0]).toBe("locked");
	// The real lock deadline is 5 s. Contention setup belongs outside the <2 s assertion case.
	const busyStarted = performance.now();
	try {
		await openReviewStore(busyRoot);
	} catch (error) {
		busyRefusal = error;
	}
	busyOpenElapsed = performance.now() - busyStarted;
	const released = once(holder, "exit");
	holder.send("release");
	await released;
}, 30000);
afterAll(async () => {
	await Promise.all(
		children.map(async (child) => {
			if (child.exitCode !== null || child.signalCode !== null) return;
			const exited = once(child, "exit");
			child.kill();
			await exited;
		}),
	);
	await Promise.all(
		concurrentRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("existing-only open on a fresh course leaves every path and byte unchanged", async () => {
	const root = await fixture();
	const before = await tree(root);
	await expect(openReviewStore(root, undefined, { createIfMissing: false })).rejects.toMatchObject({
		code: "not-initialized",
	});
	expect(await tree(root)).toEqual(before);
	await unchanged(root);
});

it.each(["junction", "directory"] as const)(
	"existing-only open refuses a %s ignore path without changing either tree",
	async (kind) => {
		const root = await fixture();
		const target = await fixture();
		await mkdir(join(root, ".praxity/reviews"));
		const ignore = join(root, ".praxity/reviews/.gitignore");
		if (kind === "junction")
			await symlink(target, ignore, process.platform === "win32" ? "junction" : "dir");
		else await mkdir(ignore);
		const before = await tree(root);
		const outside = await tree(target);
		await expect(
			openReviewStore(root, undefined, { createIfMissing: false }),
		).rejects.toMatchObject({ code: "unsafe-path" });
		expect(await tree(root)).toEqual(before);
		expect(await tree(target)).toEqual(outside);
	},
	2_000,
);

it.each(
	["manifest.json", ".gitignore"].flatMap((name) =>
		(["junction", "directory", "file"] as const).map((kind) => ({ name, kind })),
	),
)(
	"existing-only open admits $kind temp for $name without changing either tree",
	async ({ name, kind }) => {
		const root = await fixture();
		const target = await fixture();
		await mkdir(join(root, ".praxity/reviews"));
		const temp = join(root, `.praxity/reviews/.${name}.10000000-0000-4000-8000-000000000001.tmp`);
		if (kind === "junction")
			await symlink(target, temp, process.platform === "win32" ? "junction" : "dir");
		else if (kind === "directory") await mkdir(temp);
		else await writeFile(temp, Buffer.from([0, 255, 1]));
		const before = await tree(root);
		const outside = await tree(target);
		await expect(
			openReviewStore(root, undefined, { createIfMissing: false }),
		).rejects.toMatchObject({ code: kind === "file" ? "not-initialized" : "unsafe-path" });
		expect(await tree(root)).toEqual(before);
		expect(await tree(target)).toEqual(outside);
	},
	2_000,
);

it("reopens the default review, local principal and threads after restart", async () => {
	const { root, store, principal, result } = await seeded();
	const reopened = await openReviewStore(root);
	expect(reopened.reviewId).toBe(store.reviewId);
	expect(await reopened.principalFor("reviewer", "local-preview")).toEqual(principal);
	expect(await reopened.list(reader)).toEqual({
		reviewId: store.reviewId,
		changeSeq: 1,
		threads: [result.thread],
		nextCursor: null,
	});
	await unchanged(root);
});

it("accepts a visibility policy through the store and hides threads before paging", async () => {
	const { root, store, principal, result, payload } = await seeded();
	const second = success(
		await store.create(principal, {
			...payload,
			requestId: randomUUID(),
			body: "Visible",
		}),
	);
	const policy: ReviewVisibilityPolicy = {
		visibleTo: (actor, thread, state) =>
			actor.role === "author" ||
			(state.reviewId === store.reviewId && thread.id !== result.thread.id),
	};
	const restricted = await openReviewStore(root, policy);
	expect(await restricted.list(reader, { limit: 1 })).toEqual({
		reviewId: store.reviewId,
		changeSeq: 2,
		threads: [second.thread],
		nextCursor: null,
	});
	expect(((await store.list(reader)) as ReviewThreadList).threads).toHaveLength(2);
	expect(
		(
			(await restricted.list(
				await restricted.principalFor("author", "local-cli"),
			)) as ReviewThreadList
		).threads,
	).toHaveLength(2);
});

it("stores a role-neutral local principal in a strict versioned manifest", async () => {
	const { root, store, principal } = await seeded();
	expect(JSON.parse(await readFile(join(root, ".praxity/reviews/manifest.json"), "utf8"))).toEqual({
		schema: 1,
		reviewId: store.reviewId,
		initialized: true,
		localPrincipal: { id: principal.id, displayName: "Local user" },
	});
	expect(await store.principalFor("author", "local-cli")).toEqual({
		id: principal.id,
		displayName: "Local user",
		role: "author",
		provenance: "local-cli",
	});
});

it("reopens today's schema-1 state without migrating or rewriting its bytes", async () => {
	const { root, store, path } = await seeded();
	const bytes = await readFile(path);
	expect(JSON.parse(bytes.toString()).schema).toBe(1);
	const reopened = await openReviewStore(root);
	expect(reopened.reviewId).toBe(store.reviewId);
	expect(await reopened.list(reader)).toMatchObject({
		changeSeq: 1,
		threads: [{ messages: [{ body: "Original" }] }],
	});
	expect(await readFile(path)).toEqual(bytes);
	await unchanged(root);
});

it("refuses a newer schema through reads, reopen and writes without changing any bytes", async () => {
	const { root, store, principal, payload, path } = await seeded();
	const bytes = JSON.stringify({ ...JSON.parse(await readFile(path, "utf8")), schema: 2 });
	await writeFile(path, bytes);
	for (const work of [
		() => store.list(reader),
		() => openReviewStore(root),
		() => store.create(principal, { ...payload, requestId: randomUUID() }),
	])
		await expect(work()).rejects.toMatchObject({ name: "ReviewStoreError", code: "newer-schema" });
	expect(await readFile(path, "utf8")).toBe(bytes);
	await unchanged(root);
});

it.each([
	{ initialized: "yes" },
	{ extra: true },
	{ localPrincipal: { id: "unknown", displayName: "Local user" } },
	{
		localPrincipal: {
			id: "00000000-0000-4000-8000-000000000001",
			displayName: "Local user",
			role: "admin",
		},
	},
	{ reviewer: { id: "00000000-0000-4000-8000-000000000001", displayName: "Local user" } },
])("refuses unknown manifest fields and values: %j", async (patch) => {
	const { root, store, path } = await seeded();
	const manifestPath = join(root, ".praxity/reviews/manifest.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	const bytes = JSON.stringify({ ...manifest, ...patch });
	const before = await readFile(path);
	await writeFile(manifestPath, bytes);
	await expect(store.list(reader)).rejects.toMatchObject({ code: "invalid-state" });
	await expect(openReviewStore(root)).rejects.toMatchObject({ code: "invalid-state" });
	expect(await readFile(manifestPath, "utf8")).toBe(bytes);
	expect(await readFile(path)).toEqual(before);
	await unchanged(root);
});

it("initializes an absent .praxity without writing identity or source", async () => {
	const root = await mkdtemp(join(tmpdir(), "review-store-"));
	roots.push(root);
	await writeFile(join(root, "a.prax"), "Source bytes\n");
	const store = await openReviewStore(root);
	expect(await store.list(reader)).toEqual({
		reviewId: store.reviewId,
		changeSeq: 0,
		threads: [],
		nextCursor: null,
	});
	expect(await readdir(join(root, ".praxity"))).toEqual(["reviews"]);
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe("Source bytes\n");
});

it("source writes leave review state, receipts and identity unchanged", async () => {
	const { root, path } = await seeded();
	const before = await readFile(path);
	const manifest = await readFile(join(root, ".praxity/reviews/manifest.json"));
	expect(
		await writeProjectFiles(root, [
			{
				path: "a.prax",
				content: "# Changed page\n",
				expectedContent: preserved["a.prax"],
			},
		]),
	).toEqual({});
	expect(await readFile(path)).toEqual(before);
	expect(await readFile(join(root, ".praxity/reviews/manifest.json"))).toEqual(manifest);
	for (const [file, bytes] of Object.entries(preserved)) {
		if (file !== "a.prax") expect(await readFile(join(root, file), "utf8")).toBe(bytes);
	}
});

it("two independent processes creating concurrently retain both writes", async () => {
	const { root, store } = concurrent;
	await Promise.all(
		concurrentWriters
			.filter((child) => child.exitCode === null && child.signalCode === null)
			.map(async (child) => {
				let stderr = "";
				child.stderr?.on("data", (chunk) => {
					stderr += chunk;
				});
				const saved = once(child, "message");
				const exited = once(child, "exit");
				child.send("write");
				expect((await saved)[0]).toBe("saved");
				expect(await exited, stderr).toEqual([0, null]);
			}),
	);
	const listed = (await store.list(reader)) as ReviewThreadList;
	expect(listed.changeSeq).toBe(2);
	expect(listed.threads.map((thread) => thread.messages[0].body).sort()).toEqual([
		"Process 0",
		"Process 1",
	]);
	await unchanged(root);
});

it("lost acknowledgement retries keep one message and one receipt", async () => {
	const { store, principal, payload, result, path } = await seeded();
	const before = await readFile(path, "utf8");
	const retry = success(await store.create(principal, payload));
	expect(retry.replayed).toBe(true);
	expect(retry.receipt).toEqual(result.receipt);
	expect(await readFile(path, "utf8")).toBe(before);
	expect(JSON.parse(before).receipts).toHaveLength(1);
	expect(((await store.list(reader)) as ReviewThreadList).threads[0].messages).toHaveLength(1);
});

it("scopes request receipts and lookups to each admitted review", async () => {
	const first = await seeded();
	const otherRoot = await fixture();
	const other = await openReviewStore(otherRoot);
	const principal = await other.principalFor("reviewer", "local-preview");
	const created = success(
		await other.create(principal, {
			...first.payload,
			reviewId: other.reviewId,
			body: "Other review",
		}),
	);
	const otherPath = join(otherRoot, ".praxity/reviews", other.reviewId, "comments.json");
	const before = await readFile(otherPath);
	expect(await other.create(principal, first.payload)).toMatchObject({
		ok: false,
		code: "wrong_review",
	});
	expect(created.replayed).toBe(false);
	expect(JSON.parse(before.toString()).receipts).toHaveLength(1);
	expect(JSON.parse(await readFile(first.path, "utf8")).receipts).toHaveLength(1);
	expect(((await first.store.list(reader)) as ReviewThreadList).threads[0].messages[0].body).toBe(
		"Original",
	);
	expect(((await other.list(reader)) as ReviewThreadList).threads[0].messages[0].body).toBe(
		"Other review",
	);
	expect(await readFile(otherPath)).toEqual(before);
});

it("delegates reply, resolve and reopen permissions, versions and replay to C1", async () => {
	const { root, store, principal, result } = await seeded();
	const author = await store.principalFor("author", "local-cli");
	const payload = {
		reviewId: store.reviewId,
		threadId: result.thread.id,
		expectVersion: 1,
		requestId: randomUUID(),
		body: "Fixed",
	};
	expect(await store.resolve(principal, payload)).toMatchObject({ ok: false, code: "forbidden" });
	expect(success(await store.resolve(author, payload)).thread).toMatchObject({
		status: "resolved",
		version: 2,
	});
	expect(
		success(
			await store.reply(principal, {
				...payload,
				expectVersion: 2,
				requestId: randomUUID(),
				body: "Still broken",
			}),
		).thread,
	).toMatchObject({ status: "open", version: 3 });
	expect(success(await store.resolve(author, payload))).toMatchObject({
		replayed: true,
		thread: { status: "open", version: 3 },
		receipt: { version: 2 },
	});
	expect(
		success(
			await store.reopen(principal, {
				reviewId: store.reviewId,
				threadId: result.thread.id,
				expectVersion: 3,
				requestId: randomUUID(),
			}),
		).thread.version,
	).toBe(4);
	await unchanged(root);
});

it.each([
	["corrupt-json", "{broken"],
	["invalid-state", '{"schema":0}'],
])("refuses %s on reads, reopen and mutations without replacing bytes", async (code, bytes) => {
	const { root, store, principal, payload, path } = await seeded();
	await writeFile(path, bytes);
	for (const work of [
		() => store.list(reader),
		() => openReviewStore(root),
		() => store.create(principal, { ...payload, requestId: randomUUID() }),
	])
		await expect(work()).rejects.toMatchObject({ name: "ReviewStoreError", code });
	expect(await readFile(path, "utf8")).toBe(bytes);
	await unchanged(root);
});

it.each(["marked", "legacy"])(
	"refuses missing initialized state (%s) on read, reopen, mutation and retry",
	async (format) => {
		const { root, store, principal, payload, path } = await seeded();
		const manifestPath = join(root, ".praxity/reviews/manifest.json");
		if (format === "legacy") {
			const legacy = JSON.parse(await readFile(manifestPath, "utf8"));
			delete legacy.initialized;
			await writeFile(manifestPath, JSON.stringify(legacy));
		}
		const manifest = await readFile(manifestPath);
		const acknowledged = await readFile(path);
		await rename(path, `${path}.saved`);
		const temp = join(dirname(path), `.comments.json.${randomUUID()}.tmp`);
		await writeFile(temp, acknowledged);
		for (const work of [
			() => store.list(reader),
			() => openReviewStore(root),
			() => store.create(principal, { ...payload, requestId: randomUUID() }),
			() => store.create(principal, payload),
		])
			await expect(work()).rejects.toMatchObject({ code: "invalid-state" });
		expect(await readFile(manifestPath)).toEqual(manifest);
		expect(await readFile(`${path}.saved`)).toEqual(acknowledged);
		expect(await readFile(temp)).toEqual(acknowledged);
		expect((await readdir(dirname(path))).sort()).toEqual(
			[basename(temp), "comments.json.saved"].sort(),
		);
		await unchanged(root);
	},
);

it.each([
	["corrupt-json", "{"],
	["newer-schema", '{"schema":99}'],
	[
		"invalid-state",
		'{"schema":1,"reviewId":"../../identity","reviewer":{"id":"x","displayName":"x"}}',
	],
])("refuses %s in the manifest without replacing any review bytes", async (code, bytes) => {
	const { root, store, path } = await seeded();
	const before = await readFile(path);
	const manifest = join(root, ".praxity/reviews/manifest.json");
	await writeFile(manifest, bytes);
	await expect(store.list(reader)).rejects.toMatchObject({ code });
	await expect(openReviewStore(root)).rejects.toMatchObject({ code });
	expect(await readFile(manifest, "utf8")).toBe(bytes);
	expect(await readFile(path)).toEqual(before);
	await unchanged(root);
});

it("refuses symlinked review storage and leaves its target untouched", async () => {
	const root = await fixture();
	const outside = await fixture();
	await symlink(outside, join(root, ".praxity/reviews"), "junction");
	await expect(openReviewStore(root)).rejects.toMatchObject({ code: "unsafe-path" });
	expect((await readdir(outside)).sort()).toEqual([
		".praxity",
		"a.prax",
		"course.yaml",
		"narration.yaml",
	]);
	await unchanged(root);
	await unchanged(outside);
});

it("refuses hardlinked state on reads and writes", async () => {
	const { root, store, principal, payload, path } = await seeded();
	const bytes = await readFile(path, "utf8");
	await link(path, join(root, "retained-comments.json"));
	await expect(store.list(reader)).rejects.toMatchObject({ code: "unsafe-path" });
	await expect(
		store.create(principal, { ...payload, requestId: randomUUID() }),
	).rejects.toMatchObject({ code: "unsafe-path" });
	expect(await readFile(path, "utf8")).toBe(bytes);
	await unchanged(root);
});

it.each([".praxity", ".praxity/reviews"])(
	"refuses a case alias at %s on every filesystem",
	async (relative) => {
		const { root, store } = await seeded();
		const path = join(root, relative);
		await rename(path, `${path}-move`);
		await rename(
			`${path}-move`,
			path.replace(/[^\\/]+$/, (part) => part.toUpperCase()),
		);
		await expect(store.list(reader)).rejects.toMatchObject({ code: "unsafe-path" });
		await expect(openReviewStore(root)).rejects.toMatchObject({ code: "unsafe-path" });
		await rename(
			path.replace(/[^\\/]+$/, (part) => part.toUpperCase()),
			`${path}-move`,
		);
		await rename(`${path}-move`, path);
		await unchanged(root);
	},
);

it.each([".", ".praxity", ".praxity/reviews", "review"])(
	"honors actual directory write permission at %s",
	async (relative) => {
		const { root, store, principal, payload, path } = await seeded();
		const before = await readFile(path, "utf8");
		const directory =
			relative === "review" ? join(root, ".praxity/reviews", store.reviewId) : join(root, relative);
		await chmod(directory, 0o555);
		try {
			if (relative === "." || process.platform === "win32" || process.getuid?.() === 0) {
				success(await store.create(principal, { ...payload, requestId: randomUUID() }));
				expect(((await store.list(reader)) as ReviewThreadList).threads).toHaveLength(2);
			} else {
				await expect(
					store.create(principal, { ...payload, requestId: randomUUID() }),
				).rejects.toMatchObject({ code: "read-only" });
				expect(await readFile(path, "utf8")).toBe(before);
			}
			await unchanged(root);
		} finally {
			await chmod(directory, 0o755);
		}
	},
);

it.each(["EIO", "ENOSPC"])(
	"reports %s from the durable writer and preserves original bytes",
	async (errno) => {
		const { root, store, principal, payload, path } = await seeded();
		const before = await readFile(path, "utf8");
		let injected = false;
		await expect(
			withProjectFileFlushes(
				{
					...defaultProjectFileFlushes,
					async syncFile(base, target) {
						if (!injected && target.startsWith(dirname(path)) && target.endsWith(".tmp")) {
							injected = true;
							throw Object.assign(new Error("Interrupted flush"), { code: errno });
						}
						await defaultProjectFileFlushes.syncFile(base, target);
					},
				},
				() => store.create(principal, { ...payload, requestId: randomUUID() }),
			),
		).rejects.toMatchObject({
			name: "ReviewStoreError",
			code: "disk-error",
			cause: { code: errno },
		});
		expect(injected).toBe(true);
		expect(await readFile(path, "utf8")).toBe(before);
		await unchanged(root);
	},
);

it("keeps review bytes ignored while identity stays visible and stages with git add -A", async () => {
	const root = await gitFixture();
	const rootIgnore = "# Root rules stay versioned\nexports/\n";
	await writeFile(join(root, ".gitignore"), rootIgnore);
	const excludePath = join(gitRoot, ".git/info/exclude");
	const exclude = await readFile(excludePath, "utf8");
	const store = await openReviewStore(root);
	success(
		await store.create(await store.principalFor("reviewer", "local-preview"), {
			reviewId: store.reviewId,
			requestId: randomUUID(),
			anchor,
			body: "Private",
		}),
	);
	const git = (...args: string[]) =>
		run("git", ["-C", root, ...args]).then((result) => result.stdout);
	const status = await git("status", "--porcelain", "--untracked-files=all");
	expect(status).not.toContain(".praxity/reviews/");
	expect(status).toContain(`?? ${basename(root)}/.praxity/identity/keep.json`);
	await git("add", "-A");
	expect(await git("ls-files")).toContain(".praxity/identity/keep.json");
	expect(await git("ls-files")).not.toContain(".praxity/reviews/");
	expect(await readFile(join(root, ".gitignore"), "utf8")).toBe(rootIgnore);
	// The durable writer owns its existing recovery exclusions.
	const addedExclusions = (await readFile(excludePath, "utf8")).slice(exclude.length);
	expect(addedExclusions).not.toMatch(/^\/?\.praxity(?:\/|$)/m);
	await unchanged(root);
});

it.each([
	["", "*\n"],
	["# keep\r\n", "# keep\r\n*\r\n"],
	["# keep\r\n!old", "# keep\r\n!old\r\n*\r\n"],
	["# keep\n*\n", "# keep\n*\n"],
])("creates an idempotent private ignore rule preserving %j", async (existing, expected) => {
	const root = await fixture();
	await mkdir(join(root, ".praxity/reviews"));
	const path = join(root, ".praxity/reviews/.gitignore");
	await writeFile(path, existing);
	const store = await openReviewStore(root);
	await openReviewStore(root);
	success(
		await store.create(await store.principalFor("reviewer", "local-preview"), {
			reviewId: store.reviewId,
			requestId: randomUUID(),
			anchor,
			body: "Private",
		}),
	);
	expect(await readFile(path, "utf8")).toBe(expected);
	await unchanged(root);
});

it("returns only visible outcomes, never state or hidden unrelated bodies", async () => {
	const { root, store, principal, result: hidden } = await seeded();
	const restricted = await openReviewStore(root, {
		visibleTo: (_principal, thread) => thread.id !== hidden.thread.id,
	});
	const payload = {
		reviewId: store.reviewId,
		requestId: randomUUID(),
		anchor,
		body: "Visible body",
	};
	const visible = success(await restricted.create(principal, payload));
	for (const result of [
		visible,
		await restricted.create(principal, payload),
		await restricted.reply(principal, {
			reviewId: store.reviewId,
			requestId: randomUUID(),
			threadId: visible.thread.id,
			expectVersion: 1,
			body: "Visible reply",
		}),
	]) {
		expect(result).not.toHaveProperty("state");
		expect(JSON.stringify(result)).not.toContain("Original");
	}
	const invisible = await openReviewStore(root, { visibleTo: () => false });
	const created = await invisible.create(principal, { ...payload, requestId: randomUUID() });
	expect(created).toMatchObject({ ok: true, thread: null, replayed: false });
	expect(created).not.toHaveProperty("state");
	const replay = await invisible.create(principal, payload);
	expect(replay).toMatchObject({ ok: true, thread: null, replayed: true });
	expect(JSON.stringify(replay)).not.toContain("Visible body");
});

it.each(["reply", "resolve", "reopen"] as const)(
	"refuses hidden %s targets, stale versions and receipt replays as not_found",
	async (kind) => {
		const { root, store, result, path } = await seeded();
		const author = await store.principalFor("author", "local-preview");
		const payload = {
			reviewId: store.reviewId,
			threadId: result.thread.id,
			expectVersion: 1,
			requestId: randomUUID(),
			...(kind === "reopen" ? {} : { body: "Private outcome" }),
		};
		success(await store[kind](author, payload));
		const restricted = await openReviewStore(root, { visibleTo: () => false });
		const before = await readFile(path);
		for (const input of [
			payload,
			{ ...payload, requestId: randomUUID() },
			{ ...payload, expectVersion: 2, requestId: randomUUID() },
		])
			expect(await restricted[kind](author, input)).toEqual({
				ok: false,
				code: "not_found",
				detail: {},
			});
		expect(await readFile(path)).toEqual(before);
	},
);

it("accepts host provenance independently of the granted role", async () => {
	const { store, principal } = await seeded();
	expect(await store.principalFor("author", "local-preview")).toEqual({
		...principal,
		role: "author",
	});
	expect(await store.principalFor("reviewer", "local-cli")).toEqual({
		...principal,
		provenance: "local-cli",
	});
});

it.each(["manifest", "state"])(
	"refuses a BOM in %s without rewriting its bytes",
	async (target) => {
		const { root, store, principal, payload, path } = await seeded();
		const file = target === "manifest" ? join(root, ".praxity/reviews/manifest.json") : path;
		const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await readFile(file)]);
		await writeFile(file, bytes);
		for (const work of [
			() => store.list(reader),
			() => openReviewStore(root),
			() => store.create(principal, payload),
		])
			await expect(work()).rejects.toMatchObject({ code: "corrupt-json" });
		expect(await readFile(file)).toEqual(bytes);
	},
);

it("refuses a newer manifest schema and preserves both files", async () => {
	const { root, store, path } = await seeded();
	const file = join(root, ".praxity/reviews/manifest.json");
	const bytes = JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), schema: 2 });
	const state = await readFile(path);
	await writeFile(file, bytes);
	await expect(openReviewStore(root)).rejects.toMatchObject({ code: "newer-schema" });
	await expect(store.list(reader)).rejects.toMatchObject({ code: "newer-schema" });
	expect(await readFile(file, "utf8")).toBe(bytes);
	expect(await readFile(path)).toEqual(state);
});

it("maps actual cross-process lock contention to busy", () => {
	expect(busyRefusal).toMatchObject({ name: "ReviewStoreError", code: "busy" });
});

it("maps a pending journal on a read to recovery-required and leaves it untouched", async () => {
	const { root, store } = await seeded();
	const journal = join(root, ".praxity-transaction.json");
	await writeFile(journal, "incomplete journal");
	await expect(store.list(reader)).rejects.toMatchObject({ code: "recovery-required" });
	await expect(openReviewStore(root)).rejects.toMatchObject({ code: "recovery-required" });
	expect(await readFile(journal, "utf8")).toBe("incomplete journal");
});

it("maps an unsupported-filesystem refusal from the write boundary", async () => {
	const { store, principal, payload } = await seeded();
	await expect(
		withProjectFileFlushes(
			{
				...defaultProjectFileFlushes,
				async syncFile() {
					throw new ProjectFilesystemUnsupportedError(new Error("Unsupported filesystem"));
				},
			},
			() => store.create(principal, { ...payload, requestId: randomUUID() }),
		),
	).rejects.toMatchObject({ code: "filesystem-unsupported" });
});

it.each(["EINVAL", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"])(
	"maps the flush errno %s to filesystem-unsupported",
	async (code) => {
		const { store, principal, payload } = await seeded();
		await expect(
			withProjectFileFlushes(
				{
					...defaultProjectFileFlushes,
					async syncFile() {
						throw Object.assign(new Error("Unsupported flush"), { code });
					},
				},
				() => store.create(principal, { ...payload, requestId: randomUUID() }),
			),
		).rejects.toMatchObject({ code: "filesystem-unsupported", cause: { code } });
	},
);

it.each(["EINVAL", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"])(
	"maps the directory flush errno %s to filesystem-unsupported",
	async (code) => {
		const { store, principal, payload } = await seeded();
		await expect(
			withProjectFileFlushes(
				{
					...defaultProjectFileFlushes,
					async syncDirectory() {
						throw Object.assign(new Error("Unsupported directory flush"), { code });
					},
				},
				() => store.create(principal, { ...payload, requestId: randomUUID() }),
			),
		).rejects.toMatchObject({ code: "filesystem-unsupported", cause: { code } });
	},
);

it.each(["EINVAL", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"])(
	"keeps non-flush rename errno %s as interrupted-write with original state",
	async (code) => {
		const { root, store, path } = await seeded();
		const before = await readFile(path);
		const child = fork(probeEntry, ["first-use", root, code], {
			execArgv: [
				"--require",
				fileURLToPath(new URL("./fixtures/review-store-rename-error.cjs", import.meta.url)),
			],
			silent: true,
		});
		children.push(child);
		expect((await once(child, "message"))[0]).toBe("ready");
		const replied = once(child, "message");
		const exited = once(child, "exit");
		child.send({ requestId: randomUUID(), anchor, body: "Refused rename" });
		expect((await replied)[0]).toMatchObject({ code: "interrupted-write", causeCode: code });
		expect(await exited).toEqual([1, null]);
		expect(await readFile(path)).toEqual(before);
		expect(await store.list(reader)).toMatchObject({ changeSeq: 1, threads: [expect.any(Object)] });
	},
);

it("returns the committed outcome when lock cleanup fails, with a replayable receipt", async () => {
	const { store, principal, payload } = await seeded();
	const close = DatabaseSync.prototype.close;
	vi.spyOn(DatabaseSync.prototype, "close").mockImplementationOnce(function (this: DatabaseSync) {
		close.call(this);
		throw new Error("Injected release cleanup failure");
	});
	const input = { ...payload, requestId: randomUUID() };
	const committed = success(await store.create(principal, input));
	expect(committed.cleanupError).toContain("Injected release cleanup failure");
	expect(committed.replayed).toBe(false);
	expect(success(await store.create(principal, input))).toMatchObject({
		replayed: true,
		receipt: committed.receipt,
	});
	expect(((await store.list(reader)) as ReviewThreadList).threads).toHaveLength(2);
});

async function persistentFault(
	phase: number,
	point: number,
	boundary = recordedBoundaries[phase * publicationSize + point],
) {
	expect(boundary, "clean open + create + replay recorded this boundary").toBeDefined();
	const root = await fixture();
	const requestId = randomUUID();
	const ids = new Set<string>();
	const input = (store: ReviewStore) => ({
		reviewId: store.reviewId,
		requestId,
		anchor,
		body: "Durable once",
	});
	if (phase >= 2) {
		const store = await openReviewStore(root);
		ids.add(store.reviewId);
		if (phase === 3) success(await store.create(reader, input(store)));
	}
	let fault = true;
	let calls = 0;
	let failures = 0;
	const activateAt = phase < 2 ? phase * publicationSize + point : point;
	function beforeFlush(entry: Boundary) {
		const active = calls++ >= activateAt;
		if (fault && active && entry.kind === boundary.kind && entry.path === boundary.path) {
			failures++;
			throw Object.assign(new Error("Persistent publication fault"), { code: "EIO" });
		}
	}
	await withProjectFileFlushes(
		{
			async syncFile(base, target) {
				beforeFlush({ kind: "file", path: normalizedPath(root, target) });
				await defaultProjectFileFlushes.syncFile(base, target);
			},
			async syncDirectory(target) {
				beforeFlush({ kind: "directory", path: normalizedPath(root, target) });
				await defaultProjectFileFlushes.syncDirectory(target);
			},
		},
		async () => {
			for (let attempt = 0; attempt < 3; attempt++) {
				await expect(
					(async () => {
						const store = await openReviewStore(root);
						ids.add(store.reviewId);
						return store.create(reader, input(store));
					})(),
				).rejects.toMatchObject({ code: "disk-error" });
				const names = await readdir(join(root, ".praxity/reviews")).catch(() => []);
				for (const name of names) if (/^[0-9a-f-]{36}$/u.test(name)) ids.add(name);
			}
			expect(failures).toBe(3);
			fault = false;
			const store = await openReviewStore(root);
			ids.add(store.reviewId);
			expect(ids.size).toBe(1);
			success(await store.create(reader, input(store)));
			const path = join(root, ".praxity/reviews", store.reviewId, "comments.json");
			const stored = JSON.parse(await readFile(path, "utf8"));
			expect(stored.changeSeq).toBe(1);
			expect(stored.threads).toHaveLength(1);
			expect(stored.threads[0].messages).toHaveLength(1);
			expect(stored.receipts).toHaveLength(1);
			expect(success(await store.create(reader, input(store))).replayed).toBe(true);
			expect(JSON.parse(await readFile(path, "utf8"))).toEqual(stored);
			expect((await readdir(join(root, ".praxity/reviews"))).sort()).toEqual(
				[".gitignore", "manifest.json", store.reviewId].sort(),
			);
		},
	);
}

it.each(
	["pending first use", "initialized first use", "mutation", "replay"].flatMap((phase, index) =>
		Array.from({ length: publicationSize }, (_, point) => ({ phase, index, point })),
	),
)(
	"persistent fault at $phase boundary $point refuses three times then recovers",
	async ({ index, point }) => {
		await persistentFault(index, point);
	},
);

it.runIf(process.platform === "win32")(
	"r4: installed ignore flush stays failed across first-use retries",
	() => persistentFault(0, 0, { kind: "file", path: ".praxity/reviews/.gitignore" }),
);
it.runIf(process.platform !== "win32")(
	"r4: the new reviews directory's .praxity parent flush retries with existing identity",
	() => persistentFault(0, 0, { kind: "directory", path: ".praxity" }),
);

it.each(["temporary", "published"])(
	"ignore %s failure never precedes private bytes",
	async (boundary) => {
		const root = await fixture();
		let ignoreStaged = false;
		const ledger = flushLedger(root, (entry) => {
			const temporary =
				entry.kind === "file" && entry.path === ".praxity/reviews/..gitignore.<uuid>.tmp";
			if (temporary) ignoreStaged = true;
			const published =
				ignoreStaged &&
				(process.platform === "win32"
					? entry.kind === "file" && entry.path === ".praxity/reviews/.gitignore"
					: entry.kind === "directory" && entry.path === ".praxity/reviews");
			if ((boundary === "temporary" && temporary) || (boundary === "published" && published))
				throw Object.assign(new Error("Ignore publication failed"), { code: "EIO" });
		});
		await withProjectFileFlushes(ledger.flushes, async () => {
			for (let attempt = 0; attempt < 3; attempt++) {
				ignoreStaged = false;
				await expect(openReviewStore(root)).rejects.toMatchObject({ code: "disk-error" });
				expect(
					(await readdir(join(root, ".praxity/reviews"))).filter((name) => name !== ".gitignore"),
				).toEqual([]);
			}
		});
	},
);

it("recovers a crash after mkdir before the first manifest without discarding orphan bytes", async () => {
	const root = await fixture();
	const reviewId = randomUUID();
	await mkdir(join(root, ".praxity/reviews", reviewId), { recursive: true });
	await writeFile(join(root, ".praxity/reviews/.gitignore"), "*\n");
	const store = await openReviewStore(root);
	expect(store.reviewId).toBe(reviewId);
	expect(await store.list(reader)).toMatchObject({ changeSeq: 0, threads: [] });
	const orphan = await fixture();
	await mkdir(join(orphan, ".praxity/reviews", reviewId), { recursive: true });
	await writeFile(
		join(orphan, ".praxity/reviews", reviewId, "comments.json"),
		"Possibly acknowledged",
	);
	await expect(openReviewStore(orphan)).rejects.toMatchObject({ code: "invalid-state" });
	expect(await readFile(join(orphan, ".praxity/reviews", reviewId, "comments.json"), "utf8")).toBe(
		"Possibly acknowledged",
	);
});

it("recovers an abandoned manifest temp without accepting orphan state", async () => {
	const root = await fixture();
	await mkdir(join(root, ".praxity/reviews"));
	await writeFile(join(root, ".praxity/reviews", `.manifest.json.${randomUUID()}.tmp`), "partial");
	const store = await openReviewStore(root);
	expect(await store.list(reader)).toMatchObject({ threads: [] });
	const orphan = await fixture();
	await mkdir(join(orphan, ".praxity/reviews/orphan"), { recursive: true });
	await writeFile(join(orphan, ".praxity/reviews/orphan/comments.json"), "{}");
	await expect(openReviewStore(orphan)).rejects.toMatchObject({ code: "invalid-state" });
});

it.each([".DS_Store", "Thumbs.db", "desktop.ini"])(
	"preserves regular-file OS metadata %s before the first manifest",
	async (name) => {
		const root = await fixture();
		const directory = join(root, ".praxity/reviews");
		await mkdir(directory);
		await writeFile(join(directory, name), "OS metadata bytes");
		const store = await openReviewStore(root);
		success(
			await store.create(reader, {
				reviewId: store.reviewId,
				requestId: randomUUID(),
				anchor,
				body: "Review",
			}),
		);
		expect(await readFile(join(directory, name), "utf8")).toBe("OS metadata bytes");
		expect((await openReviewStore(root)).reviewId).toBe(store.reviewId);
		expect(await store.list(reader)).toMatchObject({ changeSeq: 1, threads: [expect.any(Object)] });
	},
);

it.each([".DS_Store", "Thumbs.db", "desktop.ini"])(
	"refuses OS metadata name %s when it is a directory",
	async (name) => {
		const root = await fixture();
		const directory = join(root, ".praxity/reviews");
		await mkdir(join(directory, name), { recursive: true });
		await expect(openReviewStore(root)).rejects.toMatchObject({ code: "invalid-state" });
		expect(await readdir(directory)).toEqual([name]);
	},
);

it("refuses a hardlinked OS metadata file before the first manifest", async () => {
	const root = await fixture();
	const directory = join(root, ".praxity/reviews");
	await mkdir(directory);
	await link(join(root, ".praxity/identity/keep.json"), join(directory, ".DS_Store"));
	await expect(openReviewStore(root)).rejects.toMatchObject({ code: "unsafe-path" });
	expect(await readdir(directory)).toEqual([".DS_Store"]);
	await unchanged(root);
});

it("keeps all bodies and their base64 inside reviews before Git exists and out of a later index", async () => {
	const root = await fixture();
	const store = await openReviewStore(root);
	const principal = await store.principalFor("reviewer", "local-preview");
	const bodies = ["SECRET-ONE-c2", "SECRET-TWO-c2", "SECRET-REPLY-c2"];
	const first = success(
		await store.create(principal, {
			reviewId: store.reviewId,
			requestId: randomUUID(),
			anchor,
			body: bodies[0],
		}),
	);
	success(
		await store.create(principal, {
			reviewId: store.reviewId,
			requestId: randomUUID(),
			anchor,
			body: bodies[1],
		}),
	);
	success(
		await store.reply(principal, {
			reviewId: store.reviewId,
			requestId: randomUUID(),
			threadId: first.thread.id,
			expectVersion: 1,
			body: bodies[2],
		}),
	);
	const needles = bodies.flatMap((body) => [body, Buffer.from(body).toString("base64")]);
	async function checkTree(directory: string) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (path === join(root, ".praxity/reviews")) continue;
			if (entry.isDirectory()) await checkTree(path);
			else
				for (const needle of needles)
					expect((await readFile(path)).includes(Buffer.from(needle)), path).toBe(false);
		}
	}
	await checkTree(root);
	await run("git", ["init", "--quiet", root]);
	await run("git", ["-C", root, "add", "-A"]);
	// One Git process inventories both index names and staged content.
	const { stdout } = await run("git", ["-C", root, "diff", "--cached", "--no-ext-diff"]);
	for (const needle of needles) expect(stdout).not.toContain(needle);
	expect(stdout).not.toContain(".praxity/reviews/");
	expect(stdout).toContain(".praxity/identity/keep.json");
});

it("refuses a read-only state file without replacing its bytes", async () => {
	const { store, principal, payload, path } = await seeded();
	const before = await readFile(path);
	await chmod(path, 0o444);
	try {
		await expect(
			store.create(principal, { ...payload, requestId: randomUUID() }),
		).rejects.toMatchObject({ code: "read-only" });
		expect(await readFile(path)).toEqual(before);
	} finally {
		await chmod(path, 0o644);
	}
});

it("a cold read retries after another process creates the first lock", async () => {
	expect(await readdir(join(firstUseRoot, ".praxity"))).not.toContain("reviews");
	const [coldReader, firstWriter] = firstUseWriters;
	const stalled = once(coldReader, "message");
	coldReader.send({ anchor, requestId: randomUUID(), body: "First use 0" });
	expect((await stalled)[0]).toBe("cold-read-stalled");
	const writerSaved = once(firstWriter, "message");
	const writerExited = once(firstWriter, "exit");
	firstWriter.send({ anchor, requestId: randomUUID(), body: "First use 1" });
	const [written] = await writerSaved;
	expect(await writerExited, JSON.stringify(written)).toEqual([0, null]);
	expect(written).toMatchObject({ result: { ok: true } });
	const readerSaved = once(coldReader, "message");
	const readerExited = once(coldReader, "exit");
	coldReader.send("resume");
	const [retried] = await readerSaved;
	expect(await readerExited, JSON.stringify(retried)).toEqual([0, null]);
	expect(retried).toMatchObject({ reviewId: written.reviewId, result: { ok: true } });
	const reopened = await openReviewStore(firstUseRoot);
	expect(reopened.reviewId).toBe(written.reviewId);
	const listed = (await reopened.list(reader)) as ReviewThreadList;
	expect(listed.changeSeq).toBe(2);
	expect(listed.threads.map((thread) => thread.messages[0].body).sort()).toEqual([
		"First use 0",
		"First use 1",
	]);
	expect(
		(await readdir(join(firstUseRoot, ".praxity/reviews"))).filter(
			(name) => name !== ".gitignore" && name !== "manifest.json",
		),
	).toEqual([reopened.reviewId]);
});

it("a held lock refuses busy after one deadline without retrying the deadline", () => {
	expect(busyRefusal).toMatchObject({ name: "ReviewStoreError", code: "busy" });
	expect(busyOpenElapsed).toBeGreaterThanOrEqual(4900);
	expect(busyOpenElapsed).toBeLessThan(9000);
});

it.each(["list", "principal"])(
	"a cold %s read retries when the first lock appears",
	async (mode) => {
		const original = await seeded();
		const root = await fixture();
		await cp(join(original.root, ".praxity/reviews"), join(root, ".praxity/reviews"), {
			recursive: true,
		});
		const child = fork(probeEntry, [`cold-${mode}`, root], {
			execArgv: [
				"--require",
				fileURLToPath(new URL("./fixtures/review-store-cold-read.cjs", import.meta.url)),
			],
			silent: true,
		});
		children.push(child);
		expect((await once(child, "message"))[0]).toBe("ready");
		const stalled = once(child, "message");
		child.send("arm-cold-read");
		expect((await stalled)[0]).toBe("cold-read-stalled");
		const writer = await openReviewStore(root);
		success(
			await writer.create(reader, {
				reviewId: writer.reviewId,
				requestId: randomUUID(),
				anchor,
				body: "Concurrent",
			}),
		);
		const replied = once(child, "message");
		const exited = once(child, "exit");
		child.send("resume");
		const [result] = await replied;
		expect(await exited, JSON.stringify(result)).toEqual([0, null]);
		if (mode === "list") expect(result).toMatchObject({ changeSeq: 2, threads: expect.any(Array) });
		else expect(result).toEqual(original.principal);
	},
);

it.runIf(process.platform === "win32")(
	"retries a file held by another process, reports busy, then saves after release",
	async () => {
		const { store, principal, payload, path } = heldFile;
		const before = await readFile(path);
		const input = { ...payload, requestId: randomUUID() };
		try {
			await expect(store.create(principal, input)).rejects.toMatchObject({
				code: "busy",
				cause: { code: "EFILEBUSY" },
			});
			expect(await readFile(path)).toEqual(before);
			expect(await readdir(dirname(path))).toEqual(["comments.json"]);
		} finally {
			const exited = once(fileHolder, "exit");
			fileHolder.send("release");
			await exited;
		}
		success(await store.create(principal, input));
		expect(((await store.list(reader)) as ReviewThreadList).threads).toHaveLength(2);
	},
);

function expectPublication(entries: LedgerEntry[]) {
	const files = [".gitignore", "manifest.json", "<uuid>/comments.json"].map(
		(name) => ".praxity/reviews/" + name,
	);
	const expected: LedgerEntry[] = [];
	if (process.platform !== "win32")
		for (const path of [".", ".praxity", ".praxity/reviews"])
			expected.push({ kind: "directory", path });
	for (const [index, path] of files.entries()) {
		if (index === 1 && process.platform !== "win32")
			for (const path of [".praxity/reviews", ".praxity/reviews/<uuid>"])
				expected.push({ kind: "directory", path });
		const parent = path.slice(0, path.lastIndexOf("/"));
		const name = path.slice(path.lastIndexOf("/") + 1);
		expected.push({ kind: "file", path: parent + "/." + name + ".<uuid>.tmp" });
		expected.push({ kind: "rename", path });
		if (process.platform === "win32") expected.push({ kind: "file", path });
		expected.push({ kind: "directory", path: parent });
	}
	expect(entries).toEqual(expected);
}

it("the ledger proves fresh ordered publication for first use, mutations and replays", async () => {
	expect(recordedBoundaries).toHaveLength(publicationSize * 4);
	const root = await fixture();
	const ledger = flushLedger(root);
	await withProjectFileFlushes(ledger.flushes, async () => {
		const store = await openReviewStore(root);
		const firstUse = ledger.entries.splice(0);
		expect(firstUse.length % 2).toBe(0);
		expectPublication(firstUse.slice(0, firstUse.length / 2));
		expectPublication(firstUse.slice(firstUse.length / 2));
		const input = { reviewId: store.reviewId, requestId: randomUUID(), anchor, body: "First" };
		success(await store.create(reader, input));
		expectPublication(ledger.entries.splice(0));
		const later = { ...input, requestId: randomUUID(), body: "Later" };
		success(await store.create(reader, later));
		expectPublication(ledger.entries.splice(0));
		expect(success(await store.create(reader, later)).replayed).toBe(true);
		expectPublication(ledger.entries.splice(0));
	});
});

it("republishes a replay from fresh temps with identical bytes, sequence and receipts", async () => {
	const { root, store, principal, payload, path } = await seeded();
	const before = await readFile(path);
	const inode = (await stat(path)).ino;
	const ledger = flushLedger(root);
	const result = success(
		await withProjectFileFlushes(ledger.flushes, () => store.create(principal, payload)),
	);
	expect(result.replayed).toBe(true);
	expectPublication(ledger.entries);
	expect((await stat(path)).ino).not.toBe(inode);
	expect(await readFile(path)).toEqual(before);
	const state = JSON.parse(before.toString());
	expect(state.changeSeq).toBe(1);
	expect(state.receipts).toHaveLength(1);
	expect(state.threads).toHaveLength(1);
});

it.each([
	{ raw: null, code: "forbidden" },
	{ raw: { ...reader, role: "learner" }, code: "forbidden" },
	{ raw: { ...reader, displayName: "" }, code: "invalid_input" },
])("delegates principal refusals to C1 before calling policies: %j", async ({ raw, code }) => {
	const { root, store, result, path } = await seeded();
	const visibleTo = vi.fn((principal: ReviewPrincipal) => principal.role === "author");
	const restricted = await openReviewStore(root, { visibleTo });
	const before = await readFile(path);
	const versioned = {
		reviewId: store.reviewId,
		threadId: result.thread.id,
		expectVersion: 1,
		requestId: randomUUID(),
	};
	const inputs = [
		[
			restricted.create,
			{ reviewId: store.reviewId, requestId: randomUUID(), anchor, body: "Invalid actor" },
		],
		[restricted.reply, { ...versioned, body: "Invalid actor" }],
		[restricted.reopen, versioned],
	] as const;
	for (const [command, input] of inputs)
		expect(await command(raw as unknown as ReviewPrincipal, input)).toMatchObject({
			ok: false,
			code,
		});
	// All three inputs lack author permission; C1 checks that before other principal fields.
	expect(
		await restricted.resolve(raw as unknown as ReviewPrincipal, {
			...versioned,
			body: "Invalid actor",
		}),
	).toMatchObject({ ok: false, code: "forbidden" });
	expect(visibleTo).not.toHaveBeenCalled();
	expect(await readFile(path)).toEqual(before);
});

it("removes only own stale temp siblings under a write admission", async () => {
	const { root, store, principal, payload, path } = await seeded();
	const storage = join(root, ".praxity/reviews");
	const own = [
		join(storage, `.manifest.json.${randomUUID()}.tmp`),
		join(storage, `..gitignore.${randomUUID()}.tmp`),
		join(dirname(path), `.comments.json.${randomUUID()}.tmp`),
	];
	const retained = [
		join(storage, ".manifest.json.not-a-uuid.tmp"),
		join(dirname(path), ".comments.json.saved"),
		join(dirname(path), `.other.json.${randomUUID()}.tmp`),
	];
	for (const file of [...own, ...retained]) await writeFile(file, "crashed body");
	const before = await readFile(path);
	await openReviewStore(root);
	await store.list(reader);
	for (const file of own) expect(await readFile(file, "utf8")).toBe("crashed body");
	expect(await readFile(path)).toEqual(before);
	success(await store.create(principal, { ...payload, requestId: randomUUID() }));
	for (const file of own) await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
	for (const file of retained) expect(await readFile(file, "utf8")).toBe("crashed body");
});

it("preserves course recovery archives during store opens, lists and writes", async () => {
	const { root, store, principal, payload } = await seeded();
	await writeProjectFiles(root, [
		{ path: "a.prax", content: "Changed source", expectedContent: preserved["a.prax"] },
	]);
	const archives = (await readdir(root)).filter((name) => name.startsWith(".praxity-write-"));
	expect(archives.length).toBeGreaterThan(0);
	async function snapshot(directory: string): Promise<[string, string][]> {
		const files: [string, string][] = [];
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) files.push(...(await snapshot(path)));
			else files.push([path, (await readFile(path)).toString("base64")]);
		}
		return files;
	}
	const before = await Promise.all(archives.map((name) => snapshot(join(root, name))));
	await openReviewStore(root);
	await store.list(reader);
	success(await store.create(principal, { ...payload, requestId: randomUUID() }));
	expect(await Promise.all(archives.map((name) => snapshot(join(root, name))))).toEqual(before);
});

it("admits the local principal from only the manifest while state is present but corrupt", async () => {
	const { store, principal, path } = await seeded();
	await writeFile(path, "unparseable state bytes");
	expect(await store.principalFor("reviewer", "local-preview")).toEqual(principal);
	expect(await store.principalFor("author", "local-cli")).toEqual({
		...principal,
		role: "author",
		provenance: "local-cli",
	});
	await expect(store.list(reader)).rejects.toMatchObject({ code: "corrupt-json" });
	expect(await readFile(path, "utf8")).toBe("unparseable state bytes");
});
