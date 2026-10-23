import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import {
	createGrammarHighlightExtension,
	resolveKeywordCategory,
} from "./grammar-highlight-extension";

describe("resolveKeywordCategory", () => {
	it("resolves content-layer keywords to content", () => {
		expect(resolveKeywordCategory("text")).toBe("content");
		expect(resolveKeywordCategory("image")).toBe("content");
		expect(resolveKeywordCategory("note")).toBe("content");
	});

	it("resolves container-layer keywords to flow", () => {
		// `disclosure` was renamed to `accordion`; it is no longer a manifest keyword.
		expect(resolveKeywordCategory("disclosure")).toBeNull();
		expect(resolveKeywordCategory("columns")).toBe("flow");
		expect(resolveKeywordCategory("card")).toBe("flow");
		expect(resolveKeywordCategory("accordion")).toBe("flow");
	});

	it("resolves assessment keywords to assessment", () => {
		expect(resolveKeywordCategory("choose-one")).toBe("assessment");
		expect(resolveKeywordCategory("assessment-group")).toBe("assessment");
	});

	it("resolves interactive keywords to interactive", () => {
		expect(resolveKeywordCategory("checklist")).toBe("interactive");
	});

	it("returns null for keywords removed in the slide-SCORM refocus", () => {
		// aiChat/discussion/contribution/payment were deleted with the social and
		// payment blocks; highlighting them would suggest they still parse.
		for (const keyword of ["ai-chat", "discussion", "contribution", "payment"]) {
			expect(resolveKeywordCategory(keyword)).toBeNull();
		}
	});

	it("returns null for unknown keywords", () => {
		expect(resolveKeywordCategory("banana")).toBeNull();
		expect(resolveKeywordCategory("")).toBeNull();
	});
});

describe("frontmatter Select All", () => {
	let editor: Editor;
	const source = "---\ntitle: Example\n---\n\n# Lesson\nBody";
	function open(text = source) {
		editor = new Editor({
			element: document.createElement("div"),
			extensions: [
				StarterKit,
				createGrammarHighlightExtension({
					collapseFrontmatter: "Collapse frontmatter",
					expandFrontmatter: "Expand frontmatter",
				}),
			],
			content: {
				type: "doc",
				content: text.split("\n").map((line) => ({
					type: "paragraph",
					content: line ? [{ type: "text", text: line }] : [],
				})),
			},
		});
		return editor;
	}
	function selectAll() {
		const event = new KeyboardEvent("keydown", {
			key: "a",
			ctrlKey: true,
			bubbles: true,
			cancelable: true,
		});
		editor.view.dom.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
	}
	function selectedText() {
		const { from, to } = editor.state.selection;
		return editor.state.doc.textBetween(from, to, "\n");
	}
	afterEach(() => editor?.destroy());

	it.each([false, true])(
		"selects only body with expanded=%s, including repeated Select All",
		(expanded) => {
			open();
			if (expanded)
				editor.view.dom.querySelector<HTMLButtonElement>("[data-frontmatter-fold]")?.click();
			editor.commands.setTextSelection(editor.state.doc.content.size - 1);
			for (let repeat = 0; repeat < 2; repeat++) {
				selectAll();
				expect(selectedText()).toBe("\n# Lesson\nBody");
			}
			editor.commands.insertContent("Replacement");
			expect(editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n")).toBe(
				"---\ntitle: Example\n---\nReplacement",
			);
		},
	);

	it.each([1, 7, 25])(
		"selects frontmatter from its content or fence at %s and reveals it",
		(position) => {
			open();
			editor.commands.setTextSelection(position);
			selectAll();
			expect(selectedText()).toBe("---\ntitle: Example\n---");
			expect(
				editor.view.dom.querySelector("[data-frontmatter-fold]")?.getAttribute("aria-expanded"),
			).toBe("true");
		},
	);

	it("uses the selection anchor for selections crossing the frontmatter boundary", () => {
		open();
		const bodyEnd = editor.state.doc.content.size - 1;
		for (const [anchor, head, expected] of [
			[bodyEnd, 7, "\n# Lesson\nBody"],
			[7, bodyEnd, "---\ntitle: Example\n---"],
		] as const) {
			editor.view.dispatch(
				editor.state.tr.setSelection(TextSelection.create(editor.state.doc, anchor, head)),
			);
			selectAll();
			expect(selectedText()).toBe(expected);
		}
	});

	it.each(["", "# Lesson\nBody", "---\ntitle: Incomplete", "---\n---"])(
		"handles documents without a separate body: %j",
		(text) => {
			open(text);
			selectAll();
			expect(selectedText()).toBe(text);
		},
	);
});
