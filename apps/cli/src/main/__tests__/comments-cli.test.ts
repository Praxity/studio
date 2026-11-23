import { type ChildProcess, execFile, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	readlink,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	create,
	type ReviewAnchor,
	type ReviewCommandResult,
	type ReviewState,
	type ReviewThread,
	type ReviewThreadList,
	reply,
	resolve,
} from "@praxity/review-share/review";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { runPraxityCli } from "../cli";
import { commentsRefusalCatalogue } from "../comments-cli";
import { openReviewStore, type ReviewStore, ReviewStoreError } from "../studio/review-store";

const roots: string[] = [];
const runtime = { appVersion: "test", exportAssetsDir: "unused" };
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
	context: { pageTitle: "First page", targetLabel: null },
};
type StoreResult = Awaited<ReturnType<ReviewStore["create"]>>;
function success(result: ReviewCommandResult): Extract<ReviewCommandResult, { ok: true }>;
function success(
	result: StoreResult,
): Extract<StoreResult, { ok: true }> & { thread: ReviewThread };
function success(result: ReviewCommandResult | StoreResult) {
	if (!result.ok) throw new Error(JSON.stringify(result));
	if (!result.thread) throw new Error("Expected visible thread");
	return result;
}
async function fixture(count = 1, cleanup = roots) {
	const root = await mkdtemp(join(tmpdir(), "comments-cli-"));
	cleanup.push(root);
	await writeFile(join(root, "course.yaml"), "title: Test\nlessons: [a.prax]\n");
	await writeFile(join(root, "a.prax"), "# First page\n\nText.\n");
	const store = await openReviewStore(root);
	const principal = await store.principalFor("reviewer", "local-preview");
	const path = join(root, ".praxity/reviews", store.reviewId, "comments.json");
	let state: ReviewState = JSON.parse(await readFile(path, "utf8"));
	for (let i = 0; i < count; i++) {
		state = success(
			await create(
				state,
				principal,
				{
					reviewId: store.reviewId,
					requestId: randomUUID(),
					anchor: { ...anchor, pageId: i % 2 ? "page-2" : "page-1" },
					body: `Comment ${i}`,
				},
				{ now: () => "2026-10-19T00:00:00.000Z", uuid: randomUUID },
			),
		).state;
	}
	await writeFile(path, JSON.stringify(state));
	const text = join(root, "message.txt");
	await writeFile(text, "Fixed the wording.\n");
	return { root, store, principal, path, state, thread: state.threads[0], text };
}
function cli(args: string[], openStore?: typeof openReviewStore) {
	return runPraxityCli(["comments", ...args], { ...runtime, openReviewStore: openStore });
}

it("loads and lists a stored local principal whose name contains NEL", async () => {
	const f = await fixture();
	const path = join(f.root, ".praxity/reviews/manifest.json");
	const manifest = JSON.parse(await readFile(path, "utf8"));
	manifest.localPrincipal.displayName = "Local\u0085 user";
	await writeFile(path, JSON.stringify(manifest));
	const reopened = await openReviewStore(f.root, undefined, { createIfMissing: false });
	expect((await reopened.principalFor("author", "local-cli")).displayName).toBe("Local\u0085 user");
	const result = await cli(["list", f.root, "--json"]);
	expect(result.exitCode).toBe(0);
	expect(JSON.parse(result.stdout).threads).toHaveLength(1);
	expect(JSON.parse(await readFile(path, "utf8")).localPrincipal.displayName).toBe(
		"Local\u0085 user",
	);
});

it("admits the stored NEL principal for a reply but rejects a different new control-bearing name", async () => {
	const f = await fixture();
	const path = join(f.root, ".praxity/reviews/manifest.json");
	const manifest = JSON.parse(await readFile(path, "utf8"));
	manifest.localPrincipal.displayName = "Local\u0085 user";
	await writeFile(path, JSON.stringify(manifest));
	const result = await cli(command(f, "reply", 1));
	expect(result.exitCode).toBe(0);
	expect(JSON.parse(result.stdout).thread.messages[1].actor.displayName).toBe("Local\u0085 user");
	const principal = await f.store.principalFor("author", "local-cli");
	expect(
		await f.store.reply(
			{ ...principal, displayName: "Different\u0085 name" },
			{
				reviewId: f.store.reviewId,
				threadId: f.thread.id,
				requestId: randomUUID(),
				expectVersion: 2,
				body: "New reply",
			},
		),
	).toMatchObject({ ok: false, code: "invalid_input", detail: { path: "$.displayName" } });
});

it("escapes legacy controls in JSON without changing stored text", async () => {
	const f = await fixture();
	const value =
		"old\n\t\r\n\u007f\u0080\u009f\u202a\u202e\u2066\u2069\u200b\u200f\u2060\ufeff literal\\n\\u009b";
	f.state.threads[0].messages[0].body = value;
	f.state.threads[0].anchor.context.targetLabel = value.replace(/\r/g, "");
	await writeFile(f.path, JSON.stringify(f.state));
	const before = await readFile(f.path);
	const output = await cli(["list", f.root, "--json"]);
	expect(output.exitCode).toBe(0);
	expect(output.stdout).toContain(
		"old\\u000A\\u0009\\u000D\\u000A\\u007F\\u0080\\u009F\\u202A\\u202E\\u2066\\u2069\\u200B\\u200F\\u2060\\uFEFF",
	);
	expect(JSON.parse(output.stdout).threads[0].messages[0].body).toBe(value);
	expect(await readFile(f.path)).toEqual(before);
});

it("escapes C0, C1, bidi and zero-width characters in text and JSON at the store boundary", async () => {
	const f = await fixture();
	const codes = [
		...Array.from({ length: 32 }, (_, n) => n),
		...Array.from({ length: 33 }, (_, n) => 0x7f + n),
		...Array.from({ length: 5 }, (_, n) => 0x200b + n),
		...Array.from({ length: 5 }, (_, n) => 0x202a + n),
		0x061c,
		0x2060,
		0x2066,
		0x2067,
		0x2068,
		0x2069,
		0xfeff,
	];
	const unsafe = codes.map((code) => String.fromCharCode(code)).join("");
	const adapter: typeof openReviewStore = async () => ({
		...f.store,
		list: async () => ({
			reviewId: f.store.reviewId,
			changeSeq: 1,
			threads: [{ ...f.thread, id: unsafe }],
			nextCursor: null,
		}),
	});
	const text = await cli(["list", f.root], adapter);
	const json = await cli(["list", f.root, "--json"], adapter);
	for (const code of codes) {
		const hex = code.toString(16).toUpperCase().padStart(4, "0");
		expect(text.stdout).toContain(`\\u{${hex}}`);
		expect(json.stdout.toUpperCase()).toContain(`\\U${hex}`);
	}
	expect(JSON.parse(json.stdout).threads[0].id).toBe(unsafe);
});

it("counts escaped JSON bytes against the complete-list limit", async () => {
	const f = await fixture();
	const thread = {
		...f.thread,
		messages: Array.from({ length: 750 }, () => ({
			...f.thread.messages[0],
			body: "\u0080".repeat(2000),
		})),
	};
	const result = await cli(["list", f.root, "--json"], async () => ({
		...f.store,
		list: async () => ({
			reviewId: f.store.reviewId,
			changeSeq: 1,
			threads: [thread],
			nextCursor: null,
		}),
	}));
	expect(result.exitCode).toBe(18);
	expect(JSON.parse(result.stdout)).toEqual({
		schema: 1,
		ok: false,
		code: "list-too-large",
		detail: { limit: 8388608, unit: "utf8-bytes" },
	});
});
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
async function list(root: string, ...args: string[]) {
	const result = await cli(["list", root, ...args, "--json"]);
	expect(result.exitCode, result.stdout).toBe(0);
	return JSON.parse(result.stdout) as ReviewThreadList & { schema: number; ok: boolean };
}
function command(
	f: Awaited<ReturnType<typeof fixture>>,
	kind: string,
	version: number,
	requestId = randomUUID(),
) {
	return [
		kind,
		f.root,
		f.thread.id,
		"--expect-version",
		String(version),
		"--request-id",
		requestId,
		...(kind === "reopen" ? [] : [kind === "resolve" ? "--reply-file" : "--text-file", f.text]),
		"--json",
	];
}
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const concurrentRoots: string[] = [];
let concurrent: Awaited<ReturnType<typeof fixture>>;
let child: ChildProcess;
beforeAll(async () => {
	concurrent = await fixture(1, concurrentRoots);
	child = fork(fileURLToPath(new URL("./fixtures/review-store-writer.ts", import.meta.url)), [], {
		execArgv: ["--import", "tsx"],
		silent: true,
	});
	await once(child, "message");
	const prepared = once(child, "message");
	child.send({
		root: concurrent.root,
		payload: {
			reviewId: concurrent.store.reviewId,
			requestId: randomUUID(),
			anchor,
			body: "Concurrent browser feedback",
		},
	});
	expect((await prepared)[0]).toBe("prepared");
});
afterAll(async () => {
	if (child && child.exitCode === null && child.signalCode === null) {
		const exited = once(child, "exit");
		child.kill();
		await exited;
	}
	await Promise.all(concurrentRoots.map((root) => rm(root, { recursive: true, force: true })));
});

it("lists several pages, messages and anchors twice without draining or writing", async () => {
	const f = await fixture(201);
	const author = { ...f.principal, role: "author" as const, provenance: "local-cli" as const };
	const deps = { now: () => "2026-10-19T00:00:00.000Z", uuid: randomUUID };
	f.state = success(
		await reply(
			f.state,
			author,
			{
				reviewId: f.store.reviewId,
				threadId: f.thread.id,
				expectVersion: 1,
				requestId: randomUUID(),
				body: "Clarification",
			},
			deps,
		),
	).state;
	f.state = success(
		await resolve(
			f.state,
			author,
			{
				reviewId: f.store.reviewId,
				threadId: f.thread.id,
				expectVersion: 2,
				requestId: randomUUID(),
				body: "Completed",
			},
			deps,
		),
	).state;
	await writeFile(f.path, JSON.stringify(f.state));
	await writeFile(join(dirname(f.path), `.comments.json.${randomUUID()}.tmp`), "partial write");
	const before = await tree(f.root);
	const output = await list(f.root);
	expect(output).toMatchObject({ schema: 1, ok: true, reviewId: f.store.reviewId, changeSeq: 203 });
	expect(output.threads.map((thread) => thread.id)).toEqual(
		f.state.threads.map((thread) => thread.id),
	);
	expect(output.threads[0]).toMatchObject({
		status: "resolved",
		version: 3,
		anchor,
		messages: [{ body: "Comment 0" }, { body: "Clarification" }, { body: "Completed" }],
	});
	expect(await list(f.root)).toEqual(output);
	expect(await tree(f.root)).toEqual(before);
});

it("filters by status and page ID", async () => {
	const f = await fixture(3);
	expect((await cli(command(f, "resolve", 1))).exitCode).toBe(0);
	expect((await list(f.root, "--status", "open")).threads.map((thread) => thread.id)).toEqual(
		f.state.threads.slice(1).map((thread) => thread.id),
	);
	expect(
		(await list(f.root, "--status", "resolved", "--page", "page-1")).threads.map(
			(thread) => thread.id,
		),
	).toEqual([f.thread.id]);
	expect((await list(f.root, "--page", "page-2")).threads.map((thread) => thread.id)).toEqual([
		f.state.threads[1].id,
	]);
});

it("replies as the local CLI author", async () => {
	const f = await fixture();
	const replied = await cli(command(f, "reply", 1));
	expect(replied.exitCode).toBe(0);
	expect(JSON.parse(replied.stdout)).toMatchObject({
		schema: 1,
		ok: true,
		replayed: false,
		thread: {
			version: 2,
			status: "open",
			messages: [
				{ body: "Comment 0" },
				{ body: "Fixed the wording.\n", provenance: "local-cli", actor: { role: "author" } },
			],
		},
	});
	expect(JSON.parse(replied.stdout)).not.toHaveProperty("state");
	expect(JSON.parse(replied.stdout)).not.toHaveProperty("changeSeq");
	expect(replied.stdout + replied.stderr).not.toContain(f.root);
	expect(replied.stdout + replied.stderr).not.toContain(f.text);
	expect(replied.stdout + replied.stderr).not.toMatch(/Bearer |sessionToken|capability|token=/iu);
});

it("resolves atomically and reopens; identical retry reports current facts and original receipt", async () => {
	const f = await fixture();
	const args = command(f, "resolve", 1);
	const resolved = JSON.parse((await cli(args)).stdout);
	expect(resolved).toMatchObject({
		ok: true,
		thread: {
			version: 2,
			status: "resolved",
			messages: [{ body: "Comment 0" }, { body: "Fixed the wording.\n" }],
		},
		receipt: { threadId: f.thread.id, version: 2 },
	});
	const reopened = JSON.parse((await cli(command(f, "reopen", 2))).stdout);
	expect(reopened).toMatchObject({
		ok: true,
		thread: { version: 3, status: "open", resolution: null },
		receipt: { version: 3, messageId: null },
	});
	const before = await readFile(f.path, "utf8");
	const retried = JSON.parse((await cli(args)).stdout);
	expect(retried).toMatchObject({
		ok: true,
		replayed: true,
		receipt: resolved.receipt,
		thread: { version: 3, status: "open" },
	});
	expect(retried.thread.messages).toHaveLength(2);
	expect(await readFile(f.path, "utf8")).toBe(before);
	const textRetry = await cli([...args.filter((arg) => arg !== "--json")]);
	expect(textRetry.stdout).toContain(`Thread ${f.thread.id}: open, version 3.`);
});

it("refuses a changed payload with the same request ID and a stale resolve without writing", async () => {
	const f = await fixture();
	const args = command(f, "reply", 1);
	expect((await cli(args)).exitCode).toBe(0);
	const before = await readFile(f.path, "utf8");
	expect(JSON.parse((await cli(args)).stdout)).toMatchObject({
		replayed: true,
		thread: { version: 2, messages: [{ body: "Comment 0" }, { body: "Fixed the wording.\n" }] },
	});
	await writeFile(f.text, "Changed reply");
	const reused = await cli(args);
	expect(reused.exitCode).toBe(6);
	expect(JSON.parse(reused.stdout)).toEqual({
		schema: 1,
		ok: false,
		code: "request_id_reused",
		detail: {},
	});
	const stale = await cli(command(f, "resolve", 1));
	expect(stale.exitCode).toBe(3);
	expect(JSON.parse(stale.stdout)).toEqual({
		schema: 1,
		ok: false,
		code: "stale_version",
		detail: { currentVersion: 2 },
	});
	expect(await readFile(f.path, "utf8")).toBe(before);
});

it.each([
	["missing", null, "text-file-missing", 11],
	["empty", "", "empty-text", 14],
	["whitespace", " \n\t\r", "whitespace-only", 15],
	["C1 control", "Reply\u009b31m", "invalid_input", 8],
	["bidi override", "Reply\u202e", "invalid_input", 8],
	["bidi isolate", "Reply\u2066", "invalid_input", 8],
	["limit+1", "x".repeat(2001), "text-too-large", 16],
	["bytes", "x".repeat(6001), "text-too-large", 16],
	["invalid UTF-8", Buffer.from([0xc0, 0x80]), "invalid-utf8", 13],
	["surrogate", Buffer.from([0xed, 0xa0, 0x80]), "lone-surrogate", 17],
] as const)(
	"refuses %s text without changing storage",
	async (_name, bytes, code, exitCode) => {
		const f = await fixture();
		const path = join(f.root, "input.txt");
		if (bytes !== null) await writeFile(path, bytes);
		const before = await readFile(f.path, "utf8");
		const result = await cli(command({ ...f, text: path }, "reply", 1));
		expect(result.exitCode).toBe(exitCode);
		expect(JSON.parse(result.stdout)).toMatchObject({ schema: 1, ok: false, code });
		expect(await readFile(f.path, "utf8")).toBe(before);
	},
	2_000,
);

it.each([
	["2000 ASCII characters", "x".repeat(2000)],
	["BOM and mixed line endings", "\uFEFFExact\r\n\n"],
	["1000 emoji", "😀".repeat(1000)],
	["2000 multibyte characters", "€".repeat(2000)],
])(
	"preserves valid file data, including boundary lengths: %s",
	async (_name, body) => {
		const f = await fixture();
		await writeFile(f.text, body);
		const result = await cli(command(f, "reply", 1));
		expect(result.exitCode, result.stdout).toBe(0);
		expect(JSON.parse(result.stdout).thread.messages[1].body).toBe(body);
	},
	2_000,
);

it("refuses directories as message files", async () => {
	const f = await fixture();
	const result = await cli(command({ ...f, text: f.root }, "reply", 1));
	expect(result.exitCode).toBe(12);
	expect(JSON.parse(result.stdout).code).toBe("text-file-unreadable");
});

it.skipIf(process.platform === "win32")(
	"refuses a FIFO without waiting for a writer",
	async () => {
		const f = await fixture();
		const path = join(f.root, "message.fifo");
		await promisify(execFile)("mkfifo", [path]);
		const before = await readFile(f.path);
		const result = await cli(command({ ...f, text: path }, "reply", 1));
		expect(result.exitCode).toBe(12);
		expect(JSON.parse(result.stdout)).toEqual({
			schema: 1,
			ok: false,
			code: "text-file-unreadable",
			detail: {},
		});
		expect(await readFile(f.path)).toEqual(before);
	},
	2_000,
);

it.each([
	["missing command"],
	["unknown command", "unknown", "."],
	["unknown list status", "list", ".", "--status", "pending"],
	["missing list status", "list", ".", "--status"],
	["repeated JSON flag", "list", ".", "--json", "--json"],
	["unsupported language", "list", ".", "--lang", "de"],
	["actor on list", "list", ".", "--actor", "author"],
	["inline reply text", "reply", ".", randomUUID(), "--text", "body"],
	["missing reopen request and version", "reopen", ".", randomUUID()],
	[
		"malformed reopen request ID",
		"reopen",
		".",
		randomUUID(),
		"--request-id",
		"bad",
		"--expect-version",
		"1",
	],
	...["0", "-1", "1.5", "1e3", "9007199254740992"].map((version) => [
		`invalid reopen version ${version}`,
		"reopen",
		".",
		randomUUID(),
		"--request-id",
		randomUUID(),
		"--expect-version",
		version,
	]),
])(
	"refuses invalid arguments: %s",
	async (_name, ...args) => {
		const result = await cli([...args, "--json"]);
		expect(result.exitCode).toBe(2);
		expect(JSON.parse(result.stdout)).toMatchObject({
			schema: 1,
			ok: false,
			code: "invalid-args",
		});
	},
	2_000,
);

it("does not initialize an absent review, even for mutations", async () => {
	const root = await mkdtemp(join(tmpdir(), "comments-cli-empty-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: Empty\n");
	await mkdir(join(root, "assets"));
	await writeFile(join(root, "assets", "keep.bin"), Buffer.from([0, 255, 1]));
	const before = await tree(root);
	const result = await cli(["list", root, "--json"]);
	expect(result.exitCode).toBe(0);
	expect(JSON.parse(result.stdout)).toEqual({
		schema: 1,
		ok: true,
		reviewId: null,
		changeSeq: 0,
		threads: [],
	});
	expect(await tree(root)).toEqual(before);
	const mutation = await cli([
		"reopen",
		root,
		randomUUID(),
		"--expect-version",
		"1",
		"--request-id",
		randomUUID(),
		"--json",
	]);
	expect(mutation.exitCode).toBe(27);
	expect(await tree(root)).toEqual(before);
});

it("refuses an unfinished review initialization without repairing or hiding its state", async () => {
	const f = await fixture();
	const path = join(f.root, ".praxity/reviews/manifest.json");
	const manifest = JSON.parse(await readFile(path, "utf8"));
	await writeFile(path, JSON.stringify({ ...manifest, initialized: false }));
	const before = await tree(f.root);
	const result = await cli(["list", f.root, "--json"]);
	expect(result.exitCode).toBe(29);
	expect(JSON.parse(result.stdout)).toEqual({
		schema: 1,
		ok: false,
		code: "recovery-required",
		detail: { reason: "unfinished-init" },
	});
	for (const [language, advice] of [
		["en", "Open the course in Studio with review enabled to finish setup, then retry.\n"],
		[
			"fr",
			"Ouvrez le cours dans Studio avec la révision activée pour terminer la configuration, puis réessayez.\n",
		],
	]) {
		expect(await cli(["list", f.root, "--lang", language])).toEqual({
			exitCode: 29,
			stdout: "",
			stderr: advice,
		});
	}
	expect(await tree(f.root)).toEqual(before);
});

it("refuses a symlinked course manifest without writing", async () => {
	const f = await fixture();
	const target = join(f.root, "manifest-target.yaml");
	await writeFile(target, await readFile(join(f.root, "course.yaml")));
	await rm(join(f.root, "course.yaml"));
	await symlink(target, join(f.root, "course.yaml"), "file");
	const before = await tree(f.root);
	for (const args of [["list", f.root, "--json"], command(f, "reopen", 1)]) {
		const result = await cli(args);
		expect(result.exitCode).toBe(35);
		expect(JSON.parse(result.stdout)).toEqual({
			schema: 1,
			ok: false,
			code: "course-manifest-not-file",
			detail: {},
		});
	}
	expect(await tree(f.root)).toEqual(before);
});

it.each([
	["en", "Threads: 1.\n"],
	["fr", "Fils : 1.\n"],
])(
	"formats a single thread count in %s",
	async (language, firstLine) => {
		const f = await fixture();
		const result = await cli(["list", f.root, "--lang", language]);
		expect(result.exitCode).toBe(0);
		expect(`${result.stdout.split("\n")[0]}\n`).toBe(firstLine);
	},
	2_000,
);

it.each([
	["--status", "pending", false],
	["--lang", "de", false],
	["--text-file", null, false],
	["--expect-version", "0", false],
	["--request-id", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", true],
	["<threadId>", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", true],
] as const)(
	"text refusal names %s with relevant advice",
	async (flag, value, uuid) => {
		const f = await fixture();
		for (const language of flag === "--lang" ? ["en"] : ["en", "fr"]) {
			const args =
				flag === "--status"
					? ["list", f.root]
					: command(f, "reply", 1).filter((arg) => arg !== "--json");
			if (flag === "<threadId>") args[2] = value;
			else {
				const index = args.indexOf(flag);
				if (index < 0) args.push(flag, value ?? "");
				else if (value === null) args.splice(index, 2);
				else args[index + 1] = value;
			}
			if (flag !== "--lang") args.push("--lang", language);
			const result = await cli(args);
			expect(result.exitCode).toBe(2);
			expect(result.stdout).toBe("");
			expect(result.stderr).toContain(flag);
			expect(
				result.stderr.includes(
					language === "en" ? "UUIDs must be lowercase" : "Les UUID doivent être en minuscules",
				),
			).toBe(uuid);
		}
	},
	2_000,
);

it.each([
	["assets", "course-manifest-missing", 34],
	["typo", "course-not-found", 32],
	["course.yaml", "course-not-directory", 33],
	["bad-manifest", "course-manifest-not-file", 35],
] as const)(
	"admits the populated course but refuses %s without reading an empty queue",
	async (argument, code, exitCode) => {
		const f = await fixture();
		const path = join(f.root, argument);
		if (argument === "assets") {
			await mkdir(path);
			await writeFile(join(path, "image.svg"), "<svg/>");
		} else if (argument === "bad-manifest")
			await mkdir(join(path, "course.yaml"), { recursive: true });
		const before = await tree(f.root);
		expect((await list(f.root)).threads.map((thread) => thread.id)).toEqual([f.thread.id]);
		for (const args of [["list", path, "--json"], command({ ...f, root: path }, "reopen", 1)]) {
			const result = await cli(args);
			expect(result.exitCode).toBe(exitCode);
			expect(JSON.parse(result.stdout)).toEqual({ schema: 1, ok: false, code, detail: {} });
		}
		expect(await tree(f.root)).toEqual(before);
	},
	2_000,
);

it.each(["dot", "relative", "symlink"] as const)(
	"admits a %s course path",
	async (kind) => {
		const f = await fixture();
		const previous = process.cwd();
		let path: string;
		if (kind === "symlink") {
			const parent = await mkdtemp(join(tmpdir(), "comments-cli-alias-"));
			roots.push(parent);
			path = join(parent, "course");
			await symlink(f.root, path, process.platform === "win32" ? "junction" : "dir");
		} else {
			process.chdir(kind === "dot" ? f.root : dirname(f.root));
			path = kind === "dot" ? "." : basename(f.root);
		}
		try {
			expect((await list(path)).threads.map((thread) => thread.id)).toEqual([f.thread.id]);
		} finally {
			process.chdir(previous);
		}
	},
	2_000,
);

it.each([
	["en", "The course directory must contain a regular course.yaml file.\n"],
	["fr", "Le dossier du cours doit contenir un fichier course.yaml ordinaire.\n"],
])(
	"localizes a non-course refusal in %s",
	async (language, stderr) => {
		const f = await fixture();
		await mkdir(join(f.root, "assets"));
		expect(await cli(["list", join(f.root, "assets"), "--lang", language])).toEqual({
			exitCode: 34,
			stdout: "",
			stderr,
		});
	},
	2_000,
);

it.each([
	["--request-id", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"],
	["--expect-version", "0"],
	["--lang", "de"],
])(
	"names the failing %s flag",
	async (flag, value) => {
		const f = await fixture();
		const args = command(f, "reopen", 1);
		const index = args.indexOf(flag);
		if (index < 0) args.push(flag, value);
		else args[index + 1] = value;
		const result = await cli(args);
		expect(result.exitCode).toBe(2);
		expect(JSON.parse(result.stdout)).toEqual({
			schema: 1,
			ok: false,
			code: "invalid-args",
			detail: { flag },
		});
	},
	2_000,
);

it("explains lowercase request UUIDs", async () => {
	const f = await fixture();
	const result = await cli(
		command(f, "reopen", 1, "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA").filter(
			(arg) => arg !== "--json",
		),
	);
	expect(result.exitCode).toBe(2);
	expect(result.stderr).toContain("UUIDs must be lowercase");
});

it("restarts collection after a real store write between pages, retaining every thread once", async () => {
	const f = await fixture(201);
	let inserted: string | undefined;
	const result = await cli(["list", f.root, "--json"], async (...args) => {
		const store = await openReviewStore(...args);
		return {
			...store,
			async list(principal, options) {
				const page = await store.list(principal, options);
				if (!inserted && !("ok" in page) && page.nextCursor) {
					inserted = success(
						await f.store.create(f.principal, {
							reviewId: f.store.reviewId,
							requestId: randomUUID(),
							anchor,
							body: "New browser feedback",
						}),
					).thread.id;
				}
				return page;
			},
		};
	});
	expect(result.exitCode, result.stdout).toBe(0);
	const output = JSON.parse(result.stdout);
	expect(output.changeSeq).toBe(202);
	expect(output.threads.map((thread: { id: string }) => thread.id)).toEqual([
		...f.state.threads.map((thread) => thread.id),
		inserted,
	]);
});

it("bounds repeated snapshot drift with an explicit refusal", async () => {
	const f = await fixture(2);
	const result = await cli(["list", f.root, "--json"], async () => {
		const store = f.store;
		return {
			...store,
			async list(principal, options) {
				const page = await store.list(principal, { ...options, limit: 1 });
				if (!("ok" in page) && !options?.cursor)
					success(
						await f.store.create(f.principal, {
							reviewId: f.store.reviewId,
							requestId: randomUUID(),
							anchor,
							body: "Changed again",
						}),
					);
				return page;
			},
		};
	});
	expect(result.exitCode).toBe(9);
	expect(JSON.parse(result.stdout)).toEqual({
		schema: 1,
		ok: false,
		code: "snapshot_changed",
		detail: { attempts: 3 },
	});
});

it.each([false, true])(
	"restarts its own cursor after visibility drift, repeated=%s",
	async (repeated) => {
		const f = await fixture(3);
		let visible = true;
		let changed = false;
		const result = await cli(["list", f.root, "--json"], async (root, _policy, options) => {
			const store = await openReviewStore(
				root,
				{ visibleTo: (_principal, thread) => visible || thread.id !== f.thread.id },
				options,
			);
			return {
				...store,
				async list(principal, options) {
					const page = await store.list(principal, { ...options, limit: 1 });
					if (!("ok" in page) && !options?.cursor && (repeated || !changed)) {
						visible = !visible;
						changed = true;
					}
					return page;
				},
			};
		});
		if (repeated) {
			expect(result.exitCode).toBe(9);
			expect(JSON.parse(result.stdout)).toEqual({
				schema: 1,
				ok: false,
				code: "snapshot_changed",
				detail: { attempts: 3 },
			});
		} else {
			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout).changeSeq).toBe(3);
			expect(JSON.parse(result.stdout).threads.map((thread: { id: string }) => thread.id)).toEqual(
				f.state.threads.slice(1).map((thread) => thread.id),
			);
		}
	},
	2_000,
);

it("applies store visibility before paging and counts", async () => {
	const f = await fixture(102);
	const result = await cli(["list", f.root, "--json"], (root, _policy, options) =>
		openReviewStore(
			root,
			{
				visibleTo: (principal, thread) => principal.role === "author" && thread.id !== f.thread.id,
			},
			options,
		),
	);
	expect(result.exitCode).toBe(0);
	const output = JSON.parse(result.stdout);
	expect(output.threads.map((thread: { id: string }) => thread.id)).toEqual(
		f.state.threads.slice(1).map((thread) => thread.id),
	);
	const text = await cli(["list", f.root], (root, _policy, options) =>
		openReviewStore(
			root,
			{ visibleTo: (_principal, thread) => thread.id !== f.thread.id },
			options,
		),
	);
	expect(text.stdout).toContain("Threads: 101.\n");
	expect(text.stdout).not.toContain(f.thread.id);
});

it("preserves a child process comment while the CLI replies", async () => {
	const saved = once(child, "message");
	child.send("start");
	const result = await cli(command(concurrent, "reply", 1));
	expect((await saved)[0]).toBe("saved");
	expect(result.exitCode).toBe(0);
	const output = await list(concurrent.root);
	expect(output.changeSeq).toBe(3);
	expect(output.threads.map((thread) => thread.messages.map((message) => message.body))).toEqual([
		["Comment 0", "Fixed the wording.\n"],
		["Concurrent browser feedback"],
	]);
});

it("refuses a hidden mutation target without disclosing its thread", async () => {
	const f = await fixture();
	const before = await readFile(f.path, "utf8");
	const result = await cli(command(f, "reply", 1), (root, _policy, options) =>
		openReviewStore(root, { visibleTo: () => false }, options),
	);
	expect(result.exitCode).toBe(4);
	expect(JSON.parse(result.stdout)).toEqual({
		schema: 1,
		ok: false,
		code: "not_found",
		detail: {},
	});
	expect(await readFile(f.path, "utf8")).toBe(before);
});

it.each([true, false])(
	"acknowledges a mutation whose resulting thread is hidden, json=%s",
	async (json) => {
		const f = await fixture();
		const args = command(f, "resolve", 1).filter((arg) => json || arg !== "--json");
		const result = await cli(args, (root, _policy, options) =>
			openReviewStore(
				root,
				{ visibleTo: (_principal, thread) => thread.status === "open" },
				options,
			),
		);
		expect(result.exitCode).toBe(0);
		if (json)
			expect(JSON.parse(result.stdout)).toMatchObject({
				schema: 1,
				ok: true,
				reviewId: f.store.reviewId,
				thread: null,
				replayed: false,
				receipt: { threadId: f.thread.id, version: 2 },
			});
		else
			expect(result.stdout).toBe(
				"The operation was acknowledged. This thread is no longer visible.\n",
			);
		expect(result.stdout).not.toContain("Comment 0");
		expect(result.stderr).toBe("");
	},
	2_000,
);

it("reports acknowledged cleanup warnings without returning their private errors", async () => {
	const f = await fixture();
	const result = await cli(command(f, "reply", 1), async (...args) => {
		const store = await openReviewStore(...args);
		return {
			...store,
			async reply(principal, payload) {
				const result = await store.reply(principal, payload);
				return result.ok ? { ...result, cleanupError: join(f.root, "private", "secret") } : result;
			},
		};
	});
	expect(result.exitCode).toBe(0);
	expect(JSON.parse(result.stdout)).toMatchObject({
		ok: true,
		cleanupPending: true,
		thread: { version: 2 },
	});
	expect(result.stdout).not.toContain("secret");
	expect(result.stderr).toBe("");
});

it("refuses oversized complete lists without returning partial threads", async () => {
	const f = await fixture();
	const thread = f.state.threads[0];
	thread.messages = Array.from({ length: 2100 }, () => ({
		...thread.messages[0],
		id: randomUUID(),
		body: "é".repeat(2000),
	}));
	thread.version = 2100;
	f.state.changeSeq = 2100;
	f.state.receipts = [];
	await writeFile(f.path, JSON.stringify(f.state));
	const result = await cli(["list", f.root, "--json"]);
	expect(result.exitCode).toBe(18);
	expect(JSON.parse(result.stdout)).toEqual({
		schema: 1,
		ok: false,
		code: "list-too-large",
		detail: { limit: 8388608, unit: "utf8-bytes" },
	});
	const text = await cli(["list", f.root]);
	expect(text.stderr).toBe(
		"The complete list exceeds the 8388608 UTF-8 byte limit. A single thread may exceed this limit.\n",
	);
	const french = await cli(["list", f.root, "--lang", "fr"]);
	expect(french.stderr).toBe(
		"La liste complète dépasse la limite de 8388608 octets UTF-8. Un seul fil peut dépasser cette limite.\n",
	);
});

it("refuses corrupt storage without leaking a machine path or token", async () => {
	const f = await fixture();
	await writeFile(f.path, "{broken");
	const result = await cli(["list", f.root, "--json"]);
	expect(result.exitCode).toBe(19);
	expect(JSON.parse(result.stdout)).toEqual({
		schema: 1,
		ok: false,
		code: "corrupt-json",
		detail: {},
	});
	expect(result.stdout + result.stderr).not.toMatch(/[A-Z]:\\|Bearer |session|capability|token=/iu);
	expect(await readFile(f.path, "utf8")).toBe("{broken");
});

it.each([
	["invalid-state", 20],
	["newer-schema", 21],
	["unsafe-path", 22],
	["read-only", 23],
	["disk-error", 24],
	["interrupted-write", 25],
	["tracked-storage", 26],
	["busy", 28],
	["recovery-required", 29],
	["git-unavailable", 30],
	["filesystem-unsupported", 31],
] as const)(
	"maps store %s and discards unsafe error metadata",
	async (code, exitCode) => {
		const f = await fixture();
		const result = await cli(["list", f.root, "--json"], async () => {
			throw new ReviewStoreError(
				code,
				join(f.root, "private", "Bearer secret"),
				new Error("capability=secret"),
			);
		});
		expect(result.exitCode).toBe(exitCode);
		expect(JSON.parse(result.stdout)).toEqual({ schema: 1, ok: false, code, detail: {} });
	},
	2_000,
);

it("localizes an early refusal and exposes all codes in help", async () => {
	expect(await cli(["bad", "."])).toEqual({
		exitCode: 2,
		stdout: "",
		stderr: "Invalid comments arguments. Use praxity comments --help.\n",
	});
	expect(await cli(["bad", ".", "--lang", "fr"])).toEqual({
		exitCode: 2,
		stdout: "",
		stderr: "Arguments de commentaires invalides. Utilisez praxity comments --help.\n",
	});
	const help = await cli(["--help", "--lang", "fr"]);
	expect(help.exitCode).toBe(0);
	expect(help.stdout).toContain("Codes de sortie des commentaires :");
	expect(help.stdout).toContain("0=ok");
	for (const [code, entry] of Object.entries(commentsRefusalCatalogue)) {
		expect(help.stdout).toContain(`${entry.exitCode}=${code}`);
		expect(entry.en).toBeTruthy();
		expect(entry.fr).toBeTruthy();
	}
});

it("maps a store limit refusal to exit 36 without changing storage, in EN/FR and JSON", async () => {
	const f = await fixture();
	const atLimit: typeof openReviewStore = async (...args) => ({
		...(await openReviewStore(...args)),
		async reply() {
			return { ok: false, code: "limit_reached", detail: { path: "$.bytes" } };
		},
	});
	const before = await readFile(f.path);
	const args = command(f, "reply", 1);
	const json = await cli(args, atLimit);
	expect(json.exitCode).toBe(36);
	expect(JSON.parse(json.stdout)).toEqual({
		schema: 1,
		ok: false,
		code: "limit_reached",
		detail: { path: "$.bytes" },
	});
	for (const [locale, message] of [
		["en", "The review has reached a storage or activity limit. No changes were saved."],
		[
			"fr",
			"La révision a atteint une limite de stockage ou d'activité. Aucune modification n'a été enregistrée.",
		],
	]) {
		const result = await cli(
			[...args.filter((arg) => arg !== "--json"), "--lang", locale],
			atLimit,
		);
		expect(result.exitCode).toBe(36);
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe(`${message}\n`);
		expect((await cli(["--help", "--lang", locale])).stdout).toContain("36=limit_reached");
	}
	expect(await readFile(f.path)).toEqual(before);
});

it("refuses unexpected failures without exposing raw error text", async () => {
	const f = await fixture();
	const result = await cli(["list", f.root, "--json"], async () => {
		throw new Error(`${join(f.root, "private", "course")} Bearer secret capability=secret`);
	});
	expect(result).toEqual({
		exitCode: 1,
		stdout: `${JSON.stringify({ schema: 1, ok: false, code: "failed", detail: {} })}\n`,
		stderr: "",
	});
});
