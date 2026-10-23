import { describe, expect, it } from "vitest";
import { preserveEditorLineEndings } from "../editor-source";

const LF =
	"---\ntitle: Lesson\ndescription: |\n  First line.\n  Second line.\n---\n\n\n# Welcome\n\nFirst paragraph.\nSecond line.\n\n## Topics\nas: card\n\n### Alpha\n\nCard words.\n\nclose: card\n\n```text\ncode line\nnext line\n```\n\n--- End\n\n> Quote words.\n\n- First item\n- Second item\n";

describe("editor save line endings", () => {
	it("preserves the untouched ending of a blank line beside the edited blank line", () => {
		expect(
			preserveEditorLineEndings("\uFEFF# Page\nA word\n\nBody.\n", "\uFEFF# Page\r\n\n\r\nBody.\n"),
		).toBe("\uFEFF# Page\r\nA word\n\r\nBody.\n");
	});
	it("edits mixed-ending lines without changing BOM or untouched endings", () => {
		const baseline = "\uFEFF# First\r\n\nBody.\r\n\nUnchanged.\n";
		expect(
			preserveEditorLineEndings("\uFEFF# First\n\nBody. Typed.\n\nUnchanged.\n", baseline),
		).toBe("\uFEFF# First\r\n\nBody. Typed.\r\n\nUnchanged.\n");
	});
	it("retains a deliberately removed final newline", () => {
		expect(preserveEditorLineEndings("# First\n\nBody.", "# First\r\n\r\nBody.\r\n")).toBe(
			"# First\r\n\r\nBody.",
		);
	});
	it.each(["\n", "\r\n", "\r"])(
		"preserves the draft's final newline choice and baseline line styles, %j",
		(eol) => {
			const original = LF.replace(/\n/g, eol);
			const edited = `${LF.trimEnd()} Added.`;
			expect(preserveEditorLineEndings(edited, original)).toBe(
				`${original.slice(0, -eol.length)} Added.`,
			);
			expect(preserveEditorLineEndings(`${edited}\n`, original)).toBe(
				`${original.slice(0, -eol.length)} Added.${eol}`,
			);
			expect(preserveEditorLineEndings(edited, undefined)).toBe(edited);
			expect(preserveEditorLineEndings(edited, LF.trimEnd())).toBe(edited);
			expect(preserveEditorLineEndings(`${edited}\n\n`, original)).toBe(
				`${original.slice(0, -eol.length)} Added.${eol}${eol}`,
			);
		},
	);
});
