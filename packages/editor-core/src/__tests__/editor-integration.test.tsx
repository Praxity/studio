/* @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useGrammarDocumentStore } from "../components/grammar-document-store";
import { PraxityEditor } from "../PraxityEditor";

const SAMPLE_GRAMMAR = `---
title: Test Course
lang: en
design:
  palette: standard
  colorMode: light
---

# Introduction {hideTitle}

Hello, world!
`;

beforeAll(() => {
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: vi.fn().mockImplementation((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})),
	});

	class ResizeObserverMock {
		observe() {}
		unobserve() {}
		disconnect() {}
	}

	Object.defineProperty(window, "ResizeObserver", {
		writable: true,
		value: ResizeObserverMock,
	});
	Object.defineProperty(globalThis, "ResizeObserver", {
		writable: true,
		value: ResizeObserverMock,
	});
});

afterEach(() => {
	cleanup();
});

describe("PraxityEditor integration", () => {
	it("shows malformed frontmatter to the author", async () => {
		const source = "---\ntitle: Saved\nbad: [oops\n---\n\n# Body";
		render(<PraxityEditor initialGrammar={source} locale="fr" />);
		expect(await screen.findByRole("alert")).toHaveProperty(
			"textContent",
			"Métadonnées YAML invalides. Corrigez-les avant de modifier les paramètres de présentation.",
		);
		expect(useGrammarDocumentStore.getState().parseError).toBe("invalid-frontmatter");
	});

	it("mounts with French locale", () => {
		render(<PraxityEditor initialGrammar={SAMPLE_GRAMMAR} locale="fr" />);
		expect(screen.getByTestId("praxity-editor-root")).toBeTruthy();
	});

	it("preserves syntax-significant indentation", async () => {
		render(<PraxityEditor initialGrammar={SAMPLE_GRAMMAR} />);

		const editor = await screen.findByRole("textbox", { name: "Grammar editor" });
		expect([...editor.querySelectorAll("p")].map((line) => line.textContent)).toContain(
			"  palette: standard",
		);
	});

	it("reports edited blocks in authored order", async () => {
		const grammar = "# Test {hideTitle}\n\nFirst paragraph\n\nSecond paragraph";
		const onBlocksChange = vi.fn();
		render(<PraxityEditor initialGrammar={grammar} onBlocksChange={onBlocksChange} />);
		const element = await screen.findByRole("textbox", { name: "Grammar editor" });
		const editor = (element as HTMLElement & { editor: Editor }).editor;
		let firstParagraph = -1;
		editor.state.doc.descendants((node, position) => {
			if (node.type.name === "paragraph" && node.textContent === "First paragraph")
				firstParagraph = position;
		});
		expect(firstParagraph).toBeGreaterThanOrEqual(0);
		editor.commands.insertContentAt(
			{ from: firstParagraph + 1, to: firstParagraph + 16 },
			"Updated paragraph",
		);

		await waitFor(() => {
			expect(
				onBlocksChange.mock.lastCall?.[0].filter(
					(block: { type: string }) => block.type !== "pageBreak",
				),
			).toMatchObject([
				{ type: "text", data: { content: "<p>Updated paragraph</p>" } },
				{ type: "text", data: { content: "<p>Second paragraph</p>" } },
			]);
		});
	});
});
