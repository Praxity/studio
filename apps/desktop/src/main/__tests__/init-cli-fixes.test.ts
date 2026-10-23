import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runPraxityCli } from "../cli";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>();
	return { ...actual, rename: vi.fn(actual.rename) };
});

const roots: string[] = [];
const runtime = { appVersion: "test", exportAssetsDir: "unused" };
async function course(settings = "{}", git = false) {
	const root = await fs.mkdtemp(join(tmpdir(), "praxity-init-fixes-"));
	roots.push(root);
	if (git) execFileSync("git", ["-C", root, "init", "--quiet"]);
	await fs.mkdir(join(root, ".vscode"));
	await fs.writeFile(join(root, ".vscode/settings.json"), settings);
	return root;
}
afterEach(async () => {
	vi.restoreAllMocks();
	for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

it.each([".vscode/settings.json", ".git/info/exclude"])(
	"refuses read-only %s without replacing it or changing either file",
	async (target) => {
		const root = await course('{"editor.tabSize":3}\n', true);
		const settings = await fs.readFile(join(root, ".vscode/settings.json"));
		const exclude = await fs.readFile(join(root, ".git/info/exclude"));
		const path = join(root, target);
		await fs.chmod(path, 0o444);
		const before = await fs.stat(path);
		try {
			for (const lang of ["en", "fr"]) {
				const result = await runPraxityCli(["init", root, "--lang", lang], runtime);
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain(target);
				expect(result.stderr).toContain(lang === "en" ? "not writable" : "écriture");
				expect(await fs.readFile(join(root, ".vscode/settings.json"))).toEqual(settings);
				expect(await fs.readFile(join(root, ".git/info/exclude"))).toEqual(exclude);
				expect((await fs.stat(path)).mode).toBe(before.mode);
				expect((await fs.stat(path)).ino).toBe(before.ino);
			}
			expect(await fs.readdir(join(root, ".vscode"))).toEqual(["settings.json"]);
			expect(await fs.readdir(join(root, ".git/info"))).toEqual(["exclude"]);
		} finally {
			await fs.chmod(path, 0o644);
		}
	},
);

it.skipIf(process.platform === "win32")(
	"preserves writable settings and Git file modes",
	async () => {
		const root = await course("{}", true);
		for (const name of [".vscode/settings.json", ".git/info/exclude"])
			await fs.chmod(join(root, name), 0o640);
		expect((await runPraxityCli(["init", root], runtime)).exitCode).toBe(0);
		for (const name of [".vscode/settings.json", ".git/info/exclude"])
			expect((await fs.stat(join(root, name))).mode & 0o777).toBe(0o640);
	},
);

it.each(["files.exclude", "search.exclude"])(
	"respects matching false aliases in %s",
	async (section) => {
		for (const pattern of [
			"**/.praxity",
			".praxity/",
			"**/.praxity/**",
			".prax*",
			"{.praxity,other}",
		] as const) {
			const root = await course(JSON.stringify({ [section]: { [pattern]: false, other: false } }));
			const result = await runPraxityCli(["init", root], runtime);
			expect(result.exitCode).toBe(0);
			const settings = JSON.parse(await fs.readFile(join(root, ".vscode/settings.json"), "utf8"));
			expect(settings[section][".praxity"]).toBeUndefined();
			expect(
				settings[section === "files.exclude" ? "search.exclude" : "files.exclude"]?.[".praxity"],
			).toBeUndefined();
			expect(settings[section][pattern]).toBe(false);
			expect(result.stdout).toContain(`${section}[${JSON.stringify(pattern)}]`);
			expect(result.stdout).toContain("Left .praxity as the author set it");
		}
	},
);

it.each([
	"**/.praxity-write-*",
	".praxity-write-kept/**",
	"**/.praxity-write-[ab]/**",
	".prax*-kept",
])("respects recovery false pattern %s while hiding unrelated identity", async (pattern) => {
	const root = await course(
		JSON.stringify({ "files.exclude": { [pattern]: false, other: false } }),
	);
	const result = await runPraxityCli(["init", root], runtime);
	expect(result.exitCode).toBe(0);
	const settings = JSON.parse(await fs.readFile(join(root, ".vscode/settings.json"), "utf8"));
	expect(settings["files.exclude"]).toEqual({ [pattern]: false, other: false, ".praxity": true });
	expect(settings["search.exclude"]?.[".praxity-write-*"]).toBeUndefined();
	expect(result.stdout).toContain("Left .praxity-write-* as the author set it");
});

it("leaves settings untouched when an author pattern disables all managed hiding", async () => {
	const original = '{"files.exclude":{".prax*":false}}';
	const root = await course(original);
	const timestamp = (await fs.stat(join(root, ".vscode/settings.json"))).mtimeMs;
	expect((await runPraxityCli(["init", root], runtime)).exitCode).toBe(0);
	expect(await fs.readFile(join(root, ".vscode/settings.json"), "utf8")).toBe(original);
	expect((await fs.stat(join(root, ".vscode/settings.json"))).mtimeMs).toBe(timestamp);
});

it("does not let unrelated false patterns block hiding", async () => {
	const root = await course('{"files.exclude":{"other*":false}}');
	expect((await runPraxityCli(["init", root], runtime)).exitCode).toBe(0);
	expect(
		JSON.parse(await fs.readFile(join(root, ".vscode/settings.json"), "utf8"))["files.exclude"],
	).toEqual({
		"other*": false,
		".praxity": true,
		".praxity-write-*": true,
	});
});

it("creates an absent Git info directory after preflight", async () => {
	const root = await course("{}", true);
	await fs.rm(join(root, ".git/info"), { recursive: true });
	expect((await runPraxityCli(["init", root], runtime)).exitCode).toBe(0);
	expect(await fs.readFile(join(root, ".git/info/exclude"), "utf8")).toBe(
		"\n/**/.praxity-transaction.json\n/**/.praxity-write-*/\n",
	);
});

it.each(["", " \r\n\t", "\uFEFF"])(
	"accepts empty settings %j and reruns without writes",
	async (input) => {
		const root = await course(input);
		expect((await runPraxityCli(["init", root], runtime)).exitCode).toBe(0);
		const after = await fs.readFile(join(root, ".vscode/settings.json"));
		const timestamp = (await fs.stat(join(root, ".vscode/settings.json"))).mtimeMs;
		const again = await runPraxityCli(["init", root], runtime);
		expect(again.exitCode).toBe(0);
		expect(again.stdout).toContain(".praxity already hidden");
		expect(await fs.readFile(join(root, ".vscode/settings.json"))).toEqual(after);
		expect((await fs.stat(join(root, ".vscode/settings.json"))).mtimeMs).toBe(timestamp);
	},
);

it("keeps comments in place and follows existing indentation without blank insertions", async () => {
	const root = await course('{ // personal\n\t"editor.tabSize": 2,\n}\n');
	expect((await runPraxityCli(["init", root], runtime)).exitCode).toBe(0);
	expect(await fs.readFile(join(root, ".vscode/settings.json"), "utf8")).toBe(
		'{ // personal\n\t"editor.tabSize": 2,\n\t"files.exclude": {".praxity": true, ".praxity-write-*": true},\n\t"search.exclude": {".praxity": true, ".praxity-write-*": true}\n}\n',
	);
});

it.each(["en", "fr"])(
	"reports real outcomes and workspace/User-setting limits in %s",
	async (lang) => {
		const root = await course('{"files.exclude":{".praxity":false}}');
		const result = await runPraxityCli(["init", root, "--lang", lang], runtime);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			lang === "en" ? "Left .praxity as the author set it" : ".praxity conservé selon votre choix",
		);
		expect(result.stdout).toContain(
			lang === "en" ? "Not a Git work tree" : "Ce dossier n'est pas dans un dépôt Git",
		);
		expect(result.stdout).toContain(
			lang === "en" ? "open the course folder" : "ouvrez le dossier du cours",
		);
		expect(result.stdout).toContain(lang === "en" ? "User settings" : "paramètres utilisateur");
		expect(result.stdout).toContain(lang === "en" ? "false or remove" : "false ou supprimez");
		expect(result.stdout).not.toMatch(/hidden in both|masqu[ée]s? dans les deux/);
		expect(result.stdout).not.toMatch(/versioned in Git|versionné dans Git/);
	},
);

it("refuses malformed Git metadata before writing settings, with French-only failure copy", async () => {
	const root = await course();
	await fs.writeFile(join(root, ".git"), "not a gitdir line");
	const result = await runPraxityCli(["init", root, "--lang", "fr"], runtime);
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain("exclusions Git");
	expect(result.stderr).not.toContain("Invalid Git directory reference");
	expect(await fs.readFile(join(root, ".vscode/settings.json"), "utf8")).toBe("{}");
});

it.each([".vscode/settings.json", ".git/info/exclude"])(
	"leaves %s complete on atomic rename failure",
	async (target) => {
		const root = await course("{}", true);
		const path = join(root, target);
		const original = await fs.readFile(path);
		const { rename } = await vi.importActual<typeof fs>("node:fs/promises");
		vi.mocked(fs.rename).mockImplementation(async (from, to) => {
			if (String(to) === path) throw Object.assign(new Error("denied"), { code: "EACCES" });
			return rename(from, to);
		});
		const result = await runPraxityCli(["init", root, "--lang", "fr"], runtime);
		expect(result.exitCode).toBe(1);
		expect(await fs.readFile(path)).toEqual(original);
		expect(await fs.readdir(join(root, ".vscode"))).toEqual(["settings.json"]);
		expect(await fs.readdir(join(root, ".git/info"))).toEqual(["exclude"]);
		if (target === ".git/info/exclude")
			expect(result.stderr).toContain("Fichier .vscode/settings.json mis à jour");
	},
);

it("keeps a distinct localized missing-course refusal", async () => {
	const root = await course();
	const result = await runPraxityCli(["init", join(root, "missing"), "--lang", "fr"], runtime);
	expect(result.exitCode).toBe(1);
	expect(JSON.parse(result.stdout).error.code).toBe("project_not_found");
	expect(result.stderr).not.toContain("Project directory is unavailable");
});
