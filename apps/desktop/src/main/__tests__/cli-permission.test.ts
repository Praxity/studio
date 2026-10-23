import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import AdmZip from "adm-zip";
import { build } from "esbuild";
import { afterAll, assert, beforeAll, beforeEach, expect, it } from "vitest";
import { directorySnapshot } from "../../test-utils/directory-snapshot";
import { initializeCourseIdentity } from "../identity-store";
import { LocalEditorStore } from "../operations/local-editor-store";
import { openReviewStore } from "../studio/review-store";

const checkout = fileURLToPath(new URL("../../../../../", import.meta.url));
const desktop = path.join(checkout, "apps/desktop");
const runtimeRequire = createRequire(path.join(checkout, "packages/shared-blocks/package.json"));
let root: string;
let entry: string;
let course: string;
let dependencyStore: string;
let readOnlyCourse: string;
let readOnlySnapshot: Awaited<ReturnType<typeof directorySnapshot>>;
let readOnlyField: { nodeId: string; field: string; fileRevision: string };
let exportCourse: string;
let exportSnapshot: Awaited<ReturnType<typeof directorySnapshot>>;
const source =
	"---\ntitle: Permission test\nlang: en\n---\n\n# One page {hideTitle}\n\n## One page\n\nA stable paragraph retains its identity through permission checks. Original text.\n";
const draftText = "\uFEFFUnsaved été.\r\n";

beforeAll(async () => {
	dependencyStore = await realpath(path.join(checkout, "node_modules/.pnpm"));
	const tempBase = process.platform === "win32" ? path.parse(os.tmpdir()).root : os.tmpdir();
	root = await realpath(await mkdtemp(path.join(tempBase, "cli-permission-")));
	entry = path.join(root, "cli.mjs");
	// Bundle the actual command and lesson writer without a browser build or Typst
	// download. Only jsdom's runtime files remain external, as in the shipped CLI.
	await build({
		stdin: {
			resolveDir: desktop,
			contents: `
				import { readFile } from 'node:fs/promises';
				import { runPraxityCli } from './src/main/cli';
				import { writeLessonSource } from './src/main/lesson-source';
				import { initializeCourseIdentity } from './src/main/identity-store';
				import { withProjectFileTransaction } from './src/main/project-file-transactions';
				import { openReviewStore } from './src/main/studio/review-store';
				import { startStudioServer } from './src/main/studio/server';
				import { prepareStudioTemporaryOutputs } from './src/main/studio/temporary-outputs';
				const [action, ...args] = process.argv.slice(2);
				try {
				if (action === 'transaction') {
				    await withProjectFileTransaction(args[0], async () => {}, 'write');
				} else if (action === 'identity-save') {
				    await initializeCourseIdentity(args[0], ['lesson.prax']);
				} else if (action === 'review-save') {
				    await openReviewStore(args[0]);
				} else if (action === 'review-mutate') {
				    const store = await openReviewStore(args[0], undefined, {createIfMissing:false});
				    const principal = await store.principalFor('author', 'local-cli');
				    await store[args[1]](principal, {});
				} else if (action === 'server-save') {
				    await startStudioServer({ projectDir: args[0], editorAssetsDir: '' });
				} else if (action === 'temporary-save') {
				    await prepareStudioTemporaryOutputs(args[0]);
				} else if (action === 'save') {
					const expected = await readFile(args[0] + '/lesson.prax', 'utf8');
					await writeLessonSource(args[0], 'lesson.prax', args[1], expected);
				} else if (action === 'read') {
					await readFile(args[0]);
				} else {
					const result = await runPraxityCli([action, ...args], {
						appVersion: 'test',
						exportAssetsDir: ${JSON.stringify(path.join(desktop, "resources/export-assets"))},
					});
					process.stdout.write(result.stdout);
					process.stderr.write(result.stderr);
					process.exitCode = result.exitCode;
				}
				} catch (error) {
				    console.log(JSON.stringify({ok:false,error:{code:error.code,message:error.message}}));
				    process.exitCode = 1;
				}
			`,
		},
		outfile: entry,
		bundle: true,
		minify: true,
		platform: "node",
		format: "esm",
		target: "node24",
		banner: {
			js: 'import { createRequire as createBundleRequire } from "node:module"; const require = createBundleRequire(import.meta.url);',
		},
		plugins: [
			{
				name: "external-dom-runtime",
				setup(builder) {
					builder.onResolve({ filter: /^(isomorphic-dompurify|jsdom)$/ }, (args) => ({
						path: pathToFileURL(runtimeRequire.resolve(args.path)).href,
						external: true,
					}));
				},
			},
		],
	});
	readOnlyCourse = await createCourse("read-only");
	await initializeCourseIdentity(readOnlyCourse, ["lesson.prax"]);
	await openReviewStore(readOnlyCourse);
	expect(
		await new LocalEditorStore(readOnlyCourse).draftPut({
			draft: {
				id: "recoverable",
				file: "lesson.prax",
				scope: "file",
				target: { kind: "node", nodeId: null, path: [], fingerprint: "a".repeat(64) },
				baseRevision: "b".repeat(64),
				expectedText: source,
				editableText: source,
				baseText: source,
				text: draftText,
				selection: [0, 0],
				generation: 1,
				status: "held",
				diagnostics: [],
				changedAt: 10,
				validatedGeneration: 1,
				persistedGeneration: 1,
			},
		}),
	).toMatchObject({ ok: true });
	readOnlySnapshot = await directorySnapshot(readOnlyCourse);
	const inventory = runWithGrants(false, "inspect", readOnlyCourse, "--text-fields", "--json");
	expect(inventory.status, inventory.stderr || inventory.stdout).toBe(0);
	readOnlyField = JSON.parse(inventory.stdout).textFields[0];
	expect(await directorySnapshot(readOnlyCourse)).toEqual(readOnlySnapshot);
	exportCourse = await createCourse("export");
	await writeFile(
		path.join(exportCourse, "lesson.prax"),
		`${source}\n::: choice Check your answer {scored attempts=1}\n(x) Yes\n( ) No\n:::\n`,
	);
	await writeFile(
		path.join(exportCourse, "praxity.json"),
		JSON.stringify({
			version: 1,
			export: { format: "html", completionThreshold: 0.8, passingScore: 0.8 },
		}),
	);
	await initializeCourseIdentity(exportCourse, ["lesson.prax"]);
	exportSnapshot = await directorySnapshot(exportCourse);
});

beforeEach(async () => {
	// Writers get fresh metadata; read-only cases use the shared initialized course.
	course = await createCourse(`course-${randomUUID()}`);
});

async function createCourse(name: string) {
	const directory = path.join(root, name);
	await mkdir(directory);
	await writeFile(
		path.join(directory, "course.yaml"),
		"title: Permission test\nlessons: [lesson.prax]\n",
	);
	await writeFile(path.join(directory, "lesson.prax"), source);
	return directory;
}

afterAll(async () => {
	if (root) await rm(root, { recursive: true, force: true });
});

function runWithGrants(write: boolean, ...args: string[]) {
	// Match the portable proof's grants. Dependency/assets reads are the only
	// source-mode additions; checkout source and all non-temporary writes stay denied.
	const tempTree =
		process.platform === "win32"
			? root
			: path.join(path.parse(root).root, root.split(path.sep).filter(Boolean)[0]);
	return spawnSync(
		process.execPath,
		[
			"--permission",
			`--allow-fs-read=${tempTree}`,
			...(write ? [`--allow-fs-write=${tempTree}`] : []),
			`--allow-fs-read=${path.join(checkout, "node_modules")}`,
			`--allow-fs-read=${dependencyStore}`,
			`--allow-fs-read=${path.join(desktop, "node_modules")}`,
			`--allow-fs-read=${path.join(desktop, "resources/export-assets")}`,
			entry,
			...args,
		],
		{
			cwd: root,
			encoding: "utf8",
			timeout: 30_000,
			env: {
				PATH: path.dirname(process.execPath),
				HOME: root,
				USERPROFILE: root,
				TMPDIR: root,
				TMP: root,
				TEMP: root,
				NODE_ENV: "production",
			},
		},
	);
}

const run = (...args: string[]) => runWithGrants(true, ...args);
const permissionMessage =
	"Studio can't save while Node's permission model is on, because it blocks the file sync that keeps saves safe. Run without --permission.";
const refusal = { code: "EPERMISSIONMODEL", message: permissionMessage };

async function expectRefusal(...args: string[]) {
	const before = await directorySnapshot(course);
	const result = run(...args);
	expect(result.error).toBeUndefined();
	expect(result.status, result.stderr || result.stdout).toBe(1);
	expect(JSON.parse(result.stdout)).toEqual({ ok: false, error: refusal });
	expect(await directorySnapshot(course)).toEqual(before);
}

it.each(["\n", "\r\n"])(
	"refuses lesson saves without changing bytes, %j",
	async (eol) => {
		const original = source.replace(/\n/g, eol);
		await writeFile(path.join(course, "lesson.prax"), original);
		await expectRefusal("save", course, original.replace(/\r?\n$/, ` Edited.${eol}`));
	},
	20_000,
);

it("refuses a lesson save that removes the final newline without changing the directory", async () => {
	await expectRefusal("save", course, `${source.trimEnd()} Edited.`);
}, 20_000);

it.each(
	[
		["init"],
		["identity", "init"],
		["identity", "merge"],
		["edit"],
		["comments", "reply"],
		["narration", "accept"],
		["recovery", "run"],
		["recovery", "extract"],
		["recovery", "restore"],
		["recovery", "resolve"],
		["studio"],
	].map((command) => [command.join(" "), command] as const),
)("refuses writing command %j before file admission", async (_name, command) => {
	await expectRefusal(...command, course);
});

it.each(["transaction", "identity-save", "review-save", "server-save", "temporary-save"])(
	"refuses the direct %s entry point before file admission",
	async (action) => {
		await expectRefusal(action, course);
	},
);

it("prints the named French refusal", async () => {
	const before = await directorySnapshot(course);
	const result = run("identity", "init", course, "--lang", "fr");
	expect(result.status).toBe(1);
	expect(JSON.parse(result.stdout).error).toEqual({
		code: "EPERMISSIONMODEL",
		message:
			"Studio ne peut pas enregistrer lorsque le modèle de permissions de Node est activé, car il bloque la synchronisation des fichiers qui protège les enregistrements. Relancez sans --permission.",
	});
	expect(result.stderr).toContain(JSON.parse(result.stdout).error.message);
	expect(await directorySnapshot(course)).toEqual(before);
});

const readOnlyCommands: [string, (directory: string) => string[]][] = [
	["inspect", (directory) => ["inspect", directory]],
	["inspect schema 1", (directory) => ["inspect", directory, "--schema", "1"]],
	["inspect blocks", (directory) => ["inspect", directory, "--blocks"]],
	["inspect text fields", (directory) => ["inspect", directory, "--text-fields"]],
	["comments list", (directory) => ["comments", "list", directory]],
	["narration status", (directory) => ["narration", "status", directory]],
	["recovery list", (directory) => ["recovery", "list", directory]],
	["help", () => ["--help"]],
	["version", () => ["--version"]],
];

it.each(readOnlyCommands)(
	"supports read-only %s with read grants alone and preserves every file",
	async (_name, args) => {
		const result = runWithGrants(false, ...args(readOnlyCourse));
		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr || result.stdout).toBe(0);
		expect(await directorySnapshot(readOnlyCourse)).toEqual(readOnlySnapshot);
	},
);

it("supports read-only edit dry run with read grants alone and preserves every file", async () => {
	const field = readOnlyField;
	const planned = runWithGrants(
		false,
		"edit",
		readOnlyCourse,
		"setText",
		"--at",
		field.nodeId,
		"--rendered",
		"--arg",
		`field=${field.field}`,
		"--arg",
		'text="Dry run"',
		"--expect-revision",
		field.fileRevision,
		"--dry-run",
		"--json",
	);
	expect(planned.error).toBeUndefined();
	expect(planned.status, planned.stderr || planned.stdout).toBe(0);
	expect(await directorySnapshot(readOnlyCourse)).toEqual(readOnlySnapshot);
});

it("exports under permissions with assessment configuration and unchanged course identity", async () => {
	const output = path.join(root, "restricted-export.zip");
	const exported = run("export", exportCourse, "--format", "html", "--output", output);
	expect(exported.error).toBeUndefined();
	expect(exported.status, exported.stderr || exported.stdout).toBe(0);
	expect(JSON.parse(exported.stdout)).toMatchObject({ ok: true, pageCount: 1 });
	const zip = new AdmZip(output);
	const page = zip
		.getEntries()
		.find(
			(entry) =>
				entry.entryName.endsWith(".html") &&
				zip.readAsText(entry).includes('id="praxity-host-config"'),
		);
	assert(page);
	const html = zip.readAsText(page);
	const match = html.match(
		/<script id="praxity-host-config" type="application\/json">([\s\S]*?)<\/script>/,
	);
	assert(match?.[1]);
	const config = JSON.parse(match[1]);
	expect(config.passMark).toBe(80);
	expect(config.scoredAssessmentIds).toHaveLength(1);
	expect(await directorySnapshot(exportCourse)).toEqual(exportSnapshot);
	await expect(
		readFile(path.join(exportCourse, ".praxity/content-identity.json")),
	).rejects.toMatchObject({ code: "ENOENT" });
});

it("exports retained drafts under permissions without changing the course", async () => {
	const output = path.join(root, "recovered-drafts");
	const exported = run("recovery", "export-drafts", readOnlyCourse, output);
	expect(exported.error).toBeUndefined();
	expect(exported.status, exported.stderr || exported.stdout).toBe(0);
	expect(JSON.parse(exported.stdout)).toEqual({
		ok: true,
		directory: output,
		files: [{ id: "recoverable", file: "lesson.prax", path: "draft-1.txt" }],
		skippedDraftFiles: [],
	});
	expect(await readFile(path.join(output, "draft-1.txt"))).toEqual(Buffer.from(draftText));
	expect(await directorySnapshot(readOnlyCourse)).toEqual(readOnlySnapshot);
});

it("refuses restricted export of a course without identity and preserves every file", async () => {
	const before = await directorySnapshot(course);
	const output = path.join(root, "missing-identity.zip");
	const refused = run("export", course, "--format", "html", "--output", output);
	expect(refused.error).toBeUndefined();
	expect(refused.status).toBe(1);
	expect(refused.stderr).toContain(
		"Export refused: course identity must be recorded or reviewed before export.",
	);
	expect(refused.stderr).toContain(`praxity identity init '${course}'`);
	expect(await directorySnapshot(course)).toEqual(before);
	await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["comments", "narration", "identity"])(
	"reports usage for %s without a subcommand under permissions",
	(command) => {
		const result = runWithGrants(false, command);
		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr || result.stdout).toBe(2);
		expect(result.stderr).not.toContain("Studio can't save");
		expect(result.stderr).not.toBe("");
	},
);

it.each(["create", "reply", "resolve", "reopen"])(
	"refuses %s after opening an existing review read-only",
	async (command) => {
		await openReviewStore(course);
		await expectRefusal("review-mutate", course, command);
	},
);

it("initializes identity durably in the unrestricted Rubato smoke command", async () => {
	const result = spawnSync(process.execPath, [entry, "identity", "init", course, "--lang", "en"], {
		encoding: "utf8",
	});
	expect(result.error).toBeUndefined();
	expect(result.status, result.stderr || result.stdout).toBe(0);
	expect(JSON.parse(result.stdout)).toEqual({ ok: true, changed: true });
	expect(result.stderr).toBe(
		"Recorded course identity in .praxity/identity/. Source files unchanged.\n",
	);
	const identity = JSON.parse(
		await readFile(path.join(course, ".praxity/identity/course.json"), "utf8"),
	);
	expect(identity.schema).toBe(1);
	expect(identity.courseId).toMatch(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
	expect(await readFile(path.join(course, "lesson.prax"), "utf8")).toBe(source);
});

it("still denies reads outside the grants", () => {
	const denied = runWithGrants(false, "read", path.join(checkout, "package.json"));
	expect(denied.error).toBeUndefined();
	expect(denied.status).toBe(1);
	expect(JSON.parse(denied.stdout).error.code).toBe("ERR_ACCESS_DENIED");
});

it.each(["invalid gitdir reference\n", `gitdir: ${path.join(checkout, ".git")}\n`])(
	"refuses before reading Git metadata %j",
	async (metadata) => {
		await writeFile(path.join(course, ".git"), metadata);
		await expectRefusal("save", course, source.replace("Original text.", "Refused text."));
	},
);
