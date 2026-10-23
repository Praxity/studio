import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readLesson } from "../../grammar/src/read-lesson";
import {
	type IdentityNode,
	type IdentityOperation,
	type IdentityResolution,
	isDurableIdentity,
	resolveIdentity,
	serializeIdentity,
} from "../src/index";

const base = "# First\n\nRepeated.\n\nOther subject.\n";
const duplicate = `${base}\nRepeated.\n`;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const nodes = (state: IdentityResolution): Record<string, IdentityNode> =>
	Object.assign({}, ...state.snapshots.map((s) => s.nodes));

const second = "# Second\n\nSecond body.\n";
const note = "::: note\nInside.\n:::\n";
const question = "::: choice Repeated question?\n(x) Yes\n( ) No\n:::\n";
const repeated = "# First\n\nRepeated.\n\nOld subject.\n\nRepeated.\n";
const moved = {
	"a.prax": "# First\n\nRepeated.\n\nOld subject.\n",
	"b.prax": `${second}\nRepeated.\n`,
};
const moveCases = [
	["leaf to another lesson", { "a.prax": repeated, "b.prax": second }, moved],
	[
		"leaf to another page",
		{ "a.prax": `${repeated}\n${second}` },
		{
			"a.prax": `# First\n\nRepeated.\n\nOld subject.\n\n${second}\nRepeated.\n`,
		},
	],
	[
		"leaf to an earlier file",
		{ "a.prax": "# First\n\nFirst body.\n", "b.prax": repeated },
		{
			"a.prax": "# First\n\nFirst body.\n\nRepeated.\n",
			"b.prax": "# First\n\nRepeated.\n\nOld subject.\n",
		},
	],
	[
		"leaf into a new container",
		{ "a.prax": repeated, "b.prax": second },
		{
			...moved,
			"b.prax": `${second}\n::: note\nRepeated.\n:::\n`,
		},
	],
	[
		"container and children to another lesson",
		{ "a.prax": `# First\n\n${note}\nOld subject.\n\n${note}`, "b.prax": second },
		{
			"a.prax": `# First\n\n${note}\nOld subject.\n`,
			"b.prax": `${second}\n${note}`,
		},
	],
	[
		"container and children to another page",
		{ "a.prax": `# First\n\n${note}\nOld subject.\n\n${note}\n${second}` },
		{
			"a.prax": `# First\n\n${note}\nOld subject.\n\n${second}\n${note}`,
		},
	],
	[
		"question and choices to another lesson",
		{ "a.prax": `# First\n\n${question}\nOld subject.\n\n${question}`, "b.prax": second },
		{
			"a.prax": `# First\n\n${question}\nOld subject.\n`,
			"b.prax": `${second}\n${question}`,
		},
	],
	[
		"move and unrelated rewrite",
		{ "a.prax": repeated, "b.prax": second },
		{
			...moved,
			"a.prax": moved["a.prax"].replace("Old subject.", "Unrelated replacement."),
		},
	],
	[
		"three copies with one moved",
		{ "a.prax": `${repeated}\nRepeated.\n`, "b.prax": second },
		{
			"a.prax": repeated,
			"b.prax": `${second}\nRepeated.\n`,
		},
	],
] satisfies [string, Record<string, string>, Record<string, string>][];

function fixture(
	sources: Record<string, string> = { "one.prax": base },
	reverseIds = false,
	readerRoles = false,
) {
	let sequence = 0;
	const dependencies = {
		digest,
		allocateId: () => {
			sequence++;
			return `00000000-0000-4000-8000-${String(reverseIds ? 10000 - sequence : sequence).padStart(12, "0")}`;
		},
	};
	const documents = (input: Record<string, string>) =>
		Object.entries(input).map(([path, source]) => ({
			path,
			tree: readLesson(source).tree,
		}));
	const initial = resolveIdentity(
		{ priorSnapshots: [], parsedDocuments: documents(sources), readerRoles },
		dependencies,
	);
	const activeHistoryIds = new Set(
		Object.entries(nodes(initial))
			.filter(([, node]) => node.status === "active")
			.map(([id]) => id),
	);
	const apply = (
		prior: IdentityResolution,
		next: Record<string, string>,
		operations?: IdentityOperation[],
		withHistory = true,
	) => {
		for (const [id, node] of Object.entries(nodes(prior)))
			if (node.status === "active") activeHistoryIds.add(id);
		return resolveIdentity(
			{
				course: prior.course,
				priorHeads: prior.heads,
				priorSnapshots: prior.snapshots,
				parsedDocuments: documents(next),
				readerRoles,
				activeHistoryIds: withHistory ? activeHistoryIds : undefined,
				operations,
			},
			dependencies,
		);
	};
	const donor = Object.entries(nodes(initial)).find(
		([, node]) => node.matchText === "Repeated.",
	)?.[0] as string;
	return { initial, apply, donor, activeHistoryIds };
}

describe("duplicate settlement from validated history", () => {
	it("keeps same-titled pages pending after a deletion and an addition in another lesson", () => {
		const { initial, apply } = fixture({
			"a.prax": "# Practice\n\nAlpha apples.\n\n# Practice\n\nBeta rivers.\n",
			"c.prax": "# Cee\n\nCc.\n",
		});
		const pages = initial.sourceMappings.filter(
			(m) => m.file === "a.prax" && nodes(initial)[m.id].kind === "page",
		);
		expect(pages).toHaveLength(2);
		const next = apply(initial, {
			"a.prax": "# Practice\n\nBeta rivers.\n",
			"c.prax": "# Cee\n\nCc.\n\n# Practice\n\nGamma trains.\n",
		});
		expect(pages.map(({ id }) => nodes(next)[id].status)).toEqual(["pending", "pending"]);
		expect(next.sourceMappings.filter((m) => pages.some(({ id }) => m.id === id))).toEqual([]);
		expect(next.exportable).toBe(false);
	});

	describe.each([false, true])("cross-owner groups, reader roles=%s", (readerRoles) => {
		describe.each([false, true])("reversed UUIDs=%s", (reverseIds) => {
			it.each([
				["saved case", "Z.prax", "a.prax", "b.prax", "c.prax"],
				["current case", "b.prax", "c.prax", "Y.prax", "a.prax"],
				["saved accents", "z.prax", "é.prax", "b.prax", "c.prax"],
				["current accents", "b.prax", "c.prax", "z.prax", "é.prax"],
			])("pairs moved copies in locale-independent file order, %s", (_, fromA, fromB, toA, toB) => {
				const sources = {
					[fromA]: "# Source A\n\nAnchor A.\n\nRepeated.\n",
					[fromB]: "# Source B\n\nAnchor B.\n\nRepeated.\n",
					[toA]: "# Target A\n\nAnchor C.\n",
					[toB]: "# Target B\n\nAnchor D.\n",
				};
				const { initial, apply } = fixture(sources, reverseIds, readerRoles);
				const donors = [fromA, fromB].map(
					(file) =>
						initial.sourceMappings.find(
							(m) => m.file === file && nodes(initial)[m.id].matchText === "Repeated.",
						)?.id as string,
				);
				const changed = {
					[fromA]: "# Source A\n\nAnchor A.\n",
					[fromB]: "# Source B\n\nAnchor B.\n",
					[toA]: `${sources[toA]}\nRepeated.\n`,
					[toB]: `${sources[toB]}\nRepeated.\n`,
				};
				for (const inventory of [changed, Object.fromEntries(Object.entries(changed).reverse())]) {
					const next = apply(initial, inventory);
					expect(donors.map((id) => next.sourceMappings.find((m) => m.id === id)?.file)).toEqual([
						toA,
						toB,
					]);
					expect(donors.map((id) => nodes(next)[id].status)).toEqual(["active", "active"]);
					expect(next.exportable).toBe(true);
				}
			});

			it.each(moveCases)("preserves durable IDs after %s", (_, sources, changed) => {
				const { initial, apply } = fixture(sources, reverseIds, readerRoles);
				const saved = nodes(initial);
				const copies = new Set(
					Object.keys(saved).filter(
						(id) =>
							saved[id].kind === "block" &&
							["Repeated.", "Inside.", "Repeated question? Yes No"].includes(saved[id].matchText),
					),
				);
				const originals = Object.entries(saved).filter(
					([id, node]) => copies.has(id) || (node.parent !== null && copies.has(node.parent)),
				);
				expect(originals.length).toBeGreaterThanOrEqual(2);
				const next = apply(initial, changed);
				for (const [id, original] of originals) {
					expect(nodes(next)[id].status).toBe("active");
					expect(next.exportIds).toContain(id);
					expect(next.sourceMappings.some((m) => m.id === id)).toBe(true);
					if (original.parent && ["block", "part"].includes(saved[original.parent].kind))
						expect(nodes(next)[id].parent).toBe(original.parent);
				}
				expect(next.unresolved).toEqual([]);
				expect(next.exportable).toBe(true);
				const independent = fixture(sources, reverseIds, readerRoles);
				expect(serializeIdentity(independent.apply(independent.initial, changed).snapshots)).toBe(
					serializeIdentity(next.snapshots),
				);
				expect(serializeIdentity(apply(next, changed).snapshots)).toBe(
					serializeIdentity(next.snapshots),
				);
			});

			it.each([
				[
					"earlier file",
					{ "a.prax": second, "b.prax": repeated },
					{
						"a.prax": `${second}\nRepeated.\n`,
						"b.prax": moved["a.prax"],
					},
					["b.prax:9", "a.prax:24"],
				],
				["later file", { "a.prax": repeated, "b.prax": second }, moved, ["a.prax:9", "b.prax:24"]],
				[
					"page to page",
					{ "a.prax": "# First\n\nRepeated.\n\nRepeated.\n\n# Second\n\nRepeated.\n" },
					{
						"a.prax": "# First\n\nRepeated.\n\n# Second\n\nRepeated.\n\nRepeated.\n",
					},
					["a.prax:9", "a.prax:41", "a.prax:30"],
				],
			] satisfies [string, Record<string, string>, Record<string, string>, string[]][])(
				"keeps saved owners before assigning remaining copies, %s",
				(_, sources, changed, positions) => {
					const { initial, apply } = fixture(sources, reverseIds, readerRoles);
					const donors = initial.sourceMappings.filter(
						(m) => nodes(initial)[m.id].matchText === "Repeated.",
					);
					const next = apply(initial, changed);
					expect(
						donors.map(({ id }) => {
							const mapping = next.sourceMappings.find((m) => m.id === id);
							return mapping && `${mapping.file}:${mapping.span.start}`;
						}),
					).toEqual(positions);
					expect(nodes(next)[donors[0].id].parent).toBe(nodes(initial)[donors[0].id].parent);
					expect(donors.map(({ id }) => nodes(next)[id].status)).toEqual(
						positions.map(() => "active"),
					);
				},
			);

			it.each(["added", "dropped"])(
				"keeps a move with a copy %s pending until its count is restored",
				(change) => {
					const { initial, apply } = fixture(
						{ "a.prax": repeated, "b.prax": second },
						reverseIds,
						readerRoles,
					);
					const donors = initial.sourceMappings.filter(
						(m) => nodes(initial)[m.id].matchText === "Repeated.",
					);
					const pending = apply(initial, {
						"a.prax": change === "added" ? moved["a.prax"] : "# First\n\nOld subject.\n",
						"b.prax": change === "added" ? `${second}\nRepeated.\n\nRepeated.\n` : moved["b.prax"],
					});
					expect(pending.exportable).toBe(false);
					expect(donors.map(({ id }) => nodes(pending)[id].status)).toEqual(["pending", "pending"]);
					const restored = apply(pending, {
						"a.prax": "# First\n\nOld subject.\n",
						"b.prax": `${second}\nRepeated.\n\nRepeated.\n`,
					});
					expect(donors.map(({ id }) => nodes(restored)[id].status)).toEqual(["active", "active"]);
					expect(restored.exportable).toBe(true);
				},
			);

			it.each([
				["no frontmatter", "", "", "Second"],
				[
					"shared page titles",
					"---\ntitle: Lesson A\n---\n\n",
					"---\ntitle: Lesson B\n---\n\n",
					"First",
				],
				[
					"distinct titles",
					"---\ntitle: Lesson A\n---\n\n",
					"---\ntitle: Lesson B\n---\n\n",
					"Second",
				],
			])("settles two pending lessons with %s", (_, a, b, title) => {
				const sources = {
					"a.prax": `${a}# First\n\nRepeated.\n`,
					"b.prax": `${b}# ${title}\n\nOther.\n`,
				};
				const { initial, apply } = fixture(sources, reverseIds, readerRoles);
				const pending = apply(initial, {
					"a.prax": `${sources["a.prax"]}\nRepeated.\n`,
					"b.prax": `${sources["b.prax"]}\nOther.\n`,
				});
				expect(pending.exportable).toBe(false);
				const settled = apply(pending, sources);
				expect(settled.unresolved).toEqual([]);
				expect(settled.exportable).toBe(true);
				for (const [id, node] of Object.entries(nodes(initial))) {
					if (node.kind === "lesson" || node.kind === "page")
						expect(nodes(settled)[id]).toMatchObject({
							kind: node.kind,
							parent: node.parent,
							status: "active",
						});
				}
			});
		});
	});

	it("keeps moved copies pending without history facts", () => {
		const { initial, apply } = fixture({ "a.prax": repeated, "b.prax": second });
		const pending = apply(initial, moved, undefined, false);
		expect(pending.exportable).toBe(false);
	});
	it("waits for an unresolved durable container before binding its conserved child group", () => {
		const container = "::: note\nInside.\n\nOther.\n:::\n";
		const source = `# First\n\n${container}\nOld subject.\n\n${container}`;
		const { initial, apply } = fixture({ "one.prax": source });
		const donors = initial.sourceMappings.filter(
			(m) => nodes(initial)[m.id].type === "body" && nodes(initial)[m.id].matchText === "Inside.",
		);
		expect(donors).toHaveLength(2);
		const changed = `# First\n\n${container}\nOld subject.\n\n::: note\nInside.\n\nUnrelated replacement.\n:::\n`;
		const pending = apply(initial, { "one.prax": changed });
		expect(donors.map(({ id }) => nodes(pending)[id].status)).toEqual(["pending", "pending"]);
		expect(pending.exportable).toBe(false);
	});
	it("does not bind a conserved group containing an unplaced terminal pending donor", () => {
		const { initial, apply } = fixture({ "a.prax": repeated, "b.prax": second });
		const donors = initial.sourceMappings.filter(
			(m) => nodes(initial)[m.id].matchText === "Repeated.",
		);
		const changed = {
			"a.prax": "# First\n\nOld subject.\n",
			"b.prax": `${second}\nRepeated.\n\nRepeated.\n`,
		};
		const pending = apply(initial, changed, [
			{
				intent: "modify",
				inverse: true,
				files: [
					{
						path: "a.prax",
						fromRevision: digest(repeated),
						toRevision: digest(changed["a.prax"]),
						fromSnapshot: initial.heads[0].head,
					},
				],
				mapping: [{ oldId: donors[0].id, newId: donors[0].id, fate: "pending" }],
				placements: [],
			},
		]);
		expect(donors.map(({ id }) => nodes(pending)[id].status)).toEqual(["pending", "pending"]);
		expect(pending.exportable).toBe(false);
	});
	it("refuses tied saved positions across owners", () => {
		const { initial, apply } = fixture({ "a.prax": repeated, "b.prax": second });
		const donors = initial.sourceMappings.filter(
			(m) => nodes(initial)[m.id].matchText === "Repeated.",
		);
		const first = nodes(initial)[donors[0].id];
		Object.assign(nodes(initial)[donors[1].id], { span: { ...first.span }, order: first.order });
		initial.heads[0].head = digest(serializeIdentity(initial.snapshots[0]));
		const pending = apply(initial, moved);
		expect(donors.map(({ id }) => nodes(pending)[id].status)).toEqual(["pending", "pending"]);
		expect(pending.exportable).toBe(false);
	});
	it("does not bind an identical choice group across recorded question owners", () => {
		const source =
			"# First\n\n::: choice First question\n(x) Yes\n( ) No\n( ) No\n:::\n\n::: choice Second question\n(x) Right\n( ) Wrong\n:::\n";
		const changed = source
			.replace("( ) No\n( ) No", "( ) No")
			.replace("( ) Wrong", "( ) Wrong\n( ) No");
		const { initial, apply } = fixture({ "one.prax": source });
		const owners = initial.sourceMappings.filter((m) => nodes(initial)[m.id].type === "choice");
		const donors = initial.sourceMappings.filter(
			(m) => nodes(initial)[m.id].kind === "part" && nodes(initial)[m.id].matchText === "No",
		);
		expect(owners).toHaveLength(2);
		expect(donors).toHaveLength(2);
		const pending = apply(initial, { "one.prax": changed }, [
			{
				intent: "modify",
				files: [
					{
						path: "one.prax",
						fromRevision: digest(source),
						toRevision: digest(changed),
						fromSnapshot: initial.heads[0].head,
					},
				],
				mapping: owners.map(({ id }) => ({ oldId: id, newId: id, fate: "kept" })),
				placements: owners.map((m, mappingIndex) => ({ file: m.file, path: m.path, mappingIndex })),
			},
		]);
		expect(pending.exportable).toBe(false);
		expect(donors.map(({ id }) => nodes(pending)[id].status)).toEqual(["pending", "pending"]);
	});
	describe.each([false, true])(
		"restoration after temporary edits, reader roles=%s",
		(readerRoles) => {
			describe.each([false, true])("reversed UUIDs=%s", (reverseIds) => {
				const first = "Alpha opens the lesson with a longer sentence about hills.";
				const last = "Omega closes the lesson with a longer sentence about rivers.";
				const source = `# First\n\n${first}\n\nRepeated.\n\nRepeated.\n\n${last}\n`;
				const reduced = `# First\n\n${first}\n\nRepeated.\n\n${last}\n`;
				it.each([
					["following anchor edited and reverted", reduced.replace("about rivers", "about lakes")],
					[
						"preceding anchor edited and reverted",
						reduced.replace("about hills", "about mountains"),
					],
					["anchors swapped and swapped back", `# First\n\n${last}\n\nRepeated.\n\n${first}\n`],
				])("restores both original copy IDs on the first resolution after %s", (_, temporary) => {
					const { initial, apply } = fixture({ "one.prax": source }, reverseIds, readerRoles);
					const donors = initial.sourceMappings
						.filter(
							(m) =>
								nodes(initial)[m.id].kind === "block" &&
								nodes(initial)[m.id].matchText === "Repeated.",
						)
						.map((m) => m.id);
					let pending = initial;
					for (const next of [reduced, temporary, reduced]) {
						pending = apply(pending, { "one.prax": next });
						expect(donors.map((id) => nodes(pending)[id].status)).toEqual(["pending", "pending"]);
					}
					const restored = apply(pending, { "one.prax": source });
					expect(
						restored.sourceMappings.filter((m) => donors.includes(m.id)).map((m) => m.id),
					).toEqual(donors);
					expect(donors.map((id) => nodes(restored)[id].status)).toEqual(["active", "active"]);
					expect(restored.exportable).toBe(true);
				});
			});
		},
	);
	describe.each([false, true])("equal-count groups, reader roles=%s", (readerRoles) => {
		describe.each([false, true])("reversed UUIDs=%s", (reverseIds) => {
			it.each([
				["addition", `${duplicate}\nAn added paragraph.\n`],
				["typo", duplicate.replace("Other subject.", "Other subjetc.")],
				["deletion", duplicate.replace("Other subject.\n\n", "")],
				["rewrite", duplicate.replace("Other subject.", "Unrelated replacement.")],
			])("keeps both original IDs in order after an unrelated %s", (_, source) => {
				const { initial, apply } = fixture({ "one.prax": duplicate }, reverseIds, readerRoles);
				const originals = initial.sourceMappings
					.filter(
						(m) =>
							nodes(initial)[m.id].kind === "block" &&
							nodes(initial)[m.id].matchText === "Repeated.",
					)
					.map((m) => m.id);
				const next = apply(initial, { "one.prax": source });
				expect(
					next.sourceMappings
						.filter(
							(m) =>
								nodes(next)[m.id].kind === "block" && nodes(next)[m.id].matchText === "Repeated.",
						)
						.map((m) => m.id),
				).toEqual(originals);
				expect(originals.map((id) => nodes(next)[id].status)).toEqual(["active", "active"]);
				expect(next.unresolved).toEqual([]);
			});
		});
	});

	it.each([false, true])(
		"keeps three durable copies separated by an edit, reader roles=%s",
		(readerRoles) => {
			const source = `${duplicate}\nRepeated.\n`;
			const { initial, apply } = fixture({ "one.prax": source }, true, readerRoles);
			const originals = initial.sourceMappings
				.filter(
					(m) =>
						nodes(initial)[m.id].kind === "block" && nodes(initial)[m.id].matchText === "Repeated.",
				)
				.map((m) => m.id);
			const next = apply(initial, {
				"one.prax": source.replace("Other subject.", "Unrelated replacement."),
			});
			expect(next.sourceMappings.filter((m) => originals.includes(m.id)).map((m) => m.id)).toEqual(
				originals,
			);
			expect(originals.map((id) => nodes(next)[id].status)).toEqual(["active", "active", "active"]);
			expect(next.unresolved).toEqual([]);
		},
	);

	it.each([false, true])(
		"keeps duplicated containers and their owned children after another edit, reader roles=%s",
		(readerRoles) => {
			const container = "::: note\nRepeated.\n:::\n";
			const source = `# First\n\n${container}\nOther subject.\n\n${container}`;
			const { initial, apply } = fixture({ "one.prax": source }, true, readerRoles);
			const originals = initial.sourceMappings.filter((m) => m.path[1] === 0 || m.path[1] === 2);
			const pending = apply(initial, {
				"one.prax": source.slice(0, source.lastIndexOf(container)),
			});
			for (const prior of [initial, pending]) {
				const next = apply(prior, {
					"one.prax": source.replace("Other subject.", "Unrelated replacement."),
				});
				for (const original of originals) {
					expect(next.sourceMappings.find((m) => m.path.join() === original.path.join())?.id).toBe(
						original.id,
					);
					expect(nodes(next)[original.id]).toMatchObject({
						status: "active",
						parent: nodes(initial)[original.id].parent,
					});
				}
				expect(next.unresolved).toEqual([]);
			}
		},
	);
	it.each([false, true])(
		"restores both durable copies while keeping a separate rewrite, reader roles=%s",
		(readerRoles) => {
			const { initial, apply } = fixture({ "one.prax": duplicate }, true, readerRoles);
			const originals = initial.sourceMappings
				.filter(
					(m) =>
						nodes(initial)[m.id].kind === "block" && nodes(initial)[m.id].matchText === "Repeated.",
				)
				.map((m) => m.id);
			const admitted = serializeIdentity(initial);
			const pending = apply(initial, {
				"one.prax": base.replace("Other subject.", "Unrelated replacement."),
			});
			expect(originals.map((id) => nodes(pending)[id].status)).toEqual(["pending", "pending"]);
			expect(pending.exportable).toBe(false);
			// Refused CLI initialization leaves the admitted baseline unchanged.
			expect(serializeIdentity(initial)).toBe(admitted);
			const restored = apply(initial, {
				"one.prax": duplicate.replace("Other subject.", "Unrelated replacement."),
			});
			expect(
				restored.sourceMappings.filter((m) => originals.includes(m.id)).map((m) => m.id),
			).toEqual(originals);
			expect(originals.map((id) => nodes(restored)[id].status)).toEqual(["active", "active"]);
			expect(restored.unresolved).toEqual([]);
		},
	);

	it.each(["start", "end"] as const)(
		"restores pending copies by saved span %s when sibling orders disagree or tie",
		(key) => {
			const { initial, apply } = fixture({ "one.prax": duplicate }, true);
			const originals = initial.sourceMappings
				.filter((m) => nodes(initial)[m.id].matchText === "Repeated.")
				.map((m) => m.id);
			expect(originals).toHaveLength(2);
			const pending = apply(initial, { "one.prax": base });
			const snapshot = pending.snapshots[0];
			expect(originals.map((id) => snapshot.nodes[id].status)).toEqual(["pending", "pending"]);
			// Model retained donor coordinates alongside shifted or overlapping sibling ordinals.
			snapshot.nodes[originals[0]].order = 2;
			snapshot.nodes[originals[1]].order = key === "start" ? 0 : 2;
			if (key === "end")
				snapshot.nodes[originals[1]].span.start = snapshot.nodes[originals[0]].span.start;
			pending.heads[0].head = digest(serializeIdentity(snapshot));
			const restored = apply(pending, {
				"one.prax": duplicate.replace("Other subject.", "Unrelated replacement."),
			});
			expect(
				restored.sourceMappings.filter((m) => originals.includes(m.id)).map((m) => m.id),
			).toEqual(originals);
			expect(originals.map((id) => nodes(restored)[id].status)).toEqual(["active", "active"]);
			expect(restored.unresolved).toEqual([]);
		},
	);

	it.each([false, true])(
		"keeps equal-count parts under a recorded modified owner, reader roles=%s",
		(readerRoles) => {
			const source = "# First\n\n::: fill-blank Q\nOne {answer} and {answer}.\n:::\n";
			const changed = source.replace("and {answer}.", "and {answer} and {other}.");
			const { initial, apply } = fixture({ "one.prax": source }, true, readerRoles);
			const originals = initial.sourceMappings
				.filter((m) => nodes(initial)[m.id].type === "blank")
				.map((m) => m.id);
			expect(originals).toHaveLength(2);
			const owner = initial.sourceMappings.find(
				(m) => m.id === nodes(initial)[originals[0]].parent,
			);
			if (!owner) throw new Error("Missing fill-blank body");
			const next = apply(initial, { "one.prax": changed }, [
				{
					intent: "modify",
					files: [
						{
							path: "one.prax",
							fromRevision: digest(source),
							toRevision: digest(changed),
							fromSnapshot: initial.heads[0].head,
						},
					],
					mapping: [{ oldId: owner.id, newId: owner.id, fate: "kept" }],
					placements: [{ file: "one.prax", path: owner.path, mappingIndex: 0 }],
				},
			]);
			expect(next.sourceMappings.filter((m) => originals.includes(m.id)).map((m) => m.id)).toEqual(
				originals,
			);
			expect(originals.map((id) => nodes(next)[id].status)).toEqual(["active", "active"]);
			expect(originals.map((id) => nodes(next)[id].parent)).toEqual([owner.id, owner.id]);
			expect(next.unresolved).toEqual([]);
		},
	);
	for (const readerRoles of [false, true]) {
		for (const reverseIds of [false, true]) {
			for (const container of [false, true]) {
				for (const separated of [false, true]) {
					for (const removed of [0, 1]) {
						it(`restores shifted siblings, readers=${readerRoles}, reversed=${reverseIds}, note=${container}, separated=${separated}, removed=${removed}`, () => {
							const repeated = container
								? "::: note\nRepeated.\n\nSecond line.\n:::\n"
								: "Repeated.\n";
							const gap = separated ? "\nUnrelated anchor paragraph.\n" : "";
							const source = `# First\n\n${repeated}${gap}\n${repeated}\nLast anchor.\n`;
							const { initial, apply } = fixture({ "one.prax": source }, reverseIds, readerRoles);
							const start = removed === 0 ? source.indexOf(repeated) : source.lastIndexOf(repeated);
							const reduced = source.slice(0, start) + source.slice(start + repeated.length);
							const pending = apply(initial, { "one.prax": reduced });
							const donors = initial.sourceMappings.filter(
								(m) =>
									m.path.length === 2 && nodes(initial)[m.id].matchText.startsWith("Repeated."),
							);
							expect(donors).toHaveLength(2);
							expect(donors.map(({ id }) => nodes(pending)[id].status)).toEqual([
								"pending",
								"pending",
							]);
							expect(pending.exportable).toBe(false);
							const restored = apply(pending, { "one.prax": source });
							expect(restored.exportable).toBe(true);
							expect(restored.sourceMappings.map((m) => m.id)).toEqual(
								initial.sourceMappings.map((m) => m.id),
							);
							const reopened = apply(pending, { "one.prax": reduced });
							expect(serializeIdentity(reopened.snapshots)).toBe(
								serializeIdentity(pending.snapshots),
							);
							expect(
								apply(reopened, { "one.prax": source }).sourceMappings.map((m) => m.id),
							).toEqual(initial.sourceMappings.map((m) => m.id));
						});
					}
				}
			}
		}
	}

	it("keeps an explicitly unplaced pending donor among restored-copy candidates", () => {
		const { initial, apply, donor } = fixture();
		const pending = apply(initial, { "one.prax": duplicate });
		const restored = apply(pending, { "one.prax": duplicate }, [
			{
				intent: "modify",
				inverse: true,
				files: [
					{
						path: "one.prax",
						fromRevision: digest(duplicate),
						toRevision: digest(duplicate),
						fromSnapshot: pending.heads[0].head,
					},
				],
				mapping: [{ oldId: donor, newId: donor, fate: "pending" }],
				placements: [],
			},
		]);
		expect(
			restored.unresolved.filter((u) => u.reason === "duplicate").map((u) => u.candidates),
		).toEqual([[donor], [donor], []]);
		expect(nodes(restored)[donor].status).toBe("pending");
		expect(restored.exportable).toBe(false);
	});

	it("does not settle same-titled pages after deleting one and later adding another", () => {
		const intro = "# Intro\n\nWelcome.\n";
		const x = "# Practice\n\nAlpha body one about apples and pears.\n";
		const y = "# Practice\n\nBeta body two about rivers and lakes.\n";
		const z = "# Practice\n\nGamma body three about trains and buses.\n";
		const { initial, apply } = fixture({ "one.prax": `${intro}\n${x}\n${y}` });
		const pages = initial.sourceMappings.filter((m) => nodes(initial)[m.id].label === "Practice");
		expect(pages).toHaveLength(2);
		const removed = apply(initial, { "one.prax": `${intro}\n${y}` });
		expect(pages.map(({ id }) => nodes(removed)[id].status)).toEqual(["pending", "pending"]);
		const added = apply(removed, { "one.prax": `${intro}\n${y}\n${z}` });
		expect(pages.map(({ id }) => nodes(added)[id].status)).toEqual(["pending", "pending"]);
		expect(added.exportable).toBe(false);
	});

	const finalAnchor =
		"This final anchor explains how the lesson follows the water through the forest and across the valley to the rivers.";
	it.each([
		["a fixed sibling changed", `Last anchor.\n\n${finalAnchor.replace("rivers", "lakes")}\n`, 1],
		["fixed siblings reordered", `${finalAnchor}\n\nLast anchor.\n`, 2],
		["a new sibling appeared", `Last anchor.\n\nNew content.\n\n${finalAnchor}\n`, 1],
	])("does not retain a complete saved sequence when %s", (_, tail, anchorOrder) => {
		const source = `# First\n\nRepeated.\n\nRepeated.\n\nRepeated.\n\nLast anchor.\n\n${finalAnchor}\n`;
		const { initial, apply } = fixture({ "one.prax": source });
		const anchor = initial.sourceMappings.find(
			(m) => nodes(initial)[m.id].matchText === "Last anchor.",
		);
		if (!anchor) throw new Error("Missing fixed anchor");
		const final = initial.sourceMappings.find(
			(m) => nodes(initial)[m.id].matchText === finalAnchor,
		);
		if (!final) throw new Error("Missing final anchor");
		const pending = apply(initial, { "one.prax": `# First\n\nRepeated.\n\n${tail}` });
		expect(pending.exportable).toBe(false);
		expect(nodes(initial)[anchor.id].order).toBe(3);
		expect(nodes(pending)[anchor.id].order).toBe(anchorOrder);
		expect(pending.sourceMappings.some((m) => m.id === final.id)).toBe(true);
	});

	it("does not retain competing saved positions during a copy-count change", () => {
		const source = "# First\n\nRepeated.\n\nRepeated.\n\nLast anchor.\n";
		const { initial, apply } = fixture({ "one.prax": source });
		const snapshot = initial.snapshots[0];
		const copies = initial.sourceMappings.filter(
			(m) => snapshot.nodes[m.id].matchText === "Repeated.",
		);
		expect(copies).toHaveLength(2);
		snapshot.nodes[copies[1].id].order = 0;
		initial.heads[0].head = digest(serializeIdentity(snapshot));
		const anchor = initial.sourceMappings.find(
			(m) => snapshot.nodes[m.id].matchText === "Last anchor.",
		);
		if (!anchor) throw new Error("Missing fixed anchor");
		const pending = apply(initial, { "one.prax": "# First\n\nRepeated.\n\nLast anchor.\n" });
		expect(pending.exportable).toBe(false);
		expect(nodes(pending)[anchor.id].order).toBe(1);
	});

	it("does not retain page ordinals during a same-title copy-count change", () => {
		const source = "# Repeated\n\n# Repeated\n\n# Last\n\nAnchor.\n";
		const { initial, apply } = fixture({ "one.prax": source });
		const anchor = initial.sourceMappings.find((m) => nodes(initial)[m.id].label === "Last");
		if (!anchor) throw new Error("Missing fixed page");
		const pending = apply(initial, { "one.prax": "# Repeated\n\n# Last\n\nAnchor.\n" });
		expect(pending.exportable).toBe(false);
		expect(nodes(pending)[anchor.id].order).toBe(1);
	});

	it("restores pending identical option parts after an invalid draft", () => {
		const source = "# First\n\n::: choice Q\n(x) Yes\n( ) No\n( ) No\n:::\n";
		const { initial, apply } = fixture({ "one.prax": source });
		const copies = initial.sourceMappings.filter(
			(m) => nodes(initial)[m.id].type === "option" && nodes(initial)[m.id].matchText === "No",
		);
		expect(copies).toHaveLength(2);
		const pending = apply(initial, { "one.prax": "# First\n\n::: choice Q\n(x\n" });
		expect(copies.map(({ id }) => nodes(pending)[id].status)).toEqual(["pending", "pending"]);
		const restored = apply(pending, { "one.prax": source });
		expect(restored.exportable).toBe(true);
		expect(restored.sourceMappings.map((m) => m.id)).toEqual(
			initial.sourceMappings.map((m) => m.id),
		);
	});

	it("keeps the lesson-head namespace when a never-active invalid draft becomes valid", () => {
		const { initial, apply } = fixture({ "one.prax": "# First\n\n::: note\nUnclosed.\n" });
		const next = apply(initial, { "one.prax": base });
		expect(next.snapshots).toHaveLength(1);
		expect(next.snapshots[0].lessonId).toBe(initial.snapshots[0].lessonId);
		expect(next.unresolved).toEqual([]);
	});
	it.each([
		["two copies, unsaved", duplicate, 0],
		["two copies, saved", duplicate, 1],
		["three copies, reopened", `${duplicate}\nRepeated.\n`, 3],
	])("settles %s with the original ID", (_, source, opens) => {
		const { initial, apply, donor, activeHistoryIds } = fixture();
		let state = initial;
		for (let i = 0; i < opens; i++) state = apply(state, { "one.prax": source });
		const settled = apply(state, { "one.prax": base });
		expect(nodes(settled)[donor].status).toBe("active");
		expect(settled.unresolved).toEqual([]);
		expect(settled.sourceMappings.find((m) => m.path.join() === "0,0")?.id).toBe(donor);
		for (const [id, node] of Object.entries(nodes(settled))) {
			if (!activeHistoryIds.has(id)) {
				expect(node.status).toBe("retired");
				expect(isDurableIdentity(id, node, activeHistoryIds)).toBe(false);
			}
		}
	});

	it("reuses provisional IDs in saved span order and produces identical snapshot bytes", () => {
		const { initial, apply, donor } = fixture();
		const first = apply(initial, { "one.prax": duplicate });
		const second = apply(first, { "one.prax": duplicate });
		expect(serializeIdentity(second.snapshots)).toBe(serializeIdentity(first.snapshots));
		expect(second.heads).toEqual(first.heads);
		expect(second.sourceMappings.map((m) => m.id)).toEqual(first.sourceMappings.map((m) => m.id));
		expect(nodes(second)[donor].status).toBe("pending");
	});

	it("settles stores trapped by repeated resolutions without historical facts", () => {
		const { initial, apply, donor } = fixture();
		let trapped = initial;
		for (let i = 0; i < 4; i++)
			trapped = apply(trapped, { "one.prax": duplicate }, undefined, false);
		const repaired = apply(trapped, { "one.prax": duplicate });
		const reopened = apply(repaired, { "one.prax": duplicate });
		expect(serializeIdentity(reopened.snapshots)).toBe(serializeIdentity(repaired.snapshots));
		const settled = apply(reopened, { "one.prax": base });
		expect(nodes(settled)[donor].status).toBe("active");
		expect(settled.unresolved).toEqual([]);
	});

	it("matches a durable pending donor through a typo with unchanged sibling anchors", () => {
		const paragraph =
			"The Praxity tools run locally on your own computer, so your course files stay private.";
		const source = `# First\n\nIntro paragraph stays the same here.\n\n${paragraph}\n\nOther subject entirely different.\n`;
		const { initial, apply } = fixture({ "one.prax": source });
		const donor = initial.sourceMappings.find((m) => m.path.join() === "0,1");
		if (!donor) throw new Error("Missing paragraph");
		const pending = apply(initial, { "one.prax": `${source}\n${paragraph}\n` });
		expect(nodes(pending)[donor.id].status).toBe("pending");
		const next = apply(pending, { "one.prax": source.replace("computer,", "computre,") });
		expect(nodes(next)[donor.id].status).toBe("active");
		expect(next.sourceMappings.find((m) => m.path.join() === "0,1")?.id).toBe(donor.id);
		expect(next.exportable).toBe(true);
	});

	it.each([false, true])(
		"restores a cut pending donor with a typo independently of UUID order, reversed=%s",
		(reverseIds) => {
			const paragraph =
				"The Praxity tools run locally on your own computer, so your course files stay private.";
			const source = `# First\n\nIntro paragraph stays the same here.\n\n${paragraph}\n\nOther subject entirely different.\n`;
			const { initial, apply } = fixture({ "one.prax": source }, reverseIds);
			const donor = initial.sourceMappings.find((m) => m.path.join() === "0,1");
			if (!donor) throw new Error("Missing paragraph");
			const pending = apply(initial, {
				"one.prax": `${source.replace(`${paragraph}\n\n`, "")}\n::: note\nUnclosed.\n`,
			});
			expect(nodes(pending)[donor.id].status).toBe("pending");
			const next = apply(pending, { "one.prax": source.replace("computer,", "computre,") });
			expect(nodes(next)[donor.id].status).toBe("active");
			expect(next.sourceMappings.map((m) => m.id)).toEqual(initial.sourceMappings.map((m) => m.id));
			expect(next.exportable).toBe(true);
		},
	);

	it.each([
		["removed", false],
		["added", false],
		["removed", true],
		["added", true],
	])("restores two durable copies after a copy was %s, reader roles=%s", (change, readerRoles) => {
		const { initial, apply } = fixture({ "one.prax": duplicate }, false, readerRoles);
		const donors = initial.sourceMappings.filter(
			(m) => nodes(initial)[m.id].matchText === "Repeated.",
		);
		const pending = apply(initial, {
			"one.prax": change === "removed" ? base : `${duplicate}\nRepeated.\n`,
		});
		expect(pending.exportable).toBe(false);
		const restored = apply(pending, { "one.prax": duplicate });
		expect(donors.map(({ id }) => nodes(restored)[id].status)).toEqual(["active", "active"]);
		expect(restored.sourceMappings.map((m) => m.id)).toEqual(
			initial.sourceMappings.map((m) => m.id),
		);
		expect(restored.exportable).toBe(true);
	});

	it("keeps three copies reduced to two pending", () => {
		const { initial, apply, donor } = fixture();
		const pending = apply(initial, { "one.prax": `${duplicate}\nRepeated.\n` });
		const next = apply(pending, { "one.prax": duplicate });
		expect(nodes(next)[donor].status).toBe("pending");
		expect(next.unresolved.filter((u) => u.candidates.includes(donor))).toHaveLength(2);
		expect(next.exportable).toBe(false);
	});

	it.each([
		["copy reworded", `${base}\nA distinct copy.\n`, "one.prax"],
		["original reworded", "# First\n\nNew weather.\n\nOther subject.\n\nRepeated.\n", "one.prax"],
		["copy in another lesson", "# First\n\nNew weather.\n\nOther subject.\n", "two.prax"],
	])("follows the exact text when %s", (_, source, donorFile) => {
		const { initial, apply, donor } = fixture();
		const pending = apply(initial, { "one.prax": duplicate });
		const settled = apply(pending, {
			"one.prax": source,
			...(donorFile === "two.prax" ? { "two.prax": "# Second\n\nRepeated.\n" } : {}),
		});
		expect(nodes(settled)[donor].status).toBe("active");
		expect(settled.sourceMappings.find((m) => m.id === donor)?.file).toBe(donorFile);
		expect(settled.unresolved).toEqual([]);
	});

	it("retires the durable donor when both copies lose its text", () => {
		const { initial, apply, donor, activeHistoryIds } = fixture();
		const pending = apply(initial, { "one.prax": duplicate });
		const next = apply(pending, {
			"one.prax": "# First\n\nNew weather.\n\nOther subject.\n\nDifferent topic.\n",
		});
		expect(nodes(next)[donor].status).toBe("retired");
		expect(isDurableIdentity(donor, nodes(next)[donor], activeHistoryIds)).toBe(true);
	});

	it("keeps the unchanged lesson's original when another lesson adds a copy", () => {
		const { initial, apply, donor } = fixture({
			"one.prax": base,
			"two.prax": "# Second\n\nDifferent topic.\n",
		});
		const next = apply(initial, {
			"one.prax": base,
			"two.prax": "# Second\n\nDifferent topic.\n\nRepeated.\n",
		});
		expect(next.sourceMappings.find((m) => m.id === donor)?.file).toBe("one.prax");
		expect(next.exportable).toBe(true);
	});

	it("settles duplicated containers before their children", () => {
		const container = "::: note\nRepeated.\n:::\n";
		const source = `# First\n\n${container}`;
		const { initial, apply } = fixture({ "one.prax": source });
		const pending = apply(initial, { "one.prax": `${source}\n${container}` });
		const settled = apply(pending, { "one.prax": source });
		expect(settled.sourceMappings.map((m) => m.id)).toEqual(
			initial.sourceMappings.map((m) => m.id),
		);
		expect(settled.unresolved).toEqual([]);
	});

	it("keeps two durable identical copies dropping to one pending", () => {
		const { initial, apply } = fixture({ "one.prax": duplicate });
		const donors = initial.sourceMappings
			.filter((m) => nodes(initial)[m.id].matchText === "Repeated.")
			.map((m) => m.id);
		const pending = apply(initial, { "one.prax": base });
		expect(donors.map((id) => nodes(pending)[id].status)).toEqual(["pending", "pending"]);
		expect(pending.exportable).toBe(false);
	});

	it("strips retained placement to a provisional ID before matching the durable donor", () => {
		const { initial, apply, donor } = fixture();
		const pending = apply(initial, { "one.prax": duplicate });
		const copy = pending.sourceMappings.find(
			(m) => m.path.join() === "0,2",
		) as IdentityResolution["sourceMappings"][number];
		const next = apply(pending, { "one.prax": base }, [
			{
				intent: "modify",
				files: [
					{
						path: "one.prax",
						fromRevision: digest(duplicate),
						toRevision: digest(base),
						fromSnapshot: pending.heads[0].head,
					},
				],
				mapping: [{ oldId: copy.id, newId: copy.id, fate: "kept" }],
				placements: [{ file: "one.prax", path: [0, 0], mappingIndex: 0 }],
			},
		]);
		expect(nodes(next)[donor].status).toBe("active");
		expect(next.sourceMappings.find((m) => m.path.join() === "0,0")?.id).toBe(donor);
		expect(nodes(next)[copy.id].status).toBe("retired");
	});

	it("protects consumer revisions on a never-active pending ID", () => {
		const { initial, apply, activeHistoryIds } = fixture();
		const pending = apply(initial, { "one.prax": duplicate });
		const copy = pending.sourceMappings.find(
			(m) => m.path.join() === "0,2",
		) as IdentityResolution["sourceMappings"][number];
		const snapshot = pending.snapshots.find((s) => s.nodes[copy.id]);
		if (!snapshot) throw new Error("Missing pending copy snapshot");
		snapshot.nodes[copy.id].consumerRevisions = { state: { signature: "a".repeat(64), epoch: 1 } };
		pending.heads[0].head = digest(serializeIdentity(snapshot));
		expect(isDurableIdentity(copy.id, snapshot.nodes[copy.id], activeHistoryIds)).toBe(true);
		const next = apply(pending, { "one.prax": base });
		expect(nodes(next)[copy.id].status).toBe("pending");
		expect(next.exportable).toBe(false);
	});

	it.each([false, true])(
		"does not use ordinal proof for a saved-order collision, reader roles=%s",
		(readerRoles) => {
			const { initial, apply, donor } = fixture({ "one.prax": base }, false, readerRoles);
			const source = "# First\n\nRepeated.\n\nRepeated.\n\nOther subject.\n";
			const pending = apply(initial, { "one.prax": source });
			const copy = pending.sourceMappings.find((m) => m.path.join() === "0,0");
			if (!copy) throw new Error("Missing provisional block");
			const snapshot = pending.snapshots[0];
			snapshot.nodes[copy.id].consumerRevisions = {
				state: { signature: "a".repeat(64), epoch: 1 },
			};
			pending.heads[0].head = digest(serializeIdentity(snapshot));
			expect(snapshot.nodes[copy.id].order).toBe(snapshot.nodes[donor].order);
			const next = apply(pending, { "one.prax": source });
			expect(nodes(next)[donor].status).toBe("pending");
			expect(nodes(next)[copy.id].status).toBe("pending");
			expect(next.exportable).toBe(false);
		},
	);
});
