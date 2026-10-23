import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePdfStructure, structureNodes } from "./helpers/pdf-structure.ts";

describe.each(["24.02", "26.09"])("Poppler %s structure", (version) => {
	const { output } = JSON.parse(
		readFileSync(new URL(`./fixtures/pdfinfo-${version}.json`, import.meta.url), "utf8"),
	);

	it("preserves nested containers and sibling reading order", () => {
		const tree = parsePdfStructure(output);
		expect(tree.tag).toBe("Document");
		expect(tree.children.find((node) => node.tag === "Div")).toEqual({
			tag: "Div",
			children: [
				{ tag: "Div", children: [{ tag: "H2", title: "Tab A", children: [] }] },
				{ tag: "Div", children: [{ tag: "P", children: [] }] },
				{ tag: "Div", children: [{ tag: "H2", title: "Tab B", children: [] }] },
				{ tag: "Div", children: [{ tag: "P", children: [] }] },
			],
		});
		expect(
			structureNodes(tree)
				.filter((node) => node.tag === "H1")
				.map((node) => node.title),
		).toEqual(["Contents", "Lesson"]);
		expect(
			structureNodes(tree)
				.filter((node) => node.tag === "Object")
				.map((node) => node.reference),
		).toEqual(
			version === "24.02"
				? ["105 0", "106 0", "107 0", "108 0", "109 0", "110 0", "111 0"]
				: ["106 0", "107 0", "108 0", "109 0", "110 0", "111 0", "112 0"],
		);
	});

	it("attaches attributes to the Figure and reads alt only when Poppler supplies it", () => {
		const figures = structureNodes(parsePdfStructure(output)).filter(
			(node) => node.tag === "Figure",
		);
		expect(figures).toHaveLength(1);
		expect(figures[0].attributes).toEqual({
			Placement: "/Block",
			BBox:
				version === "24.02"
					? "[62.3622 361.409 532.913 643.739]"
					: "[62.3622 375.809 532.913 658.139]",
		});
		expect(figures[0].alt).toBe(version === "24.02" ? undefined : "Accessible valve diagram");
	});
});

it("keeps quotes, Unicode and internal NULs in titles and alt text", () => {
	expect(
		parsePdfStructure(
			'Document\r\n  H2 "A \\"quoted\\" titre é" (block)\r\n  Figure ["valve\u0000diagram\u0000"]:\r\n     /Placement /Block\r\n',
		),
	).toEqual({
		tag: "Document",
		children: [
			{ tag: "H2", title: 'A \\"quoted\\" titre é', children: [] },
			{
				tag: "Figure",
				alt: "valve\u0000diagram",
				attributes: { Placement: "/Block" },
				children: [],
			},
		],
	});
});

it("keeps title and alt text distinct when both are present", () => {
	expect(
		parsePdfStructure(
			'Document\n  Figure "Valve \\"front\\"" ["Accessible valve diagram"]:\n     /Placement /Block\n',
		).children,
	).toEqual([
		{
			tag: "Figure",
			title: 'Valve \\"front\\"',
			alt: "Accessible valve diagram",
			attributes: { Placement: "/Block" },
			children: [],
		},
	]);
});

it("preserves captured table header IDs and cell associations", () => {
	const { output } = JSON.parse(
		readFileSync(new URL("./fixtures/pdfinfo-26.09-table.json", import.meta.url), "utf8"),
	);
	const tree = parsePdfStructure(output);
	const nodes = structureNodes(tree);
	expect(tree.children[0].children.map((node) => node.tag)).toEqual(["THead", "TBody"]);
	expect(nodes.filter((node) => node.tag === "TH").map((node) => node.id)).toEqual([
		"U1x0y0",
		"U1x1y0",
		"U1x2y0",
	]);
	expect(nodes.find((node) => node.tag === "TH")?.attributes).toMatchObject({
		Scope: "/Column",
		Headers: "[]",
	});
	expect(
		nodes
			.filter((node) => node.tag === "TD")
			.slice(0, 3)
			.map((node) => node.attributes?.Headers),
	).toEqual(["[(U1x0y0)]", "[(U1x1y0)]", "[(U1x2y0)]"]);
});

it.each([
	"",
	"Document\n   H1",
	"Document\n    H1",
	"Document\n  Figure [broken]",
	"Document\n     /Placement /Block",
	"Document\nDocument",
	"Document\n  Figure:\n     /Placement /Block\n     /Placement /Inline",
	"Document\n  P\n     /Placement /Block",
	"Document\n  Object 1 0\n    Span",
])("rejects malformed structure %j", (output) => {
	expect(() => parsePdfStructure(output)).toThrow(/PDF structure/);
});
