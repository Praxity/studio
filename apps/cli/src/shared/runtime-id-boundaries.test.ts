import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runNarrationCli } from "../main/narration-cli";
import { LocalEditorStore } from "../main/operations/local-editor-store";
import { editCliOutputSchema } from "./edit-cli-schema";
import { clipboardSchema, draftSchema, insertionRefSchema, nodeRefSchema } from "./editor-session";
import { parseNarrationSidecarV2 } from "./narration-sidecar";
import { parseReviewRun } from "./review/model";

const runtimeId = "rt-00000000000000000000000000001003";
const durableId = "00000000-0000-4000-8000-000000001003";
const courseId = "00000000-0000-4000-8000-000000000001";
const lessonId = "00000000-0000-4000-8000-000000000002";
const hash = "a".repeat(64);
const target = (id: string) => ({ kind: "node", nodeId: id, path: [0], fingerprint: hash });
const draft = (id: string) => ({
	id: "draft",
	file: "a.prax",
	target: target(id),
	baseRevision: hash,
	expectedText: "Text",
	editableText: "Text",
	baseText: "Text",
	text: "Text",
	selection: [0, 0],
	generation: 1,
	status: "dirty",
	diagnostics: [],
	changedAt: 1,
	validatedGeneration: -1,
	persistedGeneration: -1,
});
const cliOutput = (id: string) => ({
	schema: 1,
	ok: true,
	dryRun: false,
	operation: "insert",
	files: [],
	intent: "insert",
	mapping: [{ oldId: null, newId: id, fate: "new" }],
	summary: { key: "op.insert", params: {} },
	diagnostics: [],
	focus: { file: "a.prax", nodeId: id, role: "handle" },
});

describe("durable runtime-ID refusal table", () => {
	const ingresses: Array<[string, (id: string) => unknown]> = [
		["operation nodeId", (id) => nodeRefSchema.parse(target(id))],
		...["parentId", "after", "before"].map((field): [string, (id: string) => unknown] => [
			`insertion ${field}`,
			(id) =>
				insertionRefSchema.parse({
					kind: "insertion",
					parentId: null,
					after: null,
					before: null,
					[field]: id,
				}),
		]),
		[
			"clipboard nodeIds",
			(id) => clipboardSchema.parse({ file: "a.prax", text: "Text", nodeIds: [id] }),
		],
		["draft target", (id) => draftSchema.parse(draft(id))],
		[
			"draft outside target",
			(id) =>
				draftSchema.parse({
					...draft(durableId),
					outside: {
						file: "a.prax",
						target: target(id),
						baseRevision: hash,
						expectedText: "Text",
						editableText: "Text",
					},
				}),
		],
		[
			"draft diagnostic ref",
			(id) =>
				draftSchema.parse({
					...draft(durableId),
					diagnostics: [
						{
							file: "a.prax",
							ref: target(id),
							severity: "error",
							message: { key: "op.invalid", params: {} },
						},
					],
				}),
		],
		[
			"narration target",
			(id) =>
				parseNarrationSidecarV2(
					`version: 2\ncourseId: ${courseId}\nlessons:\n  ${lessonId}:\n    segments:\n      - target: { id: ${id}, role: body }\n`,
				),
		],
		[
			"narration lesson namespace",
			(id) =>
				parseNarrationSidecarV2(
					`version: 2\ncourseId: ${courseId}\nlessons:\n  ${id}:\n    segments: []\n`,
				),
		],
		[
			"narration course namespace",
			(id) => parseNarrationSidecarV2(`version: 2\ncourseId: ${id}\nlessons: {}\n`),
		],
		[
			"review summary entityId",
			(id) =>
				parseReviewRun(
					JSON.stringify({
						schema: 1,
						author: "A",
						createdAt: "2026-10-12T00:00:00Z",
						summaries: [{ entityId: id, summary: "Changed" }],
					}),
				),
		],
		[
			"edit CLI mapping",
			(id) =>
				editCliOutputSchema.parse({
					...cliOutput(durableId),
					mapping: [{ oldId: null, newId: id, fate: "new" }],
				}),
		],
		[
			"edit CLI focus",
			(id) =>
				editCliOutputSchema.parse({
					...cliOutput(durableId),
					focus: { file: "a.prax", nodeId: id, role: "handle" },
				}),
		],
	];
	it.each(ingresses)("refuses runtime IDs at %s, accepts UUID control", (_name, accept) => {
		expect(() => accept(durableId)).not.toThrow();
		expect(() => accept(runtimeId)).toThrow(
			_name === "review summary entityId"
				? new Error("Identity: runtime ID cannot be durable")
				: undefined,
		);
	});
	it("narration CLI refuses runtime targets before accessing a project", async () => {
		const result = await runNarrationCli(["narration", "accept", `${runtimeId}:body`]);
		expect(result.exitCode).toBe(2);
		expect(result.stdout).toBe("");
	});
	it("edit CLI dry-run accepts runtime mapping and focus IDs", () => {
		const output = { ...cliOutput(runtimeId), dryRun: true };
		expect(editCliOutputSchema.parse(output)).toEqual(output);
	});
	it("draft bucket lesson identity refuses runtime tokens with unchanged bytes", async () => {
		const root = await mkdtemp(join(tmpdir(), "runtime-id-boundary-"));
		try {
			const folder = join(root, ".praxity/local/drafts");
			await mkdir(folder, { recursive: true });
			const file = join(folder, `${lessonId}.json`);
			const document = { schema: 1, lessonId, file: "a.prax", drafts: [] };
			await writeFile(file, JSON.stringify(document));
			expect(await new LocalEditorStore(root).draftList()).toEqual([]);
			const forged = JSON.stringify({ ...document, lessonId: runtimeId });
			await writeFile(file, forged);
			await expect(new LocalEditorStore(root).draftList()).rejects.toThrow();
			expect(await readFile(file, "utf8")).toBe(forged);
		} finally {
			await rm(root, { recursive: true });
		}
	});
});
