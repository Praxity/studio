import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import {
	assertDurableCandidate,
	createIdentityPlan,
	createIdentityReadSession,
	createIdentityResolver,
	type IdentityDependencies,
	type IdentityMergeState,
	mergeIdentity,
	type ResolveIdentityInput,
	resolveIdentity,
	serializeIdentity,
} from "../src/index.ts";
import {
	digest,
	legacyFixture,
	resolveLegacyFixture,
	version2Fixture,
} from "./legacy-store-fixture.ts";

const resolutions: [
	string,
	(input: ResolveIdentityInput, dependencies: IdentityDependencies) => unknown,
][] = [
	["pure resolution", resolveIdentity],
	["retained resolver", createIdentityResolver],
	[
		"prepared plan",
		(input, deps) => createIdentityPlan(input, deps).prepare(input.parsedDocuments).resolve([]),
	],
	["read session", (input, deps) => createIdentityReadSession(deps).resolve(input)],
];

it.each(resolutions)(
	"%s refuses version-2 descriptors before allocating any ID",
	(_name, resolve) => {
		const fixture = version2Fixture();
		const before = serializeIdentity(fixture.snapshot);
		let allocations = 0;
		expect(() =>
			resolve(
				{
					course: fixture.course,
					priorSnapshots: [fixture.snapshot],
					priorHeads: [{ ...fixture.head, head: digest(before) }],
					parsedDocuments: [{ path: "lesson.prax", tree: readLesson(fixture.source).tree }],
				},
				{
					digest,
					allocateId: () => {
						allocations++;
						return "00000000-0000-4000-8000-000000009999";
					},
				},
			),
		).toThrow(expect.objectContaining({ code: "EIDENTITY_CANONICAL_VERSION" }));
		expect(allocations).toBe(0);
		expect(serializeIdentity(fixture.snapshot)).toBe(before);
	},
);

it.each(["active", "cut", "retired"] as const)(
	"also refuses %s version-2 records in merge-base evidence",
	(status) => {
		const legacy = legacyFixture("reader-roles");
		const snapshot = version2Fixture().snapshot;
		const node = Object.values(snapshot.nodes).find((node) => node.canonicalVersion === 2);
		if (!node) throw new Error("Missing versioned node");
		node.status = status;
		expect(() =>
			resolveIdentity(
				{
					course: legacy.course,
					priorSnapshots: [legacy.snapshot],
					mergeBase: [snapshot],
					parsedDocuments: [{ path: "lesson.prax", tree: readLesson(legacy.source).tree }],
				},
				{
					digest,
					allocateId: () => {
						throw new Error("unexpected allocation");
					},
				},
			),
		).toThrow(expect.objectContaining({ code: "EIDENTITY_CANONICAL_VERSION" }));
	},
);

it.each(["base", "ours", "theirs"] as const)(
	"merge refuses version-2 records in %s without allocations",
	(side) => {
		const legacy = legacyFixture("reader-roles");
		const versioned = version2Fixture();
		const state: IdentityMergeState = {
			course: legacy.course,
			heads: [legacy.head],
			snapshots: [legacy.snapshot],
		};
		const states = { base: state, ours: state, theirs: state };
		states[side] = {
			course: versioned.course,
			heads: [{ ...versioned.head, head: digest(serializeIdentity(versioned.snapshot)) }],
			snapshots: [versioned.snapshot],
		};
		expect(() =>
			mergeIdentity(
				states.base,
				states.ours,
				states.theirs,
				[{ path: "lesson.prax", tree: readLesson(legacy.source).tree }],
				{
					digest,
					allocateId: () => {
						throw new Error("unexpected allocation");
					},
				},
			),
		).toThrow(expect.objectContaining({ code: "EIDENTITY_CANONICAL_VERSION" }));
	},
);

it("durable admission refuses a version-2 candidate", () => {
	const candidate = resolveLegacyFixture("reader-roles");
	candidate.snapshots = [version2Fixture().snapshot];
	expect(() => assertDurableCandidate(candidate)).toThrow(
		expect.objectContaining({ code: "EIDENTITY_CANONICAL_VERSION" }),
	);
});
