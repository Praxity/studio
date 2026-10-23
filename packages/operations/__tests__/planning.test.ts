import { createHash } from "node:crypto";
import { resolveIdentity } from "@praxity/content-identity";
import { tokenizeLesson } from "@praxity/grammar/src/v4/lex/index.ts";
import { getDefinition } from "@praxity/grammar/src/v4/schema.ts";
import { analyzeLessonTree } from "@praxity/grammar/src/v4/tree/index.ts";
import { expect, it, vi } from "vitest";
import { applyOperation, consumeOperationIdentity } from "../src/index.ts";

const calls = vi.hoisted(() => ({
	descriptions: [] as string[],
	parses: [] as string[],
	resolutions: 0,
	validations: 0,
}));
vi.mock("@praxity/content-identity", async (original) => {
	const actual = await original<typeof import("@praxity/content-identity")>();
	return {
		...actual,
		createIdentityPlan: (...args: Parameters<typeof actual.createIdentityPlan>) => {
			const plan = actual.createIdentityPlan(...args);
			return {
				...plan,
				prepare: (...documents: Parameters<typeof plan.prepare>) => {
					const prepared = plan.prepare(...documents);
					return {
						...prepared,
						resolve: (...operations: Parameters<typeof prepared.resolve>) => {
							calls.resolutions++;
							return prepared.resolve(...operations);
						},
					};
				},
			};
		},
	};
});
vi.mock("../../content-identity/src/files.ts", async (original) => {
	const actual = await original<typeof import("../../content-identity/src/files.ts")>();
	return {
		...actual,
		parseIdentitySnapshot: (...args: Parameters<typeof actual.parseIdentitySnapshot>) => {
			calls.validations++;
			return actual.parseIdentitySnapshot(...args);
		},
	};
});
vi.mock("../../content-identity/src/canonical.ts", async (original) => {
	const actual = await original<typeof import("../../content-identity/src/canonical.ts")>();
	return {
		...actual,
		describeDocument: (...args: Parameters<typeof actual.describeDocument>) => {
			calls.descriptions.push(args[0].path);
			return actual.describeDocument(...args);
		},
	};
});
vi.mock("@praxity/grammar/src/v4/tree/index.ts", async (original) => {
	const actual = await original<typeof import("@praxity/grammar/src/v4/tree/index.ts")>();
	return {
		...actual,
		analyzeLessonTree: (...args: Parameters<typeof actual.analyzeLessonTree>) => {
			calls.parses.push(args[0].source);
			return actual.analyzeLessonTree(...args);
		},
	};
});

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture(
	source = "# Page\n::: accordion\n:: First\nBody\n:: Second\nOther\n:::\n\nTail\n",
	type = "accordion",
) {
	const files = [
		{
			path: "a.prax",
			source,
		},
		{ path: "b.prax", source: "# Elsewhere\nUnchanged\n" },
	];
	let next = 1;
	const dependencies = {
		digest,
		allocateId: () => `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, "0")}`,
	};
	const identity = resolveIdentity(
		{
			parsedDocuments: files.map((file) => ({
				path: file.path,
				tree: analyzeLessonTree(tokenizeLesson(file.source), { definition: getDefinition }),
			})),
			priorSnapshots: [],
			readerRoles: true,
		},
		dependencies,
	);
	const target = identity.sourceMappings.find((mapping) =>
		identity.snapshots.some((snapshot) => snapshot.nodes[mapping.id]?.type === type),
	);
	if (!target) throw new Error("Missing accordion");
	const run = () =>
		applyOperation(
			files,
			{
				transactionId: "counts",
				operation: "moveBlocks",
				files: files.map((file) => ({ path: file.path, baseRevision: digest(file.source) })),
				targets: [
					{
						file: target.file,
						ref: {
							kind: "node",
							nodeId: target.id,
							path: target.path,
							fingerprint: target.fingerprint,
						},
					},
				],
				args: { direction: "down" },
			},
			{ identity, readerRoles: true, ...dependencies },
		);
	return { files, dependencies, identity, target, run };
}

it("inline policy and planning share the changed parse and the unchanged course candidates", () => {
	const source = "# Page\nA [link](https://example.com).\n";
	const { files, dependencies, identity, target } = fixture(source, "body");
	const raw = "[link](https://example.com)";
	const start = source.indexOf(raw);
	calls.descriptions.length = 0;
	calls.parses.length = 0;
	const result = applyOperation(
		files,
		{
			transactionId: "inline-counts",
			operation: "editInline",
			files: files.map((file) => ({ path: file.path, baseRevision: digest(file.source) })),
			targets: [
				{
					file: target.file,
					ref: {
						kind: "node",
						nodeId: target.id,
						path: target.path,
						fingerprint: target.fingerprint,
					},
					inline: { start, end: start + raw.length, expectedText: raw },
				},
			],
			args: { text: "Changed" },
		},
		{ identity, readerRoles: true, ...dependencies },
	);
	expect(result.ok).toBe(true);
	expect(calls.parses.filter((source) => source === files[1].source)).toHaveLength(1);
	expect(
		calls.parses.filter((source) => source === "# Page\nA [Changed](https://example.com).\n"),
	).toHaveLength(1);
	expect(calls.descriptions.sort()).toEqual(["a.prax", "b.prax"]);
});

it("forward and inverse plans describe and resolve once, without reparsing unchanged lessons", () => {
	const { files, dependencies, run } = fixture();
	calls.descriptions.length = 0;
	calls.parses.length = 0;
	calls.resolutions = 0;
	calls.validations = 0;
	const result = run();
	expect(result.ok).toBe(true);
	expect(calls.descriptions.sort()).toEqual(["a.prax", "b.prax"]);
	expect(calls.parses.filter((source) => source === files[1].source)).toHaveLength(1);
	expect(calls.resolutions).toBe(1);
	expect(calls.validations).toBe(4);
	if (!result.ok) throw new Error(result.code);
	calls.descriptions.length = 0;
	calls.parses.length = 0;
	calls.resolutions = 0;
	calls.validations = 0;
	const inverse = applyOperation(
		result.history.after,
		{
			transactionId: "inverse-counts",
			operation: "applyInverse",
			targets: [],
			files: result.history.after.map((file) => ({
				path: file.path,
				baseRevision: digest(file.source),
			})),
			args: { operation: result },
		},
		{ identity: result.identity, readerRoles: true, ...dependencies },
	);
	expect(inverse.ok).toBe(true);
	expect(calls.descriptions.sort()).toEqual(["a.prax", "b.prax"]);
	expect(calls.parses.filter((source) => source === files[1].source)).toHaveLength(1);
	expect(calls.resolutions).toBe(1);
	expect(calls.validations).toBe(4);
});

it("copies descriptors once for preparation and once at consumption", () => {
	const { files, identity, run } = fixture();
	const clone = globalThis.structuredClone;
	let descriptorCopies = 0;
	const spy = vi.spyOn(globalThis, "structuredClone").mockImplementation((value, options) => {
		if (Array.isArray(value) && value.some((entry) => entry && "canonical" in entry))
			descriptorCopies++;
		return clone(value, options);
	});
	try {
		const result = run();
		if (!result.ok) throw new Error(result.code);
		expect(descriptorCopies).toBe(1);
		const consumed = consumeOperationIdentity(result, {
			identity,
			before: files,
			after: result.history.after,
			operations: result.evidence,
			readerRoles: true,
		});
		expect(consumed.descriptors?.length).toBeGreaterThan(0);
		expect(descriptorCopies).toBe(2);
	} finally {
		spy.mockRestore();
	}
});

it("an inverse refuses stale when both an unrequested lesson and its head snapshot are absent", () => {
	const { dependencies, run } = fixture();
	const result = run();
	if (!result.ok) throw new Error(result.code);
	const missing = structuredClone(result.identity);
	missing.heads[1].head = "0".repeat(64);
	expect(
		applyOperation(
			result.history.after.filter((file) => file.path === "a.prax"),
			{
				transactionId: "missing-head",
				operation: "applyInverse",
				targets: [],
				files: result.history.after
					.filter((file) => file.path === "a.prax")
					.map((file) => ({ path: file.path, baseRevision: digest(file.source) })),
				args: { operation: result },
			},
			{ identity: missing, readerRoles: true, ...dependencies },
		),
	).toMatchObject({ ok: false, code: "stale" });
});
