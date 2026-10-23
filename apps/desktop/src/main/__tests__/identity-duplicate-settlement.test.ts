import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type IdentityNode,
	isDurableIdentity,
	resolveIdentity,
	serializeIdentity,
} from "@praxity/content-identity";
import { readLesson } from "@praxity/grammar";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { projectDiskSnapshot } from "../../test-utils/interrupted-project-write";
import { runPraxityCli } from "../cli";
import {
	CourseIdentitySession,
	loadIdentityStore,
	persistCourseIdentity,
	resolveCourseIdentity,
} from "../identity-store";
import { resolveLessonSources, resolveLessonSourcesForWrite } from "../lesson-source";
import { OperationService } from "../operations/operation-service";
import { withProjectFileTransaction } from "../project-file-transactions";
import { createStudioProjectSession } from "../studio/project-session";
import { openReviewStore } from "../studio/review-store";

const runtime = { appVersion: "test", exportAssetsDir: "unused" };
const base = "# First\n\nRepeated.\n\nOther subject.\n";
const duplicate = `${base}\nRepeated.\n`;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const init = (root: string) => runPraxityCli(["identity", "init", root], runtime);
const nodes = async (root: string): Promise<Record<string, IdentityNode>> =>
	Object.assign({}, ...(await loadIdentityStore(root)).snapshots.map((s) => s.nodes));
async function legacyPendingStore(root: string) {
	const prior = await loadIdentityStore(root);
	// Reproduce saved pending stores from the former open behavior, before entering transient Studio.
	const legacy = resolveIdentity(
		{
			course: prior.course ?? undefined,
			priorHeads: prior.heads,
			priorSnapshots: prior.snapshots,
			parsedDocuments: await Promise.all(
				prior.heads.map(async ({ path }) => ({
					path,
					tree: readLesson(await readFile(join(root, path), "utf8")).tree,
				})),
			),
			readerRoles: true,
		},
		{ allocateId: randomUUID, digest },
	);
	for (const snapshot of legacy.snapshots) {
		const text = serializeIdentity(snapshot);
		await writeFile(join(root, ".praxity/identity/snapshots", `${digest(text)}.json`), text);
		const head = legacy.heads.find((head) => head.head === digest(text));
		if (!head) throw new Error("Missing legacy head");
		await writeFile(
			join(root, ".praxity/identity/lessons", `${snapshot.lessonId}.json`),
			serializeIdentity(head),
		);
	}
	await writeFile(join(root, ".praxity/identity/course.json"), serializeIdentity(legacy.course));
	await loadIdentityStore(root);
}

const second = "# Second\n\nSecond body.\n";
const copies = "# First\n\nRepeated.\n\nOld subject.\n\nRepeated.\n";
const note = "::: note\nInside.\n:::\n";
const copyMoves = [
	[
		"leaf across lessons",
		[copies, second],
		["# First\n\nRepeated.\n\nOld subject.\n", `${second}\nRepeated.\n`],
	],
	[
		"leaf across pages",
		[`${copies}\n# Third\n\nThird body.\n`, second],
		["# First\n\nRepeated.\n\nOld subject.\n\n# Third\n\nThird body.\n\nRepeated.\n", second],
	],
	[
		"move into an earlier file",
		[second, copies],
		[`${second}\nRepeated.\n`, "# First\n\nRepeated.\n\nOld subject.\n"],
	],
	[
		"move the original copy",
		[copies, second],
		["# First\n\nOld subject.\n\nRepeated.\n", "# Second\n\nRepeated.\n\nSecond body.\n"],
	],
	[
		"move into a new container",
		[copies, second],
		["# First\n\nRepeated.\n\nOld subject.\n\n::: note\nRepeated.\n:::\n", second],
	],
	[
		"move into a saved container, CR3 limit retires only the rewritten container",
		[`${copies}\n::: note\nInside note.\n:::\n`, second],
		["# First\n\nRepeated.\n\nOld subject.\n\n::: note\nInside note.\n\nRepeated.\n:::\n", second],
		"Inside note.",
	],
	[
		"move out of a saved container, CR3 limit retires only the rewritten container",
		["# First\n\n::: note\nRepeated.\n\nRepeated.\n:::\n\nOld subject.\n", second],
		["# First\n\n::: note\nRepeated.\n:::\n\nOld subject.\n\nRepeated.\n", second],
		"Repeated. Repeated.",
	],
	[
		"copy in lesson two moved into lesson one",
		["# First\n\nRepeated.\n\nOld subject.\n", "# Second\n\nRepeated.\n\nSecond body.\n"],
		[copies, second],
	],
	["three copies", [`${copies}\nRepeated.\n`, second], [copies, `${second}\nRepeated.\n`]],
	[
		"container across lessons",
		[`# First\n\n${note}\nOld subject.\n\n${note}`, second],
		[`# First\n\n${note}\nOld subject.\n`, `${second}\n${note}`],
	],
	[
		"container across pages",
		[`# First\n\n${note}\nOld subject.\n\n${note}\n# Third\n\nThird body.\n`, second],
		[`# First\n\n${note}\nOld subject.\n\n# Third\n\nThird body.\n\n${note}`, second],
	],
] satisfies [string, [string, string], [string, string], string?][];

it.each(copyMoves)(
	"plain init preserves durable copy IDs after %s",
	async (_, before, after, rewritten = undefined) => {
		const root = await mkdtemp(join(tmpdir(), "identity-moved-copies-"));
		roots.push(root);
		await writeFile(join(root, "course.yaml"), "title: Example\nlessons: [a.prax, b.prax]\n");
		const write = async (sources: [string, string]) => {
			await writeFile(join(root, "a.prax"), sources[0]);
			await writeFile(join(root, "b.prax"), sources[1]);
		};
		await write(before);
		await cp(await initializedTemplate({ "a.prax": before[0], "b.prax": before[1] }), root, {
			recursive: true,
		});
		expect((await init(root)).exitCode).toBe(0);
		const original = await nodes(root);
		await write(after);
		const beforeRefusal = rewritten ? await projectDiskSnapshot(root) : undefined;
		const initialized = await init(root);
		if (rewritten) {
			expect(initialized.exitCode).toBe(1);
			expect(JSON.parse(initialized.stdout).error.message).toBe(
				`Identity initialization refused: existing blocks could not be matched. Run praxity identity init '${root}' --rederive --confirm-unpublished only if this course has never been published.`,
			);
			expect(await nodes(root)).toEqual(original);
			expect(await projectDiskSnapshot(root)).toEqual(beforeRefusal);
			expect(await readFile(join(root, "a.prax"), "utf8")).toBe(after[0]);
			expect(await readFile(join(root, "b.prax"), "utf8")).toBe(after[1]);
			const retiredIds = Object.entries(original)
				.filter(
					([, node]) =>
						node.matchText === rewritten &&
						node.parent !== null &&
						original[node.parent].kind === "page",
				)
				.map(([id]) => id);
			expect(retiredIds).toHaveLength(1);
			const confirmed = await runPraxityCli(
				["identity", "init", root, "--rederive", "--confirm-unpublished"],
				runtime,
			);
			expect(confirmed.exitCode, confirmed.stderr).toBe(0);
			expect(JSON.parse(confirmed.stdout).retired.map((node: { id: string }) => node.id)).toEqual(
				retiredIds,
			);
		} else {
			expect(initialized.exitCode, initialized.stderr).toBe(0);
		}
		const stored = await nodes(root);
		for (const [id, node] of Object.entries(original)) {
			expect(stored[id].status).toBe(
				node.matchText === rewritten &&
					node.parent !== null &&
					original[node.parent].kind === "page"
					? "retired"
					: "active",
			);
			if (
				node.parent &&
				original[node.parent].kind === "block" &&
				original[node.parent].matchText !== rewritten
			)
				expect(stored[id].parent).toBe(node.parent);
		}
		expect(
			Object.values(stored)
				.filter((node) => node.status === "retired")
				.map((node) => node.matchText),
		).toEqual(rewritten ? [rewritten] : []);
		expect(Object.values(stored).filter((node) => node.status === "pending")).toEqual([]);
		expect((await init(root)).stdout.trim()).toBe('{"ok":true,"changed":false}');
	},
);

describe.each([
	["no frontmatter", "", "", "Second"],
	["shared page titles", "---\ntitle: Lesson A\n---\n\n", "---\ntitle: Lesson B\n---\n\n", "First"],
	["distinct titles", "---\ntitle: Lesson A\n---\n\n", "---\ntitle: Lesson B\n---\n\n", "Second"],
])("two pending lessons, %s", (_, a, b, title) => {
	const templates: string[] = [];
	const first = `${a}# First\n\nRepeated.\n`;
	const second = `${b}# ${title}\n\nOther.\n`;
	let template: string;
	let original: Record<string, IdentityNode>;
	let root: string;
	beforeAll(async () => {
		template = await mkdtemp(join(tmpdir(), "identity-two-pending-template-"));
		templates.push(template);
		await writeFile(join(template, "course.yaml"), "title: Example\nlessons: [a.prax, b.prax]\n");
		await writeFile(join(template, "a.prax"), first);
		await writeFile(join(template, "b.prax"), second);
		await cp(await initializedTemplate({ "a.prax": first, "b.prax": second }), template, {
			recursive: true,
		});
		expect((await init(template)).exitCode).toBe(0);
		original = await nodes(template);
		await writeFile(join(template, "a.prax"), `${first}\nRepeated.\n`);
		await writeFile(join(template, "b.prax"), `${second}\nOther.\n`);
		await legacyPendingStore(template);
		const beforeOpen = await projectDiskSnapshot(template);
		await (await createStudioProjectSession(template, "test")).close();
		expect(await projectDiskSnapshot(template)).toEqual(beforeOpen);
	});
	afterAll(async () => {
		await Promise.all(templates.map((path) => rm(path, { recursive: true, force: true })));
	});
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "identity-two-pending-lessons-"));
		roots.push(root);
		await cp(template, root, { recursive: true });
	});
	it.each(["en", "fr"])(
		"plain init settles a Studio open after both extras are removed, %s",
		async (lang) => {
			expect(
				Object.values(await nodes(root)).filter(
					(node) => node.kind === "lesson" && node.status === "pending",
				),
			).toHaveLength(2);
			const before = await projectDiskSnapshot(root);
			const refused = await runPraxityCli(["identity", "init", root, "--lang", lang], runtime);
			expect(refused.exitCode).toBe(1);
			expect(JSON.parse(refused.stdout), refused.stdout).toEqual({
				ok: false,
				error: {
					code: "identity_init_failed",
					message:
						lang === "fr"
							? `Initialisation des identités refusée : a.prax:${a ? 9 : 5} répète un bloc qui a déjà un identifiant ; Praxity ne peut pas savoir quelle copie le garde. Modifiez ou supprimez la copie en trop, puis lancez praxity identity init '${root}'. La copie dont le texte n'a pas changé garde l'identifiant d'origine.`
							: `Identity initialization refused: a.prax:${a ? 9 : 5} repeats a block that already has an ID, so Praxity can't tell which copy keeps it. Change or remove the extra copy, then run praxity identity init '${root}'. The copy with the unchanged text keeps the original ID.`,
				},
			});
			expect(await projectDiskSnapshot(root)).toEqual(before);
			await writeFile(join(root, "a.prax"), first);
			await writeFile(join(root, "b.prax"), second);
			const settled = await runPraxityCli(["identity", "init", root, "--lang", lang], runtime);
			expect(settled.exitCode, settled.stderr).toBe(0);
			const stored = await nodes(root);
			for (const id of Object.keys(original)) expect(stored[id].status).toBe("active");
			expect(Object.values(stored).filter((node) => node.status === "pending")).toEqual([]);
			expect((await init(root)).stdout.trim()).toBe('{"ok":true,"changed":false}');
		},
	);
});

const copyRepairs = [
	[
		"copy dropped",
		copies,
		"# First\n\nOld subject.\n",
		`${second}\nRepeated.\n`,
		"# First\n\nOld subject.\n",
		`${second}\nRepeated.\n\nRepeated.\n`,
	],
	[
		"copy added",
		copies,
		"# First\n\nRepeated.\n\nOld subject.\n",
		`${second}\nRepeated.\n\nRepeated.\n`,
		"# First\n\nOld subject.\n",
		`${second}\nRepeated.\n\nRepeated.\n`,
	],
	[
		"typo in a copy",
		copies,
		copies.replace("Old subject.\n\nRepeated.", "Old subject.\n\nRepeatedd."),
		second,
		copies,
		second,
	],
	[
		"edit inside one container",
		`# First\n\n${note}\nOld subject.\n\n${note}`,
		`# First\n\n${note}\nOld subject.\n\n::: note\nInside, changed.\n:::\n`,
		second,
		`# First\n\n${note}\nOld subject.\n`,
		`${second}\n${note}`,
	],
];

describe.each(["en", "fr"])("moved-copy repairs, %s", (lang) => {
	it.each(copyRepairs)(
		"refuses %s without writing, then plain init preserves the original copy IDs",
		async (repair, source, a, b, repairedA, repairedB) => {
			const root = await mkdtemp(join(tmpdir(), "identity-move-repair-"));
			roots.push(root);
			await writeFile(join(root, "course.yaml"), "title: Example\nlessons: [a.prax, b.prax]\n");
			await writeFile(join(root, "a.prax"), source);
			await writeFile(join(root, "b.prax"), second);
			await cp(await initializedTemplate({ "a.prax": source, "b.prax": second }), root, {
				recursive: true,
			});
			expect((await init(root)).exitCode).toBe(0);
			const original = await nodes(root);
			await writeFile(join(root, "a.prax"), a);
			await writeFile(join(root, "b.prax"), b);
			const before = await projectDiskSnapshot(root);
			const refused = await runPraxityCli(["identity", "init", root, "--lang", lang], runtime);
			expect(refused.exitCode).toBe(1);
			const position =
				repair === "copy dropped"
					? "b.prax:5"
					: repair === "edit inside one container"
						? "a.prax:4"
						: "a.prax:3";
			expect(JSON.parse(refused.stdout), refused.stdout).toEqual({
				ok: false,
				error: {
					code: "identity_init_failed",
					message:
						lang === "fr"
							? repair === "copy added"
								? `Initialisation des identités refusée : ${position} répète un bloc qui a déjà un identifiant ; Praxity ne peut pas savoir quelle copie le garde. Modifiez ou supprimez la copie en trop, puis lancez praxity identity init '${root}'. La copie dont le texte n'a pas changé garde l'identifiant d'origine.`
								: `Initialisation des identités refusée : ${position} : plusieurs blocs enregistrés avaient ce texte et il reste moins de copies ; Praxity ne peut pas savoir laquelle vous avez supprimée. Restaurez la copie supprimée, puis lancez praxity identity init '${root}'. Si ce cours n'a jamais été publié, vous pouvez plutôt lancer cette commande avec --rederive --confirm-unpublished ; ces blocs recevront alors de nouveaux identifiants.`
							: repair === "copy added"
								? `Identity initialization refused: ${position} repeats a block that already has an ID, so Praxity can't tell which copy keeps it. Change or remove the extra copy, then run praxity identity init '${root}'. The copy with the unchanged text keeps the original ID.`
								: `Identity initialization refused: ${position}: several saved blocks had this text and fewer copies remain, so Praxity can't tell which you removed. Restore the removed copy, then run praxity identity init '${root}'. If this course has never been published, you can instead run it with --rederive --confirm-unpublished; these blocks then get new IDs.`,
				},
			});
			expect(await projectDiskSnapshot(root)).toEqual(before);
			await writeFile(join(root, "a.prax"), repairedA);
			await writeFile(join(root, "b.prax"), repairedB);
			const settled = await init(root);
			expect(settled.exitCode, settled.stderr).toBe(0);
			const stored = await nodes(root);
			for (const [id, node] of Object.entries(original)) {
				expect(stored[id].status).toBe("active");
				if (node.parent && original[node.parent].kind === "block")
					expect(stored[id].parent).toBe(node.parent);
			}
			expect((await init(root)).stdout.trim()).toBe('{"ok":true,"changed":false}');
		},
	);
});

describe("temporary sibling edit history", () => {
	const templates: string[] = [];
	afterAll(async () => {
		await Promise.all(templates.map((root) => rm(root, { recursive: true, force: true })));
	});
	const source = "# First\n\nAlpha opens the lesson.\n\nRepeated.\n\nRepeated.\n\nLast anchor.\n";
	const reduced = "# First\n\nAlpha opens the lesson.\n\nRepeated.\n\nLast anchor.\n";
	let root: string;
	let donors: string[];
	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), "identity-restore-after-edit-"));
		templates.push(root);
		await writeFile(join(root, "course.yaml"), "title: Example\nlessons: [one.prax]\n");
		await writeFile(join(root, "one.prax"), source);
		await cp(await initializedTemplate({ "one.prax": source }), root, { recursive: true });
		expect((await init(root)).exitCode).toBe(0);
		const original = await nodes(root);
		donors = Object.keys(original)
			.filter((id) => original[id].kind === "block" && original[id].matchText === "Repeated.")
			.sort((a, b) => original[a].span.start - original[b].span.start);
		expect(donors).toHaveLength(2);
	});
	it("plain init restores both copies on its first run after a temporary sibling edit was saved and reverted", async () => {
		for (const next of [reduced, `${reduced}\nExtra.\n`, reduced]) {
			await writeFile(join(root, "one.prax"), next);
			await legacyPendingStore(root);
			const beforeOpen = await projectDiskSnapshot(root);
			const opened = await createStudioProjectSession(root, "test");
			await opened.close();
			expect(await projectDiskSnapshot(root)).toEqual(beforeOpen);
			const saved = await nodes(root);
			expect(donors.map((id) => saved[id].status)).toEqual(["pending", "pending"]);
		}
		await writeFile(join(root, "one.prax"), source);
		const restored = await init(root);
		expect(restored.exitCode, restored.stderr).toBe(0);
		const stored = await nodes(root);
		expect(donors.map((id) => stored[id].status)).toEqual(["active", "active"]);
		expect(
			Object.keys(stored)
				.filter(
					(id) =>
						stored[id].kind === "block" &&
						stored[id].matchText === "Repeated." &&
						stored[id].status === "active",
				)
				.sort((a, b) => stored[a].span.start - stored[b].span.start),
		).toEqual(donors);
		expect(Object.values(stored).filter((node) => node.status === "pending")).toEqual([]);
		expect(await readFile(join(root, "one.prax"), "utf8")).toBe(source);
	});
});

it("confirmed rederive restores both copies against the unchanged baseline after a refused rewrite", async () => {
	const root = await mkdtemp(join(tmpdir(), "identity-restore-refused-rewrite-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: Example\nlessons: [one.prax]\n");
	await writeFile(join(root, "one.prax"), duplicate);
	await cp(await initializedTemplate({ "one.prax": duplicate }), root, { recursive: true });
	expect((await init(root)).exitCode).toBe(0);
	const original = await nodes(root);
	const donors = Object.keys(original)
		.filter((id) => original[id].kind === "block" && original[id].matchText === "Repeated.")
		.sort((a, b) => original[a].span.start - original[b].span.start);
	expect(donors).toHaveLength(2);
	await writeFile(join(root, "one.prax"), base.replace("Other subject.", "Unrelated replacement."));
	const beforeRefusal = await projectDiskSnapshot(root);
	expect((await init(root)).exitCode).toBe(1);
	expect(await projectDiskSnapshot(root)).toEqual(beforeRefusal);
	expect(await nodes(root)).toEqual(original);
	const source = duplicate.replace("Other subject.", "Unrelated replacement.");
	await writeFile(join(root, "one.prax"), source);
	const beforeRederive = await projectDiskSnapshot(root);
	const restored = await init(root);
	expect(restored.exitCode).toBe(1);
	expect(JSON.parse(restored.stdout).error.message).toBe(
		`Identity initialization refused: existing blocks could not be matched. Run praxity identity init '${root}' --rederive --confirm-unpublished only if this course has never been published.`,
	);
	expect(await projectDiskSnapshot(root)).toEqual(beforeRederive);
	expect(await nodes(root)).toEqual(original);
	const rewritten = Object.entries(original).find(
		([, node]) => node.kind === "block" && node.matchText === "Other subject.",
	);
	if (!rewritten) throw new Error("Missing rewritten block");
	const confirmed = await runPraxityCli(
		["identity", "init", root, "--rederive", "--confirm-unpublished"],
		runtime,
	);
	expect(confirmed.exitCode, confirmed.stderr).toBe(0);
	expect(JSON.parse(confirmed.stdout).retired.map((node: { id: string }) => node.id)).toEqual([
		rewritten[0],
	]);
	const stored = await nodes(root);
	expect(stored[rewritten[0]].status).toBe("retired");
	expect(donors.map((id) => stored[id].status)).toEqual(["active", "active"]);
	expect(
		[...donors].sort((a: string, b: string) => stored[a].span.start - stored[b].span.start),
	).toEqual(donors);
	expect(Object.values(stored).filter((node) => node.status === "pending")).toEqual([]);
	expect(await readFile(join(root, "one.prax"), "utf8")).toBe(source);
});

it("plain init preserves both durable copies after adding another paragraph", async () => {
	const root = await mkdtemp(join(tmpdir(), "identity-equal-count-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: Example\nlessons: [one.prax]\n");
	await writeFile(join(root, "one.prax"), duplicate);
	await cp(await initializedTemplate({ "one.prax": duplicate }), root, { recursive: true });
	expect((await init(root)).exitCode).toBe(0);
	const original = await nodes(root);
	const donors = Object.keys(original)
		.filter((id) => original[id].kind === "block" && original[id].matchText === "Repeated.")
		.sort((a, b) => original[a].span.start - original[b].span.start);
	expect(donors).toHaveLength(2);
	const source = `${duplicate}\nAn added paragraph.\n`;
	await writeFile(join(root, "one.prax"), source);
	const initialized = await init(root);
	expect(initialized.exitCode, initialized.stderr).toBe(0);
	const stored = await nodes(root);
	expect(donors.map((id) => stored[id].status)).toEqual(["active", "active"]);
	expect(
		Object.keys(stored)
			.filter(
				(id) =>
					stored[id].kind === "block" &&
					stored[id].matchText === "Repeated." &&
					stored[id].status === "active",
			)
			.sort((a, b) => stored[a].span.start - stored[b].span.start),
	).toEqual(donors);
	expect(Object.values(stored).filter((node) => node.status === "pending")).toEqual([]);
	expect(await readFile(join(root, "one.prax"), "utf8")).toBe(source);
	expect(JSON.parse((await init(root)).stdout)).toEqual({ ok: true, changed: false });
});
const templates: string[] = [];
let pending: Awaited<ReturnType<typeof pendingTemplate>>;
beforeAll(async () => {
	pending = await pendingTemplate();
});
afterAll(async () => {
	await Promise.all(templates.map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(cleanup = roots) {
	const root = await mkdtemp(join(tmpdir(), "identity-duplicate-"));
	cleanup.push(root);
	await cp(pending.root, root, { recursive: true });
	return { root, donor: pending.donor };
}
async function pendingTemplate() {
	const root = await mkdtemp(join(tmpdir(), "identity-duplicate-"));
	templates.push(root);
	await writeFile(join(root, "course.yaml"), "title: Example\nlessons: [one.prax]\n");
	await writeFile(join(root, "one.prax"), base);
	await cp(await initializedTemplate({ "one.prax": base }), root, { recursive: true });
	expect((await init(root)).exitCode).toBe(0);
	const original = Object.entries(await nodes(root)).find(
		([, node]) => node.matchText === "Repeated.",
	);
	if (!original) throw new Error("Missing original repeated block");
	await writeFile(join(root, "one.prax"), duplicate);
	// Saved pending state comes from an author save; opening duplicates is transient.
	const session = await createStudioProjectSession(root, "test");
	try {
		await session.invoke("courseWriteLesson", {
			courseDir: root,
			filename: "one.prax",
			grammar: duplicate,
			expectedGrammar: duplicate,
		});
	} finally {
		await session.close();
	}
	return { root, donor: original[0] };
}

it("plain init refuses page IDs after removing a same-titled page and later adding a new page", async () => {
	const root = await mkdtemp(join(tmpdir(), "identity-page-copies-"));
	roots.push(root);
	const intro = "# Intro\n\nWelcome.\n";
	const x = "# Practice\n\nAlpha body one about apples and pears.\n";
	const y = "# Practice\n\nBeta body two about rivers and lakes.\n";
	const z = "# Practice\n\nGamma body three about trains and buses.\n";
	await writeFile(join(root, "course.yaml"), "title: Example\nlessons: [one.prax]\n");
	await writeFile(join(root, "one.prax"), `${intro}\n${x}\n${y}`);
	await cp(await initializedTemplate({ "one.prax": `${intro}\n${x}\n${y}` }), root, {
		recursive: true,
	});
	expect((await init(root)).exitCode).toBe(0);
	const pages = Object.entries(await nodes(root))
		.filter(([, node]) => node.kind === "page" && node.label === "Practice")
		.map(([id]) => id);
	expect(pages).toHaveLength(2);
	await writeFile(join(root, "one.prax"), `${intro}\n${y}`);
	await legacyPendingStore(root);
	const beforeRemovedOpen = await projectDiskSnapshot(root);
	await (await createStudioProjectSession(root, "test")).close();
	expect(await projectDiskSnapshot(root)).toEqual(beforeRemovedOpen);
	const removed = await nodes(root);
	expect(pages.map((id) => removed[id].status)).toEqual(["pending", "pending"]);
	await writeFile(join(root, "one.prax"), `${intro}\n${y}\n${z}`);
	await legacyPendingStore(root);
	const beforeAddedOpen = await projectDiskSnapshot(root);
	await (await createStudioProjectSession(root, "test")).close();
	expect(await projectDiskSnapshot(root)).toEqual(beforeAddedOpen);
	const before = await projectDiskSnapshot(root);
	expect((await init(root)).exitCode).toBe(1);
	expect(await projectDiskSnapshot(root)).toEqual(before);
	const added = await nodes(root);
	expect(pages.map((id) => added[id].status)).toEqual(["pending", "pending"]);
});

it.each([false, true])(
	"restores shifted durable copies directly through plain init, notes=%s",
	async (container) => {
		const root = await mkdtemp(join(tmpdir(), "identity-shifted-copies-"));
		roots.push(root);
		const repeated = container ? "::: note\nRepeated.\n\nSecond line.\n:::\n" : "Repeated.\n";
		const original = `# First\n\n${repeated}\n${repeated}\nLast anchor.\n`;
		await writeFile(join(root, "course.yaml"), "title: Example\nlessons: [one.prax]\n");
		await writeFile(join(root, "one.prax"), original);
		await cp(await initializedTemplate({ "one.prax": original }), root, { recursive: true });
		expect((await init(root)).exitCode).toBe(0);
		const initial = await nodes(root);
		await writeFile(join(root, "one.prax"), `# First\n\n${repeated}\nLast anchor.\n`);
		await (await createStudioProjectSession(root, "test")).close();
		await writeFile(join(root, "one.prax"), original);
		expect((await init(root)).exitCode).toBe(0);
		const restored = await nodes(root);
		expect(
			Object.keys(restored)
				.filter((id) => restored[id].status === "active")
				.sort(),
		).toEqual(Object.keys(initial).sort());
	},
);

describe.each(["deleteBlocks", "editSource"])("donor settlement through %s", (operation) => {
	const templates: string[] = [];
	let template: Awaited<ReturnType<typeof fixture>>;
	beforeAll(async () => {
		template = await fixture(templates);
		const opened = await createStudioProjectSession(template.root, "test");
		await opened.close();
	});
	afterAll(async () => {
		await Promise.all(templates.map((path) => rm(path, { recursive: true, force: true })));
	});
	describe.each([false, true])("replay history=%s", (replay) => {
		let root: string;
		let discarded: string[];
		let service: OperationService;
		let historyId: string;
		let settledSource: string;
		beforeAll(async () => {
			root = await mkdtemp(join(tmpdir(), "identity-duplicate-operation-"));
			templates.push(root);
			await cp(template.root, root, { recursive: true });
			const session = new CourseIdentitySession(root);
			const current = await resolveCourseIdentity(root, {
				lessonPaths: ["one.prax"],
				identitySession: session,
			});
			discarded = Object.entries(await nodes(root))
				.filter(
					([id, node]) =>
						node.status === "pending" && !isDurableIdentity(id, node, current.activeHistoryIds),
				)
				.map(([id]) => id);
			expect(discarded).toHaveLength(2);
			const copy = current.identity.sourceMappings.find((m) => m.path.join() === "0,2");
			if (!copy) throw new Error("Missing stored copy target");
			service = new OperationService(root, session, async () => undefined);
			const changed = await service.apply({
				transactionId: randomUUID(),
				operation,
				files: [{ path: "one.prax", baseRevision: digest(duplicate) }],
				targets: [
					{
						file: "one.prax",
						ref: { kind: "node", nodeId: copy.id, path: copy.path, fingerprint: copy.fingerprint },
						expectedText: duplicate.slice(copy.span.start, copy.span.end),
					},
				],
				args: operation === "editSource" ? { text: "Distinct copy.\n" } : {},
			});
			expect(changed).toMatchObject({ ok: true });
			if (!changed.ok) throw new Error("Operation refused");
			historyId = changed.historyId;
			settledSource = await readFile(join(root, "one.prax"), "utf8");
		});
		it("preserves the donor through init", async () => {
			const { donor } = template;
			const assertState = async (status: "active" | "pending") => {
				const stored = await nodes(root);
				const admitted = await resolveCourseIdentity(root, { lessonPaths: ["one.prax"] });
				expect(stored[donor].status).toBe(status);
				expect(discarded.map((id) => stored[id].status)).toEqual(["retired", "retired"]);
				expect(
					discarded.map((id) => isDurableIdentity(id, stored[id], admitted.activeHistoryIds)),
				).toEqual([false, false]);
			};
			await assertState("active");
			for (const direction of replay ? (["undo", "redo"] as const) : []) {
				expect(
					await service.historyApply({
						transactionId: randomUUID(),
						historyId,
						direction,
					}),
				).toMatchObject({ ok: true });
				await assertState(direction === "undo" ? "pending" : "active");
				expect(await readFile(join(root, "one.prax"), "utf8")).toBe(
					direction === "undo" ? duplicate : settledSource,
				);
			}
			expect((await init(root)).exitCode).toBe(0);
			await assertState("active");
		});
	});
});

it.each(["removed", "added"])(
	"restores both durable copies through init after a copy was %s",
	async (change) => {
		const root = await mkdtemp(join(tmpdir(), "identity-durable-copies-"));
		roots.push(root);
		await writeFile(join(root, "course.yaml"), "title: Example\nlessons: [one.prax]\n");
		await writeFile(join(root, "one.prax"), duplicate);
		await cp(await initializedTemplate({ "one.prax": duplicate }), root, { recursive: true });
		expect((await init(root)).exitCode).toBe(0);
		const original = await nodes(root);
		const donors = Object.entries(original)
			.filter(([, node]) => node.matchText === "Repeated.")
			.map(([id]) => id);
		expect(donors).toHaveLength(2);
		await writeFile(
			join(root, "one.prax"),
			change === "removed" ? base : `${duplicate}\nRepeated.\n`,
		);
		await legacyPendingStore(root);
		const beforeOpen = await projectDiskSnapshot(root);
		const session = await createStudioProjectSession(root, "test");
		await session.close();
		expect(await projectDiskSnapshot(root)).toEqual(beforeOpen);
		const pending = await nodes(root);
		expect(donors.map((id) => pending[id].status)).toEqual(["pending", "pending"]);
		await writeFile(join(root, "one.prax"), duplicate);
		expect((await init(root)).exitCode).toBe(0);
		const restored = await nodes(root);
		expect(donors.map((id) => restored[id].status)).toEqual(["active", "active"]);
		expect(
			Object.keys(restored)
				.filter((id) => restored[id].status === "active")
				.sort(),
		).toEqual(Object.keys(original).sort());
	},
);

// Build each initial shape on demand once, so no hook warms every case's fixture.
const initializedTemplates = new Map<string, string>();
const initializedRoots: string[] = [];
async function initializedTemplate(sources: Record<string, string>) {
	const key = JSON.stringify(sources);
	const existing = initializedTemplates.get(key);
	if (existing) return existing;
	const root = await mkdtemp(join(tmpdir(), "identity-initialized-template-"));
	initializedRoots.push(root);
	await writeFile(
		join(root, "course.yaml"),
		`title: Example\nlessons: [${Object.keys(sources).join(", ")}]\n`,
	);
	for (const [file, source] of Object.entries(sources)) await writeFile(join(root, file), source);
	const initialized = await init(root);
	expect(initialized.exitCode, initialized.stderr).toBe(0);
	initializedTemplates.set(key, root);
	return root;
}
afterAll(async () => {
	await Promise.all(initializedRoots.map((root) => rm(root, { recursive: true, force: true })));
});

const paragraph =
	"The Praxity tools run locally on your own computer, so your course files stay private.";
const anchoredSource = `# First\n\nIntro paragraph stays the same here.\n\n${paragraph}\n\nOther subject entirely different.\n`;
it.each([
	[
		"cut while note unclosed",
		`${anchoredSource.replace(`${paragraph}\n\n`, "")}\n::: note\nUnclosed.\n`,
		"\nUnclosed.\n",
	],
	["copy removed and original typo fixed", `${anchoredSource}\n${paragraph}\n`, ""],
])(
	"keeps a durable pending ID through Studio save after %s",
	async (_, intermediate, retainedText) => {
		const root = await mkdtemp(join(tmpdir(), "identity-durable-typo-"));
		roots.push(root);
		await writeFile(join(root, "course.yaml"), "title: Example\nlessons: [one.prax]\n");
		await writeFile(join(root, "one.prax"), anchoredSource);
		await cp(await initializedTemplate({ "one.prax": anchoredSource }), root, { recursive: true });
		expect((await init(root)).exitCode).toBe(0);
		const donor = Object.entries(await nodes(root)).find(
			([, node]) => node.matchText === paragraph,
		)?.[0];
		if (!donor) throw new Error("Missing paragraph");
		await writeFile(join(root, "one.prax"), intermediate);
		await legacyPendingStore(root);
		const beforeOpen = await projectDiskSnapshot(root);
		const session = await createStudioProjectSession(root, "test");
		try {
			expect(await projectDiskSnapshot(root)).toEqual(beforeOpen);
			expect((await nodes(root))[donor].status).toBe("pending");
			const retained = Object.entries(await nodes(root)).find(
				([, node]) =>
					node.kind === "block" && node.type === "body" && node.matchText === "Unclosed.",
			);
			if (retainedText)
				expect(retained?.[1]).toMatchObject({
					kind: "block",
					type: "body",
					status: "active",
					matchText: "Unclosed.",
				});
			// The legacy store made this valid paragraph durable even while its note was unclosed.
			const grammar = anchoredSource.replace("computer,", "computre,") + retainedText;
			await session.invoke("courseWriteLesson", {
				courseDir: root,
				filename: "one.prax",
				grammar,
				expectedGrammar: intermediate,
			});
			expect((await nodes(root))[donor].status).toBe("active");
			if (retained)
				expect((await nodes(root))[retained[0]]).toMatchObject({
					status: "active",
					matchText: "Unclosed.",
				});
			expect(await readFile(join(root, "one.prax"), "utf8")).toBe(grammar);
		} finally {
			await session.close();
		}
		expect((await init(root)).exitCode).toBe(0);
		expect((await nodes(root))[donor].status).toBe("active");
	},
);

it.each(["narration", "review", "retained review run"])(
	"refuses changed %s durability facts before persistence",
	async (artifact) => {
		const { root, donor } = await fixture();
		const opened = await createStudioProjectSession(root, "test");
		await opened.close();
		const store = await loadIdentityStore(root);
		const snapshot = store.snapshots[0];
		const id = Object.entries(snapshot.nodes).find(
			([id, node]) => id !== donor && node.matchText === "Repeated.",
		)?.[0];
		if (!id) throw new Error("Missing provisional ID");
		// Initialize review storage before resolution; its comments change afterwards.
		const review = artifact === "review" ? await openReviewStore(root) : undefined;
		const principal = await review?.principalFor("author", "local-preview");
		const reviewManifest = review
			? await readFile(join(root, ".praxity/reviews/manifest.json"))
			: undefined;
		await withProjectFileTransaction(
			root,
			async () => {
				const candidate = await resolveCourseIdentity(root, {
					lessonPaths: ["one.prax"],
					sources: { "one.prax": base },
				});
				if (artifact === "narration")
					await writeFile(
						join(root, "narration.yaml"),
						`version: 2\ncourseId: ${store.course?.courseId}\nlessons:\n  ${snapshot.lessonId}:\n    segments:\n      - target: {id: ${id}, role: body}\n        script: Keep this narration.\n`,
					);
				else if (review && principal) {
					expect(
						await review.create(principal, {
							reviewId: review.reviewId,
							requestId: randomUUID(),
							anchor: {
								courseId: null,
								lessonId: snapshot.lessonId,
								pageId: null,
								nodeId: id,
								blockId: null,
								revision: null,
								quote: null,
								pin: null,
								tab: null,
								revealPath: [],
								cssPath: null,
								context: { pageTitle: null, targetLabel: null },
							},
							body: "Keep this comment.",
						}),
					).toMatchObject({ ok: true });
					expect(await readFile(join(root, ".praxity/reviews/manifest.json"))).toEqual(
						reviewManifest,
					);
				} else {
					await mkdir(join(root, ".praxity/review"));
					await writeFile(
						join(root, ".praxity/review/next-run.json"),
						JSON.stringify({
							schema: 1,
							author: "Reviewer",
							createdAt: "2026-10-19T00:00:00Z",
							summaries: [{ entityId: id, summary: "Keep this comment." }],
						}),
					);
				}
				const before = await projectDiskSnapshot(root);
				await expect(persistCourseIdentity(root, candidate)).rejects.toThrow(/artifact changed/i);
				expect(await projectDiskSnapshot(root)).toEqual(before);
			},
			"write",
			false,
		);
	},
);

it.each(["journal", "head"] as const)(
	"guards artifact facts through the %s checkpoint",
	async (checkpoint) => {
		const { root, donor } = await fixture();
		const opened = await createStudioProjectSession(root, "test");
		await opened.close();
		const store = await loadIdentityStore(root);
		const snapshot = store.snapshots[0];
		const provisional = Object.entries(snapshot.nodes).find(
			([id, node]) => id !== donor && node.matchText === "Repeated.",
		)?.[0];
		if (!provisional) throw new Error("Missing provisional block");
		const path = join(root, "narration.yaml");
		// Existing bytes as well as absence are part of the issued durability facts.
		await writeFile(path, `version: 2\ncourseId: ${store.course?.courseId}\nlessons: {}\n`);
		const content = `version: 2\ncourseId: ${store.course?.courseId}\nlessons:\n  ${snapshot.lessonId}:\n    segments:\n      - target: {id: ${provisional}, role: body}\n        script: Keep this narration.\n`;
		const savedIdentity = await projectDiskSnapshot(join(root, ".praxity/identity"));
		await withProjectFileTransaction(
			root,
			async () => {
				const candidate = await resolveCourseIdentity(root, {
					lessonPaths: ["one.prax"],
					sources: { "one.prax": base },
				});
				let changed = false;
				await expect(
					persistCourseIdentity(root, candidate, [], {
						onStep: async ({ kind }) => {
							if (!changed && kind === checkpoint) {
								changed = true;
								await writeFile(path, content);
							}
						},
					}),
				).rejects.toThrow(/artifact changed/i);
				expect(changed).toBe(true);
			},
			"write",
			false,
		);
		const currentIdentity = await projectDiskSnapshot(join(root, ".praxity/identity"));
		const bytes = (files: Record<string, unknown>) =>
			Object.fromEntries(
				Object.entries(files)
					.filter(([, value]) => typeof value === "object" && value !== null && "bytes" in value)
					.map(([key, value]) => [key, (value as { bytes: string }).bytes]),
			);
		expect(bytes(currentIdentity)).toEqual(bytes(savedIdentity));
		expect(await readFile(join(root, "one.prax"), "utf8")).toBe(duplicate);
		expect(await readFile(path, "utf8")).toBe(content);
		expect((await nodes(root))[donor].status).toBe("pending");
		const fresh = await resolveLessonSourcesForWrite(root);
		const protectedNode = fresh.identity.snapshots
			.flatMap((s) => Object.entries(s.nodes))
			.find(([id]) => id === provisional)?.[1];
		if (!protectedNode) throw new Error("Missing protected block");
		expect(isDurableIdentity(provisional, protectedNode, fresh.activeHistoryIds)).toBe(true);
		expect(protectedNode.status).not.toBe("retired");
	},
);

it.each(["removed", "reworded"])(
	"settles through real Studio source save with the copy %s",
	async (change) => {
		const { root, donor } = await fixture();
		const first = await createStudioProjectSession(root, "test");
		await first.close();
		expect((await nodes(root))[donor].status).toBe("pending");
		const saved = await projectDiskSnapshot(root);
		const session = await createStudioProjectSession(root, "test");
		try {
			expect(await projectDiskSnapshot(root)).toEqual(saved);
			const grammar = change === "removed" ? base : `${base}\nA distinct copy.\n`;
			await session.invoke("courseWriteLesson", {
				courseDir: root,
				filename: "one.prax",
				grammar,
				expectedGrammar: duplicate,
			});
			const current = await nodes(root);
			expect(current[donor].status).toBe("active");
			expect(Object.values(current).filter((node) => node.status === "pending")).toEqual([]);
			expect(await readFile(join(root, "one.prax"), "utf8")).toBe(grammar);
			expect((await init(root)).exitCode).toBe(0);
			expect((await nodes(root))[donor].status).toBe("active");
		} finally {
			await session.close();
		}
	},
);

it("passes validated history to read admissions without changing the saved store", async () => {
	const { root, donor } = await fixture();
	const session = await createStudioProjectSession(root, "test");
	await session.close();
	await writeFile(join(root, "one.prax"), base);
	const saved = await projectDiskSnapshot(root);
	const read = await resolveLessonSources(root);
	expect(
		read.identity.snapshots
			.flatMap((s) => Object.entries(s.nodes))
			.find(([id]) => id === donor)?.[1].status,
	).toBe("active");
	expect(read.identity.unresolved).toEqual([]);
	expect(await projectDiskSnapshot(root)).toEqual(saved);
});

it.each(["narration", "review", "retained review run"])(
	"protects a pending ID referenced by %s",
	async (artifact) => {
		const { root, donor } = await fixture();
		const session = await createStudioProjectSession(root, "test");
		await session.close();
		const store = await loadIdentityStore(root);
		const snapshot = store.snapshots[0];
		const provisional = Object.entries(snapshot.nodes).find(
			([id, node]) => id !== donor && node.matchText === "Repeated.",
		);
		if (!provisional) throw new Error("Missing provisional block");
		const [id] = provisional;
		if (artifact === "narration") {
			await writeFile(
				join(root, "narration.yaml"),
				`version: 2\ncourseId: ${store.course?.courseId}\nlessons:\n  ${snapshot.lessonId}:\n    segments:\n      - target: {id: ${id}, role: body}\n        script: Saved narration.\n`,
			);
		} else if (artifact === "retained review run") {
			await mkdir(join(root, ".praxity/review"));
			await writeFile(
				join(root, ".praxity/review/next-run.json"),
				JSON.stringify({
					schema: 1,
					author: "Reviewer",
					createdAt: "2026-10-19T00:00:00Z",
					summaries: [{ entityId: id, summary: "Keep this comment." }],
				}),
			);
		} else {
			const review = await openReviewStore(root);
			const principal = await review.principalFor("author", "local-preview");
			expect(
				await review.create(principal, {
					reviewId: review.reviewId,
					requestId: "00000000-0000-4000-8000-000000000001",
					anchor: {
						courseId: null,
						lessonId: snapshot.lessonId,
						pageId: null,
						nodeId: id,
						blockId: null,
						revision: null,
						quote: null,
						pin: null,
						tab: null,
						revealPath: [],
						cssPath: null,
						context: { pageTitle: null, targetLabel: null },
					},
					body: "Keep this comment.",
				}),
			).toMatchObject({ ok: true });
		}
		await writeFile(join(root, "one.prax"), base);
		const read = await resolveLessonSourcesForWrite(root);
		expect(read.identity.exportable).toBe(false);
		const node = read.identity.snapshots
			.flatMap((s) => Object.entries(s.nodes))
			.find(([key]) => key === id)?.[1];
		if (!node) throw new Error("Missing protected ID");
		expect(isDurableIdentity(id, node, read.activeHistoryIds)).toBe(true);
		expect(node.status).toBe("pending");
	},
);
