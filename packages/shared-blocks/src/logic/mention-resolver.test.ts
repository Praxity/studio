import { beforeEach, describe, expect, it, vi } from "vitest";
import { MentionResolver } from "./mention-resolver";
import { VariableStore } from "./variable-store";

// Mock HTMLElement
class MockHTMLElement {
	style: Record<string, string> = {};
	attributes: Record<string, string> = {};
	textContent: string | null = null;

	setAttribute(name: string, value: string) {
		this.attributes[name] = value;
	}
	getAttribute(name: string) {
		return this.attributes[name] ?? null;
	}
}
vi.stubGlobal("HTMLElement", MockHTMLElement);

const mockElements = new Map<string, MockHTMLElement>();
const mentionElements: MockHTMLElement[] = [];

vi.stubGlobal("document", {
	querySelector: (selector: string) => {
		const match = selector.match(/\[data-block-id="([^"]+)"\]/);
		if (match) return mockElements.get(match[1]) ?? null;
		return null;
	},
	querySelectorAll: (selector: string) => {
		if (selector === "[data-mention]") return mentionElements;
		const match = selector.match(/\[data-block-id="([^"]+)"\]/);
		const element = match ? mockElements.get(match[1]) : undefined;
		if (element) return [element];
		return [];
	},
});

function createMockRuntime() {
	return {
		getSuspendData: () => null,
		setSuspendData: vi.fn(),
		commit: vi.fn(),
	};
}

describe("MentionResolver", () => {
	beforeEach(() => {
		mockElements.clear();
		mentionElements.length = 0;
	});

	it("resolves variable mentions to current value", () => {
		const runtime = createMockRuntime();
		const store = new VariableStore(
			[{ name: "score", dataType: "number", defaultValue: 85 }],
			runtime,
		);

		const mention = new MockHTMLElement();
		mention.attributes["data-mention"] = "variable:score";
		mention.attributes["data-fallback"] = "0";
		mention.textContent = "Score";
		mentionElements.push(mention);

		const resolver = new MentionResolver(store, []);
		resolver.resolve();

		expect(mention.textContent).toBe("85");
	});

	it("resolves blockOutput mentions to computed field value", () => {
		const runtime = createMockRuntime();
		const store = new VariableStore([], runtime);

		// Mock the rating block element in the DOM
		const ratingEl = new MockHTMLElement();
		ratingEl.attributes["data-rating-value"] = "4";
		// Add querySelectorAll for computed-fields compatibility
		(ratingEl as unknown as Record<string, unknown>).querySelectorAll = () => [];
		mockElements.set("rating-1", ratingEl);

		const mention = new MockHTMLElement();
		mention.attributes["data-mention"] = "blockOutput:rating-1:ratingScore";
		mention.attributes["data-fallback"] = "";
		mention.textContent = "Rating";
		mentionElements.push(mention);

		const resolver = new MentionResolver(store, [{ id: "rating-1", type: "rating" }]);
		resolver.resolve();

		expect(mention.textContent).toBe("4");
	});

	it("renders fallback when variable not found", () => {
		const runtime = createMockRuntime();
		const store = new VariableStore([], runtime);

		const mention = new MockHTMLElement();
		mention.attributes["data-mention"] = "variable:missing";
		mention.attributes["data-fallback"] = "N/A";
		mention.textContent = "Missing";
		mentionElements.push(mention);

		const resolver = new MentionResolver(store, []);
		resolver.resolve();

		expect(mention.textContent).toBe("N/A");
	});

	it("returns undefined for learnerInfo (stub)", () => {
		const runtime = createMockRuntime();
		const store = new VariableStore([], runtime);

		const mention = new MockHTMLElement();
		mention.attributes["data-mention"] = "learnerInfo:course:grade";
		mention.attributes["data-fallback"] = "\u2014";
		mention.textContent = "Grade";
		mentionElements.push(mention);

		const resolver = new MentionResolver(store, []);
		resolver.resolve();

		expect(mention.textContent).toBe("\u2014");
	});
});
