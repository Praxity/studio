import { RULE_METADATA } from "@praxity/editor-core/lib/a11y/rule-metadata.ts";
import type { DesktopExportInput } from "@praxity/export-pipeline";
import { readLesson } from "@praxity/grammar";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { describe, expect, it } from "vitest";
import { signalGif } from "../../test-utils/signal-gif";
import { assertExportAccessibility } from "../export/accessibility-enforcement";

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
	it("does not reuse an earlier GIF analysis after bytes change", async () => {
		const course = input([block("image", { src: "/assets/signal.gif", altText: "Signal" })]);
		await expect(assertExportAccessibility(course)).rejects.toMatchObject({
			issues: [expect.objectContaining({ rule: "gif-flash-threshold" })],
		});
		course.resolvedAssets.set("assets/signal.gif", signalGif(60));
		await expect(assertExportAccessibility(course)).resolves.toEqual([]);
	});
});
