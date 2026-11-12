import { readFile } from "node:fs/promises";
import { RULE_METADATA } from "@praxity/editor-core/lib/a11y/rule-metadata.ts";
import type { DesktopExportInput } from "@praxity/export-pipeline";
import { readLesson } from "@praxity/grammar";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { describe, expect, it } from "vitest";
import { signalGif } from "../../test-utils/signal-gif";
import { type AuthorWarning, assertExportAccessibility } from "../export/accessibility-enforcement";

const source = (question = "Question", right = "Answer", label = "Label", option = "Option") =>
	`---\ntitle: Practice\n---\n# Practice\n::: write-distractors ${question}\nanswer: ${right}\n:: ${label}\noption: ${option}\n:::\n`;
function input(blocks: PraxityBlock[]): DesktopExportInput {
	return {
		courseId: "test",
		blocks,
		frontmatter: { title: "Signal" },
		config: { completionThreshold: 1 },
		resolvedAssets: new Map([["assets/signal.gif", signalGif(5)]]),
		viewerVersion: "test",
		locale: "en",
	};
}
const block = (type: string, data: Record<string, unknown>): PraxityBlock => ({
	id: type,
	type: type as PraxityBlock["type"],
	data,
});

describe("export accessibility contract", () => {
	it("evaluates every rule marked export-blocking, including media and source diagnostics", async () => {
		const sources = [
			source("Q".repeat(401)),
			source(undefined, "R".repeat(301)),
			source(undefined, undefined, "L".repeat(121)),
			source(undefined, undefined, undefined, "O".repeat(301)),
			source().replace(":::\n", ":: label\noption: Another\n:::\n"),
		].map((text) => readLesson(text));
		const issues = await assertExportAccessibility(
			input([
				block("image", { src: "/assets/signal.gif", altText: "" }),
				block("hotgraphic", { imageAlt: "" }),
				block("hotspot", { image: "/assets/photo.png", imageAlt: "" }),
				block("labeledGraphic", { imageAlt: "" }),
				block("narrative", { items: [{ imageSrc: "/assets/photo.png", imageAlt: "" }] }),
				block("gmcq", {
					question: "Question",
					options: [
						{ text: "Option", isCorrect: true, imageSrc: "/assets/photo.png", imageAlt: "" },
					],
				}),
				block("button", { text: "" }),
			]),
			false,
			undefined,
			sources,
		);
		expect(new Set(issues.map((issue) => issue.rule))).toEqual(
			new Set(
				Object.entries(RULE_METADATA)
					.filter(([, metadata]) => metadata.exportPolicy === "block")
					.map(([rule]) => rule),
			),
		);
	});
	it("permits the long-held frame without counting an incomplete flash in the window", async () => {
		const course = input([block("image", { src: "/assets/signal.gif", altText: "Signal" })]);
		course.resolvedAssets.set("assets/signal.gif", signalGif([5, 200, 5, 5, 5, 5, 5, 5, 5]));
		await expect(assertExportAccessibility(course)).resolves.toEqual([]);
	});
	it.each(["avatar", "cornerImage", "poster"])(
		"checks the canonical %s visual field",
		async (field) => {
			const course = input([
				block("dialogue", { speakers: { alex: { [field]: "/assets/signal.gif" } } }),
			]);
			await expect(assertExportAccessibility(course)).rejects.toMatchObject({
				issues: [expect.objectContaining({ rule: "gif-flash-threshold" })],
			});
		},
	);
	it.each(["my signal.gif", "caf\u00e9.gif"])(
		"matches encoded references to admitted %s bytes",
		async (name) => {
			const reference = `/assets/${encodeURIComponent(name)}`;
			const course = input([block("image", { src: reference, altText: "Signal" })]);
			course.resolvedAssets = new Map([[`assets/${name}`, signalGif(5)]]);
			await expect(assertExportAccessibility(course)).rejects.toMatchObject({
				issues: [
					expect.objectContaining({ rule: "gif-flash-threshold", sourceLocation: reference }),
				],
			});
		},
	);
	it("keeps benign oversize GIFs advisory instead of decoding all their frames", async () => {
		const course = input([block("image", { src: "/assets/signal.gif", altText: "Recording" })]);
		course.resolvedAssets.set(
			"assets/signal.gif",
			await readFile(
				"packages/editor-core/src/lib/a11y/__tests__/fixtures/gif-flash/benign-large.gif",
			),
		);
		// The export interface must keep this recording publishable, with an actionable warning.
		const warnings: AuthorWarning[] = [];
		await expect(
			assertExportAccessibility(course, true, undefined, [], { authorWarnings: warnings }),
		).resolves.toEqual([]);
		expect(warnings).toEqual([
			expect.objectContaining({
				code: "gif-flash-unchecked",
				file: "/assets/signal.gif",
				message: expect.stringContaining("too large to check for flashing"),
			}),
		]);
	});
	it("shares the analysis reservation across course GIFs", async () => {
		const bytes = await readFile(
			"packages/editor-core/src/lib/a11y/__tests__/fixtures/gif-flash/benign-medium.gif",
		);
		const course = input([
			block("image", { src: "/assets/first.gif", altText: "First" }),
			{ ...block("image", { src: "/assets/second.gif", altText: "Second" }), id: "second" },
		]);
		course.resolvedAssets = new Map([
			["assets/first.gif", bytes],
			["assets/second.gif", bytes],
		]);
		const warnings: AuthorWarning[] = [];
		await expect(
			assertExportAccessibility(course, true, undefined, [], { authorWarnings: warnings }),
		).resolves.toEqual([]);
		expect(warnings.map((warning) => warning.file)).toEqual(["/assets/second.gif"]);
	});
	it("treats an invalid frame descriptor as too large without trying to decode it", async () => {
		const bytes = signalGif(5);
		bytes[32] = 255;
		bytes[33] = 255;
		const course = input([block("image", { src: "/assets/signal.gif", altText: "Signal" })]);
		course.resolvedAssets.set("assets/signal.gif", bytes);
		const warnings: AuthorWarning[] = [];
		await expect(
			assertExportAccessibility(course, true, undefined, [], { authorWarnings: warnings }),
		).resolves.toEqual([]);
		expect(warnings).toEqual([expect.objectContaining({ code: "gif-flash-unchecked" })]);
	});
	it("does not reuse an earlier GIF analysis after bytes change", async () => {
		const course = input([block("image", { src: "/assets/signal.gif", altText: "Signal" })]);
		await expect(assertExportAccessibility(course)).rejects.toMatchObject({
			issues: [expect.objectContaining({ rule: "gif-flash-threshold" })],
		});
		course.resolvedAssets.set("assets/signal.gif", signalGif(60));
		await expect(assertExportAccessibility(course)).resolves.toEqual([]);
	});
});
