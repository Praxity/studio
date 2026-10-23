import { describe, expect, it } from "vitest";
import {
	decodeHtmlEntities,
	escapeTypst,
	htmlToTypst,
	safeTypstLink,
	stripHtml,
	typstString,
} from "../src/renderers/typst/common.ts";

describe("HTML to Typst", () => {
	it("preserves no-break spaces and decodes named, decimal and hex entities once", () => {
		const input = "&nbsp;25&#160;% 10&#x202f;kg «\u00a0texte\u202f» &eacute; &amp;lt;&nbsp;";
		const decoded = "\u00a025\u00a0% 10\u202fkg «\u00a0texte\u202f» é &lt;\u00a0";
		expect(decodeHtmlEntities(input)).toBe(decoded);
		expect(stripHtml(`<p>${input}</p>`)).toBe(decoded);
		expect(htmlToTypst(`<p>${input}</p>`)).toBe(escapeTypst(decoded));
		expect(decodeHtmlEntities("&#x110000; &#0; &#xD800;")).toBe("� � �");
	});

	it("keeps nested inline formatting and quoted attributes without escaping generated markup", () => {
		expect(
			htmlToTypst(
				'<p><strong class="x">Bold <em>italic</em></strong> <a title="a > b" href=\'https://example.com/?a=1&amp;b=2\'>link</a></p>',
			),
		).toBe('#strong[Bold #emph[italic]] #link("https://example.com/?a=1&b=2")[link]');
	});

	it("escapes authored Typst commands, delimiters, comments, headings and list markers", () => {
		const text =
			'#panic("injected") [x] $math$ @label *bold* _em_ `code` \\ = + - / // /* */ 1. ~ <label>';
		expect(htmlToTypst(text.replaceAll("<", "&lt;"))).toBe(escapeTypst(text));
		expect(escapeTypst(text)).toContain('\\#panic\\("injected")');
		expect(escapeTypst(text)).toContain("\\/\\/");
		expect(escapeTypst(text)).toContain("1\\.");
		expect(htmlToTypst('<strong>]*#panic("no")</strong>')).toBe('#strong[\\]\\*\\#panic\\("no")]');
	});

	it("retains inline and list-item language overrides", () => {
		expect(htmlToTypst('<p>English <em lang="fr-CA">français</em></p>')).toContain(
			'#text(lang: "fr", region: "CA")[#emph[français]]',
		);
		expect(htmlToTypst('<ul><li lang="fr">Bonjour</li><li>Hello</li></ul>')).toBe(
			'#list([#text(lang: "fr", region: none)[Bonjour]], [Hello])',
		);
	});

	it("preserves code verbatim in a string argument, including embedded closing delimiters", () => {
		const code = '] #panic("no")\n  `quoted` & <x>\u00a0';
		expect(htmlToTypst(`<pre>${code.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</pre>`)).toBe(
			`#raw(${typstString(code)}, block: true)`,
		);
		expect(htmlToTypst("<code>a  &lt;b&gt;</code>")).toBe('#raw("a  <b>")');
	});

	it("keeps ordered starts, item overrides, nested bullets and trailing item text", () => {
		expect(
			htmlToTypst(
				'<ol start="10"><li><strong>First</strong><ul><li>Nested <em>bullet</em></li></ul>After</li><li value="15">Next</li><li>Last</li></ol>',
			),
		).toBe(
			"#enum(enum.item(10, [#strong[First]\n\n#list([Nested #emph[bullet]])\n\nAfter]), enum.item(15, [Next]), enum.item(16, [Last]))",
		);
	});

	it("preserves negative HTML numbering with valid Typst item numbers", () => {
		expect(htmlToTypst('<ol start="-1"><li>Negative</li><li>Zero</li></ol>')).toBe(
			'#enum(numbering: n => ("-1.", "0.",).at(n - 1), enum.item(1, [Negative]), enum.item(2, [Zero]))',
		);
	});

	it("handles HTML omitted list end tags, reversed numbering and invalid start attributes", () => {
		expect(htmlToTypst('<ol reversed><li>Three<li value="7">Seven<li>Six</ol>')).toBe(
			"#enum(enum.item(3, [Three]), enum.item(7, [Seven]), enum.item(6, [Six]))",
		);
		expect(htmlToTypst('<ol start="1); panic(1)"><li>Safe</li></ol>')).toBe(
			"#enum(enum.item(1, [Safe]))",
		);
		expect(htmlToTypst('<ul><li>A<ol start="2"><li>B</ol></ul>')).toContain(
			"#list([A\n\n#enum(enum.item(2, [B]))])",
		);
	});

	it("separates paragraphs and line breaks and omits scripts, styles and comments", () => {
		expect(
			htmlToTypst(
				'<p>A<br>B</p><p>C</p><script>#panic("no")</script><style>x</style><!--secret-->',
			),
		).toBe("A#linebreak()B\n\n\n\nC");
		expect(htmlToTypst('before <span title="ignored">after</span>')).toBe("before after");
	});
});

describe("Typst string and link boundaries", () => {
	it("quotes string arguments without turning authored markup into commands", () => {
		expect(typstString('"\\\n\t\u0000#panic(1)')).toBe('"\\"\\\\\\u{a}\\u{9}\\u{0}#panic(1)"');
	});

	it.each([
		"javascript:alert(1)",
		"data:text/html,x",
		"file:///etc/passwd",
		"#label",
		"https://bad\n.example",
		"https://",
	])("drops unsafe link target %s but keeps its text", (url) => {
		expect(safeTypstLink(url, "#strong[visible]")).toBe("#strong[visible]");
	});

	it("preserves the original safe target and escapes string injection", () => {
		const url = 'https://example.com/a?q=");panic("no")';
		expect(safeTypstLink(url, "visible")).toBe(`#link(${typstString(url)})[visible]`);
		expect(htmlToTypst('<a href="jav&#x61;script:alert(1)">Visible</a>')).toBe("Visible");
		expect(safeTypstLink("mailto:hello@example.com", "Mail")).toContain(
			'#link("mailto:hello@example.com")',
		);
	});
});
