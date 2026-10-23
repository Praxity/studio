import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	chmod,
	copyFile,
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { afterAll, beforeAll, expect, it } from "vitest";
import { directorySnapshot } from "../../test-utils/directory-snapshot";
import { defaultProjectFileFlushes, withProjectFileFlushes } from "../project-file-transactions";
import { openReviewStore, type ReviewStore, tracksReviewStorage } from "../studio/review-store";

const permissionRefusal = {
	code: "EPERMISSIONMODEL",
	message:
		"ProjectPermissionError: Studio can't save while Node's permission model is on, because it blocks the file sync that keeps saves safe. Run without --permission.",
};
const run = promisify(execFile);
const cleanEnv = Object.fromEntries(
	Object.entries(process.env).filter(
		([name]) => !/^GIT_/i.test(name) && !/^NoDefaultCurrentDirectoryInExePath$/i.test(name),
	),
);
let scratch: string;
let repository: string;
let cleanRepository: string;
let program: string;
let isolatedHome: string;
let tracked: string;
let statePath: string;
let original: Buffer;
let alternate: string;
let caseVariant: string;
let firstUse: string;
let untracked: string;
let outside: string;
let outsideWithoutGit: string;
let heldStore: ReviewStore;
let linked: string;
let brokenLinked: string;
let brokenState: string;
let nested: string;
let nestedState: string;
let nestedLiteral: string;
let stubBin: string;
let marker: string;
let submodule: string;
let emptyPath: string;
let hookCourse: string;
let hookMarker: string;
let promisorCourse: string;
let promisorMarker: string;
let renamed: string;
let unicodeRenamed: string;
let sibling: string;
let redirectedWorktree: string;
let redirectedAbsolute: string;
let redirectedRelative: string;
let grandchild: string;
let largeCourse: string;
let indexBlob: string;
const innerLayouts = [
	"reviews",
	"praxity",
	"review",
	"other-review",
	"submodule",
	"worktree",
] as const;
const innerRepositories = new Map<string, { root: string; state: string }>();
const protectedInnerLayouts = innerLayouts.filter((layout) => layout !== "other-review");
let bareStorage: { root: string; state: string };
let brokenInner: { root: string; state: string };
let ceilingCourse: string;
let bareAncestor: string;
let linkedGitdir: string;
let bareConfigured: string;
const git = (root: string, ...args: string[]) =>
	run("git", ["-c", "maintenance.auto=false", "-c", "gc.auto=0", "-C", root, ...args], {
		env: cleanEnv,
	});

async function seedIndex(root: string, entries: string) {
	const pending = run(
		"git",
		["-c", "maintenance.auto=false", "-c", "gc.auto=0", "-C", root, "update-index", "--index-info"],
		{ env: cleanEnv },
	);
	if (!pending.child.stdin) throw new Error("Git index builder requires stdin");
	pending.child.stdin.end(entries);
	await pending;
}

async function enclosingIndex(name: string, diskName: string, trackedName: string) {
	const outer = join(scratch, name);
	await mkdir(outer);
	await git(outer, "init", "--quiet");
	const course = join(outer, diskName);
	await mkdir(course, { recursive: true });
	const store = await openReviewStore(course);
	const state = join(course, ".praxity/reviews", store.reviewId, "comments.json");
	const blob = (await git(outer, "hash-object", "-w", state)).stdout.trim();
	await git(
		outer,
		"update-index",
		"--add",
		"--cacheinfo",
		`100644,${blob},${trackedName}/.praxity/reviews/${store.reviewId}/comments.json`,
	);
	return course;
}

async function redirectedIndex(name: string, relative: boolean) {
	const course = join(scratch, name);
	await mkdir(course);
	const store = await openReviewStore(course);
	await git(course, "init", "--quiet");
	await git(course, "config", "core.worktree", relative ? "../.praxity" : join(course, ".praxity"));
	await git(join(course, ".praxity"), "add", "-f", `reviews/${store.reviewId}/comments.json`);
	return course;
}

async function innerIndex(layout: (typeof innerLayouts)[number]) {
	const root = join(scratch, `inner-${layout}`);
	await mkdir(root);
	const store = await openReviewStore(root);
	const praxity = join(root, ".praxity");
	const state = join(praxity, "reviews", store.reviewId, "comments.json");
	if (layout === "submodule" || layout === "worktree") {
		const source = join(scratch, `source-${layout}`);
		await cp(praxity, source, { recursive: true });
		await git(source, "init", "--quiet");
		await git(source, "add", "-f", ".");
		await git(
			source,
			"-c",
			"user.name=Review Test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"--quiet",
			"-m",
			"Inner repository fixture",
		);
		await rm(praxity, { recursive: true });
		if (layout === "submodule") {
			await git(root, "init", "--quiet");
			await git(
				root,
				"-c",
				"protocol.file.allow=always",
				"submodule",
				"add",
				"--quiet",
				source,
				".praxity",
			);
		} else {
			await git(source, "worktree", "add", "--detach", praxity);
		}
	} else {
		const repository =
			layout === "praxity"
				? praxity
				: layout === "reviews"
					? join(praxity, "reviews")
					: join(praxity, "reviews", layout === "review" ? store.reviewId : "other-review");
		await mkdir(repository, { recursive: true });
		await git(repository, "init", "--quiet");
		if (layout !== "other-review") await git(repository, "add", "-f", state);
	}
	return { root, state };
}

async function inconclusiveInner(layout: "bare" | "broken") {
	const root = join(scratch, `inner-inconclusive-${layout}`);
	await mkdir(root);
	const store = await openReviewStore(root);
	const reviews = join(root, ".praxity/reviews");
	const state = join(reviews, store.reviewId, "comments.json");
	if (layout === "bare") {
		await git(reviews, "init", "--bare", "--quiet");
		await git(reviews, "config", "core.bare", "false");
		await git(reviews, "config", "core.worktree", reviews);
		await git(reviews, "add", "-f", state);
	} else {
		await writeFile(
			join(root, ".praxity/.git"),
			`gitdir: ${join(scratch, "missing-inner-gitdir")}\n`,
		);
	}
	return { root, state };
}

async function probe(
	root: string,
	options: {
		permission?: "child" | "no-child" | "all-read";
		env?: NodeJS.ProcessEnv;
		timeout?: number;
	} = {},
) {
	const before = options.permission ? await directorySnapshot(root) : undefined;
	const grants = options.permission
		? [
				"--permission",
				...(options.permission === "child" ? ["--allow-child-process"] : []),
				`--allow-fs-read=${options.permission === "all-read" ? "*" : root}`,
				`--allow-fs-read=${program}`,
				`--allow-fs-read=${isolatedHome}`,
				`--allow-fs-write=${root}`,
				`--allow-fs-write=${isolatedHome}`,
			]
		: [];
	const result = await run(
		process.execPath,
		[...grants, program, root, String(options.timeout ?? "")],
		{
			cwd: root,
			env: { ...cleanEnv, HOME: isolatedHome, USERPROFILE: isolatedHome, ...options.env },
			timeout: 1800,
		},
	);
	if (before) expect(await directorySnapshot(root)).toEqual(before);
	return JSON.parse(result.stdout);
}

beforeAll(async () => {
	scratch = await mkdtemp(join(tmpdir(), "review-git-admission-"));
	repository = join(scratch, "repository");
	isolatedHome = join(scratch, "home");
	program = join(scratch, "probe.mjs");
	await mkdir(isolatedHome);
	await mkdir(repository);
	await git(repository, "init", "--quiet");
	cleanRepository = join(scratch, "clean-repository");
	await mkdir(cleanRepository);
	await git(cleanRepository, "init", "--quiet");
	alternate = join(scratch, "alternate");
	await mkdir(alternate);
	await git(alternate, "init", "--quiet");
	// Give the alternate repository a readable empty index.
	await git(alternate, "read-tree", "--empty");
	await git(
		alternate,
		"-c",
		"user.name=Review Test",
		"-c",
		"user.email=test@example.com",
		"commit",
		"--allow-empty",
		"-m",
		"Git admission test fixture",
	);
	linked = join(scratch, "linked");
	await git(alternate, "worktree", "add", "--detach", linked);
	await openReviewStore(linked);
	await build({
		entryPoints: [fileURLToPath(new URL("./fixtures/review-store-git.ts", import.meta.url))],
		outfile: program,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		banner: {
			js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
		},
	});
	tracked = join(repository, "tracked");
	await mkdir(tracked);
	const store = await openReviewStore(tracked);
	heldStore = store;
	statePath = join(tracked, ".praxity/reviews", store.reviewId, "comments.json");
	original = await readFile(statePath);
	firstUse = join(repository, "first-use");
	await mkdir(join(firstUse, ".praxity/reviews/id"), { recursive: true });
	await writeFile(join(firstUse, ".praxity/reviews/id/comments.json"), "private bytes");
	caseVariant = join(scratch, "case-variant");
	await mkdir(caseVariant);
	await git(caseVariant, "init", "--quiet");
	await openReviewStore(caseVariant);
	const { stdout } = await git(caseVariant, "hash-object", "-w", statePath);
	await git(
		caseVariant,
		"update-index",
		"--add",
		"--cacheinfo",
		`100644,${stdout.trim()},.Praxity/Reviews/id/comments.json`,
	);
	untracked = join(cleanRepository, "untracked");
	outside = join(scratch, "outside");
	outsideWithoutGit = join(scratch, "outside-without-git");
	await mkdir(untracked);
	await openReviewStore(untracked);
	await mkdir(outside);
	await mkdir(outsideWithoutGit);
	emptyPath = join(scratch, "empty-path");
	await mkdir(emptyPath);
	hookCourse = join(scratch, "fsmonitor-course");
	hookMarker = join(scratch, "fsmonitor-ran");
	await mkdir(hookCourse);
	await git(hookCourse, "init", "--quiet");
	await writeFile(join(hookCourse, "source.prax"), "# Page\n");
	await git(hookCourse, "add", "source.prax");
	await writeFile(join(hookCourse, "hook.sh"), "#!/bin/sh\nprintf ran > ../fsmonitor-ran\n", {
		mode: 0o755,
	});
	await git(hookCourse, "config", "core.fsmonitor", "./hook.sh");
	promisorCourse = join(scratch, "promisor-course");
	promisorMarker = join(scratch, "promisor-ran");
	await mkdir(join(promisorCourse, ".praxity/reviews/id"), { recursive: true });
	await git(promisorCourse, "init", "--quiet");
	await writeFile(join(promisorCourse, ".praxity/reviews/id/comments.json"), "private bytes");
	await git(promisorCourse, "add", "-f", ".praxity/reviews/id/comments.json");
	await git(
		promisorCourse,
		"-c",
		"user.name=Review Test",
		"-c",
		"user.email=test@example.com",
		"commit",
		"--quiet",
		"-m",
		"Sparse index test fixture",
	);
	const tree = (await git(promisorCourse, "rev-parse", "HEAD:.praxity")).stdout.trim();
	await git(promisorCourse, "sparse-checkout", "init", "--cone", "--sparse-index");
	await git(promisorCourse, "sparse-checkout", "set", "visible");
	await writeFile(
		join(promisorCourse, "fetch-hook.sh"),
		"#!/bin/sh\nprintf ran > ../promisor-ran\nexit 1\n",
		{ mode: 0o755 },
	);
	await git(promisorCourse, "config", "remote.origin.url", ".");
	await git(promisorCourse, "config", "remote.origin.promisor", "true");
	await git(promisorCourse, "config", "remote.origin.uploadpack", "./fetch-hook.sh");
	await git(promisorCourse, "config", "protocol.file.allow", "always");
	const treePath = join(promisorCourse, ".git/objects", tree.slice(0, 2), tree.slice(2));
	await chmod(treePath, 0o600);
	await unlink(treePath);
	brokenLinked = join(scratch, "broken-linked");
	await git(alternate, "worktree", "add", "--detach", brokenLinked);
	const brokenStore = await openReviewStore(brokenLinked);
	brokenState = join(brokenLinked, ".praxity/reviews", brokenStore.reviewId, "comments.json");
	await git(brokenLinked, "add", "-f", brokenState);
	await rename(join(brokenLinked, ".git"), join(brokenLinked, ".git.saved"));
	await writeFile(join(brokenLinked, ".git"), `gitdir: ${join(scratch, "missing-gitdir")}\n`);
	nested = join(repository, "inner");
	await mkdir(nested);
	const nestedStore = await openReviewStore(nested);
	nestedState = join(nested, ".praxity/reviews", nestedStore.reviewId, "comments.json");
	nestedLiteral = join(repository, "inner[1]");
	await mkdir(nestedLiteral);
	const literalStore = await openReviewStore(nestedLiteral);
	await git(
		cleanRepository,
		"-c",
		"protocol.file.allow=always",
		"submodule",
		"add",
		"--quiet",
		alternate,
		"submodule",
	);
	submodule = join(cleanRepository, "submodule");
	await openReviewStore(submodule);
	await git(tracked, "add", "-f", statePath);
	await git(firstUse, "add", "-f", ".praxity/reviews/id/comments.json");
	await git(nested, "add", "-f", nestedState);
	await git(nested, "init", "--quiet");
	await git(nestedLiteral, "add", "-f", `.praxity/reviews/${literalStore.reviewId}/comments.json`);
	await git(nestedLiteral, "init", "--quiet");
	renamed = await enclosingIndex("case-renamed", "course", "Course");
	unicodeRenamed = await enclosingIndex("unicode-renamed", "\u00e9cole", "\u00c9cole");
	sibling = await enclosingIndex("sibling", "mine", "other");
	redirectedWorktree = await enclosingIndex("redirected-worktree", "course", "course");
	await git(redirectedWorktree, "init", "--quiet");
	await git(redirectedWorktree, "config", "core.worktree", parse(redirectedWorktree).root);
	redirectedAbsolute = await redirectedIndex("redirected-absolute", false);
	redirectedRelative = await redirectedIndex("redirected-relative", true);
	grandchild = await enclosingIndex("grandparent", "between/course", "between/course");
	largeCourse = join(scratch, "large-index");
	await mkdir(largeCourse);
	await git(largeCourse, "init", "--quiet");
	await openReviewStore(largeCourse);
	indexBlob = (await git(largeCourse, "hash-object", "-w", statePath)).stdout.trim();
	await seedIndex(
		largeCourse,
		Array.from(
			{ length: 30000 },
			(_, index) =>
				`100644 ${indexBlob}\tordinary/${String(index).padStart(5, "0")}/${"a".repeat(60)}/file.json\n`,
		).join(""),
	);
	for (const layout of innerLayouts) innerRepositories.set(layout, await innerIndex(layout));
	const siblingFixture = innerRepositories.get("other-review");
	if (!siblingFixture) throw new Error("Sibling review fixture is missing");
	await Promise.all(
		Array.from({ length: 200 }, (_, index) =>
			mkdir(
				join(
					siblingFixture.root,
					".praxity/reviews",
					`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
				),
			),
		),
	);
	bareStorage = await inconclusiveInner("bare");
	brokenInner = await inconclusiveInner("broken");
	const separatedParent = join(
		scratch,
		process.platform === "win32" ? "courses; 2026" : "courses: 2026",
	);
	const separatedRepository = join(separatedParent, "repository");
	ceilingCourse = join(separatedRepository, "course");
	await mkdir(ceilingCourse, { recursive: true });
	await git(separatedRepository, "init", "--quiet");
	const bareRoot = join(scratch, "bare-shaped-ancestor");
	bareAncestor = join(bareRoot, "course");
	await mkdir(bareAncestor, { recursive: true });
	const bareStore = await openReviewStore(bareAncestor);
	await git(bareRoot, "init", "--bare", "--quiet");
	await git(bareRoot, "config", "core.bare", "false");
	await git(bareRoot, "config", "core.worktree", bareRoot);
	await git(
		bareRoot,
		"add",
		"-f",
		join(bareAncestor, ".praxity/reviews", bareStore.reviewId, "comments.json"),
	);
	linkedGitdir = join(scratch, "linked-gitdir-shape");
	await mkdir(linkedGitdir);
	await openReviewStore(linkedGitdir);
	await writeFile(join(linkedGitdir, "HEAD"), "ref: refs/heads/main\n");
	await writeFile(join(linkedGitdir, "commondir"), "../missing-common-dir\n");
	bareConfigured = join(scratch, "bare-configured");
	await mkdir(bareConfigured);
	await git(bareConfigured, "init", "--quiet");
	await openReviewStore(bareConfigured);
	await git(bareConfigured, "config", "core.bare", "true");
	stubBin = join(scratch, "stub-bin");
	await mkdir(stubBin);
	marker = join(scratch, "planted-git-ran");
	if (process.platform === "win32") {
		const source = join(scratch, "git.cs");
		await writeFile(
			source,
			`using System;
class P {
  static int Main(string[] args) {
    if (Environment.GetEnvironmentVariable("REVIEW_GIT_SLEEP") != null) System.Threading.Thread.Sleep(5000);
    var marker = Environment.GetEnvironmentVariable("REVIEW_GIT_MARKER");
    if (marker != null) System.IO.File.WriteAllText(marker, "ran");
    if (Array.IndexOf(args, "version") >= 0) {
      Console.WriteLine(Environment.GetEnvironmentVariable("REVIEW_GIT_VERSION") ?? "git version 2.39.5");
      return 0;
    }
    if (Environment.GetEnvironmentVariable("REVIEW_GIT_REQUIRE_ACROSS") != null) {
      Console.Error.WriteLine(Environment.GetEnvironmentVariable("GIT_DISCOVERY_ACROSS_FILESYSTEM") == "1"
        ? "fatal: not a git repository (or any of the parent directories): .git"
        : "fatal: not a git repository (or any parent up to mount point /mount)");
      return 128;
    }
    Console.Error.Write(Environment.GetEnvironmentVariable("REVIEW_GIT_STDERR"));
    return int.Parse(Environment.GetEnvironmentVariable("REVIEW_GIT_EXIT") ?? "0");
  }
}`,
		);
		const systemRoot = process.env.SystemRoot;
		if (!systemRoot) throw new Error("SystemRoot is required to compile the Windows Git test stub");
		await run(join(systemRoot, "Microsoft.NET/Framework64/v4.0.30319/csc.exe"), [
			"/nologo",
			`/out:${join(stubBin, "git.exe")}`,
			source,
		]);
	} else {
		await writeFile(
			join(stubBin, "git"),
			`#!/bin/sh
if [ -n "$REVIEW_GIT_SLEEP" ]; then exec /bin/sleep 5; fi
for arg in "$@"; do
  if [ "$arg" = version ]; then printf '%s\\n' "\${REVIEW_GIT_VERSION:-git version 2.39.5}"; exit 0; fi
done
if [ -n "$REVIEW_GIT_REQUIRE_ACROSS" ]; then
  if [ "$GIT_DISCOVERY_ACROSS_FILESYSTEM" = 1 ]; then
    printf '%s\\n' 'fatal: not a git repository (or any of the parent directories): .git' >&2
  else
    printf '%s\\n' 'fatal: not a git repository (or any parent up to mount point /mount)' >&2
  fi
  exit 128
fi
printf '%s' "$REVIEW_GIT_STDERR" >&2
exit "\${REVIEW_GIT_EXIT:-0}"
`,
			{ mode: 0o755 },
		);
	}
}, 30000);

afterAll(async () => {
	if (scratch) await rm(scratch, { recursive: true });
});

it.each([undefined, "child"] as const)(
	"refuses tracked storage with %s permission and leaves bytes unchanged",
	async (permission) => {
		const refusal = await probe(tracked, { permission });
		expect(refusal).toMatchObject(permission ? permissionRefusal : { code: "tracked-storage" });
		expect(refusal.message).toBe(
			permission
				? permissionRefusal.message
				: "ReviewStoreError: A Git repository containing this course or its review folders tracks files in a .praxity/reviews folder (any course, any case). Untrack them in that repository, for example git rm -r --cached on those paths.",
		);
		expect(refusal.message).not.toContain(tracked);
		expect(await readFile(statePath)).toEqual(original);
	},
	2000,
);

it("checks enclosing indexes with literal course names containing Git glob characters", async () => {
	expect(await probe(nestedLiteral)).toMatchObject({ code: "tracked-storage" });
});

it.each([
	".PRAXITY/Reviews/x",
	".praxity./reviews /x",
	".praxity::$INDEX_ALLOCATION/reviews/x",
	"PRAXIT~1/REVIEW~1/x",
	"PR348E~1/reviews/x",
	"PRAXI~10/reviews/x",
	".praxity/RE1A2B~1/x",
	"build/chunk~1/reviews/x",
	".praxity/chunk~1/x",
	"PRAX\u0131T~1/REVIEW~1/x",
	"PRAXIT~1/REV\u0131EW~1/x",
	".prax\u200bity/reviews/x",
	".praxity/review\u017f/x",
	".praxity/\uff52\uff45\uff56\uff49\uff45\uff57\uff53/x",
	".praxity/./reviews/x",
	".praxity/a/../reviews/x",
	"a\\.praxity\\reviews\\x",
	".praxity/REVIEW~1/x",
	"PRAXIT~1/reviews/x",
])("recognizes tracked storage alias %s", (entry) => {
	expect(tracksReviewStorage(entry)).toBe(true);
});

it.each([
	".praxity/identity/k.json",
	".praxity/course.json",
	"reviews/x",
	"docs/praxity/reviews/x",
	"PRAXIT~1/x",
	"reviews/.praxity/x",
])("does not classify ordinary index entry %s as review storage", (entry) => {
	expect(tracksReviewStorage(entry)).toBe(false);
});

it.each([
	["case-renamed course", () => renamed],
	["Unicode case-renamed course", () => unicodeRenamed],
	["sibling course (accepted over-refusal)", () => sibling],
	["grandparent repository across a non-repository directory", () => grandchild],
] as const)(
	"refuses reviews tracked in a %s",
	async (_name, course) => {
		expect(await probe(course())).toMatchObject({ code: "tracked-storage" });
	},
	2000,
);

it("allows an ordinary 30k-entry index larger than 1 MiB", async () => {
	expect(await probe(largeCourse)).toEqual({ ok: true });
});

it.each(protectedInnerLayouts)(
	"refuses Git inside review storage at %s, preserving comment bytes",
	async (layout) => {
		const fixture = innerRepositories.get(layout);
		if (!fixture) throw new Error("Inner repository fixture is missing");
		const before = await readFile(fixture.state);
		const refusal = await probe(fixture.root);
		expect(refusal).toMatchObject({ code: "tracked-storage", reason: "repository-in-storage" });
		expect(refusal.message).toContain(
			"Move or remove the repository, submodule or worktree in .praxity or its review folders",
		);
		expect(refusal.message).not.toContain("git rm");
		expect(refusal.message).not.toContain(fixture.root);
		expect(await readFile(fixture.state)).toEqual(before);
	},
	2000,
);

it.each(
	protectedInnerLayouts.flatMap((layout) =>
		["no-child", "git-missing"].map((reason) => ({ layout, reason })),
	),
)(
	"refuses Git inside review storage at $layout with $reason, preserving comment bytes",
	async ({ layout, reason }) => {
		const fixture = innerRepositories.get(layout);
		if (!fixture) throw new Error("Inner repository fixture is missing");
		const before = await readFile(fixture.state);
		expect(
			await probe(
				fixture.root,
				reason === "no-child" ? { permission: "all-read" } : { env: { PATH: emptyPath } },
			),
		).toMatchObject(
			reason === "no-child" ? permissionRefusal : { code: "git-unavailable", reason },
		);
		expect(await readFile(fixture.state)).toEqual(before);
	},
	2000,
);

it.each(["git", "no-child", "git-missing"])(
	"checks only the active review with 200 sibling folders and %s",
	async (mode) => {
		const fixture = innerRepositories.get("other-review");
		if (!fixture) throw new Error("Sibling review fixture is missing");
		expect(
			await probe(
				fixture.root,
				mode === "git"
					? {}
					: mode === "no-child"
						? { permission: "all-read" }
						: { env: { PATH: emptyPath } },
			),
		).toEqual(mode === "no-child" ? permissionRefusal : { ok: true });
	},
	2000,
);

it.each(["git", "no-child", "git-missing"])(
	"refuses bare-shaped review storage with %s and preserves comments",
	async (mode) => {
		const before = await readFile(bareStorage.state);
		const refusal = await probe(
			bareStorage.root,
			mode === "git"
				? {}
				: mode === "no-child"
					? { permission: "all-read" }
					: { env: { PATH: emptyPath } },
		);
		expect(refusal).toMatchObject(
			mode === "git"
				? { code: "tracked-storage", reason: "repository-in-storage" }
				: mode === "no-child"
					? permissionRefusal
					: { code: "git-unavailable", reason: mode },
		);
		expect(await readFile(bareStorage.state)).toEqual(before);
	},
	2000,
);

it("refuses broken gitdir metadata inside storage, preserving comments", async () => {
	const before = await readFile(brokenInner.state);
	expect(await probe(brokenInner.root)).toMatchObject({
		code: "tracked-storage",
		reason: "repository-in-storage",
	});
	expect(await readFile(brokenInner.state)).toEqual(before);
});

it.each([
	["absolute private folder (R3)", () => redirectedAbsolute],
	["relative private folder (N5)", () => redirectedRelative],
] as const)(
	"refuses core.worktree redirected to %s",
	async (_name, course) => {
		const root = course();
		const manifest = JSON.parse(
			await readFile(join(root, ".praxity/reviews/manifest.json"), "utf8"),
		);
		const state = join(root, ".praxity/reviews", manifest.reviewId, "comments.json");
		const before = await readFile(state);
		expect(await probe(root)).toMatchObject({ code: "git-unavailable", reason: "git-error" });
		expect(await readFile(state)).toEqual(before);
	},
	2000,
);

it("finds tracked review storage after 30k ordinary index entries", async () => {
	await seedIndex(largeCourse, `100644 ${indexBlob}\tx/.praxity/reviews/y\n`);
	try {
		expect(await probe(largeCourse)).toMatchObject({ code: "tracked-storage" });
	} finally {
		await git(largeCourse, "update-index", "--force-remove", "x/.praxity/reviews/y");
	}
});

it("allows a course below a repository with a ceiling-list separator in its parent path", async () => {
	expect(await probe(ceilingCourse)).toEqual({ ok: true });
});

it("still refuses t12's tracked outer reviews when core.worktree redirects upward", async () => {
	expect(await probe(redirectedWorktree)).toMatchObject({ code: "tracked-storage" });
});

it("refuses core.bare=true without tracked reviews", async () => {
	expect(await probe(bareConfigured)).toMatchObject({
		code: "git-unavailable",
		reason: "git-error",
	});
});

it.each(
	["bare", "commondir"].flatMap((shape) =>
		["no-child", "git-missing"].map((reason) => ({ shape, reason })),
	),
)(
	"refuses a $shape git-directory ancestor with $reason and preserves comments",
	async ({ shape, reason }) => {
		const root = shape === "bare" ? bareAncestor : linkedGitdir;
		const manifest = JSON.parse(
			await readFile(join(root, ".praxity/reviews/manifest.json"), "utf8"),
		);
		const state = join(root, ".praxity/reviews", manifest.reviewId, "comments.json");
		const before = await readFile(state);
		expect(
			await probe(
				root,
				reason === "no-child" ? { permission: "all-read" } : { env: { PATH: emptyPath } },
			),
		).toMatchObject(
			reason === "no-child" ? permissionRefusal : { code: "git-unavailable", reason },
		);
		expect(await readFile(state)).toEqual(before);
	},
	2000,
);

it("refuses tracked storage before initialization", async () => {
	expect(await probe(firstUse)).toMatchObject({ code: "tracked-storage" });
	expect(await readFile(join(firstUse, ".praxity/reviews/id/comments.json"), "utf8")).toBe(
		"private bytes",
	);
});

it.each(["no-child", "all-read"] as const)(
	"refuses an uninspectable repository with %s permission",
	async (permission) => {
		const refusal = await probe(tracked, { permission });
		expect(refusal).toEqual(permissionRefusal);
		expect(refusal.message).not.toContain(tracked);
		expect(await readFile(statePath)).toEqual(original);
	},
	2000,
);

it.each(["create", "reply", "resolve", "reopen"] as const)(
	"rechecks Git before %s on an already open store",
	async (command) => {
		const principal = await heldStore.principalFor("author", "local-cli");
		await expect(heldStore[command](principal, {})).rejects.toMatchObject({
			code: "tracked-storage",
		});
		expect(await readFile(statePath)).toEqual(original);
	},
	2000,
);

it("refuses tracked storage before the durable set can start publication", async () => {
	await withProjectFileFlushes(
		{
			...defaultProjectFileFlushes,
			syncFile: async () => {
				throw Object.assign(new Error("Publication must not start"), { code: "EIO" });
			},
			syncDirectory: async () => {
				throw Object.assign(new Error("Publication must not start"), { code: "EIO" });
			},
		},
		async () => {
			const principal = await heldStore.principalFor("author", "local-cli");
			await expect(
				heldStore.create(principal, {
					reviewId: heldStore.reviewId,
					requestId: randomUUID(),
					body: "Private feedback",
					anchor: {
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
					},
				}),
			).rejects.toMatchObject({ code: "tracked-storage" });
		},
	);
	expect(await readFile(statePath)).toEqual(original);
});

it("opens tracked storage existing-only without Git admission or changing leftovers", async () => {
	const leftover = join(tracked, `.praxity/reviews/.manifest.json.${randomUUID()}.tmp`);
	await writeFile(leftover, "leftover bytes");
	try {
		const store = await openReviewStore(tracked, undefined, {
			createIfMissing: false,
			gitTimeoutMs: 0,
		});
		const principal = await store.principalFor("reviewer", "local-cli");
		expect(await store.list(principal)).toMatchObject({ reviewId: heldStore.reviewId });
		expect(await readFile(statePath)).toEqual(original);
		expect(await readFile(leftover, "utf8")).toBe("leftover bytes");
	} finally {
		await unlink(leftover);
	}
});

it("refuses an unreadable ancestor even for a non-Git course", async () => {
	expect(await probe(outside, { permission: "no-child" })).toEqual(permissionRefusal);
});

it("allows a linked worktree with Git available", async () => {
	expect(await probe(linked)).toEqual({ ok: true });
});

it("refuses a linked worktree gitdir file without child permission", async () => {
	expect(await probe(linked, { permission: "all-read" })).toEqual(permissionRefusal);
});

it.each([false, true])(
	"allows a non-Git course with Git missing: %s",
	async (missing) => {
		expect(
			await probe(missing ? outsideWithoutGit : outside, {
				env: missing ? { PATH: emptyPath } : {},
			}),
		).toEqual({ ok: true });
	},
	2000,
);

it("refuses review writes to a fully readable non-Git course without changing any file", async () => {
	expect(await probe(outside, { permission: "all-read" })).toEqual(permissionRefusal);
});

it("refuses a repository when Git is missing", async () => {
	const refusal = await probe(tracked, { env: { PATH: emptyPath } });
	expect(refusal).toMatchObject({ code: "git-unavailable", reason: "git-missing" });
	expect(refusal.message).toContain("Install Git");
	expect(await readFile(statePath)).toEqual(original);
});

it("ignores inherited Git directory, worktree, index and discovery overrides", async () => {
	expect(
		await probe(tracked, {
			env: {
				GIT_DIR: join(alternate, ".git"),
				GIT_WORK_TREE: alternate,
				GIT_INDEX_FILE: join(alternate, ".git/index"),
				GIT_CEILING_DIRECTORIES: repository,
				GIT_CONFIG_COUNT: "1",
				GIT_CONFIG_KEY_0: "core.bare",
				GIT_CONFIG_VALUE_0: "true",
			},
		}),
	).toMatchObject({ code: "tracked-storage" });
	expect(await readFile(statePath)).toEqual(original);
});

it("refuses case-variant tracked paths", async () => {
	expect(await probe(caseVariant)).toMatchObject({ code: "tracked-storage" });
});

it("allows untracked reviews and keeps new identity files stageable", async () => {
	expect(await probe(untracked)).toEqual({ ok: true });
	await mkdir(join(untracked, ".praxity/identity"));
	await writeFile(join(untracked, ".praxity/identity/new.json"), "identity");
	expect((await git(untracked, "status", "--porcelain", "--untracked-files=all")).stdout).toContain(
		"?? untracked/.praxity/identity/new.json",
	);
	await git(untracked, "add", "-A");
	expect((await git(untracked, "ls-files")).stdout).toBe(".praxity/identity/new.json\n");
});

it("refuses a corrupt index without changing review bytes", async () => {
	const index = join(repository, ".git/index");
	const bytes = await readFile(index);
	try {
		await writeFile(index, "corrupt index");
		const refusal = await probe(tracked);
		expect(refusal).toMatchObject({ code: "git-unavailable", reason: "git-error" });
		expect(refusal.message).toContain("safe.directory");
		expect(await readFile(statePath)).toEqual(original);
	} finally {
		await writeFile(index, bytes);
	}
});

it("refuses a linked worktree pointing at a missing gitdir", async () => {
	const bytes = await readFile(brokenState);
	expect(await probe(brokenLinked)).toMatchObject({ code: "git-unavailable", reason: "git-error" });
	expect(await readFile(brokenState)).toEqual(bytes);
});

it.each([undefined, "child"] as const)(
	"refuses an outer repository's tracked review behind a nested repository with %s permission",
	async (permission) => {
		const bytes = await readFile(nestedState);
		expect(await probe(nested, { permission })).toMatchObject(
			permission ? permissionRefusal : { code: "tracked-storage" },
		);
		expect(await readFile(nestedState)).toEqual(bytes);
	},
	2000,
);

it.skipIf(process.platform !== "win32")(
	"does not execute a planted git.exe in the cwd",
	async () => {
		const planted = join(tracked, "git.exe");
		await copyFile(join(stubBin, "git.exe"), planted);
		try {
			expect(await probe(tracked, { env: { REVIEW_GIT_MARKER: marker } })).toMatchObject({
				code: "tracked-storage",
			});
			await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
			expect(await readFile(statePath)).toEqual(original);
		} finally {
			await unlink(planted);
		}
	},
	2000,
);

it("reports a short injected timeout from a sleeping PATH Git", async () => {
	const refusal = await probe(tracked, {
		timeout: 100,
		env: { PATH: stubBin, REVIEW_GIT_SLEEP: "1" },
	});
	expect(refusal).toMatchObject({ code: "git-unavailable", reason: "timeout" });
	expect(refusal.message).toContain("Git did not answer in time; retry.");
	expect(refusal.message).not.toContain(tracked);
	expect(await readFile(statePath)).toEqual(original);
});

it("allows a real submodule whose superproject cannot track below its gitlink", async () => {
	expect(await probe(submodule)).toEqual({ ok: true });
});

it("does not run a repository's fsmonitor hook or change its index", async () => {
	const index = join(hookCourse, ".git/index");
	const bytes = await readFile(index);
	expect(await probe(hookCourse)).toEqual({ ok: true });
	await expect(readFile(hookMarker)).rejects.toMatchObject({ code: "ENOENT" });
	expect(await readFile(index)).toEqual(bytes);
});

it("does not invoke a promisor remote's uploadpack while expanding a sparse index", async () => {
	const index = join(promisorCourse, ".git/index");
	const bytes = await readFile(index);
	expect(await probe(promisorCourse, { env: { GIT_ALLOW_PROTOCOL: "file" } })).toMatchObject({
		code: "git-unavailable",
		reason: "git-error",
	});
	await expect(readFile(promisorMarker)).rejects.toMatchObject({ code: "ENOENT" });
	expect(await readFile(index)).toEqual(bytes);
});

it.each(["git version 2.38.5", "git version 1.99.0"])(
	"refuses unsupported %s",
	async (version) => {
		const refusal = await probe(outside, {
			env: { PATH: stubBin, REVIEW_GIT_VERSION: version, REVIEW_GIT_REQUIRE_ACROSS: "1" },
		});
		expect(refusal).toMatchObject({ code: "git-unavailable", reason: "git-too-old" });
		expect(refusal.message).toContain("Git 2.39 or newer");
		expect(refusal.message).not.toContain(outside);
	},
	2000,
);

it.each(["git version 2.39.0 (Apple Git-154)", "git version 2.43.0", "git version 3.0.0"])(
	"admits supported %s without a modern lazy-fetch flag",
	async (version) => {
		expect(
			await probe(outside, {
				env: { PATH: stubBin, REVIEW_GIT_VERSION: version, REVIEW_GIT_REQUIRE_ACROSS: "1" },
			}),
		).toEqual({ ok: true });
	},
	2000,
);

it("refuses an empty successful listing that reports an index read error", async () => {
	expect(
		await probe(tracked, {
			env: {
				PATH: stubBin,
				REVIEW_GIT_STDERR: "error: unable to read tree object\n",
				REVIEW_GIT_EXIT: "0",
			},
		}),
	).toMatchObject({ code: "git-unavailable", reason: "git-error" });
	expect(await readFile(statePath)).toEqual(original);
});

it.each([undefined, "0"])(
	"owns cross-filesystem discovery despite inherited %s",
	async (inherited) => {
		expect(
			await probe(outside, {
				env: {
					PATH: stubBin,
					REVIEW_GIT_REQUIRE_ACROSS: "1",
					GIT_DISCOVERY_ACROSS_FILESYSTEM: inherited,
				},
			}),
		).toEqual({ ok: true });
	},
	2000,
);

it.each([
	"fatal: not a git repository: missing-gitdir\n",
	"fatal: not a git repository (or any parent up to mount point /mount)\n",
	"fatal: not a git repository (or any of the parent directories): .git\nextra diagnostic\n",
])(
	"refuses inconclusive Git stderr %j",
	async (stderr) => {
		expect(
			await probe(tracked, {
				env: { PATH: stubBin, REVIEW_GIT_STDERR: stderr, REVIEW_GIT_EXIT: "128" },
			}),
		).toMatchObject({ code: "git-unavailable", reason: "git-error" });
		expect(await readFile(statePath)).toEqual(original);
	},
	2000,
);
