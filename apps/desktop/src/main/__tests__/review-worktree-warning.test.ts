import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { runPraxityCli } from "../cli";
import en from "../cli-messages/en.json" with { type: "json" };
import fr from "../cli-messages/fr.json" with { type: "json" };
import { isLinkedReviewWorktree, openReviewStore } from "../studio/review-store";

const exec = promisify(execFile);
const cleanEnv = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)),
);
const git = (root: string, ...args: string[]) =>
	exec("git", ["-C", root, ...args], { env: cleanEnv, windowsHide: true });
let scratch: string;
let main: string;
let linked: string;
let emptyBin: string;
const runtime = { appVersion: "test", exportAssetsDir: "unused" };
let studioRuntime: typeof runtime & { editorAssetsDir: string };

beforeAll(async () => {
	scratch = await mkdtemp(join(tmpdir(), "review-worktree-warning-"));
	main = join(scratch, "main");
	linked = join(scratch, "linked");
	emptyBin = join(scratch, "empty-bin");
	await mkdir(main);
	await mkdir(emptyBin);
	await git(main, "init", "--quiet");
	await mkdir(join(main, "course"));
	await writeFile(join(main, "course/course.yaml"), "title: Test\nlessons: [a.prax]\n");
	await writeFile(join(main, "course/a.prax"), "# First\n\nText.\n");
	await git(main, "add", "course");
	await git(
		main,
		"-c",
		"user.name=Ariel Harlap",
		"-c",
		"user.email=3870784+aharlap@users.noreply.github.com",
		"commit",
		"--quiet",
		"-m",
		"Fixture",
	);
	await git(main, "worktree", "add", "--quiet", "-b", "linked", linked);
	await openReviewStore(join(main, "course"));
	await openReviewStore(join(linked, "course"));
	const assets = join(scratch, "assets");
	await mkdir(assets);
	await writeFile(join(assets, "canvas.js"), "void 0;");
	await writeFile(
		join(assets, "canvas.sha256"),
		"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362",
	);
	await writeFile(join(assets, "review-comments.js"), "void 0;");
	await writeFile(join(assets, "review-comments.css"), "body {}");
	studioRuntime = { ...runtime, exportAssetsDir: assets, editorAssetsDir: assets };
	await import("../studio/server");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
	// Studio creates identity and local data outside the ignored fixture review store.
	await rm(join(linked, "course/.praxity"), { recursive: true });
	await git(main, "worktree", "remove", linked);
	await rm(scratch, { recursive: true });
});

it.each(["list", "reply", "resolve", "reopen"])(
	"warns once for comments %s in a real linked worktree",
	async (command) => {
		for (const [locale, catalogue] of [
			["en", en],
			["fr", fr],
		] as const) {
			const args = ["comments", command, join(linked, "course")];
			if (command !== "list")
				args.push(
					"10000000-0000-4000-8000-000000000001",
					"--expect-version",
					"1",
					"--request-id",
					"20000000-0000-4000-8000-000000000001",
				);
			if (command !== "list" && command !== "reopen") {
				const text = join(scratch, `${command}.txt`);
				await writeFile(text, "Reply");
				args.push(command === "reply" ? "--text-file" : "--reply-file", text);
			}
			const result = await runPraxityCli([...args, "--json", "--lang", locale], runtime);
			expect(result.exitCode).toBe(command === "list" ? 0 : 4);
			expect(result.stderr).toBe(`${catalogue.reviewWorktreeWarning}\n`);
		}
	},
);

it("keeps a main checkout silent", async () => {
	const result = await runPraxityCli(["comments", "list", join(main, "course"), "--json"], runtime);
	expect(result.exitCode).toBe(0);
	expect(result.stderr).toBe("");
});

it("fails open silently when Git is missing", async () => {
	vi.stubEnv("PATH", emptyBin);
	const result = await runPraxityCli(
		["comments", "list", join(linked, "course"), "--json"],
		runtime,
	);
	expect(result.exitCode).toBe(0);
	expect(result.stderr).toBe("");
});

it("ignores ambient Git discovery and command overrides", async () => {
	vi.stubEnv("GIT_DIR", join(main, ".git"));
	vi.stubEnv("GIT_WORK_TREE", main);
	vi.stubEnv("GIT_CEILING_DIRECTORIES", linked);
	vi.stubEnv("GIT_CONFIG_COUNT", "1");
	vi.stubEnv("GIT_CONFIG_KEY_0", "core.fsmonitor");
	vi.stubEnv("GIT_CONFIG_VALUE_0", "must-not-run");
	expect(await isLinkedReviewWorktree(join(linked, "course"))).toBe(true);
	expect(await isLinkedReviewWorktree(join(main, "course"))).toBe(false);
});

it.each(["en", "fr"] as const)("warns once at review Studio launch in %s", async (locale) => {
	const result = await runPraxityCli(
		["studio", join(linked, "course"), "--review", "--no-open", "--lang", locale],
		studioRuntime,
	);
	try {
		expect(result.exitCode, result.stderr).toBe(0);
		expect(result.stderr).toBe(`${(locale === "fr" ? fr : en).reviewWorktreeWarning}\n`);
	} finally {
		await result.studioServer?.close();
	}
});

it.each([false, true])("keeps main-checkout Studio silent with review=%s", async (review) => {
	const result = await runPraxityCli(
		["studio", join(main, "course"), "--no-open", ...(review ? ["--review"] : [])],
		studioRuntime,
	);
	try {
		expect(result.exitCode, result.stderr).toBe(0);
		expect(result.stderr).toBe("");
	} finally {
		await result.studioServer?.close();
	}
});

it("keeps linked-worktree Studio silent without review", async () => {
	const result = await runPraxityCli(
		["studio", join(linked, "course"), "--no-open"],
		studioRuntime,
	);
	try {
		expect(result.exitCode, result.stderr).toBe(0);
		expect(result.stderr).toBe("");
	} finally {
		await result.studioServer?.close();
	}
});
