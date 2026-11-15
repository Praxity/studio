import { readFile } from "node:fs/promises";
import { RULE_METADATA } from "@praxity/editor-core/lib/a11y/rule-metadata.ts";
import type { DesktopExportInput } from "@praxity/export-pipeline";
import { readLesson } from "@praxity/grammar";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { describe, expect, it, vi } from "vitest";
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
	it.each([2, 8])("refuses a %i-frame looping strobe", async (frames) => {
		const course = input([block("image", { src: "/assets/signal.gif", altText: "Signal" })]);
		course.resolvedAssets.set("assets/signal.gif", signalGif(10, { frames, loop: 0 }));
		await expect(assertExportAccessibility(course)).rejects.toMatchObject({
			issues: [expect.objectContaining({ rule: "gif-flash-threshold" })],
		});
	});
	it.each([undefined, 1])("does not replay an eight-frame GIF with loop count %s", async (loop) => {
		const course = input([block("image", { src: "/assets/signal.gif", altText: "Signal" })]);
		course.resolvedAssets.set("assets/signal.gif", signalGif(10, { frames: 8, loop }));
		await expect(assertExportAccessibility(course)).resolves.toEqual([]);
	});
	it("refuses a strobe with enough finite repetitions", async () => {
		const course = input([block("image", { src: "/assets/signal.gif", altText: "Signal" })]);
		course.resolvedAssets.set("assets/signal.gif", signalGif(10, { frames: 2, loop: 5 }));
		await expect(assertExportAccessibility(course)).rejects.toMatchObject({
			issues: [expect.objectContaining({ rule: "gif-flash-threshold" })],
		});
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
	it("keeps oversized canvases advisory instead of allocating them", async () => {
		const course = input([block("image", { src: "/assets/signal.gif", altText: "Recording" })]);
		course.resolvedAssets.set(
			"assets/signal.gif",
			await readFile(
				"packages/editor-core/src/lib/a11y/__tests__/fixtures/gif-flash/oversized-canvas.gif",
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
	it("gives each course GIF its own live-memory budget", async () => {
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
		expect(warnings).toEqual([]);
	});
	it("treats an invalid frame descriptor as malformed without trying to decode it", async () => {
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

	it.each(["benign-medium.gif", "benign-large.gif"])(
		"still refuses a strobe after %s",
		async (name) => {
			const prefix = "packages/editor-core/src/lib/a11y/__tests__/fixtures/gif-flash/";
			const course = input([
				block("image", { src: "/assets/intro.gif", altText: "Intro" }),
				{ ...block("image", { src: "/assets/strobe.gif", altText: "Strobe" }), id: "strobe" },
			]);
			course.resolvedAssets = new Map([
				["assets/intro.gif", await readFile(prefix + name)],
				["assets/strobe.gif", await readFile(prefix + "strobe-320x240.gif")],
			]);
			const warnings: AuthorWarning[] = [];
			await expect(
				assertExportAccessibility(course, true, undefined, [], { authorWarnings: warnings }),
			).rejects.toMatchObject({
				issues: [
					expect.objectContaining({
						sourceLocation: "/assets/strobe.gif",
						rule: "gif-flash-threshold",
					}),
				],
			});
			expect(warnings).toEqual([]);
		},
	);
	it.each([0, 1, 12, 20, 22, 30, 255])(
		"skips malformed LZW code size %i before decode",
		async (code) => {
			const bytes = signalGif(5, { frames: 2 });
			bytes[37] = code;
			bytes[60] = code;
			expect(bytes.byteLength).toBe(66);
			const course = input([block("image", { src: "/assets/signal.gif", altText: "Signal" })]);
			course.resolvedAssets.set("assets/signal.gif", bytes);
			const warnings: AuthorWarning[] = [];
			await expect(
				assertExportAccessibility(course, true, undefined, [], { authorWarnings: warnings }),
			).resolves.toEqual([]);
			expect(warnings).toEqual([
				expect.objectContaining({
					message: "This GIF is malformed and cannot be checked for flashing",
				}),
			]);
		},
	);
	it("reports excessive frame-pixel work before decoding", async () => {
		const bytes = signalGif(5, { frames: 801 });
		// Valid descriptors request 200.25M frame pixels; compressed payload is never decoded.
		bytes.set([244, 1, 244, 1], 6);
		for (let i = 0; i < 801; i++) bytes.set([244, 1, 244, 1], 32 + i * 23);
		const course = input([block("image", { src: "/assets/signal.gif", altText: "Signal" })]);
		course.resolvedAssets.set("assets/signal.gif", bytes);
		const warnings: AuthorWarning[] = [];
		await assertExportAccessibility(course, true, undefined, [], { authorWarnings: warnings });
		expect(warnings[0].message).toContain("too many frames or frame pixels");
	});
	it("reports the frame-count limit with its own reason", async () => {
		const course = input([block("image", { src: "/assets/signal.gif", altText: "Signal" })]);
		course.resolvedAssets.set("assets/signal.gif", signalGif(5, { frames: 1001 }));
		const warnings: AuthorWarning[] = [];
		await assertExportAccessibility(course, true, undefined, [], { authorWarnings: warnings });
		expect(warnings[0].message).toContain("too many frames");
	});
	it("does not read GIF bytes for static PDF checking", async () => {
		const course = input([block("image", { src: "/assets/signal.gif", altText: "Signal" })]);
		const read = vi.fn(async () => signalGif(5));
		await expect(
			assertExportAccessibility(course, true, read, [], { checkFlashing: false }),
		).resolves.toEqual([]);
		expect(read).not.toHaveBeenCalled();
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
