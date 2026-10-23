import {
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runPraxityCli } from "../cli";
import {
	buildCourseExportInput,
	buildExportInputFromProject,
} from "../export/build-export-input-from-project";
import { estimateProjectScorm12Storage } from "../export/export-project";
import { loadIdentityStore } from "../identity-store";
import { createStudioProjectSession } from "../studio/project-session";

const runtime = { appVersion: "test", exportAssetsDir: "unused" };
const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const defaultSource = "\uFEFF# First\r\n\r\nKeep these bytes.";
async function fixture(source = defaultSource, cleanup = roots) {
	const root = await mkdtemp(join(tmpdir(), "identity-init-"));
	cleanup.push(root);
	await writeFile(
		join(root, "course.yaml"),
		"title: Example\nlessons: [first.prax, second.prax]\n",
	);
	await writeFile(join(root, "first.prax"), source);
	await writeFile(join(root, "second.prax"), "# Second\n\nDifferent content.\n");
	return root;
}
const templates: string[] = [];
const initialized = new Map<string, string>();
// One initialization per hook keeps setup bounded; cases mutate independent copies.
function prepareInitialized(source: string) {
	beforeAll(async () => {
		const root = await fixture(source, templates);
		const result = await runPraxityCli(["identity", "init", root], runtime);
		if (result.exitCode !== 0) throw new Error(result.stderr);
		initialized.set(source, root);
	});
}
prepareInitialized(defaultSource);
prepareInitialized("# First\n\nRepeated.\n\nRepeated.\n");
beforeAll(async () => {
	await import("../studio/server");
});
afterAll(async () => {
	await Promise.all(templates.map((root) => rm(root, { recursive: true, force: true })));
});
async function initializedFixture(source = defaultSource) {
	const template = initialized.get(source);
	if (!template) throw new Error("Missing initialized template");
	const root = await mkdtemp(join(tmpdir(), "identity-init-"));
	roots.push(root);
	await cp(template, root, { recursive: true });
	return root;
}
async function files(
	root: string,
	prefix = "",
): Promise<Record<string, { bytes: string; mtime: number } | "directory">> {
	const result: Record<string, { bytes: string; mtime: number } | "directory"> = {};
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const file = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			result[file] = "directory";
			Object.assign(result, await files(root, file));
		} else {
			result[file] = {
				bytes: (await readFile(join(root, file))).toString("base64"),
				mtime: (await stat(join(root, file))).mtimeMs,
			};
		}
	}
	return result;
}
it("initializes every lesson, preserves source bytes and makes reruns a true no-op", async () => {
	const root = await fixture();
	const before = await files(root);
	const first = await runPraxityCli(["identity", "init", root], runtime);
	expect(first.exitCode).toBe(0);
	expect(first.stderr).toBe(
		"Recorded course identity in .praxity/identity/. Source files unchanged.\n",
	);
	expect(JSON.parse(first.stdout)).toEqual({ ok: true, changed: true });
	const initialized = await files(root);
	for (const [file, value] of Object.entries(before)) expect(initialized[file]).toEqual(value);
	expect(
		Object.keys(initialized).filter(
			(file) => file.startsWith(".praxity/identity/lessons/") && initialized[file] !== "directory",
		),
	).toHaveLength(2);
	const second = await runPraxityCli(["identity", "init", root], runtime);
	expect(second.exitCode).toBe(0);
	expect(JSON.parse(second.stdout)).toEqual({ ok: true, changed: false });
	expect(second.stderr).toBe("Course identity is already current. No files changed.\n");
	expect(await files(root)).toEqual(initialized);
	const french = await runPraxityCli(["identity", "init", root, "--lang", "fr"], runtime);
	expect(french.stderr).toBe("Les identités du cours sont déjà à jour. Aucun fichier modifié.\n");
});
it.each([
	[
		"en",
		"Identity initialization refused: first.prax:2 contains a source error. Fix the source, then run praxity identity init '{course}'.\n",
	],
	[
		"fr",
		"Initialisation des identités refusée : first.prax:2 contient une erreur de source. Corrigez la source, puis lancez praxity identity init '{course}'.\n",
	],
])(
	"refuses invalid source with its file and line in %s, without writes",
	async (locale, message) => {
		const root = await fixture("# First\n::: note\nUnclosed content\n");
		message = message.replace("{course}", root);
		const before = await files(root);
		const result = await runPraxityCli(["identity", "init", root, "--lang", locale], runtime);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(message);
		expect(JSON.parse(result.stdout)).toEqual({
			ok: false,
			error: { code: "identity_init_failed", message: message.trimEnd() },
		});
		expect(await files(root)).toEqual(before);
	},
);
it("records later external edits while preserving source and current node IDs", async () => {
	const root = await initializedFixture();
	expect((await runPraxityCli(["identity", "init", root], runtime)).exitCode).toBe(0);
	const { blocks: before } = JSON.parse(
		(await runPraxityCli(["inspect", root, "--blocks", "--json"], runtime)).stdout,
	);
	await writeFile(
		join(root, "first.prax"),
		"\uFEFF# First\r\n\r\nKeep these bytes.\r\n\r\nA new paragraph.",
	);
	const source = await readFile(join(root, "first.prax"));
	const result = await runPraxityCli(["identity", "init", root], runtime);
	expect(result.exitCode).toBe(0);
	expect(JSON.parse(result.stdout)).toEqual({ ok: true, changed: true });
	expect(await readFile(join(root, "first.prax"))).toEqual(source);
	const { blocks: after } = JSON.parse(
		(await runPraxityCli(["inspect", root, "--blocks", "--json"], runtime)).stdout,
	);
	for (const block of before)
		expect(after.find((entry: { nodeId: string }) => entry.nodeId === block.nodeId)).toBeDefined();
});

it.each(["en", "fr"])(
	"refuses fewer durable copies in %s without persisting pending IDs",
	async (locale) => {
		const root = await initializedFixture("# First\n\nRepeated.\n\nRepeated.\n");
		expect((await runPraxityCli(["identity", "init", root], runtime)).exitCode).toBe(0);
		await writeFile(join(root, "first.prax"), "# First\n\nRepeated.\n");
		const before = await files(root);
		const result = await runPraxityCli(["identity", "init", root, "--lang", locale], runtime);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(
			locale === "fr"
				? `Initialisation des identités refusée : first.prax:3 : plusieurs blocs enregistrés avaient ce texte et il reste moins de copies ; Praxity ne peut pas savoir laquelle vous avez supprimée. Restaurez la copie supprimée, puis lancez praxity identity init '${root}'. Si ce cours n'a jamais été publié, vous pouvez plutôt lancer cette commande avec --rederive --confirm-unpublished ; ces blocs recevront alors de nouveaux identifiants.\n`
				: `Identity initialization refused: first.prax:3: several saved blocks had this text and fewer copies remain, so Praxity can't tell which you removed. Restore the removed copy, then run praxity identity init '${root}'. If this course has never been published, you can instead run it with --rederive --confirm-unpublished; these blocks then get new IDs.\n`,
		);
		expect(await files(root)).toEqual(before);
	},
);

it.each(["missing", "corrupt"])(
	"refuses %s established identity without changing any files",
	async (state) => {
		const root = await (state === "corrupt" ? initializedFixture() : fixture());
		if (state === "missing") await writeFile(join(root, "narration.yaml"), "version: 2\n");
		else {
			expect((await runPraxityCli(["identity", "init", root], runtime)).exitCode).toBe(0);
			await writeFile(join(root, ".praxity/identity/course.json"), "{broken");
		}
		const before = await files(root);
		const rederived = await runPraxityCli(
			["identity", "init", root, "--rederive", "--confirm-unpublished"],
			runtime,
		);
		expect(rederived.exitCode).toBe(1);
		expect(await files(root)).toEqual(before);
		const result = await runPraxityCli(["identity", "init", root], runtime);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error.code).toBe("identity_init_failed");
		expect(result.stderr).toMatch(
			/^Identity: missing \.praxity\/identity\/course\.json for an established course\./,
		);
		expect(await files(root)).toEqual(before);
	},
);

describe.each([false, true])("duplicate re-derivation, saved pending=%s", (savedPending) => {
	let root: string;
	let originalIds: string[];
	beforeEach(async () => {
		root = await initializedFixture("# First\n\nRepeated.\n\nRepeated.\n");
		expect((await runPraxityCli(["identity", "init", root], runtime)).exitCode).toBe(0);
		const original = await loadIdentityStore(root);
		originalIds = original.snapshots.flatMap((snapshot) =>
			Object.entries(snapshot.nodes)
				.filter(([, node]) => node.kind === "block" && node.type === "body")
				.map(([id]) => id),
		);
		await writeFile(join(root, "first.prax"), "# First\n\nRepeated.\n");
		if (savedPending) {
			const studio = await createStudioProjectSession(root, "test");
			await studio.invoke("courseWriteLesson", {
				courseDir: root,
				filename: "first.prax",
				grammar: "# First\n\nRepeated.\n",
				expectedGrammar: "# First\n\nRepeated.\n",
			});
			await studio.close();
			expect(
				(await loadIdentityStore(root)).snapshots.some((snapshot) =>
					Object.values(snapshot.nodes).some((node) => node.status === "pending"),
				),
			).toBe(true);
		}
	});
	it("refuses plain initialization without persisting pending IDs", async () => {
		const before = await files(root);
		const plain = await runPraxityCli(["identity", "init", root], runtime);
		expect(plain.exitCode).toBe(1);
		expect(await files(root)).toEqual(before);
	});
	it("confirms retirement before writing and reruns without changes", async () => {
		const before = await files(root);
		let notices = 0;
		const result = await runPraxityCli(
			["identity", "init", root, "--rederive", "--confirm-unpublished"],
			{
				...runtime,
				writeIdentityNotice: async (text) => {
					notices++;
					expect(text).toContain("Re-deriving gives blocks new IDs.");
					expect(text).toContain('first.prax:3: page "First", block "Repeated."');
					expect(await files(root)).toEqual(before);
				},
			},
		);
		expect(result.exitCode).toBe(0);
		expect(notices).toBe(1);
		const { added } = JSON.parse(result.stdout);
		expect(added).toEqual([
			{ file: "first.prax", page: "First", line: 3, label: "Repeated.", id: expect.any(String) },
		]);
		expect(originalIds).not.toContain(added[0].id);
		const after = await files(root);
		expect(
			JSON.parse(
				(
					await runPraxityCli(
						["identity", "init", root, "--rederive", "--confirm-unpublished"],
						runtime,
					)
				).stdout,
			),
		).toEqual({ ok: true, changed: false, added: [], retired: [] });
		expect(await files(root)).toEqual(after);
	});
});

it.each(["# First\n::: note\nUnclosed\n", "# First\n\nA complete rewrite.\n"])(
	"refuses invalid source or a failed notice without writes: %s",
	async (source) => {
		const root = await initializedFixture();
		expect((await runPraxityCli(["identity", "init", root], runtime)).exitCode).toBe(0);
		await writeFile(join(root, "first.prax"), source);
		const before = await files(root);
		const result = await runPraxityCli(
			["identity", "init", root, "--rederive", "--confirm-unpublished"],
			{
				...runtime,
				writeIdentityNotice: async () => {
					throw new Error("Notice unavailable");
				},
			},
		);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			source.includes("Unclosed") ? "first.prax:2 contains a source error" : "Notice unavailable",
		);
		expect(await files(root)).toEqual(before);
	},
);

it("re-derives a rewritten lesson inventory while retaining the namespace and immutable history", async () => {
	const root = await initializedFixture();
	expect((await runPraxityCli(["identity", "init", root], runtime)).exitCode).toBe(0);
	const before = await loadIdentityStore(root);
	await rm(join(root, "first.prax"));
	await writeFile(join(root, "replacement.prax"), "# Replacement\n\nUnrelated new material.\n");
	await writeFile(
		join(root, "course.yaml"),
		"title: Example\nlessons: [replacement.prax, second.prax]\n",
	);
	const result = await runPraxityCli(
		["identity", "init", root, "--rederive", "--confirm-unpublished"],
		runtime,
	);
	expect(result.exitCode).toBe(0);
	const after = await loadIdentityStore(root);
	expect(after.course).toEqual(before.course);
	for (const head of before.heads)
		expect(
			await readFile(join(root, ".praxity/identity/snapshots", `${head.head}.json`), "utf8"),
		).toContain('"schema":1');
	expect(JSON.parse(result.stdout).added).toEqual([
		{
			file: "replacement.prax",
			page: "Replacement",
			line: 3,
			label: "Unrelated new material.",
			id: expect.any(String),
		},
	]);
});

it("preserves placeholder-shaped filenames and labels in replacement notices", async () => {
	const root = await fixture("# First\n\nLiteral {page} {label}.\n");
	await rename(join(root, "first.prax"), join(root, "lesson{line}.prax"));
	const result = await runPraxityCli(
		["identity", "init", root, "--rederive", "--confirm-unpublished"],
		runtime,
	);
	expect(result.exitCode).toBe(0);
	expect(result.stderr).toContain(
		'lesson{line}.prax:3: page "First", block "Literal {page} {label}."',
	);
});

it.each([
	[],
	["--lang", "de"],
	["--lang", "en", "--lang", "fr"],
	["extra"],
	["--confirm-unpublished"],
	["--rederive", "--rederive"],
])("refuses invalid arguments: $0 $1 $2 $3", async (...extra) => {
	const root = await fixture();
	const args = extra.length ? [root, ...extra] : [];
	const result = await runPraxityCli(["identity", "init", ...args], runtime);
	expect(result.exitCode).toBe(2);
	expect(JSON.parse(result.stdout).error.code).toBe("invalid_arguments");
	expect(result.stderr).toBe(
		"Usage: praxity identity init <course> [--rederive --confirm-unpublished] [--lang en|fr]\n",
	);
});

it.each(["en", "fr"])("preserves placeholder text in source filenames in %s", async (locale) => {
	const root = await fixture();
	await rename(join(root, "first.prax"), join(root, "lesson{line}{course}.prax"));
	await writeFile(join(root, "lesson{line}{course}.prax"), "# First\n::: note\nUnclosed\n");
	const before = await files(root);
	const result = await runPraxityCli(["identity", "init", root, "--lang", locale], runtime);
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain("lesson{line}{course}.prax:2");
	expect(await files(root)).toEqual(before);
});

it.each([
	["course", buildCourseExportInput],
	["lesson", buildExportInputFromProject],
] as const)("defaults %s to a read without changing .praxity bytes", async (_scope, build) => {
	const root = await fixture();
	await mkdir(join(root, ".praxity"));
	await writeFile(join(root, ".praxity", "keep.txt"), "unrelated metadata\r\n");
	const options = {
		projectDir: root,
		completionThreshold: 0,
		viewerVersionPath: "unused",
		loadAssets: false,
	};
	const fresh = await files(root);
	await expect(build(options)).rejects.toMatchObject({ code: "EIDENTITY" });
	expect(await files(root)).toEqual(fresh);
	expect((await runPraxityCli(["identity", "init", root], runtime)).exitCode).toBe(0);
	const initialized = await files(root);
	await build(options);
	expect(await files(root)).toEqual(initialized);
	await writeFile(join(root, "second.prax"), "# Changed\n\nNew text.\n");
	const edited = await files(root);
	await expect(build(options)).rejects.toMatchObject({ code: "EIDENTITY" });
	expect(await files(root)).toEqual(edited);
});

it("storage estimation refuses transient identity without writing", async () => {
	const root = await fixture();
	const before = await files(root);
	await expect(
		estimateProjectScorm12Storage({ projectDir: root, exportAssetsDir: "unused", scope: "course" }),
	).rejects.toMatchObject({ code: "EIDENTITY" });
	expect(await files(root)).toEqual(before);
});

it.each([
	["en", "Studio needs a plain copy of .praxity."],
	["fr", "Studio a besoin d'une copie ordinaire de .praxity."],
])(
	"localizes linked-store recovery in %s without changing either course",
	async (locale, message) => {
		const root = await fixture();
		const outside = await fixture();
		const before = await files(outside);
		await symlink(outside, join(root, ".praxity"), "junction");
		const result = await runPraxityCli(["identity", "init", root, "--lang", locale], runtime);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(message);
		expect(await files(outside)).toEqual(before);
		await rm(join(root, ".praxity"));
	},
);

describe("Studio identity parity", () => {
	const source =
		"# First\n\n::: note\nA note.\n:::\n\n- One\n- Two\n\nRepeated.\n\nRepeated.\n\n# Next\n\nMore.\n";
	prepareInitialized(source);
	let root: string;
	beforeEach(async () => {
		root = await initializedFixture(source);
		expect((await runPraxityCli(["identity", "init", root], runtime)).exitCode).toBe(0);
	});
	it("initializes the same identity structure as Studio", async () => {
		const studioRoot = await fixture(source);
		const studio = await createStudioProjectSession(studioRoot, "test");
		await studio.close();
		const normalize = async (course: string) => {
			const store = await loadIdentityStore(course);
			const ids = new Map<string, string>();
			if (!store.course) throw new Error("Missing course identity");
			ids.set(store.course.courseId, "course");
			for (const head of store.heads) {
				const snapshot = JSON.parse(
					await readFile(join(course, ".praxity/identity/snapshots", `${head.head}.json`), "utf8"),
				) as (typeof store.snapshots)[number];
				ids.set(head.head, `head:${head.path}`);
				for (const [id, node] of Object.entries(snapshot.nodes))
					ids.set(
						id,
						`${head.path}:${node.kind}:${node.type}:${node.span.start}:${node.span.end}:${node.order}`,
					);
			}
			const replace = (value: unknown): unknown => {
				if (typeof value === "string") return ids.get(value) ?? value;
				if (Array.isArray(value)) return value.map(replace);
				if (value && typeof value === "object")
					return Object.fromEntries(
						Object.entries(value).map(([key, item]) => [ids.get(key) ?? key, replace(item)]),
					);
				return value;
			};
			const normalized = replace(store) as typeof store;
			normalized.heads.sort((a, b) => a.path.localeCompare(b.path));
			normalized.snapshots.sort((a, b) => a.lessonId.localeCompare(b.lessonId));
			return normalized;
		};
		expect(await normalize(root)).toEqual(await normalize(studioRoot));
	});
	it("leaves CLI-initialized identity unchanged when Studio opens it", async () => {
		const before = await files(root);
		const session = await createStudioProjectSession(root, "test");
		try {
			expect(await files(root)).toEqual(before);
		} finally {
			await session.close();
		}
	});
});
