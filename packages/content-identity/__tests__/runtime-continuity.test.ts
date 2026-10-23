import { createHash } from "node:crypto";
import { isIdentityNodeId } from "@praxity/content-model/types";
import { readLesson, withLessonIds } from "@praxity/grammar";
import type { LessonIdAllocator } from "@praxity/grammar/src/v4/to-blocks.ts";
import { expect, it } from "vitest";
import * as identity from "../src/index.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const dependencies = (start = 1000, allocated: string[] = []) => {
	let next = start;
	return {
		digest: (text: string) => createHash("sha256").update(text).digest("hex"),
		allocateId: () => {
			const id = uuid(++next);
			allocated.push(id);
			return id;
		},
		allocateRuntimeId: () => `rt-${String(++next).padStart(32, "0")}`,
	};
};
const documents = (sources: Record<string, string>) =>
	Object.entries(sources).map(([path, source]) => ({ path, tree: readLesson(source).tree }));
const initial = {
	"a.prax": "# P\n\n::: note\nOne\n:::\n\n::: note\nTwo\n:::\n",
	"b.prax": "# Q\n\nText\n",
};
const inserted = "# P\n\n::: note\nNew\n:::\n\n::: note\nOne\n:::\n\n::: note\nTwo\n:::\n";
function fixture(allocated: string[] = []) {
	const stored = identity.resolveIdentity(
		{ parsedDocuments: documents(initial), priorSnapshots: [], readerRoles: true },
		dependencies(0),
	);
	const input = {
		course: stored.course,
		priorHeads: stored.heads,
		priorSnapshots: stored.snapshots,
		parsedDocuments: documents(initial),
		readerRoles: true,
	};
	const session = identity.createIdentityReadSession(dependencies(1000, allocated));
	return { stored, input, session };
}

function assertComplete(view: identity.IdentityReadView, parsed: identity.ParsedDocument[]) {
	expect(new Set(view.sourceMappings.map((m) => m.id)).size).toBe(view.sourceMappings.length);
	expect(Object.keys(view.nodes).sort()).toEqual(view.sourceMappings.map((m) => m.id).sort());
	for (const doc of parsed) {
		const mappings = view.sourceMappings.filter((m) => m.file === doc.path);
		const descriptors = identity.describeDocument(doc, { readerRoles: true });
		expect(descriptors.map((d) => d.path)).toEqual(mappings.map((m) => m.path));
		const ids = new Set(mappings.map((m) => m.id));
		for (const m of mappings) {
			const node = view.nodes[m.id];
			expect(node.fingerprint).toBe(m.fingerprint);
			expect(node.span).toEqual(m.span);
			if (node.parent !== null) expect(ids.has(node.parent)).toBe(true);
		}
		const lesson = view.lessons.find((l) => l.file === doc.path);
		expect(lesson?.lessonId).toBe(mappings.find((m) => !m.path.length)?.id);
		expect(lesson?.sourceHash).toBe(dependencies().digest(doc.tree.stream.source));
	}
}

function assertReaderJoin(view: identity.IdentityReadView, sources: Record<string, string>) {
	for (const [file, source] of Object.entries(sources)) {
		const read = readLesson(source);
		const known = new Map<unknown, Map<string | undefined, string>>();
		const mappings = view.sourceMappings.filter((m) => m.file === file);
		for (const d of identity.describeDocument(
			{ path: file, tree: read.tree },
			{ readerRoles: true },
		)) {
			const owner = (d.readerOwnerPath ?? d.path).reduce(
				(node, i) => node?.children[i],
				read.tree.root,
			);
			if (!owner) continue;
			const mapping = mappings.find(
				(m) => identity.serializeIdentity(m.path) === identity.serializeIdentity(d.path),
			);
			expect(mapping).toBeDefined();
			const roles = known.get(owner) ?? new Map();
			roles.set(d.readerRole, mapping?.id);
			known.set(owner, roles);
		}
		const ids: LessonIdAllocator = Object.assign(
			(node: unknown, role?: string) => {
				const id = known.get(node)?.get(role);
				if (!id) throw new Error("missing read provider binding");
				return id;
			},
			{ transient: true },
		);
		const projected = withLessonIds(read, ids);
		const mappingIds = new Set(mappings.map((m) => m.id));
		expect([...projected.nodes.keys()].filter((id) => !mappingIds.has(id))).toEqual([]);
		for (const record of projected.nodes.values())
			expect(ids(record.node, record.role)).toBe(record.id);
	}
}

it("I4 generated outside edits preserve the unique runtime sentinel and full durable decisions", () => {
	const seed = 0x01b;
	let random = seed;
	const pick = () => {
		random = (1664525 * random + 1013904223) >>> 0;
		return random % 7;
	};
	const allocated: string[] = [];
	const { input, session } = fixture(allocated);
	const sentinel = "::: note\nRuntime sentry alpha\n:::\n";
	const nested =
		"\n::: tabs\n:: First\nInside first.\n:: Second\n::: note\nNested body.\n:::\n:::\n";
	const sources: Record<string, string> = {
		...initial,
		"a.prax": `${initial["a.prax"]}\n${sentinel}${nested}`,
	};
	let path = "a.prax";
	let sentinelIds: string[] | undefined;
	const sequence: string[] = [];
	for (let step = 0; step < 35; step++) {
		const action = pick();
		sequence.push(`${step}:${action}`);
		if (action === 0) sources["b.prax"] = `# Q\n\nUnrelated revision ${step}.\n`;
		if (action === 1)
			sources[path] = sources[path].replace(sentinel, `Preceding content ${step}.\n\n${sentinel}`);
		if (action === 2) sources[path] = sources[path].replace(/Preceding content \d+\.\n\n/g, "");
		if (action === 3)
			sources[path] = sources[path].replace(
				"::: note\nOne\n:::\n\n::: note\nTwo\n:::\n",
				"::: note\nTwo\n:::\n\n::: note\nOne\n:::\n",
			);
		if (action === 4) sources["c.prax"] = `# Additional\n\nAdded lesson revision ${step}.\n`;
		if (action === 5) {
			const renamed = path === "a.prax" ? "renamed.prax" : "a.prax";
			sources[renamed] = sources[path];
			delete sources[path];
			path = renamed;
		}
		const parsedDocuments = documents(sources);
		if (action === 6) parsedDocuments.reverse();
		const next = { ...input, parsedDocuments };
		const offset = allocated.length;
		const actual = session.resolve(next);
		let replay = offset;
		const expected = identity.resolveIdentity(next, {
			digest: dependencies().digest,
			allocateId: () => allocated[replay++],
		});
		const trace = `seed=${seed}, successful admission prefix=${sequence.join(",")}`;
		expect(identity.serializeIdentity(actual.candidate), trace).toBe(
			identity.serializeIdentity(expected),
		);
		const current = Object.entries(actual.view.nodes)
			.filter(([, n]) => n.matchText === "Runtime sentry alpha")
			.map(([id]) => id);
		expect(current, trace).toHaveLength(2);
		sentinelIds ??= current;
		expect(current, trace).toEqual(sentinelIds);
		assertComplete(actual.view, parsedDocuments);
		assertReaderJoin(actual.view, sources);
		for (const id of actual.view.runtimeIds)
			expect(identity.serializeIdentity(actual.candidate), trace).not.toContain(id);
		for (let repeat = 0; repeat < step % 3; repeat++) {
			const again = session.resolve(next).view;
			expect(
				again.sourceMappings.map((m) => m.id),
				trace,
			).toEqual(actual.view.sourceMappings.map((m) => m.id));
			assertReaderJoin(again, sources);
		}
	}
});

function runtimeAttack(
	input: identity.ResolveIdentityInput,
	runtimeId: string,
	ingress: "operation" | "lineage",
): identity.ResolveIdentityInput {
	const attack = structuredClone(input);
	const heads = input.priorHeads;
	if (!heads) throw new Error("missing stored heads");
	if (ingress === "operation") {
		attack.operations = [
			{
				intent: "insert",
				files: [
					{
						path: "a.prax",
						fromRevision: dependencies().digest(initial["a.prax"]),
						toRevision: dependencies().digest(inserted),
						fromSnapshot: heads[0].head,
					},
				],
				mapping: [{ oldId: null, newId: runtimeId, fate: "new" }],
				placements: [{ mappingIndex: 0, file: "a.prax", path: [0, 0] }],
			},
		];
	} else {
		const snapshots = structuredClone(input.priorSnapshots);
		const note = Object.values(snapshots[0].nodes).find((node) => node.type === "note");
		if (!note) throw new Error("missing stored note");
		note.lineage.push(runtimeId);
		attack.priorSnapshots = snapshots;
		attack.priorHeads = heads.map((head, index) => ({
			...head,
			head: dependencies().digest(identity.serializeIdentity(snapshots[index])),
		}));
	}
	return attack;
}

it("I4 runtime format separates every unstored view ID and the absent course from durable candidates", () => {
	for (const absent of [false, true]) {
		const { input, session } = fixture();
		const next = {
			...input,
			parsedDocuments: documents({ ...initial, "a.prax": inserted }),
			...(absent ? { course: undefined, priorSnapshots: [], priorHeads: [] } : {}),
		};
		const { view, candidate } = session.resolve(next);
		const stored = new Set(next.priorSnapshots.flatMap((snapshot) => Object.keys(snapshot.nodes)));
		for (const id of Object.keys(view.nodes)) {
			expect(stored.has(id) || /^rt-[0-9a-f]{32}$/u.test(id)).toBe(true);
		}
		for (const lesson of view.lessons)
			expect(stored.has(lesson.lessonId) || /^rt-[0-9a-f]{32}$/u.test(lesson.lessonId)).toBe(true);
		if (absent) expect(view.course.courseId).toMatch(/^rt-[0-9a-f]{32}$/u);
		else expect(view.course).toEqual(input.course);
		expect(isIdentityNodeId(candidate.course.courseId)).toBe(true);
		for (const snapshot of candidate.snapshots) {
			expect(isIdentityNodeId(snapshot.lessonId)).toBe(true);
			for (const id of Object.keys(snapshot.nodes)) expect(isIdentityNodeId(id)).toBe(true);
		}
	}
});

for (const ingress of ["operation", "lineage"] as const) {
	for (const reset of [
		"identical retry",
		"admission failure",
		"invalidate",
		"admitted removal",
		"namespace reopening",
	] as const) {
		it(`I4 R2 ${ingress} ingress refuses twice after ${reset}`, () => {
			const { input, session } = fixture();
			const next = { ...input, parsedDocuments: documents({ ...initial, "a.prax": inserted }) };
			const [runtimeId] = newIds(session.resolve(next).view);
			const attack = runtimeAttack(next, runtimeId, ingress);
			if (reset === "identical retry")
				expect(() => session.resolve(attack)).toThrow("Identity: runtime ID cannot be durable");
			if (reset === "admission failure")
				expect(() =>
					session.resolve({
						...next,
						parsedDocuments: documents({
							...initial,
							"a.prax": inserted,
							"b.prax": "<<<<<<< conflict\n",
						}),
					}),
				).toThrow("Identity: source conflict markers");
			if (reset === "invalidate") session.invalidate();
			if (reset === "admitted removal") session.resolve(input);
			if (reset === "namespace reopening") {
				session.resolve({
					...next,
					course: { schema: 1, courseId: uuid(999999) },
					priorSnapshots: [],
					priorHeads: [],
				});
				session.resolve(next);
			}
			for (let attempt = 0; attempt < 2; attempt++)
				expect(() => session.resolve(attack)).toThrow("Identity: runtime ID cannot be durable");
		});
	}
	for (const entry of ["resolveIdentity", "fresh session", "identity plan"] as const) {
		it(`I4 stateless ${ingress} refusal through ${entry}`, () => {
			const { input, session } = fixture();
			const next = { ...input, parsedDocuments: documents({ ...initial, "a.prax": inserted }) };
			const [runtimeId] = newIds(session.resolve(next).view);
			const attack = runtimeAttack(next, runtimeId, ingress);
			expect(() => {
				if (entry === "resolveIdentity") identity.resolveIdentity(attack, dependencies(9000));
				if (entry === "fresh session")
					identity.createIdentityReadSession(dependencies(9000)).resolve(attack);
				if (entry === "identity plan") {
					const { parsedDocuments, operations, ...baseline } = attack;
					identity
						.createIdentityPlan(baseline, dependencies(9000))
						.prepare(parsedDocuments)
						.resolve(operations ?? []);
				}
			}).toThrow("Identity: runtime ID cannot be durable");
		});
	}
}

it("I4 P2 an isolated retired runtime leaf key refuses at snapshot ingress", () => {
	const { input, session } = fixture();
	const next = { ...input, parsedDocuments: documents({ ...initial, "a.prax": inserted }) };
	const [runtimeId] = newIds(session.resolve(next).view);
	const snapshots = structuredClone(input.priorSnapshots);
	const leaf = Object.values(snapshots[0].nodes).find((node) => node.type === "note");
	if (!leaf) throw new Error("missing stored leaf");
	snapshots[0].nodes[runtimeId] = { ...structuredClone(leaf), status: "retired", lineage: [] };
	const control = structuredClone(snapshots[0]);
	control.nodes[uuid(90000)] = control.nodes[runtimeId];
	delete control.nodes[runtimeId];
	expect(() =>
		identity.parseIdentitySnapshot(identity.serializeIdentity(control), {
			digest: dependencies().digest,
		}),
	).not.toThrow();
	const text = identity.serializeIdentity(snapshots[0]);
	expect(() => identity.parseIdentitySnapshot(text, { digest: dependencies().digest })).toThrow(
		"Identity: runtime ID cannot be durable",
	);
	const priorHeads = input.priorHeads.map((head, index) => ({
		...head,
		head: dependencies().digest(identity.serializeIdentity(snapshots[index])),
	}));
	expect(() => session.resolve({ ...next, priorSnapshots: snapshots, priorHeads })).toThrow(
		"Identity: runtime ID cannot be durable",
	);
});

it("I4 runtime allocator must return a runtime token", () => {
	const { input } = fixture();
	const session = identity.createIdentityReadSession({
		...dependencies(),
		allocateRuntimeId: () => uuid(90000),
	});
	expect(() =>
		session.resolve({ ...input, parsedDocuments: documents({ ...initial, "a.prax": inserted }) }),
	).toThrow("Identity: invalid allocated runtime ID");
});

it("I4 a retained alias is reserved until its owner releases it", () => {
	const { input } = fixture();
	const alias = "rt-00000000000000000000000000001003";
	const reserved = new Set([alias]);
	let reuse = true;
	const hooks = dependencies(2000);
	const session = identity.createIdentityReadSession(
		{
			...hooks,
			allocateRuntimeId: () => {
				if (!reuse) return hooks.allocateRuntimeId();
				reuse = false;
				return alias;
			},
		},
		() => reserved,
	);
	const next = { ...input, parsedDocuments: documents({ ...initial, "a.prax": inserted }) };
	expect(session.resolve(next).view.runtimeIds).not.toContain(alias);
	reserved.clear();
	reuse = true;
	const fresh = session.resolve({
		...next,
		parsedDocuments: documents({ ...initial, "a.prax": `${inserted}\n## Fresh\n` }),
	});
	expect(fresh.view.runtimeIds).toContain(alias);
});

it("I4 an allocator repeatedly returning a reserved alias fails rather than looping", () => {
	const { input } = fixture();
	const alias = "rt-00000000000000000000000000001003";
	const session = identity.createIdentityReadSession(
		{ ...dependencies(), allocateRuntimeId: () => alias },
		() => [alias],
	);
	expect(() =>
		session.resolve({
			...input,
			parsedDocuments: documents({ ...initial, "a.prax": inserted }),
		}),
	).toThrow("Identity: duplicate allocated read ID");
});

it("I4 durable allocation refuses the runtime allocator's output without session state", () => {
	const hooks = dependencies();
	expect(() =>
		identity.resolveIdentity(
			{ parsedDocuments: documents(initial), priorSnapshots: [], readerRoles: true },
			{ ...hooks, allocateId: hooks.allocateRuntimeId },
		),
	).toThrow("Identity: runtime ID cannot be durable");
});

it("I4 the optional runtime allocator defaults to tokens and rejects duplicate runtime allocations", () => {
	const { input } = fixture();
	const next = { ...input, parsedDocuments: documents({ ...initial, "a.prax": inserted }) };
	const hooks = dependencies();
	const view = identity
		.createIdentityReadSession({ allocateId: hooks.allocateId, digest: hooks.digest })
		.resolve(next).view;
	for (const id of newIds(view)) expect(id).toMatch(/^rt-[0-9a-f]{32}$/u);
	const repeated = identity.createIdentityReadSession({
		...dependencies(),
		allocateRuntimeId: () => "rt-00000000000000000000000000001003",
	});
	expect(() => repeated.resolve(next)).toThrow("Identity: duplicate allocated read ID");
});

it("I4 a whole-file copy gets fresh runtime identities while a rename retains the donor", () => {
	const { input, session } = fixture();
	const sources = { ...initial, "a.prax": inserted };
	const first = session.resolve({ ...input, parsedDocuments: documents(sources) }).view;
	const ids = newIds(first);
	const copied = session.resolve({
		...input,
		parsedDocuments: documents({ ...sources, "copy.prax": inserted }),
	}).view;
	const inFile = (view: identity.IdentityReadView, file: string) =>
		view.sourceMappings
			.filter((m) => m.file === file && view.nodes[m.id].matchText === "New")
			.map((m) => m.id);
	expect(inFile(copied, "a.prax")).toEqual(ids);
	for (const id of inFile(copied, "copy.prax")) expect(ids).not.toContain(id);
	const renamed = session.resolve({
		...input,
		parsedDocuments: documents({
			"renamed.prax": inserted,
			"b.prax": initial["b.prax"],
			"copy.prax": inserted,
		}),
	}).view;
	for (const id of inFile(renamed, "renamed.prax")) expect(ids).not.toContain(id);
	const unique = identity.createIdentityReadSession(dependencies(9000));
	const donor = unique.resolve({ ...input, parsedDocuments: documents(sources) }).view;
	const uniqueRename = unique.resolve({
		...input,
		parsedDocuments: documents({ "renamed.prax": inserted, "b.prax": initial["b.prax"] }),
	}).view;
	expect(inFile(uniqueRename, "renamed.prax")).toEqual(newIds(donor));
});

it("I4 read views are disjoint from canonical durable candidates and return transition evidence", () => {
	const { input, session, stored } = fixture();
	const next = { ...input, parsedDocuments: documents({ ...initial, "a.prax": inserted }) };
	const first = session.resolve(next);
	const runtime = newIds(first.view);
	expect(first.view.kind).toBe("runtime-read");
	expect(first.view).not.toHaveProperty("snapshots");
	expect(first.view).not.toHaveProperty("heads");
	expect(first.view).not.toHaveProperty("mapping");
	const candidateText = identity.serializeIdentity(first.candidate);
	for (const id of runtime) expect(candidateText).not.toContain(id);
	const durable = first.candidate.sourceMappings
		.filter((m) => first.candidate.snapshots.some((s) => s.nodes[m.id]?.matchText === "New"))
		.map((m) => m.id);
	expect(durable).toHaveLength(2);
	const installed = {
		...next,
		priorHeads: first.candidate.heads,
		priorSnapshots: first.candidate.snapshots,
	};
	const after = session.resolve(installed);
	expect(newIds(after.view)).toEqual(durable);
	expect(after.view.runtimeIds).toEqual([]);
	expect(after.view.correspondence).toEqual(
		runtime.map((runtimeId, i) => ({ runtimeId, durableId: durable[i] })),
	);
	expect(
		identity.createIdentityReadSession(dependencies(9000)).resolve(installed).candidate,
	).toEqual(after.candidate);
	for (const mapping of stored.sourceMappings) expect(after.view.nodes[mapping.id]).toBeDefined();
	assertComplete(after.view, next.parsedDocuments);
});

it("I4 recorded replacement and copy keep fresh runtime subtrees despite identical text", () => {
	for (const intent of ["replace", "copy"] as const) {
		const { input, session } = fixture();
		const next = { ...input, parsedDocuments: documents({ ...initial, "a.prax": inserted }) };
		const first = session.resolve(next);
		const ids = newIds(first.view);
		const donor = first.candidate.sourceMappings.find((m) =>
			first.candidate.snapshots.some(
				(s) => s.nodes[m.id]?.type === "note" && s.nodes[m.id]?.matchText === "New",
			),
		);
		if (!donor) throw new Error("missing literal New donor");
		const source =
			intent === "copy"
				? inserted.replace("::: note\nNew\n:::\n", "::: note\nNew\n:::\n\n::: note\nNew\n:::\n")
				: inserted;
		const operation: identity.IdentityOperation = {
			intent,
			files: [
				{
					path: "a.prax",
					fromRevision: dependencies().digest(inserted),
					toRevision: dependencies().digest(source),
					fromSnapshot: first.candidate.heads[0].head,
				},
			],
			mapping:
				intent === "replace"
					? [
							{ oldId: donor.id, newId: null, fate: "retired" },
							{ oldId: null, newId: null, fate: "new" },
						]
					: [{ oldId: donor.id, newId: null, fate: "copied" }],
			placements: [
				{
					mappingIndex: intent === "replace" ? 1 : 0,
					file: "a.prax",
					path: intent === "replace" ? donor.path : [0, 1],
				},
			],
		};
		const result = session.resolve({
			...next,
			parsedDocuments: documents({ ...initial, "a.prax": source }),
			priorHeads: first.candidate.heads,
			priorSnapshots: first.candidate.snapshots,
			operations: [operation],
		});
		const placements = result.view.sourceMappings.filter(
			(m) => m.file === "a.prax" && operation.placements[0].path.every((p, i) => m.path[i] === p),
		);
		expect(placements).toHaveLength(2);
		for (const m of placements) expect(ids).not.toContain(m.id);
		for (const id of ids) expect(identity.serializeIdentity(result.candidate)).not.toContain(id);
		assertComplete(result.view, documents({ ...initial, "a.prax": source }));
	}
});

it("I4 recorded modify supplies runtime-to-durable correspondence for literal Changed", () => {
	const { input, session } = fixture();
	const next = { ...input, parsedDocuments: documents({ ...initial, "a.prax": inserted }) };
	const first = session.resolve(next);
	const runtime = newIds(first.view);
	const mappings = first.candidate.sourceMappings.filter((m) =>
		first.candidate.snapshots.some((s) => s.nodes[m.id]?.matchText === "New"),
	);
	const changed = inserted.replace("New\n", "Changed\n");
	const result = session.resolve({
		...next,
		parsedDocuments: documents({ ...initial, "a.prax": changed }),
		priorHeads: first.candidate.heads,
		priorSnapshots: first.candidate.snapshots,
		operations: [
			{
				intent: "modify",
				files: [
					{
						path: "a.prax",
						fromSnapshot: first.candidate.heads[0].head,
						fromRevision: dependencies().digest(inserted),
						toRevision: dependencies().digest(changed),
					},
				],
				mapping: mappings.map((m) => ({ oldId: m.id, newId: m.id, fate: "kept" })),
				placements: mappings.map((m, mappingIndex) => ({
					mappingIndex,
					file: "a.prax",
					path: m.path,
				})),
			},
		],
	});
	expect(result.view.correspondence).toEqual(
		runtime.map((runtimeId, i) => ({ runtimeId, durableId: mappings[i].id })),
	);
	expect(
		Object.entries(result.view.nodes)
			.filter(([, n]) => n.matchText === "Changed")
			.map(([id]) => id),
	).toEqual(mappings.map((m) => m.id));
	for (const id of runtime) expect(identity.serializeIdentity(result.candidate)).not.toContain(id);
});

it("I4 unchanged repeated runtime siblings retain identity but changed multiplicity cannot pick a winner", () => {
	const { input, session } = fixture();
	const next = { ...input, parsedDocuments: documents({ ...initial, "a.prax": inserted }) };
	const original = newIds(session.resolve(next).view);
	const duplicated = inserted.replace(
		"::: note\nNew\n:::\n",
		"::: note\nNew\n:::\n\n::: note\nNew\n:::\n",
	);
	const duplicateInput = {
		...input,
		parsedDocuments: documents({ ...initial, "a.prax": duplicated }),
	};
	const duplicate = session.resolve(duplicateInput).view;
	const duplicateIds = Object.entries(duplicate.nodes)
		.filter(([, n]) => n.matchText === "New")
		.map(([id]) => id);
	expect(duplicateIds).toHaveLength(4);
	for (const id of original) expect(duplicateIds).not.toContain(id);
	expect(duplicate.unresolved.filter((u) => u.reason === "duplicate").length).toBeGreaterThan(0);
	// Removing all duplicates is admitted before reinsertion. No older revision is a baseline.
	session.resolve(input);
	const reinserted = newIds(session.resolve(next).view);
	for (const id of original.concat(duplicateIds)) expect(reinserted).not.toContain(id);
	const repeated = identity.createIdentityReadSession(dependencies(10000));
	const a = repeated.resolve(duplicateInput).view;
	const b = repeated.resolve(duplicateInput).view;
	expect(b.sourceMappings.map((m) => m.id)).toEqual(a.sourceMappings.map((m) => m.id));
});

it("I4 callers, fresh sessions, namespace replacement and failed admissions cannot keep revoked assignments", () => {
	const { input, session } = fixture();
	const sources = { ...initial, "a.prax": inserted };
	const next = { ...input, parsedDocuments: documents(sources) };
	const first = session.resolve(next);
	const ids = newIds(first.view);
	first.view.nodes = {};
	first.view.sourceMappings[0].path.push(999);
	expect(first.candidate.sourceMappings[0].path).toEqual([]);
	const viewSpan = { ...first.view.sourceMappings[1].span };
	first.candidate.sourceMappings[1].span.end = 999;
	expect(first.view.sourceMappings[1].span).toEqual(viewSpan);
	first.candidate.snapshots[0].nodes = {};
	next.parsedDocuments[0].tree.stream.source = "mutated caller parse";
	const clean = { ...input, parsedDocuments: documents(sources) };
	expect(newIds(session.resolve(clean).view)).toEqual(ids);
	const other = identity.createIdentityReadSession(dependencies(9000));
	for (const id of newIds(other.resolve(clean).view)) expect(ids).not.toContain(id);
	session.invalidate();
	for (const id of newIds(session.resolve(clean).view)) expect(ids).not.toContain(id);
	const admitted = newIds(session.resolve(clean).view);
	expect(() =>
		session.resolve({
			...clean,
			parsedDocuments: documents({ ...sources, "b.prax": "<<<<<<< conflict\n" }),
		}),
	).toThrow("source conflict markers");
	for (const id of newIds(session.resolve(clean).view)) expect(admitted).not.toContain(id);
	const newNamespace = { schema: 1 as const, courseId: uuid(999999) };
	const replaced = session.resolve({
		...clean,
		course: newNamespace,
		priorHeads: [],
		priorSnapshots: [],
	});
	for (const id of newIds(replaced.view)) expect(admitted).not.toContain(id);
	session.dispose();
	expect(() => session.resolve(clean)).toThrow("read session disposed");
});

it("I4 in-memory drafts have their own continuity and invent no node for an empty insertion", () => {
	const { input, session } = fixture();
	const saved = session.resolve(input).view;
	const draft = identity.createIdentityReadSession(dependencies(8000));
	const next = { ...input, parsedDocuments: documents({ ...initial, "a.prax": inserted }) };
	expect(newIds(draft.resolve(next).view)).toEqual(newIds(draft.resolve(next).view));
	expect(session.resolve(input).view.sourceMappings).toEqual(saved.sourceMappings);
	expect(saved.nodes).toEqual(session.resolve(input).view.nodes);
	expect(Object.values(saved.nodes).filter((n) => n.matchText === "New")).toEqual([]);
});

it("I4 read continuity supports an absent store without turning runtime nodes into candidates", () => {
	const session = identity.createIdentityReadSession(dependencies());
	const input = {
		parsedDocuments: documents({ ...initial, "a.prax": inserted }),
		priorSnapshots: [],
		readerRoles: true,
	};
	const first = session.resolve(input);
	const second = session.resolve(input);
	expect(second.view.course).toEqual(first.view.course);
	expect(newIds(second.view)).toEqual(newIds(first.view));
	for (const id of first.view.runtimeIds)
		expect(identity.serializeIdentity(second.candidate)).not.toContain(id);
});

it("I4 loss of a stored namespace ends continuity rather than reviving that namespace", () => {
	const { input, session } = fixture();
	const parsedDocuments = documents({ ...initial, "a.prax": inserted });
	const before = session.resolve({ ...input, parsedDocuments }).view;
	const absent = session.resolve({ parsedDocuments, priorSnapshots: [], readerRoles: true }).view;
	expect(absent.course.courseId).not.toBe(before.course.courseId);
	for (const id of newIds(absent)) expect(before.runtimeIds).not.toContain(id);
});

it("I4 an allocator collision cannot put a runtime token into a durable candidate", () => {
	const { input } = fixture();
	const hooks = dependencies(10000);
	let forced: string | undefined;
	const session = identity.createIdentityReadSession({
		digest: hooks.digest,
		allocateRuntimeId: hooks.allocateRuntimeId,
		allocateId: () => {
			if (!forced) return hooks.allocateId();
			return forced;
		},
	});
	const next = { ...input, parsedDocuments: documents({ ...initial, "a.prax": inserted }) };
	const first = session.resolve(next).view;
	forced = newIds(first)[0];
	expect(() => session.resolve(next)).toThrow("Identity: runtime ID cannot be durable");
});

it("I4 a stored baseline cannot adopt the session's runtime graph", () => {
	const { input, session } = fixture();
	const next = { ...input, parsedDocuments: documents({ ...initial, "a.prax": inserted }) };
	const { view } = session.resolve(next);
	const snapshots = view.lessons.map(
		(lesson): identity.IdentitySnapshot => ({
			schema: 1,
			courseId: view.course.courseId,
			lessonId: lesson.lessonId,
			parents: [],
			sourceHash: lesson.sourceHash,
			nodes: Object.fromEntries(
				view.sourceMappings
					.filter((m) => m.file === lesson.file)
					.map((m) => [m.id, view.nodes[m.id]]),
			),
		}),
	);
	const heads = view.lessons.map((lesson, i) => ({
		schema: 1 as const,
		path: lesson.file,
		head: dependencies().digest(identity.serializeIdentity(snapshots[i])),
	}));
	expect(() => session.resolve({ ...next, priorSnapshots: snapshots, priorHeads: heads })).toThrow(
		"Identity: runtime ID cannot be durable",
	);
});

for (const reference of [
	"explicit operation newId",
	"explicit operation oldId",
	"explicit operation history",
	"stored lineage",
	"stored parent",
	"course namespace",
	"snapshot course namespace",
	"snapshot lesson identity",
	"snapshot history parent",
	"stored head",
	"mergeBase history lineage",
] as const) {
	it(`I4 P1 rejects the literal runtime token in ${reference} before durable resolution`, () => {
		const { input, session } = fixture();
		const next: identity.ResolveIdentityInput = {
			...input,
			parsedDocuments: documents({ ...initial, "a.prax": inserted }),
		};
		expect(newIds(session.resolve(next).view)).toEqual([
			"rt-00000000000000000000000000001003",
			"rt-00000000000000000000000000001004",
		]);
		const runtimeId = "rt-00000000000000000000000000001003";
		if (reference.startsWith("explicit operation")) {
			next.operations = [
				{
					intent: "insert",
					files: [
						{
							path: "a.prax",
							fromRevision: dependencies().digest(initial["a.prax"]),
							toRevision: dependencies().digest(inserted),
							fromSnapshot: input.priorHeads[0].head,
						},
					],
					mapping: [
						{
							oldId: reference === "explicit operation oldId" ? runtimeId : null,
							newId: runtimeId,
							fate: "new",
						},
					],
					placements: [{ mappingIndex: 0, file: "a.prax", path: [0, 0] }],
				},
			];
			if (reference === "explicit operation oldId")
				next.operations[0].mapping[0].newId = uuid(90000);
			if (reference === "explicit operation history") {
				next.operations[0].mapping[0].newId = uuid(90000);
				next.operations[0].files[0].fromSnapshot = runtimeId;
			}
		} else if (reference === "course namespace") {
			next.course = { schema: 1, courseId: runtimeId };
			next.priorSnapshots = [];
			next.priorHeads = [];
		} else {
			const snapshots = structuredClone(input.priorSnapshots);
			const storedNote = Object.values(snapshots[0].nodes).find((n) => n.type === "note");
			if (!storedNote) throw new Error("missing stored note fixture");
			if (reference === "stored lineage" || reference === "mergeBase history lineage")
				storedNote.lineage.push(runtimeId);
			if (reference === "stored parent") storedNote.parent = runtimeId;
			if (reference === "snapshot course namespace") snapshots[0].courseId = runtimeId;
			if (reference === "snapshot lesson identity") snapshots[0].lessonId = runtimeId;
			if (reference === "snapshot history parent") snapshots[0].parents = [runtimeId];
			if (reference === "mergeBase history lineage") next.mergeBase = snapshots;
			else {
				next.priorSnapshots = snapshots;
				next.priorHeads = input.priorHeads.map((head, i) => ({
					...head,
					head: dependencies().digest(identity.serializeIdentity(snapshots[i])),
				}));
				if (reference === "stored head") next.priorHeads[0].head = runtimeId;
			}
		}
		expect(() => session.resolve(next)).toThrow(
			reference === "explicit operation history" ||
				reference === "snapshot history parent" ||
				reference === "stored head"
				? "Identity: invalid SHA-256 hash"
				: "Identity: runtime ID cannot be durable",
		);
	});
}

it("I4 P1 permits a runtime token as authored text and preserves ordinary candidate decisions", () => {
	const allocated: string[] = [];
	const { input, session } = fixture(allocated);
	const next = { ...input, parsedDocuments: documents({ ...initial, "a.prax": inserted }) };
	expect(newIds(session.resolve(next).view)).toEqual([
		"rt-00000000000000000000000000001003",
		"rt-00000000000000000000000000001004",
	]);
	const authored = {
		...next,
		parsedDocuments: documents({
			...initial,
			"a.prax": inserted,
			"b.prax": "# Q\n\nAuthored reference rt-00000000000000000000000000001003.\n",
		}),
	};
	let replay = allocated.length;
	const { candidate } = session.resolve(authored);
	const expected = identity.resolveIdentity(authored, {
		digest: dependencies().digest,
		allocateId: () => allocated[replay++],
	});
	expect(candidate).toEqual(expected);
});

it("I4 revocation during a dependency call cannot repopulate a read session", () => {
	const { input } = fixture();
	const hooks = dependencies(20000);
	let revoke = false;
	const session = identity.createIdentityReadSession({
		allocateId: hooks.allocateId,
		allocateRuntimeId: hooks.allocateRuntimeId,
		digest(text) {
			if (revoke) {
				revoke = false;
				session.invalidate();
			}
			return hooks.digest(text);
		},
	});
	const next = { ...input, parsedDocuments: documents({ ...initial, "a.prax": inserted }) };
	const old = newIds(session.resolve(next).view);
	revoke = true;
	expect(() => session.resolve(next)).toThrow("read session revoked");
	for (const id of newIds(session.resolve(next).view)) expect(old).not.toContain(id);
});
function newIds(view: identity.IdentityReadView) {
	const nodeIds = Object.entries(view.nodes)
		.filter(([, node]) => node.matchText === "New")
		.map(([id]) => id);
	expect(nodeIds).toHaveLength(2);
	return nodeIds;
}

it("I4 successful write correspondence uses the literal UUIDs issued by that write, not an earlier candidate", () => {
	const { input, session } = fixture();
	const next = { ...input, parsedDocuments: documents({ ...initial, "a.prax": inserted }) };
	const before = session.resolve(next);
	const written = identity.resolveIdentity(next, dependencies(2000));
	const transition = session.prepareWrite(
		{
			...next,
			course: written.course,
			priorHeads: written.heads,
			priorSnapshots: written.snapshots,
		},
		before.candidate,
		written,
	);
	// Preparation neither stores nor advances the display revision.
	expect(newIds(session.resolve(next).view)).toEqual([
		"rt-00000000000000000000000000001003",
		"rt-00000000000000000000000000001004",
	]);
	expect(transition.commit()).toEqual([]);
	const current = session.resolve(next);
	const successful = session.prepareWrite(
		{
			...next,
			course: written.course,
			priorHeads: written.heads,
			priorSnapshots: written.snapshots,
		},
		current.candidate,
		written,
	);
	expect(successful.commit()).toEqual([
		{
			runtimeId: "rt-00000000000000000000000000001003",
			durableId: "00000000-0000-4000-8000-000000002001",
		},
		{
			runtimeId: "rt-00000000000000000000000000001004",
			durableId: "00000000-0000-4000-8000-000000002002",
		},
	]);
	expect(successful.commit()).toEqual([]);
	expect(identity.serializeIdentity(written)).not.toContain("rt-");
	expect(identity.serializeIdentity(written)).not.toContain("correspondence");
});

it("I4 write preparation refuses a before snapshot whose source was not admitted by the last read", () => {
	const { input, session } = fixture();
	const next = { ...input, parsedDocuments: documents({ ...initial, "a.prax": inserted }) };
	expect(newIds(session.resolve(next).view)).toEqual([
		"rt-00000000000000000000000000001003",
		"rt-00000000000000000000000000001004",
	]);
	const unread = {
		...next,
		parsedDocuments: documents({ ...initial, "a.prax": inserted, "b.prax": "# Q\n\nChanged\n" }),
	};
	const before = identity.resolveIdentity(unread, dependencies(2000));
	expect(
		before.sourceMappings
			.filter((m) => m.file === "a.prax" && (m.path.join() === "0,0" || m.path.join() === "0,0,0"))
			.map((m) => m.id),
	).toEqual(["00000000-0000-4000-8000-000000002001", "00000000-0000-4000-8000-000000002002"]);
	expect(() =>
		session.prepareWrite(
			{
				...unread,
				course: before.course,
				priorHeads: before.heads,
				priorSnapshots: before.snapshots,
			},
			before,
			before,
		),
	).toThrow("Identity: write correspondence has no admitted source");
});

it("I4 a revoked write transition cannot repopulate the read session", () => {
	const { input, session } = fixture();
	const next = { ...input, parsedDocuments: documents({ ...initial, "a.prax": inserted }) };
	const before = session.resolve(next);
	const written = identity.resolveIdentity(next, dependencies(2000));
	const transition = session.prepareWrite(
		{
			...next,
			course: written.course,
			priorHeads: written.heads,
			priorSnapshots: written.snapshots,
		},
		before.candidate,
		written,
	);
	session.invalidate();
	expect(transition.commit()).toEqual([]);
	expect(newIds(session.resolve(next).view)).not.toContain("rt-00000000000000000000000000001003");
});

it("I4 a write in a replacement stored namespace cannot adopt the old draft's runtime tokens", () => {
	const { input, session } = fixture();
	const parsedDocuments = documents({ ...initial, "a.prax": inserted });
	session.resolve({ ...input, parsedDocuments });
	const replacement = identity.resolveIdentity(
		{ parsedDocuments, priorSnapshots: [], readerRoles: true },
		dependencies(9000),
	);
	const transition = session.prepareWrite(
		{
			parsedDocuments,
			course: replacement.course,
			priorHeads: replacement.heads,
			priorSnapshots: replacement.snapshots,
			readerRoles: true,
		},
		undefined,
		replacement,
	);
	expect(transition.commit()).toEqual([]);
});

it("I4 preparation leaves an absent-store read's provisional namespace unchanged until success", () => {
	const session = identity.createIdentityReadSession(dependencies(1000));
	const input = {
		parsedDocuments: documents({ "u.prax": "# P\n\nText\n" }),
		priorSnapshots: [],
		readerRoles: true,
	};
	const before = session.resolve(input);
	const written = identity.resolveIdentity(input, dependencies(2000));
	const transition = session.prepareWrite(
		{
			...input,
			course: written.course,
			priorHeads: written.heads,
			priorSnapshots: written.snapshots,
		},
		before.candidate,
		written,
	);
	expect(session.resolve(input).candidate.course.courseId).toBe(
		"00000000-0000-4000-8000-000000001001",
	);
	expect(transition.commit()).toEqual([]);
});

it("I4 read continuity keeps outside New and its body through both reviewer revisions", () => {
	const { input, session } = fixture();
	const sources = { ...initial, "a.prax": inserted };
	const first = session.resolve({ ...input, parsedDocuments: documents(sources) });
	const ids = newIds(first.view);
	expect(ids).toEqual([
		"rt-00000000000000000000000000001003",
		"rt-00000000000000000000000000001004",
	]);
	expect(newIds(session.resolve({ ...input, parsedDocuments: documents(sources) }).view)).toEqual(
		ids,
	);
	sources["b.prax"] = "# Q\n\nText changed\n";
	expect(newIds(session.resolve({ ...input, parsedDocuments: documents(sources) }).view)).toEqual(
		ids,
	);
	sources["a.prax"] = inserted.replace("Two\n", "Two changed\n");
	expect(newIds(session.resolve({ ...input, parsedDocuments: documents(sources) }).view)).toEqual(
		ids,
	);
	sources["a.prax"] = sources["a.prax"].replace(
		"::: note\nNew",
		"Unrelated preceding text.\n\n::: note\nNew",
	);
	expect(newIds(session.resolve({ ...input, parsedDocuments: documents(sources) }).view)).toEqual(
		ids,
	);
});
