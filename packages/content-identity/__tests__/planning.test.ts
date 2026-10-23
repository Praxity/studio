import { createHash } from "node:crypto";
import { tokenizeLesson } from "@praxity/grammar/src/v4/lex/index.ts";
import { getDefinition } from "@praxity/grammar/src/v4/schema.ts";
import { analyzeLessonTree } from "@praxity/grammar/src/v4/tree/index.ts";
import { expect, it } from "vitest";
import { createIdentityPlan, resolveIdentity } from "../src/index.ts";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function dependencies(start = 100) {
	let next = start;
	return {
		digest,
		reset: () => {
			next = start;
		},
		allocateId: () => `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, "0")}`,
	};
}
const documents = () => [
	{
		path: "a.prax",
		tree: analyzeLessonTree(tokenizeLesson("# One\n::: note\nOriginal\n:::\n"), {
			definition: getDefinition,
		}),
	},
	{
		path: "b.prax",
		tree: analyzeLessonTree(tokenizeLesson("# Two\nElsewhere\n"), { definition: getDefinition }),
	},
];
function fixture() {
	const parsedDocuments = documents();
	const seed = resolveIdentity(
		{ parsedDocuments, priorSnapshots: [], readerRoles: true },
		dependencies(1),
	);
	return {
		course: seed.course,
		priorHeads: seed.heads,
		priorSnapshots: seed.snapshots,
		parsedDocuments,
		readerRoles: true,
	};
}

it("shares owned evidence and copies every caller boundary", () => {
	const input = fixture();
	const expected = resolveIdentity(input, dependencies());
	const hooks = dependencies();
	const plan = createIdentityPlan(input, hooks);
	const prepared = plan.prepare(input.parsedDocuments);
	input.priorSnapshots[0].nodes = {};
	input.priorHeads[0].head = "0".repeat(64);
	input.course.courseId = "00000000-0000-4000-8000-000000000099";
	input.readerRoles = false;
	input.parsedDocuments[0].tree.root.status = "unresolved";
	prepared.descriptors[0].valid = false;
	prepared.descriptors[0].path.push(999);
	hooks.digest = () => {
		throw new Error("replaced hook");
	};
	hooks.allocateId = () => {
		throw new Error("replaced allocator");
	};
	expect(plan.sourceHash(expected.heads[0].head)).toBe(expected.snapshots[0].sourceHash);
	const first = prepared.resolve([]);
	expect(first).toEqual(expected);
	first.snapshots[0].nodes = {};
	first.sourceMappings[0].path.push(999);
	expect(prepared.resolve([])).toEqual(expected);
});

it("new preparations agree with independent fresh results after same-size and tree-only edits", () => {
	const input = fixture();
	const hooks = dependencies();
	const plan = createIdentityPlan(input, hooks);
	plan.prepare(input.parsedDocuments).resolve([]);
	input.parsedDocuments[1] = {
		path: "b.prax",
		tree: analyzeLessonTree(tokenizeLesson("# Two\nChanged!!\n"), { definition: getDefinition }),
	};
	const expected = resolveIdentity(input, dependencies());
	expect(plan.prepare(input.parsedDocuments).resolve([])).toEqual(expected);
	input.parsedDocuments[0].tree.root.status = "unresolved";
	const mutated = resolveIdentity(input, dependencies());
	hooks.reset();
	expect(plan.prepare(input.parsedDocuments).resolve([])).toEqual(mutated);
});

it("a new plan reads current reader configuration and snapshot bytes", () => {
	const input = fixture();
	createIdentityPlan(input, dependencies()).prepare(input.parsedDocuments).resolve([]);
	input.readerRoles = false;
	const expected = resolveIdentity(input, dependencies());
	expect(
		createIdentityPlan(input, dependencies()).prepare(input.parsedDocuments).resolve([]),
	).toEqual(expected);
	const node = Object.values(input.priorSnapshots[0].nodes)[0];
	node.canonical += "tampered";
	expect(() => resolveIdentity(input, dependencies())).toThrow("node fingerprint hash mismatch");
	expect(() =>
		createIdentityPlan(input, dependencies()).prepare(input.parsedDocuments).resolve([]),
	).toThrow("node fingerprint hash mismatch");
});

it("prepared descriptors cannot bypass namespace, inventory or source conflict guards", () => {
	const input = fixture();
	input.priorSnapshots[1].courseId = "00000000-0000-4000-8000-000000000099";
	expect(() =>
		createIdentityPlan(input, dependencies()).prepare(input.parsedDocuments).resolve([]),
	).toThrow("namespace mismatch");
	const clean = fixture();
	const plan = createIdentityPlan(clean, dependencies());
	expect(() =>
		plan.prepare([clean.parsedDocuments[0], clean.parsedDocuments[0]]).resolve([]),
	).toThrow("duplicate parsed document path");
	clean.parsedDocuments[1].tree.stream.source += "\n<<<<<<< conflict\n";
	expect(() => plan.prepare(clean.parsedDocuments).resolve([])).toThrow("source conflict markers");
});

it("rejects an invalid digest before it can become a shared snapshot key", () => {
	expect(() =>
		createIdentityPlan(fixture(), { ...dependencies(), digest: () => "invalid" }),
	).toThrow("invalid SHA-256 hash");
});
