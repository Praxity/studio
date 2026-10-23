import { readBlockFixture as readBlockSource } from "../../../grammar/__tests__/helpers/lesson-fixture.ts";
/* @vitest-environment jsdom */

import { GRAMMAR_YTEXT_FIELD } from "@praxity/shared-blocks/constants";
import { cleanup, render } from "@testing-library/react";
import type { Ref } from "react";
import { act, forwardRef, useContext, useEffect } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useGrammarDocumentStore } from "../components/grammar-document-store";
import { CollaborationContext } from "../lib/collaboration/collaboration-context";
import { PraxityEditor } from "../PraxityEditor";

const mockParseAuto = vi.fn().mockReturnValue({ blocks: [], frontmatter: {} });

vi.mock("@praxity/grammar", async () => {
	const actual = await vi.importActual<typeof import("@praxity/grammar")>("@praxity/grammar");
	return {
		...actual,
		readLesson: (...args: unknown[]) => mockParseAuto(...args),
	};
});

vi.mock("../components/grammar-raw-editor", () => {
	const MockRawEditor = forwardRef(function MockRawEditor(
		_props: Record<string, unknown>,
		_ref: Ref<{ getScrollFraction: () => number; setScrollFraction: (fraction: number) => void }>,
	) {
		const collaboration = useContext(CollaborationContext);
		useEffect(() => {
			(globalThis as { __TEST_YDOC__?: unknown }).__TEST_YDOC__ = collaboration?.ydoc ?? null;
			return () => {
				delete (globalThis as { __TEST_YDOC__?: unknown }).__TEST_YDOC__;
			};
		}, [collaboration?.ydoc]);

		return null;
	});

	return {
		GrammarRawEditor: MockRawEditor,
	};
});

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

beforeEach(() => {
	vi.useFakeTimers();
	mockParseAuto.mockClear();
	mockParseAuto.mockImplementation((source: string) => readBlockSource(source));
	useGrammarDocumentStore.setState({ _designDirty: false });
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("PraxityEditor parse debouncing", () => {
	it("recovers a non-numeric YAML alias without serializing its cycle into the render signature", async () => {
		const source = "---\ntitle: Jo\ndesign:\n  headingSize: &a [*a]\n---\n\n# Jo\n";
		const onGrammarChange = vi.fn();
		render(<PraxityEditor initialGrammar={source} onGrammarChange={onGrammarChange} />);
		expect(onGrammarChange).toHaveBeenCalledWith(source);
		expect(useGrammarDocumentStore.getState().designVariants.headingSize).toBe(2.375);
		await act(async () => {
			useGrammarDocumentStore.getState().updateDesignVariants({ colorMode: "dark" });
		});
		const design = readBlockSource(onGrammarChange.mock.lastCall?.[0]).frontmatter
			.design as unknown as { headingSize: unknown[] };
		expect(design.headingSize[0]).toBe(design.headingSize);
	});
	it("preserves invalid saved numbers through unrelated edits until that field changes", async () => {
		const source =
			"---\ntitle: Jo\ndesign:\n  headingSize: large\n  lineHeight: null\n  accentHue: 1000000\n---\n\n# Jo\n";
		const onGrammarChange = vi.fn();
		render(<PraxityEditor initialGrammar={source} onGrammarChange={onGrammarChange} />);
		expect(onGrammarChange).toHaveBeenCalledWith(source);
		expect(useGrammarDocumentStore.getState().designVariants.headingSize).toBe(2.375);
		await act(async () => {
			useGrammarDocumentStore.getState().updateDesignVariants({ colorMode: "dark" });
		});
		expect(readBlockSource(onGrammarChange.mock.lastCall?.[0]).frontmatter.design).toMatchObject({
			headingSize: "large",
			lineHeight: null,
			accentHue: 1000000,
			colorMode: "dark",
		});
		await act(async () => {
			useGrammarDocumentStore.getState().updateDesignVariants({ headingSize: 2.375 });
		});
		expect(readBlockSource(onGrammarChange.mock.lastCall?.[0]).frontmatter.design).toMatchObject({
			headingSize: 2.375,
			lineHeight: null,
			accentHue: 1000000,
		});
	});
	it("coalesces rapid grammar insert events into a single parse call", () => {
		render(<PraxityEditor initialGrammar="" />);

		const initialCalls = mockParseAuto.mock.calls.length;
		expect(initialCalls).toBe(1);

		const ydoc = (globalThis as { __TEST_YDOC__?: import("yjs").Doc }).__TEST_YDOC__;
		expect(ydoc).toBeDefined();
		const ytext = ydoc?.getText(GRAMMAR_YTEXT_FIELD);
		expect(ytext).toBeDefined();

		act(() => {
			for (let i = 0; i < 10; i += 1) {
				ytext?.insert(ytext.length, `a${i}`);
			}
		});

		const beforeDebounce = mockParseAuto.mock.calls.length;
		expect(beforeDebounce).toBe(initialCalls);

		act(() => {
			vi.advanceTimersByTime(200);
		});

		const afterDebounce = mockParseAuto.mock.calls.length;
		expect(afterDebounce).toBe(initialCalls + 1);
	});

	it("parses immediately on initial load", () => {
		const source = "# Test {hideTitle}\n\nHello\n";
		render(<PraxityEditor initialGrammar={source} />);

		expect(mockParseAuto).toHaveBeenCalledTimes(1);
		expect(mockParseAuto).toHaveBeenCalledWith(source);
	});

	it("applies source edits made by an external authoring panel", () => {
		const { rerender } = render(<PraxityEditor initialGrammar="Before" externalGrammar="Before" />);
		const ydoc = (globalThis as { __TEST_YDOC__?: import("yjs").Doc }).__TEST_YDOC__;

		act(() => {
			rerender(<PraxityEditor initialGrammar="Before" externalGrammar="After" />);
		});

		expect(ydoc?.getText(GRAMMAR_YTEXT_FIELD).toString()).toBe("After");
	});

	it("persists design changes before the next editor keystroke", async () => {
		const source =
			"---\ntitle: Test\ndesign:\n  colorMode: light\n  navArchetype: sidebar\n---\n\n# Before\n";
		const onGrammarChange = vi.fn();
		render(
			<PraxityEditor
				initialGrammar={source}
				externalGrammar={source}
				onGrammarChange={onGrammarChange}
			/>,
		);

		await act(async () => {
			useGrammarDocumentStore.getState().updateDesignVariants({
				colorMode: "auto",
				navArchetype: "slides",
			});
		});

		const ydoc = (globalThis as { __TEST_YDOC__?: import("yjs").Doc }).__TEST_YDOC__;
		const ytext = ydoc?.getText(GRAMMAR_YTEXT_FIELD);
		const savedSource = onGrammarChange.mock.lastCall?.[0] as string;
		expect(savedSource).toContain("colorMode: auto");
		expect(savedSource).toContain("navArchetype: slides");

		act(() => {
			ytext?.insert(ytext.length, " typed");
			vi.advanceTimersByTime(200);
		});

		expect(useGrammarDocumentStore.getState().designVariants).toMatchObject({
			colorMode: "auto",
			navArchetype: "slides",
		});
	});

	it("preserves malformed frontmatter after a design change", async () => {
		const source = "---\ntitle: Saved\nlang: en\nbad: [oops\n---\n\n# Body";
		render(<PraxityEditor initialGrammar={source} />);
		const ydoc = (globalThis as { __TEST_YDOC__?: import("yjs").Doc }).__TEST_YDOC__;
		const ytext = ydoc?.getText(GRAMMAR_YTEXT_FIELD);

		await act(async () => {
			useGrammarDocumentStore.getState().updateDesignVariants({ colorMode: "dark" });
		});

		expect(ytext?.toString()).toBe(source);
		expect(useGrammarDocumentStore.getState()._designDirty).toBe(true);
	});
});
