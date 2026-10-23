import { tokenizeLesson } from "@praxity/grammar/src/v4/lex/index.ts";
import { getDefinition } from "@praxity/grammar/src/v4/schema.ts";
import { analyzeLessonTree } from "@praxity/grammar/src/v4/tree/index.ts";
import { expect, it } from "vitest";
import { draftRange, draftText, locateTree } from "../src/ranges.ts";

it("D1 D2 expands exact BOM, CRLF and surrogate-pair draft bytes", () => {
	const source = "\uFEFFHead\r\n::: note\r\nText🙂\r\n:::\r\nTail";
	expect(draftText(source, { start: 7, end: 30 }, { start: 7, end: 25 })).toEqual({
		expectedText: "::: note\r\nText🙂\r\n:::\r\n",
		editableText: "::: note\r\nText🙂\r\n",
	});
	expect(draftText(source, { start: 0, end: 34 }, { start: 0, end: 34 })).toEqual({
		expectedText: "\uFEFFHead\r\n::: note\r\nText🙂\r\n:::\r\nTail",
		editableText: "\uFEFFHead\r\n::: note\r\nText🙂\r\n:::\r\nTail",
	});
});

it("D2 derives nested note and item ranges from grammar without the container closer", () => {
	const source =
		"\uFEFF# Page\r\n\r\n::: tabs\r\n:: A\r\n::: note\r\nIn🙂\r\n:::\r\n:: B\r\nb\r\n:::\r\n";
	const tree = analyzeLessonTree(tokenizeLesson(source), { definition: getDefinition });
	const entries = locateTree(tree);
	const note = entries.find(({ node }) => node.type === "note")?.node;
	const lastItem = entries.filter(({ node }) => node.kind === "item").at(-1)?.node;
	if (!note || !lastItem) throw new Error("Missing fixture note or item");
	expect(draftText(source, note.span, draftRange(note))).toEqual({
		expectedText: "::: note\r\nIn🙂\r\n:::\r\n",
		editableText: "::: note\r\nIn🙂\r\n",
	});
	expect(draftText(source, lastItem.span, draftRange(lastItem))).toEqual({
		expectedText: ":: B\r\nb\r\n",
		editableText: ":: B\r\nb\r\n",
	});
});

it("D1 keeps mixed endings and a missing final newline", () => {
	expect(draftText("\uFEFFA\r\nB\rC\n🙂", { start: 0, end: 10 }, { start: 5, end: 10 })).toEqual({
		expectedText: "\uFEFFA\r\nB\rC\n🙂",
		editableText: "\rC\n🙂",
	});
});

it("D2 permits empty files and empty editable ranges at either owner boundary", () => {
	expect(draftText("", { start: 0, end: 0 }, { start: 0, end: 0 })).toEqual({
		expectedText: "",
		editableText: "",
	});
	for (const offset of [1, 3]) {
		expect(draftText("abcd", { start: 1, end: 3 }, { start: offset, end: offset })).toEqual({
			expectedText: "bc",
			editableText: "",
		});
	}
});

it.each([
	{ start: -1, end: 1 },
	{ start: 0.5, end: 1 },
	{ start: 2, end: 1 },
	{ start: 0, end: 4 },
	{ start: Number.NaN, end: 1 },
	{ start: 0, end: Infinity },
	{ start: 0, end: Number.MAX_SAFE_INTEGER + 1 },
	{ start: "0", end: 1 },
	{},
	null,
])("D2 refuses an invalid expected or editable range %j", (invalid) => {
	expect(() => draftText("abc", invalid as never, { start: 0, end: 0 })).toThrow(RangeError);
	expect(() => draftText("abc", { start: 0, end: 3 }, invalid as never)).toThrow(RangeError);
	expect(() => draftText("abc", invalid as never, { start: 0, end: 0 })).toThrow("invalid-args");
	expect(() => draftText("abc", { start: 0, end: 3 }, invalid as never)).toThrow("invalid-args");
});

it.each([
	{ start: 0, end: 2 },
	{ start: 2, end: 4 },
])("D2 refuses an editable range outside either edge of its owning slice %j", (editable) => {
	expect(() => draftText("abcd", { start: 1, end: 3 }, editable)).toThrow(RangeError);
	expect(() => draftText("abcd", { start: 1, end: 3 }, editable)).toThrow("invalid-args");
});
