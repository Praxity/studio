import { describe, expect, it } from "vitest";
import {
	findFrontmatterEndOffset,
	parseFrontmatter,
	readLesson,
	setFrontmatterPath,
	setYamlPath,
} from "../src/index.ts";
import { tokenizeLesson } from "../src/v4/lex/index.ts";

describe("metadata source edits", () => {
	it.each(["\n", "\r\n", "\r"])(
		"reader, lexer and edits agree on BOM frontmatter fences with %j endings",
		(ending) => {
			const source = ["\uFEFF---", "title: Lesson", " \t--- \t", "", "# Body", ""].join(ending);
			expect(parseFrontmatter(source)).toMatchObject({ frontmatter: { title: "Lesson" } });
			const stream = tokenizeLesson(source);
			expect(stream.lines.map((line) => line.kind)).toEqual([
				"frontmatter-fence",
				"frontmatter",
				"frontmatter-fence",
				"blank",
				"page",
			]);
			expect(stream.tokens.map((token) => token.raw).join("")).toBe(source);
			expect(readLesson(source).pages).toHaveLength(1);
			expect(source.slice(findFrontmatterEndOffset(source))).toBe(`# Body${ending}`);
			expect(setFrontmatterPath(source, ["title"], "Edited")).toBe(
				source.replace("Lesson", "Edited"),
			);
		},
	);
	it.each(["", "\uFEFF"])(
		"retains the BOM and every byte around an existing frontmatter scalar, %j",
		(bom) => {
			const source = `${bom}---\r\ntitle: Lesson\ndesign:\r\n  colorAccent: red # chosen\n---\r\n\n# Body\r\n`;
			expect(setFrontmatterPath(source, ["design", "colorAccent"], "blue")).toBe(
				source.replace("red #", "blue #"),
			);
			expect(parseFrontmatter(source).frontmatter.title).toBe("Lesson");
			expect(source.slice(findFrontmatterEndOffset(source))).toBe("# Body\r\n");
		},
	);
	it("keeps the BOM before newly inserted frontmatter", () => {
		expect(setFrontmatterPath("\uFEFF# Body\n", ["title"], "Lesson")).toBe(
			"\uFEFF---\ntitle: Lesson\n---\n\n# Body\n",
		);
	});
	it.each(["---", "\uFEFF---\n", "---\ntitle: Lesson\n", "---\ntitle: [\n---\n# Body\n"])(
		"refuses malformed frontmatter instead of returning unchanged source, %j",
		(source) => {
			expect(() => setFrontmatterPath(source, ["title"], "Edited")).toThrow(
				expect.objectContaining({ code: "invalid-args" }),
			);
		},
	);
	it.each([
		[
			"\uFEFFtitle: Course\r\nlessons: [lesson.prax]\ndesign:\r\n  colorAccent: red # chosen\n",
			["design", "colorAccent"],
			"blue",
			"\uFEFFtitle: Course\r\nlessons: [lesson.prax]\ndesign:\r\n  colorAccent: blue # chosen\n",
		],
		[
			"design: {colorAccent: red, background: white}\r\n",
			["design", "colorAccent"],
			"blue",
			"design: {colorAccent: blue, background: white}\r\n",
		],
		[
			"title: 'Before' # chosen\nlessons: [a.prax]\n",
			["title"],
			"After",
			"title: 'After' # chosen\nlessons: [a.prax]\n",
		],
		[
			"title: Course\r\nlessons: [a.prax]\n",
			["design", "colorAccent"],
			"blue",
			"title: Course\r\nlessons: [a.prax]\ndesign:\r\n  colorAccent: blue\r\n",
		],
		[
			"design:\r\n  background: white\nother: value\r\n",
			["design", "colorAccent"],
			"blue",
			"design:\r\n  background: white\n  colorAccent: blue\nother: value\r\n",
		],
		[
			"design: {background: white}\n",
			["design", "colorAccent"],
			"blue",
			"design: {background: white, colorAccent: blue}\n",
		],
		[
			"title: Course\nold: value\nlessons: [a.prax]\r\n",
			["old"],
			null,
			"title: Course\nlessons: [a.prax]\r\n",
		],
		[
			"design: {colorAccent: red, background: white}\n",
			["design", "colorAccent"],
			null,
			"design: { background: white}\n",
		],
		[
			"design:\n  colorAccent: red\nother: value\n",
			["design", "colorAccent"],
			null,
			"design:\n  {}\nother: value\n",
		],
		["lessons: [a.prax, b.prax]\r\n", ["lessons", 1], "c.prax", "lessons: [a.prax, c.prax]\r\n"],
		[
			"design:\r\n  palette: clean\nother: value\r\n",
			["design"],
			{ palette: "standard" },
			"design:\r\n  { palette: standard }\nother: value\r\n",
		],
		["lessons: [a.prax]\r\n", ["lessons", 1], "b.prax", "lessons: [a.prax, b.prax]\r\n"],
		[
			"lessons:\n  - a.prax\r\nother: value\n",
			["lessons", 1],
			"b.prax",
			"lessons:\n  - a.prax\r\n  - b.prax\r\nother: value\n",
		],
	] as const)("edits only the selected YAML entry, %j", (source, path, value, expected) => {
		expect(Buffer.from(setYamlPath(source, path, value))).toEqual(Buffer.from(expected));
	});
	it.each(["first", "middle", "last"])(
		"deletes the %s nested mapping entry without changing siblings",
		(key) => {
			const source =
				"design:\r\n  first: red\n  # author note\r\n  middle: blue\n  last: white\r\nother: keep\n";
			const removed =
				key === "first"
					? "  first: red\n"
					: key === "middle"
						? "  middle: blue\n"
						: "  last: white\r\n";
			expect(setYamlPath(source, ["design", key], null)).toBe(source.replace(removed, ""));
		},
	);
});
