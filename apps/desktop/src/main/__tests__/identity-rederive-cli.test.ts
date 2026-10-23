import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPraxityCli } from "../cli";
import en from "../cli-messages/en.json";
import fr from "../cli-messages/fr.json";
import { identityDiagnosticLabel, loadIdentityStore } from "../identity-store";
import { createStudioProjectSession } from "../studio/project-session";

const runtime = { appVersion: "test", exportAssetsDir: "unused" };
const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(source: string) {
	const root = await mkdtemp(join(tmpdir(), "identity-rederive-"));
	roots.push(root);
	await writeFile(
		join(root, "course.yaml"),
		"title: Example\nlessons: [first.prax, second.prax]\n",
	);
	await writeFile(join(root, "first.prax"), source);
	await writeFile(join(root, "second.prax"), "# Second\n\nSurviving lesson.\n");
	expect((await runPraxityCli(["identity", "init", root], runtime)).exitCode).toBe(0);
	return root;
}
async function identityBytes(root: string, prefix = ".praxity/identity"): Promise<object> {
	const entries = await readdir(join(root, prefix), { withFileTypes: true });
	return Object.fromEntries(
		await Promise.all(
			entries.map(async (entry) => {
				const file = `${prefix}/${entry.name}`;
				return [
					file,
					entry.isDirectory()
						? await identityBytes(root, file)
						: await readFile(join(root, file), "utf8"),
				];
			}),
		),
	);
}
const init = (root: string, locale: string, ...flags: string[]) =>
	runPraxityCli(["identity", "init", root, "--lang", locale, ...flags], runtime);
it.each([en, fr])("rederive messages omit Studio: $adviceLanguageOption", (messages) => {
	for (const key of [
		"rederiveRequired",
		"mixedRederiveRequired",
		"exportRederiveAdvice",
		"rederiveWarning",
		"deletionRequired",
		"exportDeletionAdvice",
		"deletionWarning",
	] as const)
		expect(messages.identityInit[key]).not.toContain("Studio");
});

it("uses a readable type for hidden self-check descendants without exposing answers", async () => {
	const root = await fixture(
		"# First\n\n::: self-check Task\nmodel: Secret model\n:: Criterion\nmissed: Secret hint\n:::\n",
	);
	const store = await loadIdentityStore(root);
	const snapshot = store.snapshots.find((snapshot) =>
		Object.values(snapshot.nodes).some((node) => node.type === "self-check"),
	);
	if (!snapshot) throw new Error("Missing self-check fixture");
	const child = Object.entries(snapshot.nodes).find(
		([, node]) =>
			node.type === "item" &&
			node.parent !== null &&
			snapshot.nodes[node.parent].type === "self-check",
	);
	if (!child) throw new Error("Missing self-check item fixture");
	expect(identityDiagnosticLabel(snapshot.nodes, child[0])).toBe("item");
});

describe.each(["en", "fr"])("deletion in %s", (locale) => {
	describe.each(["lesson", "block"])("removed %s", (removed) => {
		let root: string;
		let before: object;
		beforeEach(async () => {
			root = await fixture("# First\n\nRemoved paragraph.\n\n## Surviving heading\n");
			if (removed === "lesson") {
				await rm(join(root, "first.prax"));
				await writeFile(join(root, "course.yaml"), "title: Example\nlessons: [second.prax]\n");
			} else await writeFile(join(root, "first.prax"), "# First\n\n## Surviving heading\n");
			before = await identityBytes(root);
		});
		it("refuses init with the deletion confirmation route, preserving identity bytes", async () => {
			const result = await init(root, locale);
			expect(result.exitCode).toBe(1);
			expect(result.stderr.toLowerCase()).toContain(
				locale === "en"
					? "removed blocks retire their ids; learner records for them stop mapping"
					: "les identifiants des blocs supprimés sont retirés",
			);
			expect(result.stderr).toContain(
				`praxity identity init '${root}' --rederive --confirm-unpublished`,
			);
			expect(result.stderr).not.toContain("Studio");
			expect(result.stderr).not.toContain("missing pending lesson");
			expect(await identityBytes(root)).toEqual(before);
		});
		it("requires confirmation with an honest deletion warning and writes nothing", async () => {
			const result = await init(root, locale, "--rederive");
			expect(result.exitCode).toBe(1);
			expect(JSON.parse(result.stdout).error.code).toBe("unpublished_confirmation_required");
			expect(result.stderr).toBe(
				locale === "en"
					? "Removed blocks retire their IDs; learner records for them stop mapping. Proceed with --confirm-unpublished only if this course has never been published.\n"
					: "Les identifiants des blocs supprimés sont retirés ; leurs données d'apprenants ne correspondent plus à ces blocs. Utilisez --confirm-unpublished uniquement si ce cours n'a jamais été publié.\n",
			);
			expect(await identityBytes(root)).toEqual(before);
		});
		it("lists saved IDs and unknown old lines before retiring them", async () => {
			const prior = await loadIdentityStore(root);
			const nodes = new Map(prior.snapshots.flatMap((snapshot) => Object.entries(snapshot.nodes)));
			const removedNode = [...nodes].find(([, node]) => node.matchText === "Removed paragraph.");
			if (!removedNode) throw new Error("Missing removed paragraph fixture");
			const [id, node] = removedNode;
			let notice = "";
			const result = await runPraxityCli(
				["identity", "init", root, "--lang", locale, "--rederive", "--confirm-unpublished"],
				{
					...runtime,
					writeIdentityNotice: async (text) => {
						notice = text;
						expect(text).toContain(id);
						expect(text).toContain(`first.prax:${locale === "en" ? "unknown" : "inconnue"}`);
						expect(text).toContain('page "First"');
						expect(text.toLowerCase()).toContain('"removed paragraph."');
						expect(text).not.toContain("Re-deriving gives blocks new IDs");
						expect(await identityBytes(root)).toEqual(before);
					},
				},
			);
			expect(result.exitCode, result.stderr).toBe(0);
			expect(notice).not.toBe("");
			const { retired } = JSON.parse(result.stdout);
			for (const block of retired) expect(notice).toContain(block.id);
			if (removed === "lesson") {
				const deleted = prior.snapshots.find((snapshot) =>
					Object.values(snapshot.nodes).some(
						(node) => node.kind === "page" && node.label === "First",
					),
				);
				if (!deleted) throw new Error("Missing deleted lesson fixture");
				expect(new Set(retired.map((block: { id: string }) => block.id))).toEqual(
					new Set(Object.keys(deleted.nodes)),
				);
				expect(notice).toContain(locale === "en" ? 'lesson "lesson"' : 'leçon "lesson"');
				expect(notice).toContain('page "First",');
				expect(
					retired.map((entry: { kind: string; label: string }) => `${entry.kind}:${entry.label}`),
				).toEqual([
					"lesson:lesson",
					"page:First",
					"part:title",
					"block:Removed paragraph.",
					"block:Surviving heading",
				]);
			}
			expect(JSON.parse(result.stdout)).toMatchObject({
				added: [],
				retired: expect.arrayContaining([
					{
						id,
						kind: "block",
						file: "first.prax",
						page: "First",
						label: "Removed paragraph.",
						line: null,
						span: {
							start: node.span.start,
							end: node.span.end,
						},
					},
				]),
			});
			const after = await loadIdentityStore(root);
			const current = Object.assign({}, ...after.snapshots.map((snapshot) => snapshot.nodes));
			for (const [savedId, saved] of nodes)
				if (
					saved.label === "Second" ||
					(removed === "block" && ["page", "lesson"].includes(saved.kind))
				)
					expect(current[savedId]).toMatchObject({ status: "active" });
		});
	});
});

describe("retirement file ordering", () => {
	let root: string;
	beforeEach(async () => {
		root = await fixture("# First\n\nRemoved paragraph.\n\n## Surviving heading\n");
		await writeFile(join(root, "third.prax"), "# Third\n\nKeep this lesson.\n");
		expect((await init(root, "en")).exitCode).toBe(0);
		await rm(join(root, "first.prax"));
		await rm(join(root, "second.prax"));
		await writeFile(join(root, "course.yaml"), "title: Example\nlessons: [third.prax]\n");
	});
	it("sorts removed lessons by file before their source spans", async () => {
		const result = await init(root, "en", "--rederive", "--confirm-unpublished");
		expect(result.exitCode, result.stderr).toBe(0);
		expect(
			JSON.parse(result.stdout).retired.map(
				(entry: { file: string; label: string }) => `${entry.file}:${entry.label}`,
			),
		).toEqual([
			"first.prax:lesson",
			"first.prax:First",
			"first.prax:title",
			"first.prax:Removed paragraph.",
			"first.prax:Surviving heading",
			"second.prax:lesson",
			"second.prax:Second",
			"second.prax:title",
			"second.prax:Surviving lesson.",
		]);
	});
});

describe.each(["en", "fr"])("mixed edit and addition in %s", (locale) => {
	let root: string;
	let before: object;
	beforeEach(async () => {
		root = await fixture(
			"# First\n\nAlpha paragraph about safety.\n\nBeta paragraph about tools.\n",
		);
		await writeFile(
			join(root, "first.prax"),
			"# First\n\nAlpha paragraph about safety rules.\n\nBrand new block.\n\nBeta paragraph about tools.\n",
		);
		before = await identityBytes(root);
	});
	it("refuses init without the Studio route", async () => {
		const result = await init(root, locale);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			`praxity identity init '${root}' --rederive --confirm-unpublished`,
		);
		expect(result.stderr).not.toContain("Studio");
		expect(await identityBytes(root)).toEqual(before);
	});
	it("distinguishes orphaned IDs from added blocks and keeps matched page and lesson IDs", async () => {
		const prior = await loadIdentityStore(root);
		const priorNodes = new Map(
			prior.snapshots.flatMap((snapshot) => Object.entries(snapshot.nodes)),
		);
		const removedNode = [...priorNodes].find(
			([, node]) => node.matchText === "Alpha paragraph about safety.",
		);
		if (!removedNode) throw new Error("Missing mixed edit fixture");
		const [oldId] = removedNode;
		const result = await init(root, locale, "--rederive", "--confirm-unpublished");
		expect(result.exitCode, result.stderr).toBe(0);
		const { retired, added } = JSON.parse(result.stdout);
		for (const block of [...retired, ...added]) expect(result.stderr).toContain(block.id);
		expect(retired).toEqual([
			expect.objectContaining({
				id: oldId,
				label: "Alpha paragraph about safety.",
				line: null,
				file: "first.prax",
				page: "First",
			}),
		]);
		expect(added.map((block: { label: string }) => block.label)).toEqual([
			"Alpha paragraph about safety rules.",
			"Brand new block.",
		]);
		const after = await loadIdentityStore(root);
		expect(after.snapshots.map((snapshot) => snapshot.lessonId).sort()).toEqual(
			prior.snapshots.map((snapshot) => snapshot.lessonId).sort(),
		);
		const afterNodes = Object.assign({}, ...after.snapshots.map((snapshot) => snapshot.nodes));
		for (const [id, node] of priorNodes)
			if (["page", "lesson"].includes(node.kind))
				expect(afterNodes[id]).toMatchObject({ status: "active" });
	});
});

describe("saved source lines", () => {
	let root: string;
	beforeEach(async () => {
		root = await fixture("# First\n\nRepeated.\n\nRepeated.\n");
		await writeFile(join(root, "first.prax"), "# First\n\nRepeated.\n");
		const studio = await createStudioProjectSession(root, "test");
		await studio.close();
	});
	it("reports exact retired lines only when the saved source hash matches", async () => {
		const result = await init(root, "en", "--rederive", "--confirm-unpublished");
		expect(result.exitCode, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout).retired).toEqual(
			expect.arrayContaining([
				// The saved and current source hashes differ, so the old line is unknown.
				expect.objectContaining({ label: "Repeated.", line: null, span: { start: 9, end: 19 } }),
			]),
		);
		expect(result.stderr).toContain('first.prax:unknown: page "First", block "Repeated."');
	});
});

// Follow-up slice: container additions need an approach review before changing subtree canonical matching.
describe.each([
	[
		"accordion",
		"::: accordion\n:: One\nShort.\n:: Two\nAlso short.\n:::\n",
		":: Three\nNew item.\n:::\n",
	],
	["choice", "::: choice Pick one?\n(x) Yes\n( ) No\n:::\n", "( ) Maybe\n:::\n"],
	["list", "- One\n- Two\n", "- One\n- Two\n- Three\n"],
])("current %s addition rewrite limit", (kind, content, replacement) => {
	let root: string;
	beforeEach(async () => {
		root = await fixture(`# First\n\n${content}`);
		await writeFile(
			join(root, "first.prax"),
			`# First\n\n${kind === "list" ? replacement : content.replace(":::\n", replacement)}`,
		);
	});
	it("requires explicit re-derivation", async () => {
		const result = await init(root, "en");
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("--rederive");
	});
	it("uses readable labels for new and retired identities", async () => {
		const confirmed = await init(root, "en", "--rederive", "--confirm-unpublished");
		expect(confirmed.exitCode).toBe(0);
		for (const block of [
			...JSON.parse(confirmed.stdout).retired,
			...JSON.parse(confirmed.stdout).added,
		]) {
			expect(block.label).not.toMatch(/^[\da-f]{8}-[\da-f-]{27}$/);
			expect(block.label.length).toBeGreaterThan(0);
		}
	});
});
