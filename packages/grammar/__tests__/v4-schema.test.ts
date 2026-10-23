import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getManifest, getOptionValue, isOptionImplemented } from "../src/manifest";
import { tokenizeLesson } from "../src/v4/lex";
import { BLOCK_SCHEMA, getDefinition, INLINE_HELPERS, suggestType } from "../src/v4/schema";
import { analyzeLessonTree, type TreeNode } from "../src/v4/tree";

const parse = (source: string) =>
	analyzeLessonTree(tokenizeLesson(source), { definition: getDefinition, suggestType });
const walk = (node: TreeNode): TreeNode[] => [node, ...node.children.flatMap(walk)];
const types = [
	"text",
	"note",
	"quote",
	"figure",
	"float",
	"video",
	"audio",
	"embed",
	"bookmark",
	"button",
	"dialogue",
	"table",
	"stats",
	"accordion",
	"tabs",
	"sequence",
	"cards",
	"comparison",
	"columns",
	"divider",
	"page",
	"image",
	"heading",
];

describe("G4 schema public interface", () => {
	it.each(types)("%s insert template parses without diagnostics", (type) => {
		const definition = BLOCK_SCHEMA[type];
		expect(definition).toBeDefined();
		const source =
			type === "page" ? definition.insertTemplate : `# Example\n${definition.insertTemplate}`;
		const tree = parse(source);
		expect(tree.diagnostics).toEqual([]);
		expect(tree.root.status).toBe("resolved");
		expect(tree.root.raw).toBe(source);
		expect(definition.labelKey).toBe(`grammar.v4.type.${type}`);
	});
	it.each([
		["# P\n::: cards {columns=0}\n:: A\n:::", "bad-setting-value"],
		["# P\n::: stats {columns=0}\n| 1 | One |\n:::", "bad-setting-value"],
		["# P\n::: columns\n:: {weight=-2}\nText\n:::", "bad-setting-value"],
		["# P\n::: columns\n:: {weight=0}\nText\n:::", "bad-setting-value"],
		["# P\n::: tabs\n::\n::\n:::", "missing-subject"],
		["# P\n::: comparison\n:: A\n:::", "child-count"],
		["# P\n::: comparison\n:: A\n:: B\n:: C\n:::", "child-count"],
		["# P\n::: back\nText\n:::", "disallowed-child"],
		["# P\n::: tabs\n:: A\n::: back\nText\n:::\n:::", "disallowed-child"],
		["# P\n::: note\n::: back\nText\n:::\n:::", "disallowed-child"],
		["# P\n::: button Not a link\n:::", "bad-subject"],
		["# P\n::: embed\n:::", "missing-subject"],
		["# P\n::: figure\nCaption\n:::", "child-count"],
		["# P\n![](/assets/a.png)", "missing-image-alt"],
		["# P\n::: note {hide=perhaps}\n:::", "bad-setting-value"],
		["# P\n::: video /assets/a.mp4 {start=-1}\n:::", "bad-setting-value"],
		["# P\n::: video /assets/a.mp4 {start=4 end=2}\n:::", "bad-setting-value"],
		["# P\n::: note {icon=NotAnIcon}\n:::", "bad-setting-value"],
		["# P\n::: cards\n::: note\nText\n:::\n:: A\n:::", "disallowed-child"],
	])("rejects %s with %s while preserving source", (source, code) => {
		const tree = parse(source);
		expect(tree.diagnostics.map((d) => d.code)).toContain(code);
		expect(tree.root.status).toBe("unresolved");
		expect(tree.root.raw).toBe(source);
	});
	it.each([2, 4])("accepts columns bound %s", (columns) => {
		expect(parse(`# P\n::: cards {columns=${columns}}\n:: A\n:::`).diagnostics).toEqual([]);
	});
	it.each(["1", "0.5", "2.5"])("accepts positive column weight %s", (weight) => {
		expect(parse(`# P\n::: columns\n:: {weight=${weight}}\nText\n:::`).diagnostics).toEqual([]);
	});
	it.each(["1", "5", "2.5", "NaN", "Infinity"])("rejects invalid columns %s", (columns) => {
		expect(
			parse(`# P\n::: cards {columns=${columns}}\n:: A\n:::`).diagnostics.map((d) => d.code),
		).toContain("bad-setting-value");
	});
	it("suggests tone for colour without silently correcting source", () => {
		const source = "# P\n::: note {colour=warning}\nText\n:::";
		const tree = parse(source);
		expect(tree.diagnostics[0].message.args).toMatchObject({ name: "colour", suggestion: "tone" });
		expect(tree.root.raw).toBe(source);
	});
	it("rejects a legacy setting line and retains unknown named prose", () => {
		const source = "# P\n::: note\ncolor: warning\nRemarque: Keep this\n:::";
		const tree = parse(source);
		expect(tree.diagnostics.map((d) => d.code)).toEqual(["setting-on-body-line"]);
		expect(walk(tree.root).find((n) => n.kind === "recovery")?.raw).toBe("color: warning\n");
		expect(walk(tree.root).find((n) => n.kind === "body")?.raw).toContain("Remarque: Keep this");
	});
	it("warns on U+202F before a part colon and keeps prose", () => {
		const source = "# P\n::: video /assets/a.mp4\ncaption \u202f: Attention!\n:::";
		const tree = parse(source);
		expect(tree.diagnostics.map((d) => [d.code, d.severity])).toEqual([
			["part-colon-spacing", "warning"],
		]);
		expect(tree.root.status).toBe("resolved");
		expect(walk(tree.root).filter((n) => n.kind === "part")).toEqual([]);
		expect(walk(tree.root).find((n) => n.kind === "body")?.raw).toBe(
			"caption \u202f: Attention!\n",
		);
	});
	it("uses the manifest layout vocabulary and exposes helper metadata", () => {
		const layout = getManifest({ include: "all" })
			.get("card")
			?.variants.find((v) => v.name === "layout");
		expect(BLOCK_SCHEMA.cards.settings.layout.values).toEqual(
			layout?.options?.filter(isOptionImplemented).map(getOptionValue),
		);
		expect(BLOCK_SCHEMA.note.settings.tone.helper?.kind).toBe("enum");
		expect(
			BLOCK_SCHEMA.note.settings.tone.helper?.options?.every((o) => o.icon && o.labelKey),
		).toBe(true);
		expect(BLOCK_SCHEMA.note.settings.icon.helper?.kind).toBe("icon");
		expect(BLOCK_SCHEMA.button.settings.newTab.helper?.kind).toBe("toggle");
		expect(BLOCK_SCHEMA.cards.settings.columns.helper?.kind).toBe("stepper");
		expect(BLOCK_SCHEMA.quote.settings.source.helper?.kind).toBe("link");
		expect(BLOCK_SCHEMA.video.settings.captions.helper?.kind).toBe("asset");
		expect(BLOCK_SCHEMA.image.settings.effects.helper?.kind).toBe("colour");
		expect(INLINE_HELPERS.term.kind).toBe("glossary");
	});
	it("recognizes multiline learner parts and keeps item heading scope", () => {
		const tree = parse(
			"# P\n::: tabs\n:: A\n### Deep\n::: video /assets/a.mp4\ntranscript: First\n  Second\n:::\n:: B\nText\n:::",
		);
		expect(tree.diagnostics).toEqual([]);
		expect(walk(tree.root).find((n) => n.name === "transcript")?.value?.value).toBe(
			"First\n  Second",
		);
		expect(
			walk(tree.root)
				.filter((n) => n.kind === "item")
				.map((n) => n.headingLevel),
		).toEqual([2, 2]);
	});
	it("allows decorative images and a back only directly in a card item", () => {
		expect(
			parse("# P\n![](/assets/a.png){decorative}\n::: cards\n:: Front\n::: back\nBack\n:::\n:::")
				.diagnostics,
		).toEqual([]);
	});
	it.each(["constructor", "toString"])("rejects an undeclared setting named %s", (name) => {
		const tree = parse(`# P\n::: note {${name}=value}\n:::`);
		expect(tree.diagnostics.map((d) => d.code)).toEqual(["unknown-setting"]);
		expect(tree.diagnostics[0].message.args).not.toHaveProperty("suggestion");
	});
	it("keeps a named prose line whose name exists only on Object.prototype", () => {
		expect(parse("# P\n::: note\nconstructor: Keep\n:::").diagnostics).toEqual([]);
	});
	it.each([
		"# P\n::: float\nText before image\n![Alt](/assets/a.png)\n:::",
		"# P\n::: figure\n![Alt](/assets/a.png)\n:::",
	])("rejects an incomplete or reversed image body %s", (source) => {
		expect(parse(source).diagnostics.map((d) => d.code)).toContain("disallowed-child");
	});
	it.each([
		"# P\n::: button [Unsafe](javascript:alert)\n:::",
		"# P\n::: embed http://example.com/embed\n:::",
		"# P\n::: embed https://praxity.io/embed\n:::",
		"# P\n::: video javascript:alert\n:::",
	])("rejects unsafe subjects %s", (source) => {
		expect(parse(source).diagnostics.map((d) => d.code)).toContain("bad-subject");
	});
	it.each(types)("%s exposes only valid default settings", (type) => {
		for (const setting of Object.values(BLOCK_SCHEMA[type].settings)) {
			if (setting.default !== undefined)
				expect(
					setting.accepts(
						typeof setting.default === "number" ? String(setting.default) : setting.default,
					),
				).toBe(true);
		}
	});
	it.each(types)("%s templates keep CRLF and mixed line endings", (type) => {
		const template = BLOCK_SCHEMA[type].insertTemplate;
		for (const mixed of [false, true]) {
			let line = 0;
			const original = type === "page" ? template : `# P\n${template}`;
			const source = original.replace(/\n/g, () => (!mixed || line++ % 2 === 0 ? "\r\n" : "\n"));
			const tree = parse(source);
			expect(tree.diagnostics).toEqual([]);
			expect(tree.root.raw).toBe(source);
			expect(tree.stream.tokens.map((t) => t.raw).join("")).toBe(source);
		}
	});
	it("validates a Markdown link from raw spelling before decoding escapes", () => {
		const source = "# P\n::: button [A \\] bracket](https://example.com/a(1))\n:::";
		const tree = parse(source);
		expect(tree.diagnostics).toEqual([]);
		expect(walk(tree.root).find((n) => n.type === "button")?.subject?.raw).toBe(
			"[A \\] bracket](https://example.com/a(1))",
		);
	});
	it("declares boolean defaults only when their owning manifest supplies them", () => {
		expect(BLOCK_SCHEMA.accordion.settings.allowMultipleOpen.default).toBe(false);
		expect(BLOCK_SCHEMA.cards.settings.headings.default).toBeUndefined();
		expect(BLOCK_SCHEMA.cards.settings.showProgress.default).toBeUndefined();
		expect(BLOCK_SCHEMA.button.settings.newTab.default).toBeUndefined();
	});
	it.each([
		"leadership/00-avant-de-commencer",
		"leadership/01-affirmez-vous",
		"leadership/02-quatre-cavaliers",
		"leadership/03-resoudre-un-conflit",
		"toolkit/welcome",
	])("accepts G4 constructs in the converted %s corpus", (lesson) => {
		const source = readFileSync(new URL(`./fixtures/v4/${lesson}.prax`, import.meta.url), "utf8");
		const tree = parse(source);
		// G5 owns undeclared assessment types. Any error from a G4 declaration still fails.
		expect(tree.diagnostics.filter((d) => d.code !== "unknown-type")).toEqual([]);
		expect(tree.root.raw).toBe(source);
	});
});
