import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { expect, it } from "vitest";
import { createDesktopGrammarDecorationExtension } from "./desktop-grammar-decoration-extension";
import { createGrammarHighlightExtension } from "./grammar-highlight-extension";

it("X2 decorates grammar 4 page headings and dividers without legacy directives", () => {
	const element = document.createElement("div");
	document.body.append(element);
	const lines = ["# Page", "Body.", "---", "## Section", "# Next"];
	const editor = new Editor({
		element,
		extensions: [
			StarterKit,
			createDesktopGrammarDecorationExtension(),
			createGrammarHighlightExtension({
				collapseFrontmatter: "Collapse",
				expandFrontmatter: "Expand",
			}),
		],
		content: {
			type: "doc",
			content: lines.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
		},
	});
	try {
		expect(
			[...element.querySelectorAll(".grammar-page-break")].map((line) => line.textContent),
		).toEqual(["1# Page", "2# Next"]);
		expect(element.querySelector('[data-token-type="page-break"]')).toBeNull();
		expect(element.querySelector('[data-token-type="section-break"]')?.textContent).toBe("---");
		editor.commands.setContent({
			type: "doc",
			content: [
				"## Heading @section.name",
				"background: red",
				"as: note",
				"audience: instructor",
				"close: note",
			].map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
		});

		expect(
			element.querySelector(
				".grammar-instructor, .grammar-key, .praxity-raw-param-name, .praxity-raw-annotation, [data-token-type='v3-as']",
			),
		).toBeNull();
	} finally {
		editor.destroy();
		element.remove();
	}
});
