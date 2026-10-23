import { describe, expect, it } from "vitest";
import {
	findFrontmatterEndOffset,
	parseFrontmatter,
	preserveLineEndings,
	setFrontmatterPath,
	setYamlPath,
} from "../src/index.ts";
import {
	readBlockFixture as readBlockSource,
	readBlockFixture as readSource,
} from "./helpers/lesson-fixture.ts";

const LF =
	"---\ntitle: Lesson\ndescription: |\n  First line.\n  Second line.\n---\n\n# Welcome\n\nFirst paragraph.\nSecond line.\n\n::: cards Topics\n:: Alpha\nCard words.\n:::\n\n```text\ncode line\nnext line\n```\n\n# End {hideTitle}\n\n::: quote\nQuote words.\n:::\n\n- First item\n- Second item\n";
const CRLF = LF.replace(/\n/g, "\r\n");

describe("line endings at the parser boundary", () => {
	it.each([true, false])(
		"metadata edit retains every mixed-ending body byte, frontmatter %s",
		(exists) => {
			const body = "# Welcome\r\n\nBody.\r\nOther.\n";
			const prefix = exists ? "---\r\ntitle: Lesson\r\n---\r\n\n" : "";
			const edited = setFrontmatterPath(prefix + body, ["design", "accent"], "#123456");
			expect(edited.slice(edited.indexOf("# Welcome"))).toBe(body);
		},
	);
	it.each(["\n", "\r\n", "\r"])(
		"keeps fragment boundaries when adapting line endings, %j",
		(eol) => {
			const baseline = `First.${eol}Second.${eol}`;
			expect(preserveLineEndings("Replacement", baseline)).toBe("Replacement");
			expect(preserveLineEndings("First.\nSecond.", baseline)).toBe(`First.${eol}Second.`);
			expect(preserveLineEndings("", baseline)).toBe("");
		},
	);
	it.each([readSource, readBlockSource])(
		"parses CRLF exactly like LF, without carriage returns in text, reader alias %#",
		(parse) => {
			const crlf = parse(CRLF);
			const lf = parse(LF);
			expect(JSON.stringify(crlf.blocks)).not.toContain("\\r");
			expect(crlf.blocks).toEqual(lf.blocks);
			expect(crlf.frontmatter).toEqual(lf.frontmatter);
			expect([...crlf.spans]).toEqual([...lf.spans]);
		},
	);

	it.each(["\r\n", "\r"])(
		"normalizes frontmatter and body text at the public parser edge, %j",
		(eol) => {
			expect(readSource(LF.replace(/\n/g, eol)).blocks).toEqual(readSource(LF).blocks);
		},
	);

	it.each(["# Welcome\n\nBody.\n", "---\ntitle: [\n---\n\nBody.\n"])(
		"normalizes source without valid frontmatter, %j",
		(source) => {
			const parsed = readSource(source.replace(/\n/g, "\r\n"));
			expect(parsed.blocks).toEqual(readSource(source).blocks);
			expect(parsed.frontmatter).toEqual(readSource(source).frontmatter);
			expect(JSON.stringify(parsed.blocks)).not.toContain("\\r");
		},
	);

	it("normalizes parsed YAML text while retaining the raw body for source edits", () => {
		const { frontmatter, body } = parseFrontmatter(CRLF);
		expect(frontmatter.description).toBe("First line.\nSecond line.\n");
		expect(body).toBe(CRLF.slice(findFrontmatterEndOffset(CRLF)));
	});

	it("locates the raw body after CRLF blank lines for byte-preserving source edits", () => {
		expect(CRLF.slice(findFrontmatterEndOffset(CRLF))).toBe(
			LF.slice(findFrontmatterEndOffset(LF)).replace(/\n/g, "\r\n"),
		);
	});

	it("preserves CRLF in YAML and frontmatter writes", () => {
		expect(setYamlPath("# Comment\r\n", ["title"], "Edited")).toBe(
			"# Comment\r\ntitle: Edited\r\n",
		);
		expect(setYamlPath("# Comment\r\ntitle: Original\r\n", ["title"], "Edited")).toBe(
			"# Comment\r\ntitle: Edited\r\n",
		);
		expect(setFrontmatterPath(CRLF, ["title"], "Edited")).toBe(
			CRLF.replace("title: Lesson", "title: Edited"),
		);
		expect(setFrontmatterPath("# Welcome\r\n\r\nBody.\r\n", ["title"], "Added")).toBe(
			"---\r\ntitle: Added\r\n---\r\n\r\n# Welcome\r\n\r\nBody.\r\n",
		);
	});
});
