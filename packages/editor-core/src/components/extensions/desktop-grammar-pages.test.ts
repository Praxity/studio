import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { expect, it } from "vitest";
import { createDesktopGrammarDecorationExtension } from "./desktop-grammar-decoration-extension";

it("numbers grammar 4 pages at their headings and ignores fenced page examples", () => {
	const element = document.createElement("div");
	document.body.append(element);
	const lines = [
		"---",
		"title: Pages",
		"---",
		"# First",
		"Body.",
		"```",
		"# Example",
		"```",
		"# Second",
		"Done.",
	];
	const editor = new Editor({
		element,
		extensions: [StarterKit, createDesktopGrammarDecorationExtension()],
		content: {
			type: "doc",
			content: lines.map((text) => ({
				type: "paragraph",
				...(text ? { content: [{ type: "text", text }] } : {}),
			})),
		},
	});
	try {
		const boundaries = [...element.querySelectorAll(".grammar-page-break")];
		expect(boundaries.map((line) => line.textContent)).toEqual(["1# First", "2# Second"]);
		expect(
			[...element.querySelectorAll(".grammar-page-num")].map((badge) => badge.textContent),
		).toEqual(["1", "2"]);
	} finally {
		editor.destroy();
		element.remove();
	}
});
