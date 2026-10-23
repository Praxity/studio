import {
	inlineParagraph,
	materialInlineTree,
	renderInlineTree,
} from "@praxity/content-model/inline-tree";
import { describe, expect, it } from "vitest";
import { readLesson } from "../../grammar/src/read-lesson";
import { choiceContentSignature, choiceMaterialContent } from "../src/assessment-choice";
import { assessmentMaterialContent, assessmentMaterialOptionHtml } from "../src/assessment-content";
import { getStrings } from "../src/i18n/strings";
import { preparePageFootnotes } from "../src/page-footnotes";
import type { AssessmentBlockData } from "../src/types";
import { compiled, fieldQuestion, producers } from "./fixtures/choice-material";

const forms = ["@source{Note}", "@footer{Note}", "@sources", "@footer.insert"];

describe.each(producers)("$name material footnotes with internal closing braces", (producer) => {
	// Fixed hashes of the note-free "a c" field in the pinned question fixture.
	for (const [field, expected] of [
		["stem", "sha256:51a23a027c2360ff925813a8ff8bb669bda3199fa67760ebb23c3266fd8ddcbe"],
		["description", "sha256:2118aa56711835f28ba185fb483535477ec2f4ba4f77537c15d7629a051d10f5"],
		["option", "sha256:c50532c29ae16d6b4b65d8805d1756679ea76984674cf1fc72f908c2effd70ec"],
	] as const) {
		it.each([
			["escaped source", String.raw`a @source{N\} b} c`],
			["escaped footer", String.raw`a @footer{N\} b} c`],
			["code-span source", "a @source{x `y}` z} c"],
			["code-span footer", "a @footer{x `y}` z} c"],
		])(`${field} erases %s`, (_name, source) => {
			const data = fieldQuestion(source, field, producer);
			if (data.response.type !== "choice") throw new Error("Missing choice");
			const material =
				field === "option"
					? assessmentMaterialOptionHtml(data.response.options[0])
					: assessmentMaterialContent(data)[field === "stem" ? "stemHtml" : "descriptionHtml"];
			expect(material).toBe(field === "option" ? "a c" : "<p>a c</p>");
			expect(choiceContentSignature(data, false)).toBe(expected);
		});
	}
});

it("compiled comparison stems erase every spelling as literal text", () => {
	for (const [note, expected] of [
		["@source{N}", "sha256:a545d15fc444ca80abae0ca541cfcb26e6598b90c9cba8989c56bc58961abe8f"],
		["@footer{N}", "sha256:a545d15fc444ca80abae0ca541cfcb26e6598b90c9cba8989c56bc58961abe8f"],
		["@sources", "sha256:a545d15fc444ca80abae0ca541cfcb26e6598b90c9cba8989c56bc58961abe8f"],
		["@footer.insert", "sha256:a545d15fc444ca80abae0ca541cfcb26e6598b90c9cba8989c56bc58961abe8f"],
	]) {
		const data = compiled(`If a<b ${note} then b>a`);
		expect(assessmentMaterialContent(data).stemHtml).toBe("<p>If a&lt;b then b&gt;a</p>");
		expect(choiceContentSignature(data, false)).toBe(expected);
	}
});

it("compiled code cannot open a tag around a later note", () => {
	for (const note of ["@source{N}", "@footer{N}", "@source{N >}", "@footer{N >}"]) {
		const data = compiled(`Yes \`<tag\` ${note}`);
		expect(assessmentMaterialContent(data).stemHtml).toBe("<p>Yes <code>&lt;tag</code></p>");
		expect(choiceContentSignature(data, false)).toBe(
			"sha256:34f6c5c90c9873814db8568d2b295923d498e09d4e9f7f547726edcdb4374fd6",
		);
	}
});

it.each(producers)("$name tree text never acquires HTML attribute ownership", (producer) => {
	for (const [template, grammar, display] of [
		["If a<b NOTE then b>a", "If a&lt;b then b&gt;a", "If a&lt;b then b&gt;a"],
		["x<y NOTE z>w", "x&lt;y z&gt;w", "x&lt;y z&gt;w"],
		["Yes `<tag` NOTE", "Yes <code>&lt;tag</code>", "Yes <code>&lt;tag</code>"],
		[String.raw`Yes \<tag NOTE`, "Yes &lt;tag", String.raw`Yes \&lt;tag`],
	]) {
		const expected = producer.name === "grammar" ? grammar : display;
		for (const note of ["@source{N >}", "@footer{N >}", "@sources", "@footer.insert"]) {
			const source = template.replace("NOTE", note);
			const tree = producer.parse(source);
			const original = structuredClone(tree);
			const material = materialInlineTree(tree, true);
			expect(material && renderInlineTree(material)).toBe(expected);
			expect(tree).toEqual(original);
			for (const field of ["stem", "description", "option"] as const) {
				expect(choiceContentSignature(fieldQuestion(source, field, producer), false)).toBe(
					choiceContentSignature(
						fieldQuestion(template.replace(" NOTE", ""), field, producer),
						false,
					),
				);
			}
		}
	}
});

it.each(producers)("$name bound option trees retain the fixed plain-label hash", (producer) => {
	for (const source of ["Yes @source{Use `<span>`}", "Yes @footer{Edited `<span>`}"]) {
		const data = compiled("Word");
		if (data.response.type !== "choice") throw new Error("Missing choice");
		const tree = producer.parse(source);
		const display = renderInlineTree(tree, { interactive: false });
		data.response.options[0] = {
			id: "a",
			isCorrect: true,
			label: source,
			_inline: { label: display },
			_inlineTrees: { label: { trees: [tree], display } },
		} as (typeof data.response.options)[number];
		expect(choiceMaterialContent(assessmentMaterialOptionHtml(data.response.options[0]))).toEqual([
			"Yes",
		]);
		expect(choiceContentSignature(data, false)).toBe(
			"sha256:d49cc3756afdf93e14b19836ac8a42fb28c2ddc2c3c18faad430f54f0e411533",
		);
	}
});

for (const locale of ["en", "fr"]) {
	for (const field of ["stem", "description", "option"] as const) {
		it.each(forms)(
			`compiled ${locale} ${field} ignores edits and earlier-page renumbering: %s`,
			(note) => {
				const plain = compiled("Word", "Description", "Yes");
				const expected = choiceContentSignature(plain, false);
				for (const spelling of [note, note.replace("Note", "Edited"), `${note} ${note}`]) {
					for (const earlier of ["", "Earlier @source{Before}\n\n# Next\n"]) {
						const data = compiled(
							field === "stem" ? `Word ${spelling}` : "Word",
							field === "description" ? `Description ${spelling}` : "Description",
							field === "option" ? `Yes ${spelling}` : "Yes",
							earlier,
						);
						// A second preparation with the requested locale also keeps bound provenance.
						const prepared = preparePageFootnotes(
							[
								{
									id: "question",
									type: "assessment",
									data: data as unknown as Record<string, unknown>,
								},
							],
							"page",
							getStrings(locale),
						)[0].data as unknown as AssessmentBlockData;
						expect(choiceContentSignature(prepared, false)).toBe(expected);
						const material = assessmentMaterialContent(prepared);
						expect(material.stemHtml).toBe("<p>Word</p>");
						expect(material.descriptionHtml).toBe("<p>Description</p>");
						if (prepared.response.type !== "choice") throw new Error("Missing choice");
						expect(assessmentMaterialOptionHtml(prepared.response.options[0])).toBe("Yes");
					}
				}
			},
		);
	}
}

describe.each(producers)("$name material-only footnotes", (producer) => {
	for (const field of ["stem", "description", "option"] as const) {
		it.each(forms)(`${field} erases %s before coverage and separator ownership`, (note) => {
			for (const [source, expected] of [
				[`Yes ${note}`, "Yes"],
				[`${note} Yes`, "Yes"],
				[`Yes ${note} now`, "Yes now"],
				[note, ""],
				[`**${note}**`, ""],
				[`==Yes== ${note}`, "Yes"],
				[`Yes ==aside ${note}== now`, "Yes now"],
			]) {
				const tree = producer.parse(source);
				const original = structuredClone(tree);
				const material = materialInlineTree(
					field === "description" ? inlineParagraph(tree) : tree,
					field !== "description",
				);
				const html = material ? renderInlineTree(material) : "";
				const wanted =
					field === "description"
						? expected === "Yes" && source.includes("==Yes==")
							? ""
							: expected
						: expected;
				expect(html).toBe(field === "description" && wanted ? `<p>${wanted}</p>` : wanted);
				expect(tree).toEqual(original);
			}
		});
		it(`${field} signatures ignore note presence, spelling, text and list forms`, () => {
			const plain = fieldQuestion("Yes", field, producer);
			for (const note of forms)
				for (const source of [
					`Yes ${note}`,
					`Yes ${note.replace("Note", "Edited")}`,
					`Yes ${note} ${note}`,
					`**Yes** ${note}`,
				]) {
					expect(choiceContentSignature(fieldQuestion(source, field, producer), false)).toBe(
						choiceContentSignature(plain, false),
					);
				}
		});
	}
});

it.each(["@source{N}", "@footer{N}", "@sources", "@footer.insert"])(
	"erases compiled note-only description envelopes: %s",
	(source) => {
		const data = compiled("Word", source);
		expect(assessmentMaterialContent(data).descriptionHtml).toBe("");
		expect(choiceContentSignature(data, false)).toBe(
			choiceContentSignature(compiled("Word"), false),
		);
	},
);

it.each([
	[
		"Use `<em>` tag",
		"No",
		"sha256:3cd8a2ed05caa246813182dc7441c83ec77da25aa59ea67c2138a1295fc77741",
	],
	[
		"The `<span>` tag",
		"The `<div>` tag",
		"sha256:f617a9cebf4c0aa71d579b3f3daab1588419d5e1a56d28307ffec9d34ced9487",
	],
	["Yes", "No", "sha256:45882264b6cdeac4047ebffb3a9a0ddeaf3408e7bc416b03e1f8602562e3b016"],
	[
		"Yes @source{N}",
		"No",
		"sha256:45882264b6cdeac4047ebffb3a9a0ddeaf3408e7bc416b03e1f8602562e3b016",
	],
	[
		"Yes @footer{N}",
		"No",
		"sha256:45882264b6cdeac4047ebffb3a9a0ddeaf3408e7bc416b03e1f8602562e3b016",
	],
])("preserves the fixed review hash for %s", (label, other, expected) => {
	let id = 0;
	const read = readLesson(`# P\n::: choice Word\n(x) ${label}\n( ) ${other}\n:::\n`, {
		ids: (node) =>
			node.kind === "option" ? (node.correct ? `yes${id++}` : `no${id++}`) : `x${id++}`,
	});
	const data = read.pages[0].blocks.find((b) => b.type === "assessment")
		?.data as unknown as AssessmentBlockData;
	expect(choiceContentSignature(data, false)).toBe(expected);
});

it.each(producers)(
	"$name validates original display bindings before material normalization",
	(producer) => {
		const source = "Yes @source{Use `<span>`}";
		const tree = producer.parse(source),
			display = renderInlineTree(tree, { interactive: false });
		const owner = {
			label: source,
			_inline: { label: display },
			_inlineTrees: { label: { trees: [tree], display } },
		};
		expect(assessmentMaterialOptionHtml(owner)).toBe("Yes");
		expect(assessmentMaterialOptionHtml({ ...owner, _inline: { label: "Different" } })).toBe(
			"Different",
		);
		expect(assessmentMaterialOptionHtml({ label: '<span title="@source{N}">Yes</span>' })).toBe(
			'<span title="@source{N}">Yes</span>',
		);
	},
);

// Unchanged material controls were captured from main, including each producer's own syntax.
const materialControls = [
	{
		producer: "grammar",
		source: "\\@source{N}",
		html: "@source{N}",
		signature: "sha256:ebd7296a72070eabdd1f169b81a9b4abb2c6c9149376747da46b5fbfa57ef054",
	},
	{
		producer: "grammar",
		source: "\\@footer{N}",
		html: "@footer{N}",
		signature: "sha256:1a6b7b13f81cd9efb13677448c531aca57256a18fa7044be489ee400bb8f55b8",
	},
	{
		producer: "grammar",
		source: "\\@sources",
		html: "@sources",
		signature: "sha256:50438b2c3e36bd63afb817c4e67fe218d229c8bf7cf48f5ff29ae1df05ae4a08",
	},
	{
		producer: "grammar",
		source: "\\@footer.insert",
		html: "@footer.insert",
		signature: "sha256:71abc8e306d2e483a87ec43d64a2ba953d0f888aa5bb65d4f55ec77fdd006c94",
	},
	{
		producer: "grammar",
		source: "`@source{N}`",
		html: "<code>@source{N}</code>",
		signature: "sha256:d687937aa223e24c70c42575b9ee44d67e6fa7d4b5397f561ed0f4c2c9ec0e0f",
	},
	{
		producer: "grammar",
		source: "`@footer{N}`",
		html: "<code>@footer{N}</code>",
		signature: "sha256:de7311eb23ab40e3b0937c733738d93767ba2d24a10994f17796385b303810c1",
	},
	{
		producer: "grammar",
		source: "[Yes](https://example.com/@sources)",
		html: '<a href="https://example.com/@sources">Yes</a>',
		signature: "sha256:4c9fc47aff6b36d8e38f2c101a91191165ff9b8608398c1a43690e6737f5190f",
	},
	{
		producer: "grammar",
		source: "[Yes]{Use @source{N}}",
		html: "[Yes]{Use @source{N}}",
		signature: "sha256:c3ded1f8cd1564447fb2e4be699b1f062b44c21902037d84650052635a028fff",
	},
	{
		producer: "grammar",
		source: "@source{}",
		html: "@source{}",
		signature: "sha256:4a07c568b7054054159b70f8b6390800e49c897be81b6035feb4256cc94f979e",
	},
	{
		producer: "grammar",
		source: "@footer{}",
		html: "@footer{}",
		signature: "sha256:64c81524d465b3220d42225ce0a7bd1490ffe621b5075fe7a95bb039887acac0",
	},
	{
		producer: "grammar",
		source: "@source{outer {nested}}",
		html: "@source{outer {nested}}",
		signature: "sha256:e2fb915898e67e59093169db54deabc9894db61e49ae02da3bf9808282973982",
	},
	{
		producer: "grammar",
		source: "@footer{outer {nested}}",
		html: "@footer{outer {nested}}",
		signature: "sha256:10a4888ef968784a093f8d639cba83528fee69347c5f57374af7afd0aa0099ef",
	},
	{
		producer: "grammar",
		source: "@source{Use `{`}",
		html: "@source{Use `{`}",
		signature: "sha256:1344475f954144a8c2543ea98a9db007a6fa554fcff2e53868f2aac32d143d0e",
	},
	{
		producer: "grammar",
		source: "@footer{Use `{`}",
		html: "@footer{Use `{`}",
		signature: "sha256:0f58ba8c2bd67a7627baad809123f249eaec77ce13ddf304eef8b1a2f026eb16",
	},
	{
		producer: "grammar",
		source: "@sourcesMore",
		html: "@sourcesMore",
		signature: "sha256:ae75368efc8d7f9e35878526f795e44c803090d64ec2ce37b4187fa3d1599ed3",
	},
	{
		producer: "grammar",
		source: "@footer.insertion",
		html: "@footer.insertion",
		signature: "sha256:f8d565baf2a5bf1a2f7357c2bb2de71986f54c5ea8e31b05bfe267b20a449c4d",
	},
	{
		producer: "grammar",
		source: "@sources.more",
		html: "@sources.more",
		signature: "sha256:5805f36901ae570688e145aa119113b5b6588fd9aa25ab880f4fe9b7a98fc4a2",
	},
	{
		producer: "grammar",
		source: "@footer.insert.more",
		html: "@footer.insert.more",
		signature: "sha256:ebf7b91812fa0174a33a2e90495e49e1a4eb76a1fa29e688f25cb3ef16533b26",
	},
	{
		producer: "grammar",
		source: "@source.wavy{N}",
		html: "@source.wavy{N}",
		signature: "sha256:59fcde95608f39fe1d747f869c41963d11ebf96368cc0861b236720b06298cdd",
	},
	{
		producer: "grammar",
		source: "@footer.wavy{N}",
		html: "@footer.wavy{N}",
		signature: "sha256:64cfff9af71c075e839809038a7d76054e3a50d47af4ac673b9c2d2cc7f06329",
	},
	{
		producer: "grammar",
		source: "[a](https://x.test/a(1))",
		html: '<a href="https://x.test/a(1)">a</a>',
		signature: "sha256:66021655ea3f4e5dcbe9c30cba2918cb6294fec2fa40c03ca111c89927552c06",
	},
	{
		producer: "display",
		source: "\\@source{N}",
		html: "@source{N}",
		signature: "sha256:ebd7296a72070eabdd1f169b81a9b4abb2c6c9149376747da46b5fbfa57ef054",
	},
	{
		producer: "display",
		source: "\\@footer{N}",
		html: "@footer{N}",
		signature: "sha256:1a6b7b13f81cd9efb13677448c531aca57256a18fa7044be489ee400bb8f55b8",
	},
	{
		producer: "display",
		source: "\\@sources",
		html: "@sources",
		signature: "sha256:50438b2c3e36bd63afb817c4e67fe218d229c8bf7cf48f5ff29ae1df05ae4a08",
	},
	{
		producer: "display",
		source: "\\@footer.insert",
		html: "@footer.insert",
		signature: "sha256:71abc8e306d2e483a87ec43d64a2ba953d0f888aa5bb65d4f55ec77fdd006c94",
	},
	{
		producer: "display",
		source: "`@source{N}`",
		html: "<code>@source{N}</code>",
		signature: "sha256:d687937aa223e24c70c42575b9ee44d67e6fa7d4b5397f561ed0f4c2c9ec0e0f",
	},
	{
		producer: "display",
		source: "`@footer{N}`",
		html: "<code>@footer{N}</code>",
		signature: "sha256:de7311eb23ab40e3b0937c733738d93767ba2d24a10994f17796385b303810c1",
	},
	{
		producer: "display",
		source: "[Yes](https://example.com/@sources)",
		html: '<a href="https://example.com/@sources">Yes</a>',
		signature: "sha256:4c9fc47aff6b36d8e38f2c101a91191165ff9b8608398c1a43690e6737f5190f",
	},
	{
		producer: "display",
		source: "[Yes]{Use @source{N}}",
		html: "[Yes]{Use @source{N}}",
		signature: "sha256:c3ded1f8cd1564447fb2e4be699b1f062b44c21902037d84650052635a028fff",
	},
	{
		producer: "display",
		source: "@source{}",
		html: "@source{}",
		signature: "sha256:4a07c568b7054054159b70f8b6390800e49c897be81b6035feb4256cc94f979e",
	},
	{
		producer: "display",
		source: "@footer{}",
		html: "@footer{}",
		signature: "sha256:64c81524d465b3220d42225ce0a7bd1490ffe621b5075fe7a95bb039887acac0",
	},
	{
		producer: "display",
		source: "@source{outer {nested}}",
		html: "outer {nested}",
		signature: "sha256:1a0a4ed2d89e6768370990f60831e70403fd817de9a551b8e20d88e5dc0dc7b0",
	},
	{
		producer: "display",
		source: "@footer{outer {nested}}",
		html: "@footer{outer {nested}}",
		signature: "sha256:10a4888ef968784a093f8d639cba83528fee69347c5f57374af7afd0aa0099ef",
	},
	{
		producer: "display",
		source: "@source{Use `{`}",
		html: "Use <code>{</code>",
		signature: "sha256:5bf4a9acbf279d1713bf36bd6f7d2812676054e04eb65152606231fd449cfe1f",
	},
	{
		producer: "display",
		source: "@footer{Use `{`}",
		html: "@footer{Use `{`}",
		signature: "sha256:0f58ba8c2bd67a7627baad809123f249eaec77ce13ddf304eef8b1a2f026eb16",
	},
	{
		producer: "display",
		source: "@sourcesMore",
		html: "@sourcesMore",
		signature: "sha256:ae75368efc8d7f9e35878526f795e44c803090d64ec2ce37b4187fa3d1599ed3",
	},
	{
		producer: "display",
		source: "@footer.insertion",
		html: "ion",
		signature: "sha256:f59faad83955f2e8f0796263117b77c8af92a73318cd460224efa93e2b01ede2",
	},
	{
		producer: "display",
		source: "@sources.more",
		html: "@sources.more",
		signature: "sha256:5805f36901ae570688e145aa119113b5b6588fd9aa25ab880f4fe9b7a98fc4a2",
	},
	{
		producer: "display",
		source: "@footer.insert.more",
		html: ".more",
		signature: "sha256:59a74da4c96e5c11384b7c1b8bf25d034505038551a76f6edd786c997c81af35",
	},
	{
		producer: "display",
		source: "@source.wavy{N}",
		html: "N",
		signature: "sha256:c3ff100c699fa9abcfa916a2b9da84acf4c54f7897f39e686079224821cee7fd",
	},
	{
		producer: "display",
		source: "@footer.wavy{N}",
		html: "@footer.wavy{N}",
		signature: "sha256:64cfff9af71c075e839809038a7d76054e3a50d47af4ac673b9c2d2cc7f06329",
	},
	{
		producer: "display",
		source: "[a](https://x.test/a(1))",
		html: '<a href="https://x.test/a(1">a</a>)',
		signature: "sha256:371d356e18111b2c47f3eef851afb32a2f2e3c07194c9fde6b12ade5df7b3ccf",
	},
];
it.each(materialControls)(
	"keeps main's opaque and malformed controls: $producer $source",
	(row) => {
		const producer = producers.find((producer) => producer.name === row.producer);
		if (!producer) throw new Error("Missing producer");
		const material = materialInlineTree(producer.parse(row.source), true);
		expect(material ? renderInlineTree(material) : "").toBe(row.html);
		expect(choiceContentSignature(fieldQuestion(row.source, "stem", producer), false)).toBe(
			row.signature,
		);
	},
);
