import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { editManifest } from "../../../apps/desktop/src/main/operations/manifest-editor.ts";
import { applyOperation, operationRegistry } from "../../operations/src/index.ts";
import { applyEdits, setFrontmatterPath, setYamlPath } from "../src/source-edit.ts";
import {
	corpusOperation,
	digest,
	operationFixture,
	sourceEditCorpus,
	yamlCorpusSource,
} from "./source-edit-corpus.ts";

function outsideRange(before: string, after: string, range: { start: number; end: number }) {
	expect(Buffer.from(after.slice(0, range.start))).toEqual(
		Buffer.from(before.slice(0, range.start)),
	);
	const tail = before.slice(range.end);
	expect(Buffer.from(after.slice(after.length - tail.length))).toEqual(Buffer.from(tail));
}

describe.each(sourceEditCorpus)("byte contract: $name", (entry) => {
	const invalid = "invalid" in entry;
	it("applyEdits preserves raw bytes and refuses invalid ranges", () => {
		const start = entry.source.indexOf("red # keep");
		const next = applyEdits(entry.source, [{ start, end: start + 3, text: "blue" }]);
		outsideRange(entry.source, next, { start, end: start + 3 });
		expect(Buffer.from(next)).toEqual(
			Buffer.from(entry.source.replace("red # keep", "blue # keep")),
		);
		for (const range of [
			{ start: -1, end: 0 },
			{ start: 2, end: 1 },
			{ start: 0.5, end: 1 },
			{ start: 0, end: entry.source.length + 1 },
			{ start: NaN, end: 1 },
		])
			expect(() => applyEdits(entry.source, [{ ...range, text: "changed" }])).toThrow(
				expect.objectContaining({ code: "invalid-args" }),
			);
		expect(() =>
			applyEdits(entry.source, [
				{ start: 0, end: 2, text: "a" },
				{ start: 1, end: 3, text: "b" },
			]),
		).toThrow(expect.objectContaining({ code: "invalid-args" }));
	});
	for (const operation of Object.keys(operationRegistry)) {
		it(`${operation} preserves untouched bytes and refuses an unapplied request`, () => {
			const f = operationFixture(entry.source);
			if (invalid) {
				const target = {
					file: "lesson.prax",
					ref: {
						kind: "node" as const,
						nodeId: "00000000-0000-4000-8000-000000000099",
						path: [1],
						fingerprint: "missing",
					},
					expectedText: "",
				};
				expect(f.run(operation, [target], {})).toMatchObject({ ok: false, code: "orphaned" });
				return;
			}
			const spec = corpusOperation(f, operation);
			const result = f.run(operation, spec.targets, spec.args);
			expect(result.ok, JSON.stringify(result)).toBe(true);
			if (!result.ok) throw new Error(result.code);
			const edits = result.files.flatMap((file) => file.edits);
			if (spec.readOnly) expect(edits).toEqual([]);
			else expect(edits.length).toBeGreaterThan(0);
			for (const edit of edits) {
				expect(edit.start).toBeGreaterThanOrEqual(spec.range.start);
				expect(edit.end).toBeLessThanOrEqual(spec.range.end);
			}
			const next = applyEdits(entry.source, edits);
			outsideRange(entry.source, next, spec.range);
			const stale = {
				...f.request(operation, spec.targets, spec.args),
				files: [{ path: "lesson.prax", baseRevision: "0".repeat(64) }],
			};
			expect(
				applyOperation([{ path: "lesson.prax", source: entry.source }], stale, {
					identity: f.identity,
					...f.dependencies,
				}),
			).toMatchObject({ ok: false, code: "stale" });
			// Recorded inverses are another source-edit entry point. Check exact bytes through it.
			const undo = applyOperation(
				[{ path: "lesson.prax", source: next }],
				{
					transactionId: "undo",
					operation: "applyInverse",
					targets: [],
					args: { operation: result },
					files: [{ path: "lesson.prax", baseRevision: digest(next) }],
				},
				{ identity: result.identity, clipboard: result.clipboard, ...f.dependencies },
			);
			expect(undo.ok, JSON.stringify(undo)).toBe(true);
			if (!undo.ok) throw new Error(undo.code);
			expect(
				Buffer.from(
					applyEdits(
						next,
						undo.files.flatMap((file) => file.edits),
					),
				),
			).toEqual(Buffer.from(entry.source));
		});
	}

	it("setFrontmatterPath preserves every byte outside the selected YAML value", () => {
		expect(() => setFrontmatterPath(entry.source, [], "blue")).toThrow(
			expect.objectContaining({ code: "invalid-args" }),
		);
		if (invalid) {
			expect(() => setFrontmatterPath(entry.source, ["design", "colorAccent"], "blue")).toThrow(
				expect.objectContaining({ code: "invalid-args" }),
			);
			return;
		}
		const next = setFrontmatterPath(entry.source, ["design", "colorAccent"], "blue");
		const start = entry.source.indexOf("red # keep");
		outsideRange(entry.source, next, { start, end: start + 3 });
		expect(Buffer.from(next)).toEqual(
			Buffer.from(entry.source.replace("red # keep", "blue # keep")),
		);
	});

	it("setYamlPath preserves the same corpus bytes around its selected scalar", () => {
		expect(() => setYamlPath(yamlCorpusSource(entry.source), [], "blue")).toThrow(
			expect.objectContaining({ code: "invalid-args" }),
		);
		if (invalid) {
			expect(() => setYamlPath(entry.source, ["design", "colorAccent"], "blue")).toThrow(
				expect.objectContaining({ code: "invalid-args" }),
			);
			return;
		}
		const source = yamlCorpusSource(entry.source);
		const next = setYamlPath(source, ["design", "colorAccent"], "blue");
		const start = source.indexOf("red # keep");
		outsideRange(source, next, { start, end: start + 3 });
		expect(Buffer.from(next)).toEqual(Buffer.from(source.replace("red # keep", "blue # keep")));
	});

	it.each(["lesson.prax", "course.yaml"])(
		"manifest editor preserves %s or returns a coded refusal without writes",
		async (file) => {
			const root = await mkdtemp(join(tmpdir(), "byte-contract-"));
			try {
				await writeFile(join(root, "lesson.prax"), entry.source);
				const course =
					invalid && file === "lesson.prax"
						? "title: Course\nlessons: [lesson.prax]\n"
						: yamlCorpusSource(entry.source);
				await writeFile(join(root, "course.yaml"), course);
				const source = file === "lesson.prax" ? entry.source : course;
				const result = await editManifest(root, {
					file,
					baseRevision: digest(source),
					path: ["design", "colorAccent"],
					value: "blue",
				});
				if (invalid) {
					expect(result).toMatchObject({ ok: false, code: "invalid-args" });
					expect(await readFile(join(root, file))).toEqual(Buffer.from(source));
				} else {
					expect(result.ok, JSON.stringify(result)).toBe(true);
					expect(await readFile(join(root, file))).toEqual(
						Buffer.from(source.replace("red # keep", "blue # keep")),
					);
				}
				const unchanged = await readFile(join(root, file));
				expect(
					await editManifest(root, {
						file,
						baseRevision: "0".repeat(64),
						path: ["design", "colorAccent"],
						value: "yellow",
					}),
				).toEqual({ ok: false, code: "stale" });
				expect(await readFile(join(root, file))).toEqual(unchanged);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		},
	);
});
