import { MantineProvider } from "@mantine/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import { useGrammarDocumentStore } from "../grammar-document-store";
import { GrammarRawEditor } from "../grammar-raw-editor";

vi.mock("../../lib/collaboration/collaboration-context", () => ({ useCollaboration: () => null }));

beforeEach(() => {
	vi.useFakeTimers({
		toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
	});
	window.matchMedia = vi
		.fn()
		.mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
	Element.prototype.scrollIntoView = vi.fn();
	useGrammarDocumentStore.setState({
		grammarSource: "Before.\nstyle: likert\nAfter.",
		cursorLocation: null,
	});
});
function cleanupEditor() {
	cleanup();
	// Tiptap defers editor destruction until the next tick; finish it while jsdom still exists.
	act(() => vi.runOnlyPendingTimers());
}
afterEach(() => {
	cleanupEditor();
	vi.useRealTimers();
});
async function mount() {
	await act(async () => {
		render(
			<IntlProvider locale="en" messages={en}>
				<MantineProvider>
					<GrammarRawEditor />
				</MantineProvider>
			</IntlProvider>,
		);
	});
	const element = screen.getByRole("textbox", { name: "Grammar editor" });
	const editor = (element as HTMLElement & { editor: Editor }).editor;
	vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 0, bottom: 20, left: 0, right: 0 });
	return editor;
}

describe("raw editor cursor restoration", () => {
	it.each([
		["Control+End", "# First\n\nFirst.\n\n--- Second\n\nSecond.\n\n--- Third\n\nLast."],
		["Meta+End", "# First\n\nFirst.\n\n--- Second\n\nSecond.\n\n--- Third\n\nLast."],
		["Control+End", "# First\n\nFirst.\n\n# Second\n\nSecond.\n\n# Third\n\nLast."],
		["Meta+End", "# First\n\nFirst.\n\n# Second\n\nSecond.\n\n# Third\n\nLast."],
	])("%s leaves a pending page jump for the document end in %s", async (shortcut, source) => {
		useGrammarDocumentStore.setState({ grammarSource: source });
		const editor = await mount();
		act(() => {
			window.dispatchEvent(
				new CustomEvent("praxity:scroll-to-grammar-line", { detail: { lineNumber: 4 } }),
			);
			const event = new KeyboardEvent("keydown", {
				key: "End",
				ctrlKey: shortcut.startsWith("Control"),
				metaKey: shortcut.startsWith("Meta"),
				bubbles: true,
				cancelable: true,
			});
			editor.view.dom.dispatchEvent(event);
		});
		expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
		act(() => editor.commands.splitBlock());
		act(() => editor.commands.insertContent("Added at the end."));
		expect(editor.getText({ blockSeparator: "\n" })).toBe(`${source}\nAdded at the end.`);
	});

	it("destroys the editor during test cleanup before the DOM environment is torn down", async () => {
		const editor = await mount();
		cleanupEditor();
		expect(editor.isDestroyed).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("announces the destination when an audit finding jumps to a grammar line", async () => {
		const editor = await mount();
		act(() => {
			window.dispatchEvent(
				new CustomEvent("praxity:scroll-to-grammar-line", { detail: { lineNumber: 1 } }),
			);
			vi.advanceTimersByTime(32);
		});
		expect(document.activeElement).toBe(editor.view.dom);
		expect(editor.state.doc.resolve(editor.state.selection.from).parent.textContent).toBe(
			"style: likert",
		);
		const announcement = document.getElementById("praxity-editor-live-region");
		expect(announcement?.getAttribute("role")).toBe("status");
		expect(announcement?.textContent).toBe("Moved to line 2: style: likert");
	});

	it("preserves the first authored range when no saved cursor exists", async () => {
		const editor = await mount();
		const from = editor.state.doc.child(0).nodeSize + 1 + "style: ".length;
		const selection = { from, to: from + "likert".length };
		act(() => editor.commands.setTextSelection(selection));
		act(() => vi.advanceTimersByTime(32));
		expect(editor.state.selection.from).toBe(selection.from);
		expect(editor.state.selection.to).toBe(selection.to);
		expect(
			editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to),
		).toBe("likert");
		expect(useGrammarDocumentStore.getState().cursorLocation).toMatchObject({
			grammarLine: 1,
			grammarColumn: 7,
		});
	});

	it("restores the saved line and column rather than the last paragraph", async () => {
		useGrammarDocumentStore.setState({
			cursorLocation: {
				grammarLine: 1,
				grammarColumn: 4,
				enclosingKeyword: null,
				keywordOccurrenceIndex: 0,
				scrollFraction: 0,
			},
		});
		const editor = await mount();
		act(() => vi.advanceTimersByTime(32));
		expect(editor.state.selection.from).toBe(editor.state.doc.child(0).nodeSize + 1 + 4);
		expect(editor.state.selection.empty).toBe(true);
		act(() => editor.commands.setTextSelection(3));
		expect(useGrammarDocumentStore.getState().cursorLocation).toMatchObject({
			grammarLine: 0,
			grammarColumn: 2,
		});
	});
});

describe("raw editor delimiter diagnostics", () => {
	it("does not underline an accordion closer before columns but still marks an orphan closer", async () => {
		useGrammarDocumentStore.setState({
			grammarSource:
				"# Page\n\n::: accordion\n:: Accordion item\nAccordion body.\n:::\n\n::: columns\n::\nColumn body.\n:::\n\n:::",
		});
		const editor = await mount();
		const closers = [...editor.view.dom.querySelectorAll("p")].filter(
			(line) => line.textContent === ":::",
		);
		expect(closers).toHaveLength(3);
		expect(closers[0].querySelector(".praxity-raw-delimiter-unmatched")).toBeNull();
		expect(closers[1].querySelector(".praxity-raw-delimiter-unmatched")).toBeNull();
		expect(closers[2].querySelector(".praxity-raw-delimiter-unmatched")).not.toBeNull();
		expect(
			[...editor.view.dom.querySelectorAll("p")].filter((line) =>
				line.querySelector(".praxity-raw-delimiter-unmatched"),
			),
		).toHaveLength(1);
	});
});
