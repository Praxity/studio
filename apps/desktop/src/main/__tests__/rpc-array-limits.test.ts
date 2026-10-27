import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import {
	clipboardPutSchema,
	draftPersistenceSubmitSchema,
	draftPutSchema,
	manifestEditSchema,
	parseEditorInput,
} from "../../shared/editor-session";
import { LocalEditorStore } from "../operations/local-editor-store";
import { OperationService, requestSchema } from "../operations/operation-service";

const id = "00000000-0000-4000-8000-000000000001";
const revision = "a".repeat(64);
const ref = { kind: "node", nodeId: id, path: [0, 0], fingerprint: revision };
const request = {
	transactionId: "bounded",
	operation: "setText",
	files: [{ path: "lesson.prax", baseRevision: revision }],
	targets: [{ file: "lesson.prax", ref, expectedText: "Text" }],
	args: {},
};
const draft = {
	id: "draft",
	file: "lesson.prax",
	target: ref,
	baseRevision: revision,
	expectedText: "Text",
	editableText: "Text",
	baseText: "Text",
	text: "Edited",
	selection: [0, 0],
	generation: 1,
	status: "held",
	diagnostics: [],
	changedAt: 0,
	validatedGeneration: 1,
	persistedGeneration: 0,
};

// Count nested union branches too; one outer issue can hide thousands of element issues.
function issueCount(issues: z.core.$ZodIssue[]): number {
	return issues.reduce(
		(total, issue) =>
			total +
			1 +
			(issue.code === "invalid_union"
				? issue.errors.reduce((sum, branch) => sum + issueCount(branch), 0)
				: 0),
		0,
	);
}

it.each(["files", "targets"])("bounds operation %s before element validation", (field) => {
	const parsed = requestSchema.safeParse({ ...request, [field]: Array(50_001).fill(0) });
	expect(parsed.success).toBe(false);
	if (parsed.success) throw new Error("Expected collection refusal");
	expect(parsed.error.issues.length).toBe(1);
	expect(parsed.error.issues[0]).toMatchObject({
		code: "too_big",
		path: [field],
		maximum: 50_000,
	});
});

it.each(["node", "parentRef", "afterRef", "beforeRef"])(
	"bounds the operation reference path through %s",
	(kind) => {
		const nested = { ...ref, nodeId: null, path: Array(129).fill("invalid") };
		const targetRef =
			kind === "node"
				? { ...nested, nodeId: id }
				: { kind: "insertion", parentId: null, after: null, before: null, [kind]: nested };
		const parsed = requestSchema.safeParse({
			...request,
			targets: [{ ...request.targets[0], ref: targetRef }],
		});
		expect(parsed.success).toBe(false);
		if (parsed.success) throw new Error("Expected path refusal");
		expect(parsed.error.issues).toEqual([
			expect.objectContaining({ code: "too_big", maximum: 128 }),
		]);
	},
);

it.each(["draftPut", "draftPersistenceSubmit", "clipboardPut", "manifestEdit"])(
	"bounds collections admitted by %s",
	(method) => {
		const oversized = Array(50_001).fill(0);
		const cases = {
			draftPut: [draftPutSchema, { draft: { ...draft, diagnostics: oversized } }],
			draftPersistenceSubmit: [
				draftPersistenceSubmitSchema,
				{
					serviceId: id,
					attemptId: id,
					operation: { action: "put", draft: { ...draft, diagnostics: oversized } },
				},
			],
			clipboardPut: [
				clipboardPutSchema,
				{ clipboard: { file: "lesson.prax", text: "Text", nodeIds: oversized } },
			],
			manifestEdit: [
				manifestEditSchema,
				{ file: "course.yaml", baseRevision: revision, path: ["lessons"], value: oversized },
			],
		} as const;
		const [schema, input] = cases[method as keyof typeof cases];
		const parsed = schema.safeParse(input);
		expect(parsed.success).toBe(false);
		if (parsed.success) throw new Error("Expected collection refusal");
		expect(issueCount(parsed.error.issues)).toBeLessThanOrEqual(8);
	},
);

it("bounds draftResolve diagnostics through the service interface", async () => {
	await expect(
		new OperationService("unused").draftResolve({
			draft: {
				...draft,
				diagnostics: Array(50_001).fill({
					file: "lesson.prax",
					ref: null,
					severity: "error",
					message: { key: "op.invalid-args", params: {} },
				}),
			},
		}),
	).rejects.toSatisfy(
		(error: unknown) => error instanceof z.ZodError && issueCount(error.issues) <= 4,
	);
});

it("bounds stored draft buckets without changing their bytes", async () => {
	const root = await mkdtemp(join(tmpdir(), "bounded-drafts-"));
	try {
		const directory = join(root, ".praxity/local/drafts");
		await mkdir(directory, { recursive: true });
		const file = join(directory, `${id}.json`);
		const bytes = JSON.stringify({
			schema: 1,
			lessonId: id,
			file: "lesson.prax",
			drafts: Array(50_001).fill(0),
		});
		await writeFile(file, bytes);
		await expect(new LocalEditorStore(root).draftList()).rejects.toSatisfy(
			(error: unknown) => error instanceof z.ZodError && issueCount(error.issues) <= 6,
		);
		expect(await readFile(file, "utf8")).toBe(bytes);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("stops the raw JSON pre-pass after its first prototype refusal", () => {
	const value = Array.from({ length: 1_000 }, () =>
		JSON.parse('{"__proto__":1,"constructor":1,"prototype":1}'),
	);
	let refusal: unknown;
	try {
		parseEditorInput(manifestEditSchema, {
			file: "course.yaml",
			baseRevision: revision,
			path: ["design"],
			value,
		});
	} catch (error) {
		refusal = error;
	}
	expect(refusal instanceof z.ZodError).toBe(true);
	if (!(refusal instanceof z.ZodError)) throw new Error("Expected prototype refusal");
	expect(refusal.issues.length).toBe(1);
});

import { createHash } from "node:crypto";

it("never writes a draft bucket that its read limit would refuse", async () => {
	const root = await mkdtemp(join(tmpdir(), "bounded-draft-write-"));
	try {
		await writeFile(join(root, "course.yaml"), "title: Course\nlessons: [lesson.prax]\n");
		await writeFile(join(root, "lesson.prax"), "# Page\n\nText\n");
		const directory = join(root, ".praxity/local/drafts");
		await mkdir(directory, { recursive: true });
		const filename = `file-${createHash("sha256").update("lesson.prax").digest("hex")}.json`;
		const file = join(directory, filename);
		const bytes = JSON.stringify({
			schema: 2,
			file: "lesson.prax",
			drafts: Array.from({ length: 50_000 }, (_, index) => ({ ...draft, id: `draft-${index}` })),
		});
		await writeFile(file, bytes);
		await expect(new LocalEditorStore(root).draftPut({ draft })).rejects.toBeInstanceOf(z.ZodError);
		expect(await readFile(file, "utf8")).toBe(bytes);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
