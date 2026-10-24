import { renderInlineTree } from "@praxity/content-model/inline-tree";
import { expect, it } from "vitest";
import { producers } from "./fixtures/choice-material";

const materialControls = [
	{
		producer: "grammar",
		source: "\\@source{N}",
		html: "@source{N}",
	},
	{
		producer: "grammar",
		source: "\\@footer{N}",
		html: "@footer{N}",
	},
	{
		producer: "grammar",
		source: "\\@sources",
		html: "@sources",
	},
	{
		producer: "grammar",
		source: "\\@footer.insert",
		html: "@footer.insert",
	},
	{
		producer: "grammar",
		source: "`@source{N}`",
		html: "<code>@source{N}</code>",
	},
	{
		producer: "grammar",
		source: "`@footer{N}`",
		html: "<code>@footer{N}</code>",
	},
	{
		producer: "grammar",
		source: "[Yes](https://example.com/@sources)",
		html: '<a href="https://example.com/@sources">Yes</a>',
	},
	{
		producer: "grammar",
		source: "[Yes]{Use @source{N}}",
		html: "[Yes]{Use @source{N}}",
	},
	{
		producer: "grammar",
		source: "@source{}",
		html: "@source{}",
	},
	{
		producer: "grammar",
		source: "@footer{}",
		html: "@footer{}",
	},
	{
		producer: "grammar",
		source: "@source{outer {nested}}",
		html: "@source{outer {nested}}",
	},
	{
		producer: "grammar",
		source: "@footer{outer {nested}}",
		html: "@footer{outer {nested}}",
	},
	{
		producer: "grammar",
		source: "@source{Use `{`}",
		html: "@source{Use `{`}",
	},
	{
		producer: "grammar",
		source: "@footer{Use `{`}",
		html: "@footer{Use `{`}",
	},
	{
		producer: "grammar",
		source: "@sourcesMore",
		html: "@sourcesMore",
	},
	{
		producer: "grammar",
		source: "@footer.insertion",
		html: "@footer.insertion",
	},
	{
		producer: "grammar",
		source: "@sources.more",
		html: "@sources.more",
	},
	{
		producer: "grammar",
		source: "@footer.insert.more",
		html: "@footer.insert.more",
	},
	{
		producer: "grammar",
		source: "@source.wavy{N}",
		html: "@source.wavy{N}",
	},
	{
		producer: "grammar",
		source: "@footer.wavy{N}",
		html: "@footer.wavy{N}",
	},
	{
		producer: "grammar",
		source: "[a](https://x.test/a(1))",
		html: '<a href="https://x.test/a(1)">a</a>',
	},
	{
		producer: "display",
		source: "\\@source{N}",
		html: "@source{N}",
	},
	{
		producer: "display",
		source: "\\@footer{N}",
		html: "@footer{N}",
	},
	{
		producer: "display",
		source: "\\@sources",
		html: "@sources",
	},
	{
		producer: "display",
		source: "\\@footer.insert",
		html: "@footer.insert",
	},
	{
		producer: "display",
		source: "`@source{N}`",
		html: "<code>@source{N}</code>",
	},
	{
		producer: "display",
		source: "`@footer{N}`",
		html: "<code>@footer{N}</code>",
	},
	{
		producer: "display",
		source: "[Yes](https://example.com/@sources)",
		html: '<a href="https://example.com/@sources">Yes</a>',
	},
	{
		producer: "display",
		source: "[Yes]{Use @source{N}}",
		html: "[Yes]{Use @source{N}}",
	},
	{
		producer: "display",
		source: "@source{}",
		html: "@source{}",
	},
	{
		producer: "display",
		source: "@footer{}",
		html: "@footer{}",
	},
	{
		producer: "display",
		source: "@source{outer {nested}}",
		html: '<span class="praxity-doodle" data-doodle="source" data-doodle-mods="">outer {nested}</span>',
	},
	{
		producer: "display",
		source: "@footer{outer {nested}}",
		html: "@footer{outer {nested}}",
	},
	{
		producer: "display",
		source: "@source{Use `{`}",
		html: '<span class="praxity-doodle" data-doodle="source" data-doodle-mods="">Use <code>{</code></span>',
	},
	{
		producer: "display",
		source: "@footer{Use `{`}",
		html: "@footer{Use `{`}",
	},
	{
		producer: "display",
		source: "@sourcesMore",
		html: "@sourcesMore",
	},
	{
		producer: "display",
		source: "@footer.insertion",
		html: '<span data-footer-insert="true">@footer.insert</span>ion',
	},
	{
		producer: "display",
		source: "@sources.more",
		html: "@sources.more",
	},
	{
		producer: "display",
		source: "@footer.insert.more",
		html: '<span data-footer-insert="true">@footer.insert</span>.more',
	},
	{
		producer: "display",
		source: "@source.wavy{N}",
		html: '<span class="praxity-doodle" data-doodle="source" data-doodle-mods="wavy">N</span>',
	},
	{
		producer: "display",
		source: "@footer.wavy{N}",
		html: "@footer.wavy{N}",
	},
	{
		producer: "display",
		source: "[a](https://x.test/a(1))",
		html: '<a href="https://x.test/a(1">a</a>)',
	},
];
it.each(materialControls)("keeps producer rendering: $producer $source", (row) => {
	const producer = row.producer === "grammar" ? producers[0] : producers[1];
	expect(renderInlineTree(producer.parse(row.source))).toBe(row.html);
});
