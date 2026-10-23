import { expect, it } from "vitest";
import { applyPlainYamlEdits, plainYamlDocument } from "../plain-yaml-edit";

const read = (source: string) => plainYamlDocument(source).toJS();

it.each(["\n", "\r\n"])(
	"keeps a comment between entries when deleting only an entry with %j",
	(ending) => {
		const source = [
			"lessons:",
			"  - a.prax # A's comment",
			"  # Between entries",
			"  - b.prax # B's comment",
			"",
		].join(ending);
		const start = source.indexOf("  - a.prax");
		const end = source.indexOf("  # Between entries");
		const result = applyPlainYamlEdits(
			source,
			[{ start, end, text: "" }],
			{ lessons: ["b.prax"] },
			read,
		);
		expect(result).toBe(
			["lessons:", "  # Between entries", "  - b.prax # B's comment", ""].join(ending),
		);
	},
);

it.each([
	["a: one # Note\nb: two # Note\n", "a: changed\nb: two # Note\n", { a: "changed", b: "two" }],
	["a: one # Note\n", "a: changed # Altered\n", { a: "changed" }],
	["a: one # Note\n", "a: 'changed # Note'\n", { a: "changed # Note" }],
	["a: one # Note\n", "a: changed\n# Note\n", { a: "changed" }],
	["lessons:\n  - a.prax\n  - a.prax # Note\n", "lessons: [a.prax]\n", { lessons: ["a.prax"] }],
])("refuses comment-token edits from %j to %j", (source, text, expected) => {
	expect(() =>
		applyPlainYamlEdits(source, [{ start: 0, end: source.length, text }], expected, read),
	).toThrow("Plain YAML required");
});

it("removes comments within a deleted mapping entry while keeping the surviving entry", () => {
	const source =
		"lessons:\n  a.prax:\n    script: A # A's comment\n  b.prax:\n    script: B # B's comment\n";
	const start = source.indexOf("  a.prax:");
	const end = source.indexOf("  b.prax:");
	expect(
		applyPlainYamlEdits(
			source,
			[{ start, end, text: "" }],
			{ lessons: { "b.prax": { script: "B" } } },
			read,
		),
	).toBe("lessons:\n  b.prax:\n    script: B # B's comment\n");
});
