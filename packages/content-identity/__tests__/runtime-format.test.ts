import { createHash } from "node:crypto";
import { isDisplayNodeId, isIdentityNodeId, isRuntimeNodeId } from "@praxity/content-model/types";
import { readLesson } from "@praxity/grammar";
import { describe, expect, it } from "vitest";
import {
	type IdentityDependencies,
	parseCourseIdentity,
	parseIdentitySnapshot,
	type ResolveIdentityInput,
	resolveIdentity,
	serializeIdentity,
} from "../src/index";

const runtimeId = "rt-00000000000000000000000000001003";
const durableId = "00000000-0000-4000-8000-000000009999";
const refusal = "Identity: runtime ID cannot be durable";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function dependencies(start = 5000): IdentityDependencies {
	let n = start;
	return { digest, allocateId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` };
}
const doc = (source: string) => ({ path: "a.prax", tree: readLesson(source).tree });
const source = "# P\n\n::: note\nOne\n:::\n";
const inserted = "# P\n\n::: note\nNew\n:::\n\n::: note\nOne\n:::\n";
const stored = resolveIdentity(
	{ parsedDocuments: [doc(source)], priorSnapshots: [] },
	dependencies(0),
);
const base: ResolveIdentityInput = {
	course: stored.course,
	priorSnapshots: stored.snapshots,
	priorHeads: stored.heads,
	parsedDocuments: [doc(inserted)],
};
function changedSnapshot(change: (snapshot: (typeof stored.snapshots)[number]) => void) {
	const snapshots = structuredClone(stored.snapshots);
	change(snapshots[0]);
	return {
		...base,
		priorSnapshots: snapshots,
		priorHeads: [{ ...stored.heads[0], head: digest(serializeIdentity(snapshots[0])) }],
	};
}

describe("runtime identity format", () => {
	it("separates display tokens from durable identity", () => {
		expect(isRuntimeNodeId(runtimeId)).toBe(true);
		expect(isRuntimeNodeId("rt-abcdef0123456789abcdef0123456789")).toBe(true);
		expect(isRuntimeNodeId("rt-ffffffffffffffffffffffffffffffff")).toBe(true);
		expect(isIdentityNodeId(runtimeId)).toBe(false);
		expect(isRuntimeNodeId(durableId)).toBe(false);
		expect(isIdentityNodeId(durableId)).toBe(true);
		expect(isDisplayNodeId(runtimeId)).toBe(true);
		expect(isDisplayNodeId(durableId)).toBe(true);
	});
	it.each([
		null,
		undefined,
		1003,
		{},
		"",
		"rt-",
		"rt-0000000000000000000000000001003",
		"rt-000000000000000000000000000001003",
		"rt-0000000000000000000000000000100G",
		"rt-0000000000000000000000000000100A",
		"RT-00000000000000000000000000001003",
		"rt-00000000-0000-4000-8000-000000001003",
		`${runtimeId}\n`,
		` ${runtimeId}`,
		`${runtimeId}x`,
		"authored-name",
	])("refuses malformed display identity %j", (value) => {
		expect(isRuntimeNodeId(value)).toBe(false);
		expect(isDisplayNodeId(value)).toBe(false);
	});

	const ingresses: Array<[string, (id: string) => unknown]> = [
		[
			"operation mapping.newId",
			(id) =>
				resolveIdentity(
					{
						...base,
						operations: [
							{
								intent: "insert",
								files: [
									{
										path: "a.prax",
										fromRevision: digest(source),
										toRevision: digest(inserted),
										fromSnapshot: stored.heads[0].head,
									},
								],
								mapping: [{ oldId: null, newId: id, fate: "new" }],
								placements: [{ mappingIndex: 0, file: "a.prax", path: [0, 0] }],
							},
						],
					},
					dependencies(),
				),
		],
		[
			"stored lineage",
			(id) =>
				resolveIdentity(
					changedSnapshot((s) => {
						Object.values(s.nodes)
							.find((n) => n.type === "note")
							?.lineage.push(id);
					}),
					dependencies(),
				),
		],
		[
			"retired leaf node key",
			(id) =>
				resolveIdentity(
					changedSnapshot((s) => {
						const note = Object.values(s.nodes).find((n) => n.type === "note");
						if (!note) throw new Error("Missing fixture note");
						s.nodes[id] = { ...structuredClone(note), status: "retired", lineage: [] };
					}),
					dependencies(),
				),
		],
		[
			"snapshot parent",
			(id) => {
				const s = structuredClone(stored.snapshots[0]);
				const note = Object.values(s.nodes).find((n) => n.type === "note");
				const page = Object.values(s.nodes).find((n) => n.kind === "page");
				if (!note || !page) throw new Error("Missing fixture nodes");
				note.parent = id;
				s.nodes[id] = { ...structuredClone(page), status: "retired" };
				return parseIdentitySnapshot(serializeIdentity(s));
			},
		],
		[
			"mergeBase lineage",
			(id) => {
				const snapshots = structuredClone(stored.snapshots);
				Object.values(snapshots[0].nodes)
					.find((n) => n.type === "note")
					?.lineage.push(id);
				return resolveIdentity({ ...base, mergeBase: snapshots }, dependencies());
			},
		],
		[
			"course namespace",
			(id) =>
				resolveIdentity(
					{ ...base, course: { schema: 1, courseId: id }, priorSnapshots: [], priorHeads: [] },
					dependencies(),
				),
		],
		["course.json", (id) => parseCourseIdentity(JSON.stringify({ schema: 1, courseId: id }))],
		[
			"snapshot lesson namespace",
			(id) => {
				const s = structuredClone(stored.snapshots[0]);
				s.nodes[id] = s.nodes[s.lessonId];
				delete s.nodes[s.lessonId];
				for (const node of Object.values(s.nodes)) if (node.parent === s.lessonId) node.parent = id;
				s.lessonId = id;
				return parseIdentitySnapshot(serializeIdentity(s));
			},
		],
		[
			"durable allocator output",
			(id) => {
				const deps = dependencies(5000);
				let first = true;
				return resolveIdentity(
					{ parsedDocuments: [doc(source)], priorSnapshots: [], course: stored.course },
					{
						digest,
						allocateId: () => {
							if (first) {
								first = false;
								return id;
							}
							return deps.allocateId();
						},
					},
				);
			},
		],
	];
	it.each(ingresses)("refuses runtime tokens without session state: %s", (_name, accept) => {
		expect(() => accept(runtimeId)).toThrow(refusal);
	});
	it.each(ingresses)("accepts a durable control: %s", (_name, accept) =>
		expect(() => accept(durableId)).not.toThrow(),
	);
	it("retains the ordinary invalid UUID refusal", () => {
		expect(() => parseCourseIdentity('{"schema":1,"courseId":"authored-name"}')).toThrow(
			"Identity: invalid UUID",
		);
	});
});
