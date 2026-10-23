import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	lineColumn,
	type TokenStream,
	tokenizeLesson,
	toUtf8Offset,
	toUtf16Offset,
} from "../src/v4/lex";

function partition(source: string, stream = tokenizeLesson(source)) {
	expect(stream.source).toBe(source);
	expect(stream.tokens.map((token) => token.raw).join("")).toBe(source);
	expect(Buffer.from(stream.tokens.map((token) => token.raw).join(""))).toEqual(
		Buffer.from(source),
	);
	expect(Buffer.concat(stream.tokens.map((token) => Buffer.from(token.raw)))).toEqual(
		Buffer.from(source),
	);
	let end = 0;
	for (const token of stream.tokens) {
		expect(token.start).toBe(end);
		expect(token.end).toBeGreaterThan(token.start);
		expect(token.raw).toBe(source.slice(token.start, token.end));
		end = token.end;
	}
	expect(end).toBe(source.length);
	for (const line of stream.lines) {
		const tokens = stream.tokens.slice(line.tokenStart, line.tokenEnd);
		expect(tokens.map((token) => token.raw).join("")).toBe(source.slice(line.start, line.end));
	}
}

const diagnostics = (stream: TokenStream) =>
	stream.tokens.filter((token) => token.kind === "diagnostic").map((token) => token.value);
const values = (source: string, kind: string) =>
	tokenizeLesson(source)
		.tokens.filter((token) => token.kind === kind)
		.map((token) => token.value);
const shapes = (source: string) => tokenizeLesson(source).lines.map((line) => line.kind);

describe("G1 lossless partition", () => {
	const lessons = [
		"leadership/00-avant-de-commencer",
		"leadership/01-affirmez-vous",
		"leadership/02-quatre-cavaliers",
		"leadership/03-resoudre-un-conflit",
		"toolkit/welcome",
	];
	for (const lesson of lessons) {
		for (const ending of ["LF", "CRLF", "mixed"]) {
			it(`${lesson} partitions byte for byte with ${ending}`, () => {
				const original = readFileSync(
					new URL(`./fixtures/v4/${lesson}.prax`, import.meta.url),
					"utf8",
				);
				let index = 0;
				const source = original.replace(/\r\n|\r|\n/g, () =>
					ending === "LF" ? "\n" : ending === "CRLF" || index++ % 2 === 0 ? "\r\n" : "\n",
				);
				partition(source);
				expect(diagnostics(tokenizeLesson(source))).toEqual([]);
			});
		}
	}
	it("keeps BOM, Café 😀, U+202F, tabs, mixed endings and no final newline", () => {
		const source = '\uFEFF# Café 😀\r\n\ttext\nPourquoi\u202F?\r::: note Fin {icon="a\\"b"}\nbody';
		partition(source);
		expect(tokenizeLesson(source).tokens[0]).toEqual({
			kind: "bom",
			start: 0,
			end: 1,
			raw: "\uFEFF",
		});
		expect(values(source, "line-ending")).toEqual(["\r\n", "\n", "\r", "\n"]);
	});
	it("partitions 5,000 deterministic generated inputs including invalid drafts", () => {
		let state = 0x471acafe;
		const random = () => {
			state ^= state << 13;
			state ^= state >>> 17;
			state ^= state << 5;
			return state >>> 0;
		};
		const fragments = [
			"# ",
			"::: note ",
			":: ",
			"{",
			"}",
			'"',
			"\\",
			"=",
			"tone",
			" ",
			"\t",
			"\r",
			"\n",
			"\r\n",
			"Café",
			"😀",
			"\u202F?",
			"\uFEFF",
			"```",
			"~~~~",
			"$$",
			"- ",
			"10. ",
			"caption: ",
			"\uD800",
			"\uDC00",
		];
		for (let input = 0; input < 5_000; input++) {
			let source = "";
			const count = random() % 45;
			for (let i = 0; i < count; i++) source += fragments[random() % fragments.length];
			partition(source);
		}
	}, 30_000);
});

describe("G1 Q1 fence shielding and line shapes", () => {
	it.each([
		["```\n# literal\n:::\n```\n# Real", ["code-fence", "code", "code", "code-fence", "page"]],
		[
			"````\n```\n# literal\n:::\n````\n# Real",
			["code-fence", "code", "code", "code", "code-fence", "page"],
		],
		[
			"~~~ lang\n```\n# literal\n~~~~\n# Real",
			["code-fence", "code", "code", "code-fence", "page"],
		],
		[
			"```\n~~~\n# literal\n``` suffix\n# literal\n````\n# Real",
			["code-fence", "code", "code", "code", "code", "code-fence", "page"],
		],
		["    ```\n# Real second page", ["prose", "page"]],
		[
			"> # literal\n> :::\n> :: literal\n> ```\n# Real",
			["quote", "quote", "quote", "quote", "page"],
		],
		[
			"$$\n# literal\n:::\n```\n$$\n# Real",
			["math-fence", "math", "math", "math", "math-fence", "page"],
		],
		["```\n$$\n# literal\n```\n# Real", ["code-fence", "code", "code", "code-fence", "page"]],
		[
			"- Item\n  ```\n  # literal\n:::\n  ```\n# Real",
			["list-item", "code-fence", "code", "code", "code-fence", "page"],
		],
		[
			"10. Item\n\n    ~~~~\n    ~~~\n# literal\n    ~~~~\n# Real",
			["list-item", "blank", "code-fence", "code", "code", "code-fence", "page"],
		],
		[
			"- Outer\n  - Inner\n    ```\n# literal\n    ```\n# Real",
			["list-item", "list-item", "code-fence", "code", "code-fence", "page"],
		],
		[
			"- Item\n  continuation\n\n  ```\n# literal\n  ```\n# Real",
			["list-item", "prose", "blank", "code-fence", "code", "code-fence", "page"],
		],
		["- Item\nEnded\n  ```\n# Real", ["list-item", "prose", "prose", "page"]],
		["- Item\n    ```\n# Real", ["list-item", "prose", "page"]],
		["Title\n---\n===", ["prose", "divider", "prose"]],
		["\\# literal\n\\::: note Literal\n\\speaker: literal", ["prose", "prose", "prose"]],
	])("shields %j", (source, expected) => {
		const stream = tokenizeLesson(source);
		partition(source, stream);
		expect(stream.lines.map((line) => line.kind)).toEqual(expected);
	});
	it("splits structural markers, type, subject, parts, settings and line endings", () => {
		const source =
			"# Page {hideTitle}\r\n::: note Check {tone=warning}\n:: Item {weight=2}\ncaption:\u202FAttention\u202F!\n--- {palette=warm}\n:::";
		partition(source);
		expect(shapes(source)).toEqual(["page", "opener", "item", "part", "divider", "closer"]);
		expect(values(source, "subject")).toEqual(["Page", "Check", "Item"]);
		expect(values(source, "block-type")).toEqual(["note"]);
		expect(values(source, "part-value")).toEqual(["Attention\u202F!"]);
	});
	it("shields frontmatter including BOM and retains later dividers", () => {
		const source = "\uFEFF---\r\ntitle: Café\n# yaml\n---\n# Page\n---";
		partition(source);
		expect(shapes(source)).toEqual([
			"frontmatter-fence",
			"frontmatter",
			"frontmatter",
			"frontmatter-fence",
			"page",
			"divider",
		]);
	});
	it("recognizes image settings with escaped labels and balanced destinations", () => {
		const source = String.raw`![A \] bracket](/assets/a(1).png){size=small}`;
		partition(source);
		expect(shapes(source)).toEqual(["image"]);
		expect(values(source, "image-alt")).toEqual(["A ] bracket"]);
		expect(values(source, "image-source")).toEqual(["/assets/a(1).png"]);
		expect(values(source, "setting-value")).toEqual(["small"]);
	});
});

describe("G1 FORMAT-NEXT 4.8, every B as specified row", () => {
	// Schema owns the vocabulary. G1 receives only a spelling classifier.
	const isSettingName = (name: string) => ["tone", "colour"].includes(name.toLowerCase());
	it.each([
		["space before colon", "Indice : relisez…"],
		["U+202F before colon", "Indice\u202F: relisez…"],
		["after setting and blank", "tone: info\n\nIndice : relisez…"],
		["directly after setting", "tone: info\nIndice : relisez…"],
		["capital Note", "Note: start with the facts."],
		["card Exemple", "Exemple : « Non. »"],
		["two-word label", "Mots clés : évitement"],
		["unknown lowercase name", "remarque: lisez bien."],
	])("keeps learner text, %s", (_case, body) => {
		const source = `::: note\n${body}\n:::`;
		const stream = tokenizeLesson(source, { isSettingName });
		partition(source, stream);
		const text = body.split("\n").filter((line) => line && !line.startsWith("tone:"));
		for (const line of text) {
			expect(
				stream.tokens
					.filter((token) => token.kind !== "diagnostic")
					.map((token) => token.raw)
					.join(""),
			).toContain(line);
		}
		expect(diagnostics(stream)).toHaveLength(body.startsWith("tone:") ? 1 : 0);
	});
	it.each([
		["real setting name used as text", "tone: friendly voices help."],
		["misspelt setting", "colour: warning"],
		["capital setting", "Tone: warning"],
		["space before colon", "tone : warning"],
		["below body", "Body\ntone: warning"],
	])("diagnoses line setting, %s", (_case, body) => {
		const source = `::: note\n${body}\n:::`;
		const stream = tokenizeLesson(source, { isSettingName });
		partition(source, stream);
		expect(diagnostics(stream)).toEqual([
			{ code: "setting-on-body-line", name: body.split("\n").at(-1)?.split(":")[0].trim() },
		]);
	});
	it("blank between opener and brace setting has no B placement exception", () => {
		const source = "::: note\n\n{tone=warning}\n:::";
		partition(source);
		expect(diagnostics(tokenizeLesson(source))).toEqual([{ code: "setting-on-body-line" }]);
	});
	it("keeps URL colons and equals", () => {
		const source = '::: quote Source {source="https://example.com?a=b&c=d"}';
		partition(source);
		expect(values(source, "setting-value")).toEqual(["https://example.com?a=b&c=d"]);
		expect(diagnostics(tokenizeLesson(source))).toEqual([]);
	});
	it("keeps closing braces and spaces in a quoted value", () => {
		const source = "::: note Check {visible=\"name == '{x}'\"}";
		partition(source);
		expect(values(source, "subject")).toEqual(["Check"]);
		expect(values(source, "setting-value")).toEqual(["name == '{x}'"]);
		expect(diagnostics(tokenizeLesson(source))).toEqual([]);
	});
	it("diagnoses duplicate keys and identifies the first occurrence for recovery", () => {
		const source = "::: note Check {tone=info tone=warning}";
		partition(source);
		expect(values(source, "setting-key")).toEqual(["tone"]);
		expect(diagnostics(tokenizeLesson(source))).toEqual([
			{ code: "duplicate-setting", name: "tone", firstStart: 16 },
		]);
	});
	it("decodes escaped title braces as learner text", () => {
		const source = String.raw`::: note The set \{pressure\}`;
		partition(source);
		expect(values(source, "subject")).toEqual(["The set {pressure}"]);
		expect(diagnostics(tokenizeLesson(source))).toEqual([]);
	});
});

describe("G1 review finding 6, malformed settings never become titles", () => {
	it.each([
		["{tone = warning}", "spaces-around-equals"],
		["{tone= warning}", "spaces-around-equals"],
		["{tone =warning}", "spaces-around-equals"],
		["{tone=warning", "missing-settings-close"],
		['{visible="name == x}', "unclosed-setting-quote"],
		["{tone=“warning”}", "invalid-setting-quote"],
		["{tone=}", "missing-setting-value"],
		["{tone=info} {icon=check}", "multiple-settings-groups"],
		["{tone=info} trailing", "settings-not-final"],
	])("diagnoses %s", (suffix, code) => {
		const source = `::: note Check ${suffix}`;
		const stream = tokenizeLesson(source);
		partition(source, stream);
		expect(values(source, "subject")).toEqual(["Check"]);
		expect(diagnostics(stream)).toContainEqual({ code });
	});
	it("lexes flags, empty strings, equals, punctuation and escaped quotes without re-quoting", () => {
		const source = String.raw`::: note Check {shuffle visible="a \"{b}\" = c" path=C:\assets\x empty=""}`;
		partition(source);
		expect(values(source, "setting-flag")).toEqual([true]);
		expect(values(source, "setting-value")).toEqual(['a "{b}" = c', String.raw`C:\assets\x`, ""]);
		expect(diagnostics(tokenizeLesson(source))).toEqual([]);
	});
});

describe("G1 offsets", () => {
	const source = "\uFEFFCafé 😀\r\n\tPourquoi\u202F?\rFin\n";
	it("converts every scalar boundary using UTF-8 byte offsets", () => {
		let offset = 0;
		for (const point of source) {
			expect(toUtf8Offset(source, offset)).toBe(Buffer.byteLength(source.slice(0, offset)));
			expect(toUtf16Offset(source, Buffer.byteLength(source.slice(0, offset)))).toBe(offset);
			offset += point.length;
		}
		expect(toUtf8Offset(source, source.length)).toBe(Buffer.byteLength(source));
		expect(toUtf16Offset(source, Buffer.byteLength(source))).toBe(source.length);
	});
	it("uses one-based lines and UTF-16 columns, with BOM and CRLF counted raw", () => {
		expect(lineColumn(source, 0)).toEqual({ line: 1, column: 1 });
		expect(lineColumn(source, 6)).toEqual({ line: 1, column: 7 });
		expect(lineColumn(source, 9)).toEqual({ line: 1, column: 10 });
		expect(lineColumn(source, 10)).toEqual({ line: 2, column: 1 });
		expect(lineColumn(source, source.indexOf("Fin"))).toEqual({ line: 3, column: 1 });
		expect(lineColumn(source, source.length)).toEqual({ line: 4, column: 1 });
	});
	it("rejects out-of-range, fractional and split-scalar byte conversions", () => {
		for (const offset of [-1, 0.5, NaN, Infinity, source.length + 1]) {
			expect(() => toUtf8Offset(source, offset)).toThrow(RangeError);
			expect(() => lineColumn(source, offset)).toThrow(RangeError);
		}
		for (const offset of [-1, 0.5, NaN, Infinity, Buffer.byteLength(source) + 1, 1, 2, 7, 11]) {
			expect(() => toUtf16Offset(source, offset)).toThrow(RangeError);
		}
		expect(() => toUtf8Offset(source, 7)).toThrow(RangeError);
	});
	it("handles empty input and isolated surrogates by UTF-8 replacement encoding", () => {
		partition("");
		expect(toUtf8Offset("", 0)).toBe(0);
		expect(toUtf16Offset("", 0)).toBe(0);
		expect(lineColumn("", 0)).toEqual({ line: 1, column: 1 });
		expect(toUtf8Offset("\uD800x\uDC00", 3)).toBe(7);
		expect(toUtf16Offset("\uD800x\uDC00", 4)).toBe(2);
	});
});

describe("G1 additional reserved-syntax boundaries", () => {
	it("the image-only adjacent brace rule does not reserve title braces after a parenthesis", () => {
		const source = "::: note Function(x){literal}";
		partition(source);
		expect(values(source, "subject")).toEqual(["Function(x){literal}"]);
		expect(diagnostics(tokenizeLesson(source))).toEqual([]);
	});
	it.each(["- ```", "10. ~~~~"])(
		"shields a fence starting on its list item line, %s",
		(opening) => {
			const marker = opening.endsWith("```") ? "```" : "~~~~";
			const indent = opening.indexOf(marker);
			const source = `${opening}\n# literal\n:::\n${" ".repeat(indent)}${marker}\n# Real`;
			partition(source);
			expect(shapes(source)).toEqual(["list-item", "code", "code", "code-fence", "page"]);
		},
	);
	it("a body brace expression followed by words stays learner text", () => {
		const source = "# Page\n{pressure=force} is prose";
		partition(source);
		expect(shapes(source)).toEqual(["page", "prose"]);
		expect(diagnostics(tokenizeLesson(source))).toEqual([]);
	});
	it("ordinary body braces and variables stay prose", () => {
		const source = "# Page\n{pressure}\n{{score}}\nText {tone=warning}";
		partition(source);
		expect(shapes(source)).toEqual(["page", "prose", "prose", "prose"]);
		expect(diagnostics(tokenizeLesson(source))).toEqual([]);
	});
	it("standalone brace flags need the injected schema classifier", () => {
		const source = "# Page\n{shuffle}";
		const stream = tokenizeLesson(source, { isSettingName: (name) => name === "shuffle" });
		partition(source, stream);
		expect(diagnostics(stream)).toEqual([{ code: "setting-on-body-line" }]);
	});
	it("a quoted value is one helper range including its quotes", () => {
		const source = String.raw`::: note Check {visible="a \"{x}\"" icon=check}`;
		const stream = tokenizeLesson(source);
		partition(source, stream);
		const value = stream.tokens.find((token) => token.kind === "setting-value");
		expect(value).toEqual({
			kind: "setting-value",
			start: 24,
			end: 35,
			raw: String.raw`"a \"{x}\""`,
			value: 'a "{x}"',
		});
	});
	it("duplicate flags recover from the first bare key", () => {
		const source = "::: choice Stem {shuffle shuffle=false}";
		partition(source);
		expect(values(source, "setting-flag")).toEqual([true]);
		expect(diagnostics(tokenizeLesson(source))).toEqual([
			{ code: "duplicate-setting", name: "shuffle", firstStart: 17 },
		]);
	});
	it("only column zero has structural headings and part candidates", () => {
		const source =
			"  # Literal\n\t::: note Literal\ncaption\u202F: Attention\ncaption:\u202FAttention";
		partition(source);
		expect(shapes(source)).toEqual(["prose", "prose", "prose", "part"]);
		expect(values(source, "part-value")).toEqual(["Attention"]);
	});
});
