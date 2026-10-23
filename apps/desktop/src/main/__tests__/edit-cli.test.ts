import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { editCliOutputSchema } from "../../shared/edit-cli-schema";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { runPraxityCli } from "../cli";
import { readBlockInventory } from "../operations/block-inspection";
import { OperationService } from "../operations/operation-service";

const roots: string[] = [];
const runtime = { appVersion: "test", exportAssetsDir: "unused" };
const source =
	"# Safety\r\n\r\n::: note Exit {tone=info}\r\nKeep the exit clear.\r\n:::\r\n\r\nA separate paragraph.\r\n";
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(text = source, initialize = true) {
	const root = await mkdtemp(join(tmpdir(), "o7-edit-"));
	roots.push(root);
	await writeFile(join(root, "lesson.prax"), text);
	await writeFile(join(root, "course.yaml"), "title: Test\nlessons: [lesson.prax]\n");
	if (initialize) await persistFixtureIdentity(root);
	return root;
}
async function hashes(root: string, prefix = ""): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const file = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) Object.assign(result, await hashes(root, file));
		else
			result[file] = createHash("sha256")
				.update(await readFile(join(root, file)))
				.digest("hex");
	}
	return result;
}
async function inspect(root: string, ...options: string[]) {
	const result = await runPraxityCli(["inspect", root, "--blocks", ...options], runtime);
	expect(result.exitCode, result.stderr).toBe(0);
	return JSON.parse(result.stdout);
}
const change = ["--arg", "name=tone", "--arg", "value=warning"];

it("O7 discovers edit and exposes stable inspection addresses, UUIDs, operations and typed settings", async () => {
	const root = await fixture();
	const before = await hashes(root);
	const result = await inspect(root, "--eligibility");
	expect(result.schema).toBe(1);
	const note = result.blocks.find((b: { type: string }) => b.type === "note");
	expect(note).toMatchObject({
		address: "lesson.prax#1.1",
		type: "note",
		startLine: 3,
		endLine: 5,
	});
	expect(note.nodeId).toMatch(/^[a-f0-9-]{36}$/);
	expect(note.operations).toContain("setProperty");
	expect(note.settings.tone).toMatchObject({
		type: "enum",
		value: "info",
		values: expect.arrayContaining(["warning"]),
	});
	expect(await inspect(root, "--eligibility")).toEqual(result);
	expect(await hashes(root)).toEqual(before);
});
it("O7 move keeps every moved ID without creating review metadata", async () => {
	const root = await fixture();
	const before = await inspect(root);
	const note = before.blocks.find((b: { type: string }) => b.type === "note");
	const result = await runPraxityCli(
		["edit", root, "moveBlocks", "--at", note.address, "--arg", "direction=down", "--json"],
		runtime,
	);
	expect(result.exitCode, result.stderr).toBe(0);
	const after = await inspect(root);
	expect(after.blocks.find((b: { type: string }) => b.type === "note").nodeId).toBe(note.nodeId);
	expect(after.blocks.map((b: { nodeId: string }) => b.nodeId).sort()).toEqual(
		before.blocks.map((b: { nodeId: string }) => b.nodeId).sort(),
	);
	expect(Object.keys(await hashes(root)).some((path) => path.startsWith(".praxity/review/"))).toBe(
		false,
	);
	const second = await runPraxityCli(
		["edit", root, "setProperty", "--at", note.nodeId, ...change, "--json"],
		runtime,
	);
	expect(second.exitCode, second.stderr).toBe(0);
	expect(Object.keys(await hashes(root)).some((path) => path.startsWith(".praxity/review/"))).toBe(
		false,
	);
}, 20_000);
it("O7 ambiguous find refuses without writes", async () => {
	const root = await fixture(
		`${source}\r\n::: note Exit {tone=info}\r\nKeep the exit clear.\r\n:::\r\n`,
	);
	const before = await hashes(root);
	const result = await runPraxityCli(
		["edit", root, "setProperty", "--find", "Keep the exit clear.", ...change, "--json"],
		runtime,
	);
	expect(result.exitCode).toBe(4);
	expect(JSON.parse(result.stdout)).toMatchObject({ schema: 1, ok: false, code: "ambiguous" });
	expect(await hashes(root)).toEqual(before);
});
it("O7 stale expected revision refuses with exit 5 and zero writes", async () => {
	const root = await fixture();
	const before = await hashes(root);
	const result = await runPraxityCli(
		[
			"edit",
			root,
			"setProperty",
			"--at",
			"lesson.prax#1.1",
			...change,
			"--expect-revision",
			"0".repeat(64),
			"--json",
		],
		runtime,
	);
	expect(result.exitCode).toBe(5);
	expect(JSON.parse(result.stdout)).toMatchObject({ schema: 1, ok: false, code: "stale" });
	expect(await hashes(root)).toEqual(before);
});
it("O7 R8 resolves the copied file and inclusive line range", async () => {
	const root = await fixture();
	const result = await runPraxityCli(
		["edit", root, "setProperty", "--line", "lesson.prax:3-5", ...change, "--json"],
		runtime,
	);
	expect(result.exitCode, result.stderr).toBe(0);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		source.replace("tone=info", "tone=warning"),
	);
});
it("O7 page and block resolve one-based positions", async () => {
	const root = await fixture();
	const result = await runPraxityCli(
		["edit", root, "setProperty", "--page", "Safety", "--block", "1", ...change, "--json"],
		runtime,
	);
	expect(result.exitCode, result.stderr).toBe(0);
});

it.each(["1", "Safety:2"])(
	"T3 one-lesson page selector %s preserves exact edited bytes",
	async (page) => {
		const text = "# Safety:2\r\n\r\n::: note Exit {tone=info}\r\nKeep the exit clear.\r\n:::";
		const root = await fixture(text);
		const result = await runPraxityCli(
			["edit", root, "setProperty", "--page", page, "--block", "1", ...change, "--json"],
			runtime,
		);
		expect(result.exitCode, result.stdout).toBe(0);
		expect(await readFile(join(root, "lesson.prax"))).toEqual(
			Buffer.from("# Safety:2\r\n\r\n::: note Exit {tone=warning}\r\nKeep the exit clear.\r\n:::"),
		);
	},
);

async function multiLessonFixture() {
	const root = await mkdtemp(join(tmpdir(), "edit-pages-"));
	roots.push(root);
	const lessons = ["lesson-01.prax", "lesson-02.prax", "lesson-03.prax"];

	for (const [index, file] of lessons.entries()) {
		await writeFile(
			join(root, file),
			`\uFEFF---\r\ntitle: Lesson ${index + 1}\r\n---\r\n\r\n# Start ${index + 1}\r\n\r\nOpening ${index + 1}.\r\n\r\n# Practice ${index + 1} {hideTitle}\r\n\r\n::: note Tip ${index + 1} {tone=info}\r\nKeep route ${index + 1} clear.\r\n:::`,
		);
	}
	await writeFile(join(root, "course.yaml"), `title: Test\nlessons: ${JSON.stringify(lessons)}\n`);
	await persistFixtureIdentity(root);
	return root;
}

it.each([
	[
		"en",
		'Page selector 2 matches 3 pages: lesson-01.prax:2 "Practice 1", lesson-02.prax:2 "Practice 2", lesson-03.prax:2 "Practice 3". Use one of these with --page.',
	],
	[
		"fr",
		'Le sélecteur de page 2 correspond à 3 pages : lesson-01.prax:2 "Practice 1", lesson-02.prax:2 "Practice 2", lesson-03.prax:2 "Practice 3". Utilisez une de ces valeurs avec --page.',
	],
])(
	"T3 ambiguous page lists lesson candidates in %s text and JSON without writes",
	async (language, message) => {
		const root = await multiLessonFixture();
		const before = await hashes(root);
		const args = [
			"edit",
			root,
			"setProperty",
			"--page",
			"2",
			"--block",
			"1",
			...change,
			"--lang",
			language,
		];
		const text = await runPraxityCli(args, runtime);
		expect(text.exitCode).toBe(4);
		expect(text.stderr).toBe(`${message}\n`);
		const json = await runPraxityCli([...args, "--json"], runtime);
		expect(json.exitCode).toBe(4);
		const output = JSON.parse(json.stdout);
		expect(output).toEqual({
			schema: 1,
			ok: false,
			code: "ambiguous",
			message,
			candidates: [
				{ selector: "lesson-01.prax:2", title: "Practice 1" },
				{ selector: "lesson-02.prax:2", title: "Practice 2" },
				{ selector: "lesson-03.prax:2", title: "Practice 3" },
			],
		});
		expect(editCliOutputSchema.safeParse(output).success).toBe(true);
		const missingBlockArgs = [...args];
		missingBlockArgs[missingBlockArgs.indexOf("--block") + 1] = "99";
		const missingBlock = await runPraxityCli([...missingBlockArgs, "--json"], runtime);
		expect(JSON.parse(missingBlock.stdout)).toEqual(output);
		expect(await hashes(root)).toEqual(before);
	},
);

it.each(["lesson-02.prax", "lesson-03.prax"])(
	"T3 lesson-qualified page edits only the requested bytes in %s",
	async (file) => {
		const root = await multiLessonFixture();
		const before = await hashes(root);
		const original = await readFile(join(root, file), "utf8");
		const result = await runPraxityCli(
			["edit", root, "setProperty", "--page", `${file}:2`, "--block", "1", ...change, "--json"],
			runtime,
		);
		expect(result.exitCode, result.stdout).toBe(0);
		expect(await readFile(join(root, file))).toEqual(
			Buffer.from(original.replace("tone=info", "tone=warning")),
		);
		const after = await hashes(root);
		for (const path of ["lesson-01.prax", "lesson-02.prax", "lesson-03.prax", "course.yaml"]) {
			if (path !== file) expect(after[path]).toBe(before[path]);
		}
	},
);

it("T3 repeated titles in one lesson list page selectors without counting them as lessons", async () => {
	const root = await fixture("# Repeated\n\nFirst body.\n\n# Repeated\n\nSecond body.\n");
	const before = await hashes(root);
	const result = await runPraxityCli(
		["edit", root, "setProperty", "--page", "Repeated", "--block", "1", ...change, "--json"],
		runtime,
	);
	expect(result.exitCode).toBe(4);
	expect(JSON.parse(result.stdout)).toEqual({
		schema: 1,
		ok: false,
		code: "ambiguous",
		message:
			'Page selector Repeated matches 2 pages: lesson.prax:1 "Repeated", lesson.prax:2 "Repeated". Use one of these with --page.',
		candidates: [
			{ selector: "lesson.prax:1", title: "Repeated" },
			{ selector: "lesson.prax:2", title: "Repeated" },
		],
	});
	expect(await hashes(root)).toEqual(before);
});

it.each(["escape.prax:1", "1"])(
	"T3 course admission refuses an escaping lesson symlink for page %s without writes",
	async (page) => {
		const root = await multiLessonFixture();
		const outside = await fixture();
		await symlink(join(outside, "lesson.prax"), join(root, "escape.prax"), "file");
		const before = await hashes(root);
		const outsideBefore = await hashes(outside);
		const result = await runPraxityCli(
			["edit", root, "setProperty", "--page", page, "--block", "1", ...change, "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).code).toBe("failed");
		expect(await hashes(root)).toEqual(before);
		expect(await hashes(outside)).toEqual(outsideBefore);
	},
);

it.each([
	...[
		"lesson-02.PRAX",
		"lesson-02",
		"lesson-02.prax/",
		"lesson-02.prax ",
		"LESSON-02.prax",
	].flatMap<[string, string, number, string]>((file) => [
		[`${file}:2`, "en", 3, `Lesson "${file}" was not found in the course.`],
		[`${file}:2`, "fr", 3, `La leçon "${file}" est introuvable dans le cours.`],
	]),
	["missing.prax:2", "en", 3, 'Lesson "missing.prax" was not found in the course.'],
	["missing.prax:2", "fr", 3, 'La leçon "missing.prax" est introuvable dans le cours.'],
	["lesson-02.prax:99", "en", 3, 'Page 99 was not found in lesson "lesson-02.prax".'],
	["lesson-02.prax:99", "fr", 3, 'La page 99 est introuvable dans la leçon "lesson-02.prax".'],
	[
		"lesson-02.prax:0",
		"en",
		2,
		"Use a positive whole page number after the lesson path and colon.",
	],
	[
		"lesson-02.prax:1.5",
		"en",
		2,
		"Use a positive whole page number after the lesson path and colon.",
	],
	["lesson-02.prax:", "en", 2, "Use a positive whole page number after the lesson path and colon."],
	[
		"lesson-02.prax:9007199254740992",
		"en",
		2,
		"Use a positive whole page number after the lesson path and colon.",
	],
	[
		"lesson-02.prax:0",
		"fr",
		2,
		"Après le chemin de leçon et les deux-points, utilisez un numéro de page entier et positif.",
	],
	[
		"../outside.prax:2",
		"en",
		2,
		"Use a .prax lesson path relative to the course root, without traversal, absolute paths, backslashes or colons.",
	],
	[
		"../outside.prax:2",
		"fr",
		2,
		"Utilisez un chemin de leçon .prax relatif à la racine du cours, sans remontée de dossier, chemin absolu, barre oblique inverse ni deux-points.",
	],
	[
		"/outside.prax:2",
		"en",
		2,
		"Use a .prax lesson path relative to the course root, without traversal, absolute paths, backslashes or colons.",
	],
	[
		"C:/outside.prax:2",
		"en",
		2,
		"Use a .prax lesson path relative to the course root, without traversal, absolute paths, backslashes or colons.",
	],
	[
		"units/../../outside.prax:2",
		"en",
		2,
		"Use a .prax lesson path relative to the course root, without traversal, absolute paths, backslashes or colons.",
	],
	...[
		"sub\\outside.prax:2",
		"\\\\srv\\share\\outside.prax:2",
		"\\\\?\\C:\\outside.prax:2",
		"C:\\outside.prax:2",
		"./lesson-02.prax:2",
		"lesson:02.prax:2",
	].flatMap<[string, string, number, string]>((page) => [
		[
			page,
			"en",
			2,
			"Use a .prax lesson path relative to the course root, without traversal, absolute paths, backslashes or colons.",
		],
		[
			page,
			"fr",
			2,
			"Utilisez un chemin de leçon .prax relatif à la racine du cours, sans remontée de dossier, chemin absolu, barre oblique inverse ni deux-points.",
		],
	]),
])(
	"T3 refuses unavailable or unsafe page %s in %s without writes",
	async (page, language, status, message) => {
		const root = await multiLessonFixture();
		const before = await hashes(root);
		const result = await runPraxityCli(
			[
				"edit",
				root,
				"setProperty",
				"--page",
				page,
				"--block",
				"1",
				...change,
				"--lang",
				language,
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(status);
		expect(JSON.parse(result.stdout)).toEqual({
			schema: 1,
			ok: false,
			code: status === 3 ? "orphaned" : "invalid-args",
			message,
		});
		expect(await hashes(root)).toEqual(before);
	},
);

it.each([
	["", ""],
	["---\ntitle: Test\n---\n\n", ""],
	["", " {hideTitle}"],
	["---\ntitle: Test\n---\n\n", " {hideTitle}"],
])(
	"O7 review numeric pages ignore frontmatter %j and hidden titles %j",
	async (frontmatter, hidden) => {
		const text = `${frontmatter}# First\n\n::: note First note {tone=info}\nFirst page body.\n:::\n\n# Second${hidden}\n\n::: note Second note {tone=info}\nSecond page body.\n:::\n`;
		const root = await fixture(text);
		const inventory = await inspect(root);
		expect(inventory.blocks.filter((b: { kind: string }) => b.kind === "page")).toMatchObject([
			{ page: "First", pageNumber: 1, blockNumber: null },
			{ page: "Second", pageNumber: 2, blockNumber: null },
		]);
		const result = await runPraxityCli(
			["edit", root, "setProperty", "--page", "2", "--block", "1", ...change, "--json"],
			runtime,
		);
		expect(result.exitCode, result.stdout).toBe(0);
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
			text.replace("Second note {tone=info}", "Second note {tone=warning}"),
		);
	},
	15_000,
);

it("O7 review absent, ambiguous and stale targets have distinct exit codes", async () => {
	const root = await fixture();
	const before = await hashes(root);
	const common = ["edit", root, "setProperty", ...change];
	const missing = await runPraxityCli([...common, "--at", "missing", "--json"], runtime);
	const ambiguous = await runPraxityCli([...common, "--find", "a", "--json"], runtime);
	const stale = await runPraxityCli(
		[...common, "--at", "lesson.prax#1.1", "--expect-revision", "0".repeat(64), "--json"],
		runtime,
	);
	expect(JSON.parse(missing.stdout).code).toBe("orphaned");
	expect(JSON.parse(ambiguous.stdout).code).toBe("ambiguous");
	expect(JSON.parse(stale.stdout).code).toBe("stale");
	expect(missing.exitCode).not.toBe(ambiguous.exitCode);
	expect(new Set([missing.exitCode, ambiguous.exitCode, stale.exitCode]).size).toBe(3);
	expect(await hashes(root)).toEqual(before);
});

it("O7 review French batch refusal uses French text", async () => {
	const result = await runPraxityCli(
		["edit", "unused-course", "--batch", "ops.json", "--lang", "fr", "--json"],
		runtime,
	);
	expect(JSON.parse(result.stdout).message).toBe(
		"Cette opération ou cible est indisponible. Les lots ne sont pas encore pris en charge.",
	);
});

it("O7 review French argument refusal is independent of option order", async () => {
	const common = ["edit", "unused-course", "setProperty", "--at", "lesson.prax#1.1", ...change];
	const front = await runPraxityCli([...common, "--lang", "fr", "--bogus", "--json"], runtime);
	const back = await runPraxityCli([...common, "--bogus", "--lang", "fr", "--json"], runtime);
	expect(JSON.parse(back.stdout).message).toBe(JSON.parse(front.stdout).message);
});

it.each(
	[false, true].flatMap((metadata) =>
		(
			[
				["First note", ["--page", "1", "--block", "1"]],
				["First later note", ["--page", "1", "--block", "2"]],
				["Second later note", ["--page", "2", "--block", "2"]],
				[
					"First note",
					["--line", `lesson.prax:${4 + (metadata ? 6 : 0)}-${6 + (metadata ? 6 : 0)}`],
				],
				[
					"Second later note",
					["--line", `lesson.prax:${18 + (metadata ? 6 : 0)}-${20 + (metadata ? 6 : 0)}`],
				],
			] as const
		).map(([title, selector]) => ({ metadata, title, selector })),
	),
)(
	"O7 source ordinals: $title via $selector, frontmatter=$metadata",
	async ({ metadata, title, selector }) => {
		const frontmatter = metadata ? "---\ntitle: Test\nvariables:\n  score: 0\n---\n\n" : "";
		const text = `${frontmatter}# First {hideTitle}\nnav: First label\n\n::: note First note {tone=info}\nFirst body.\n:::\n\n::: note First later note {tone=info}\nFirst later body.\n:::\n\n# Second\n\n::: note Second note {tone=info}\nSecond body.\n:::\n\n::: note Second later note {tone=info}\nSecond later body.\n:::\n`;
		const root = await fixture(text);
		const result = await runPraxityCli(
			["edit", root, "setProperty", ...selector, ...change, "--json"],
			runtime,
		);
		expect(result.exitCode, result.stdout).toBe(0);
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
			text.replace(`${title} {tone=info}`, `${title} {tone=warning}`),
		);
	},
	15_000,
);

it.each([
	["orphaned", ["--at", "missing"], 3],
	["ambiguous", ["--find", "a"], 4],
	["stale", ["--at", "lesson.prax#1.1", "--expect-revision", "0".repeat(64)], 5],
	["invalid-args", ["--bogus"], 2],
	["not-allowed", ["--batch", "ops.json"], 6],
] as const)("O7 %s returns its documented exit code", async (code, selector, exitCode) => {
	const root = await fixture();
	const before = await hashes(root);
	for (const output of [[], ["--json"]]) {
		const result = await runPraxityCli(
			["edit", root, "setProperty", ...selector, ...change, ...output],
			runtime,
		);
		expect(result.exitCode).toBe(exitCode);
		if (output.length) expect(JSON.parse(result.stdout).code).toBe(code);
		else expect(result.stderr).not.toBe("");
	}
	const help = await runPraxityCli(["edit", "--help"], runtime);
	expect(help.stdout).toContain(`${exitCode}=${code}`);
	expect(await hashes(root)).toEqual(before);
});

it.each([
	["edit", "unused-course", "setProperty", "--bogus", "--lang", "fr"],
	[
		"edit",
		"unused-course",
		"setProperty",
		"--arg",
		"name=tone",
		"--arg",
		"name=other",
		"--lang",
		"fr",
	],
	["edit", "--lang", "fr"],
	["edit", "unused-course", "setProperty", "--lang", "fr", "--at"],
] as const)("O7 early invalid arguments honor French: $0 $1 $2 $3 $4 $5", async (...args) => {
	for (const json of [false, true]) {
		const result = await runPraxityCli([...args, ...(json ? ["--json"] : [])], runtime);
		expect(result.exitCode).toBe(2);
		const message = json ? JSON.parse(result.stdout).message : result.stderr.trim();
		expect(message).toBe("Arguments de modification invalides. Utilisez praxity edit --help.");
	}
});
it("O7 dry run preserves hashes and JSON has stable keys and values", async () => {
	const root = await fixture();
	const before = await hashes(root);
	const args = [
		"edit",
		root,
		"setProperty",
		"--at",
		"lesson.prax#1.1",
		...change,
		"--dry-run",
		"--json",
	];
	const first = await runPraxityCli(args, runtime);
	expect(first.exitCode, first.stderr).toBe(0);
	const value = JSON.parse(first.stdout);
	expect(editCliOutputSchema.safeParse(value).success).toBe(true);
	expect(Object.keys(value)).toEqual([
		"schema",
		"ok",
		"dryRun",
		"operation",
		"files",
		"intent",
		"mapping",
		"summary",
		"diagnostics",
		"focus",
	]);
	expect(value).toMatchObject({
		schema: 1,
		ok: true,
		dryRun: true,
		operation: "setProperty",
		intent: "modify",
	});
	expect((await runPraxityCli(args, runtime)).stdout).toBe(first.stdout);
	expect(await hashes(root)).toEqual(before);
});
it("O7 refuses unsupported batches before applying any member", async () => {
	const root = await fixture();
	const file = join(root, "ops.json");
	await writeFile(
		file,
		JSON.stringify([
			{ operation: "setProperty", at: "lesson.prax#1.1", args: { name: "tone", value: "warning" } },
			{ operation: "deleteBlocks", at: "missing" },
		]),
	);
	const before = await hashes(root);
	const result = await runPraxityCli(["edit", root, "--batch", file, "--json"], runtime);
	expect(result.exitCode).toBe(6);
	expect(JSON.parse(result.stdout)).toMatchObject({ schema: 1, ok: false, code: "not-allowed" });
	expect(await hashes(root)).toEqual(before);
});
it("O7 preserves corrupt retired review metadata while deleting source", async () => {
	const root = await fixture();
	await mkdir(join(root, ".praxity/review"), { recursive: true });
	await writeFile(join(root, ".praxity/review/next-run.json"), '{"schema":99}');
	const result = await runPraxityCli(
		["edit", root, "deleteBlocks", "--at", "lesson.prax#1.1", "--json"],
		runtime,
	);
	expect(result.exitCode, result.stdout).toBe(0);
	expect(await readFile(join(root, ".praxity/review/next-run.json"), "utf8")).toBe('{"schema":99}');
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		"# Safety\r\n\r\nA separate paragraph.\r\n",
	);
}, 15_000);

it.each(["resolve", "apply"] as const)(
	"O7 %s checks an explicit revision inside admission",
	async (method) => {
		const root = await fixture();
		const inventory = await readBlockInventory(root);
		const selected = inventory.blocks.find((b) => b.type === "note");
		if (!selected) throw new Error("Missing fixture note");
		const expectedRevision = { path: selected.file, baseRevision: selected.fileRevision };
		await writeFile(
			join(root, "lesson.prax"),
			source.replace("A separate paragraph.", "An outside edit."),
		);
		const before = await hashes(root);
		const request = {
			transactionId: "strict-test",
			operation: "setProperty",
			files: inventory.files,
			targets: [selected.target],
			args: { name: "tone", value: "warning" },
		};
		const result = await new OperationService(root)[method](request, { expectedRevision });
		expect(result).toMatchObject({ ok: false, code: "stale" });
		expect(await hashes(root)).toEqual(before);
	},
);

it("O7 French copy and invalid arguments are structured without writes", async () => {
	const root = await fixture();
	const before = await hashes(root);
	const result = await runPraxityCli(
		["edit", root, "setProperty", "--at", "missing", ...change, "--lang", "fr", "--json"],
		runtime,
	);
	expect(JSON.parse(result.stdout)).toEqual({
		schema: 1,
		ok: false,
		code: "orphaned",
		message: "Le nœud sélectionné est introuvable.",
	});
	for (const options of [
		["--at", "lesson.prax#1.1", "--find", "Exit"],
		["--page", "Safety"],
		["--at", "lesson.prax#1.1", "--arg", "name=tone", "--arg", "name=style"],
		["--at", "lesson.prax#1.1", ...change, "--expect-revision", ""],
	]) {
		const invalid = await runPraxityCli(
			["edit", root, "setProperty", ...options, "--json"],
			runtime,
		);
		expect(invalid.exitCode).toBe(2);
		expect(editCliOutputSchema.safeParse(JSON.parse(invalid.stdout)).success).toBe(true);
		expect(JSON.parse(invalid.stdout)).toMatchObject({
			schema: 1,
			ok: false,
			code: "invalid-args",
		});
	}
	expect(await hashes(root)).toEqual(before);
});

it("O7 a new course plans without sidecars and installs identity through the service", async () => {
	const root = await fixture(source, false);
	const before = await hashes(root);
	const args = ["edit", root, "setProperty", "--at", "lesson.prax#1.1", ...change, "--json"];
	const dry = await runPraxityCli([...args, "--dry-run"], runtime);
	expect(dry.exitCode, dry.stdout).toBe(0);
	expect(await hashes(root)).toEqual(before);
	const applied = await runPraxityCli(args, runtime);
	expect(applied.exitCode, applied.stdout).toBe(0);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		source.replace("tone=info", "tone=warning"),
	);
	expect(Object.keys(await hashes(root)).some((path) => path.startsWith(".praxity/review/"))).toBe(
		false,
	);
}, 15_000);

it("O7 a replacement maps removed and new roots without review metadata", async () => {
	const root = await fixture();
	const before = await inspect(root);
	const oldId = before.blocks.find((b: { type: string }) => b.type === "note").nodeId;
	const result = await runPraxityCli(
		[
			"edit",
			root,
			"replaceBlock",
			"--at",
			oldId,
			"--arg",
			'text="A replacement paragraph."',
			"--json",
		],
		runtime,
	);
	expect(result.exitCode, result.stdout).toBe(0);
	const output = JSON.parse(result.stdout);
	expect(output.mapping).toContainEqual(expect.objectContaining({ oldId, fate: "retired" }));
	expect(output.focus.nodeId).not.toBe(oldId);
	expect(Object.keys(await hashes(root)).some((path) => path.startsWith(".praxity/review/"))).toBe(
		false,
	);
});

it("O7 block inspection localizes its own usage errors", async () => {
	const result = await runPraxityCli(["inspect", "--blocks", "--lang", "fr"], runtime);
	expect(result.exitCode).toBe(2);
	expect(JSON.parse(result.stdout)).toEqual({
		schema: 1,
		ok: false,
		code: "invalid-args",
		message:
			"Utilisation : praxity inspect <course> <--blocks|--text-fields> [--eligibility avec --blocks] [--json] [--lang en|fr].",
	});
});
