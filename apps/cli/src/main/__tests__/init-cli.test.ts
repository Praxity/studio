import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runPraxityCli } from "../cli";

const roots: string[] = [];
const runtime = { appVersion: "test", exportAssetsDir: "unused" };
const git = (root: string, ...args: string[]) =>
	execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
async function folder(repository = false) {
	const root = await mkdtemp(join(tmpdir(), "praxity-init-"));
	roots.push(root);
	if (repository) git(root, "init", "--quiet");
	return root;
}
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("initializes a fresh Git course, preserves exclusions and never creates .gitignore", async () => {
	const root = await folder(true);
	const exclude = join(root, ".git/info/exclude");
	await writeFile(exclude, "# keep\r\nexisting");
	const result = await runPraxityCli(["init", root], runtime);
	expect(result.exitCode).toBe(0);
	expect(JSON.parse(await readFile(join(root, ".vscode/settings.json"), "utf8"))).toEqual({
		"files.exclude": { ".praxity": true, ".praxity-write-*": true },
		"search.exclude": { ".praxity": true, ".praxity-write-*": true },
	});
	expect(await readFile(exclude, "utf8")).toBe(
		"# keep\r\nexisting\n/**/.praxity-transaction.json\n/**/.praxity-write-*/\n",
	);
	expect(result.stdout).toContain("Updated .vscode/settings.json");
	expect(result.stdout).toContain("Updated Git info/exclude");
	expect(result.stdout).toContain("Left .gitignore and recovery copies unchanged");
	expect(result.stdout).toContain(".praxity hidden in VS Code files and search");
	expect(result.stdout).toContain("Init does not exclude .praxity from Git");
	await expect(stat(join(root, ".gitignore"))).rejects.toMatchObject({ code: "ENOENT" });
	await mkdir(join(root, ".praxity/identity"), { recursive: true });
	await mkdir(join(root, ".praxity-write-retained"));
	await writeFile(join(root, ".praxity/identity/course.json"), "keep");
	await writeFile(join(root, ".praxity-write-retained/copy"), "keep");
	await writeFile(join(root, ".praxity-transaction.json"), "recovery journal");
	const status = git(root, "status", "--porcelain", "--untracked-files=all");
	expect(status).toContain("?? .praxity/identity/course.json");
	expect(status).not.toContain(".praxity-write-");
	expect(status).not.toContain(".praxity-transaction.json");
	git(root, "add", "-A");
	expect(git(root, "diff", "--cached", "--name-only")).toBe(
		".praxity/identity/course.json\n.vscode/settings.json",
	);
	const before = await readFile(join(root, ".vscode/settings.json"));
	const timestamp = (await stat(join(root, ".vscode/settings.json"))).mtimeMs;
	const again = await runPraxityCli(["init", root], runtime);
	expect(again.exitCode).toBe(0);
	expect(await readFile(join(root, ".vscode/settings.json"))).toEqual(before);
	expect((await stat(join(root, ".vscode/settings.json"))).mtimeMs).toBe(timestamp);
	expect(await readFile(exclude, "utf8")).toBe(
		"# keep\r\nexisting\n/**/.praxity-transaction.json\n/**/.praxity-write-*/\n",
	);
	expect(again.stdout).toContain("unchanged");
});

it("keeps new identity files visible and stageable after init", async () => {
	const root = await folder(true);
	expect((await runPraxityCli(["init", root], runtime)).exitCode).toBe(0);
	await mkdir(join(root, ".praxity/identity"), { recursive: true });
	await writeFile(join(root, ".praxity/identity/new.json"), "new block identities");
	expect(git(root, "status", "--porcelain", "--untracked-files=all")).toContain(
		"?? .praxity/identity/new.json",
	);
	git(root, "add", "-A");
	expect(git(root, "diff", "--cached", "--name-only")).toContain(".praxity/identity/new.json");
});

it("inserts entries without changing existing JSONC bytes, including explicit false and conditional values", async () => {
	const root = await folder();
	await mkdir(join(root, ".vscode"));
	const original =
		'\uFEFF{\r\n // keep comment\r\n "editor.tabSize" : 7,\r\n "files.exclude": {".praxity":false, "other": true /* end */},\r\n "search.exclude": {".praxity-write-*": {"when":"keep"}},\r\n}\r\n';
	await writeFile(join(root, ".vscode/settings.json"), original);
	await writeFile(join(root, ".gitignore"), "# exact\r\nkeep");
	const result = await runPraxityCli(["init", root], runtime);
	expect(result.exitCode).toBe(0);
	const updated = await readFile(join(root, ".vscode/settings.json"), "utf8");
	expect(
		updated
			.replace(', /* end */\r\n  ".praxity-write-*": true\r\n ', " /* end */")
			.replace(',\r\n  ".praxity": true\r\n ', ""),
	).toBe(original);
	expect(result.stdout).toContain('Left files.exclude[".praxity"] unchanged');
	expect(result.stdout).toContain('Left search.exclude[".praxity-write-*"] unchanged');
	expect(result.stdout).toContain("Not a Git work tree");
	expect(await readFile(join(root, ".gitignore"), "utf8")).toBe("# exact\r\nkeep");
	await runPraxityCli(["init", root], runtime);
	expect(await readFile(join(root, ".vscode/settings.json"), "utf8")).toBe(updated);
});

it("defaults to the current directory and reports French notices and help", async () => {
	const root = await folder();
	vi.spyOn(process, "cwd").mockReturnValue(root);
	const result = await runPraxityCli(["init", "--lang", "fr"], runtime);
	expect(result.exitCode).toBe(0);
	expect(result.stdout).toContain("Fichier .vscode/settings.json mis à jour");
	expect(result.stdout).toContain("Ce dossier n'est pas dans un dépôt Git");
	expect(result.stdout).toContain(".praxity masqué dans les fichiers et la recherche de VS Code");
	expect(result.stdout).toContain("Init n'exclut pas .praxity de Git");
	for (const lang of ["en", "fr"]) {
		const help = await runPraxityCli(["init", "--help", "--lang", lang], runtime);
		expect(help.stdout).toContain("praxity init [<course-dir>]");
		expect(help.stdout).toContain(lang === "en" ? "Hide" : "Masquer");
		expect(help.stdout).toContain(lang === "en" ? "Usage:" : "Utilisation :");
	}
});

it("preserves recovery copies and identity without attempting recovery", async () => {
	const root = await folder();
	await mkdir(join(root, ".praxity-write-unknown"));
	await writeFile(join(root, ".praxity-write-unknown/copy"), "retained evidence");
	await mkdir(join(root, ".praxity"));
	await writeFile(join(root, ".praxity/identity.json"), "identity");
	expect((await runPraxityCli(["init", root], runtime)).exitCode).toBe(0);
	expect(await readFile(join(root, ".praxity-write-unknown/copy"), "utf8")).toBe(
		"retained evidence",
	);
	expect(await readFile(join(root, ".praxity/identity.json"), "utf8")).toBe("identity");
	expect((await readdir(root)).sort()).toEqual([".praxity", ".praxity-write-unknown", ".vscode"]);
});

it("scopes Git exclusions to a nested course and preserves an existing .gitignore", async () => {
	const root = await folder(true);
	const course = join(root, "course [one]");
	await mkdir(course);
	await writeFile(join(root, ".gitignore"), "# keep\r\nexisting");
	expect((await runPraxityCli(["init", course], runtime)).exitCode).toBe(0);
	await mkdir(join(course, ".praxity/identity"), { recursive: true });
	await writeFile(join(course, ".praxity/identity/course.json"), "keep");
	await mkdir(join(course, ".praxity-write-retained"));
	await writeFile(join(course, ".praxity-write-retained/copy"), "keep");
	await mkdir(join(root, ".praxity-write-other"));
	await writeFile(join(root, ".praxity-write-other/copy"), "keep");
	await mkdir(join(root, ".praxity"));
	await writeFile(join(root, ".praxity/visible"), "keep");
	expect(git(root, "check-ignore", "course [one]/.praxity-write-retained/copy")).toBe(
		"course [one]/.praxity-write-retained/copy",
	);
	const status = git(root, "status", "--porcelain", "--untracked-files=all");
	expect(status).toContain("course [one]/.praxity/identity/course.json");
	expect(status).toContain(".praxity/visible");
	expect(status).toContain(".praxity-write-other/copy");
	expect(status).not.toContain(".praxity-write-retained/copy");
	expect(await readFile(join(root, ".gitignore"), "utf8")).toBe("# keep\r\nexisting");
});

it("uses the common Git exclusion file in a linked worktree", async () => {
	const root = await folder(true);
	git(
		root,
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.com",
		"commit",
		"--allow-empty",
		"-m",
		"base",
		"--quiet",
	);
	const linked = join(await folder(), "linked");
	git(root, "worktree", "add", "--quiet", "--detach", linked);
	expect((await runPraxityCli(["init", linked], runtime)).exitCode).toBe(0);
	expect(await readFile(join(root, ".git/info/exclude"), "utf8")).toContain(
		"/**/.praxity-transaction.json\n/**/.praxity-write-*/\n",
	);
	await mkdir(join(linked, ".praxity/identity"), { recursive: true });
	await writeFile(join(linked, ".praxity/identity/course.json"), "keep");
	expect(git(linked, "status", "--porcelain", "--untracked-files=all")).toContain(
		"?? .praxity/identity/course.json",
	);
	git(linked, "add", "-A");
	expect(git(linked, "diff", "--cached", "--name-only")).toContain(".praxity/identity/course.json");
});

it("refuses settings paths linked outside the course without changing the target", async () => {
	const root = await folder();
	const outside = await folder();
	await writeFile(join(outside, "settings.json"), "{}\n");
	await symlink(outside, join(root, ".vscode"), process.platform === "win32" ? "junction" : "dir");
	expect((await runPraxityCli(["init", root], runtime)).exitCode).toBe(1);
	expect(await readFile(join(outside, "settings.json"), "utf8")).toBe("{}\n");
});

it.each([
	"{}",
	"{ /* comment only */ }",
	'{"files.exclude":{},"search.exclude":{}}',
	'{"files.exclude":{".praxity":true,".praxity-write-*":true},"search.exclude":{".praxity":false,".praxity-write-*":false}}',
])("handles and reruns valid starting settings %s", async (original) => {
	const root = await folder();
	await mkdir(join(root, ".vscode"));
	await writeFile(join(root, ".vscode/settings.json"), original);
	const first = await runPraxityCli(["init", root, "--lang", "fr"], runtime);
	expect(first.exitCode).toBe(0);
	const after = await readFile(join(root, ".vscode/settings.json"), "utf8");
	expect((await runPraxityCli(["init", root], runtime)).exitCode).toBe(0);
	expect(await readFile(join(root, ".vscode/settings.json"), "utf8")).toBe(after);
	if (original.includes("false")) {
		expect(after).toBe(original);
		expect(first.stdout).toContain('Entrée search.exclude[".praxity"] conservée');
	}
});

it.each([
	"{broken",
	"[]",
	'{"files.exclude":false}',
	'{"search.exclude":null}',
	'{"files.exclude":{},"files.exclude":{}}',
	'{"files.exclude":{".praxity":false,".praxity":true}}',
])(
	"refuses ambiguous or invalid settings without touching settings or Git exclusions: %s",
	async (original) => {
		const root = await folder(true);
		await mkdir(join(root, ".vscode"));
		await writeFile(join(root, ".vscode/settings.json"), original);
		const exclude = await readFile(join(root, ".git/info/exclude"));
		const result = await runPraxityCli(["init", root, "--lang", "fr"], runtime);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("paramètres");
		expect(await readFile(join(root, ".vscode/settings.json"), "utf8")).toBe(original);
		expect(await readFile(join(root, ".git/info/exclude"))).toEqual(exclude);
	},
);

it.each([["--bad"], ["one", "two"], ["--lang", "xx"], ["--lang", "fr", "--lang", "fr"]])(
	"rejects invalid arguments: $0 $1 $2 $3",
	async (...args) => {
		expect((await runPraxityCli(["init", ...args], runtime)).exitCode).toBe(2);
	},
);
