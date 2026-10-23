import DOMPurify, { clearConfig, clearWindow, setConfig } from "isomorphic-dompurify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { htmlToPlainText, sanitizeHtml, splitHeadingContent } from "../src/sanitize";

afterEach(() => {
	vi.restoreAllMocks();
	DOMPurify.removeAllHooks();
	DOMPurify.clearConfig();
});

function purifierInstance() {
	let instance: typeof DOMPurify | undefined;
	DOMPurify.addHook("beforeSanitizeElements", function () {
		instance = this;
	});
	DOMPurify.sanitize("<p>Find instance</p>");
	DOMPurify.removeAllHooks();
	if (!instance) throw new Error("Expected DOMPurify hook receiver");
	return instance;
}

describe("sanitizer traversal", () => {
	it("does not register window listeners after 1,000 unique calls", () => {
		// ALLOWED_ATTR shadowroot returns nodes in the original document, exposing
		// the shared window through the public DOM API rather than jsdom internals.
		const root = DOMPurify.sanitize("<p>Warm window</p>", {
			RETURN_DOM: true,
			ALLOWED_ATTR: ["shadowroot"],
		});
		const sharedWindow = root.ownerDocument.defaultView;
		if (!sharedWindow) throw new Error("Expected sanitizer window");
		htmlToPlainText("<p>Warm text</p>");
		splitHeadingContent("<p>Warm heading</p><div>Body</div>");
		const add = vi.spyOn(sharedWindow, "addEventListener");
		const remove = vi.spyOn(sharedWindow, "removeEventListener");
		for (let i = 0; i < 1_000; i++) {
			expect(htmlToPlainText(`<p>Text <em>${i}</em></p>`)).toBe(`Text ${i}`);
			expect(splitHeadingContent(`<p>Heading ${i}</p><div>Body</div>`)).toEqual({
				heading: `Heading ${i}`,
				body: "<div>Body</div>",
			});
		}
		expect(add.mock.calls.length - remove.mock.calls.length).toBe(0);
	});

	it("walks SVG, MathML and mixed-case HTML without changing boundaries", () => {
		expect(
			htmlToPlainText(
				"<P>A<EM>B</EM></P><svg><text>C</text></svg><math><mi>x</mi><mn>2</mn></math>",
			),
		).toBe("A B C x 2");
		expect(
			splitHeadingContent(
				"<P>A<EM>B</EM><svg><text>C</text></svg><math><mi>x</mi></math></P><DIV>Body</DIV>",
			),
		).toEqual({
			heading: "A<em>B</em><svg><text>C</text></svg><math><mi>x</mi></math>",
			body: "<div>Body</div>",
		});
		expect(
			splitHeadingContent(
				"<span>Intro<svg><foreignObject><DIV>Block</DIV></foreignObject></svg></span>tail",
			),
		).toEqual({
			heading: "<span>Intro<svg></svg></span>tail",
			body: "",
		});
		expect(splitHeadingContent("<span>Intro<DIV>Nested block</DIV></span>tail")).toEqual({
			heading: "",
			body: "<span>Intro<div>Nested block</div></span>tail",
		});
	});
});

describe("sanitizer memo", () => {
	for (const [name, run] of Object.entries({
		sanitizeHtml,
		htmlToPlainText,
		splitHeadingContent,
	})) {
		it(`${name} caches hits, misses and evicts the least recently used input`, () => {
			const sanitize = vi.spyOn(purifierInstance(), "sanitize");
			const first = "<p>Memo first</p>";
			const oldest = "<p>Memo oldest</p>";
			const expected =
				name === "splitHeadingContent"
					? { heading: "Memo first", body: "" }
					: name === "sanitizeHtml"
						? first
						: "Memo first";
			expect(run(first)).toEqual(expected);
			const firstCalls = sanitize.mock.calls.length;
			run(oldest);
			const calls = sanitize.mock.calls.length;
			expect(calls).toBeGreaterThan(firstCalls);
			expect(run(first)).toEqual(expected);
			expect(sanitize).toHaveBeenCalledTimes(calls);
			// The shared memo retains at most 256 results across all helpers.
			for (let i = 0; i < 254; i++) run(`<p>Memo filler ${i}</p>`);
			run(first);
			run("<p>Memo overflow</p>");
			const filledCalls = sanitize.mock.calls.length;
			run(first);
			expect(sanitize).toHaveBeenCalledTimes(filledCalls);
			run(oldest);
			expect(sanitize.mock.calls.length).toBeGreaterThan(filledCalls);
		});
	}

	it("keys sanitizeHtml on both rendering options", () => {
		const input = '<a href="https://example.com">Link</a>';
		expect(sanitizeHtml(input)).toBe(input);
		expect(sanitizeHtml(input, { interactive: false })).toBe("Link");
		const sanitize = vi.spyOn(purifierInstance(), "sanitize");
		sanitizeHtml(input, { renderInlineIcons: false });
		const calls = sanitize.mock.calls.length;
		sanitizeHtml(input, { renderInlineIcons: true });
		expect(sanitize.mock.calls.length).toBeGreaterThan(calls);
	});

	it("never memoizes caller options, including frozen options", () => {
		const sanitize = vi.spyOn(purifierInstance(), "sanitize");
		const input = '<a href="https://example.com">Caller options</a>';
		for (const options of [{ interactive: true }, Object.freeze({ interactive: true })]) {
			expect(sanitizeHtml(input, options)).toBe(input);
			const calls = sanitize.mock.calls.length;
			expect(sanitizeHtml(input, options)).toBe(input);
			expect(sanitize.mock.calls.length).toBeGreaterThan(calls);
		}
	});

	for (const [name, run] of Object.entries({
		sanitizeHtml,
		htmlToPlainText,
		splitHeadingContent,
	})) {
		it(`${name} never memoizes a caller policy, including a frozen policy`, () => {
			const sanitize = vi.spyOn(purifierInstance(), "sanitize");
			setConfig(Object.freeze({ RETURN_DOM: name !== "sanitizeHtml" }));
			const input = "<p>Caller policy</p>";
			const expected =
				name === "splitHeadingContent"
					? { heading: "Caller policy", body: "" }
					: name === "sanitizeHtml"
						? input
						: "Caller policy";
			expect(run(input)).toEqual(expected);
			const calls = sanitize.mock.calls.length;
			expect(run(input)).toEqual(expected);
			expect(sanitize.mock.calls.length).toBeGreaterThan(calls);
		});
	}

	it("invalidates for named and default config changes", () => {
		const input = "<strong>Configured</strong>";
		expect(sanitizeHtml(input)).toBe(input);
		setConfig({ ALLOWED_TAGS: [] });
		expect(sanitizeHtml(input)).toBe("Configured");
		clearConfig();
		expect(sanitizeHtml(input)).toBe(input);
		DOMPurify.setConfig({ ALLOWED_TAGS: [] });
		expect(sanitizeHtml(input)).toBe("Configured");
		DOMPurify.clearConfig();
		expect(sanitizeHtml(input)).toBe(input);
	});

	it("bypasses a policy installed through a previously captured setter", () => {
		clearWindow();
		const captured = DOMPurify.setConfig;
		const input = '<a href="https://course-a.example/private">Link</a>';
		expect(sanitizeHtml(input)).toBe(input);
		captured({ FORBID_ATTR: ["href"] });
		expect(sanitizeHtml(input)).toBe("<a>Link</a>");
	});

	it("runs a hook installed through a previously captured method on every call", () => {
		clearWindow();
		const captured = DOMPurify.addHook;
		const input = "<p>Original course</p>";
		expect(sanitizeHtml(input)).toBe(input);
		let text = "Other course";
		captured("afterSanitizeAttributes", (node) => {
			if (node.localName === "p") node.textContent = text;
		});
		expect(sanitizeHtml(input)).toBe("<p>Other course</p>");
		text = "Changed course";
		expect(sanitizeHtml(input)).toBe("<p>Changed course</p>");
	});

	it("bypasses a caller policy whose URI RegExp changes in place", () => {
		const pattern = /^https:/;
		setConfig({ ALLOWED_URI_REGEXP: pattern });
		const input = '<a href="https://course.example/private">Link</a>';
		expect(sanitizeHtml(input)).toBe(input);
		pattern.compile(/^mailto:/);
		expect(sanitizeHtml(input)).toBe("<a>Link</a>");
	});

	it("bypasses Trusted Types callbacks retained after external sanitization", () => {
		try {
			let text = "Original course";
			DOMPurify.sanitize("<p>Initialize policy</p>", {
				TRUSTED_TYPES_POLICY: {
					createHTML: (html) => html.replace("Original course", text),
					createScriptURL: (url) => url,
				},
			});
			const input = "<p>Original course</p>";
			expect(sanitizeHtml(input)).toBe(input);
			text = "Other course";
			expect(sanitizeHtml(input)).toBe("<p>Other course</p>");
		} finally {
			clearWindow();
		}
	});

	it("runs stateful hooks on every call and invalidates hook removal", () => {
		const input = '<a href="https://example.com">Hook</a>';
		expect(sanitizeHtml(input)).toBe(input);
		let keep = false;
		DOMPurify.addHook("uponSanitizeAttribute", (_node, event) => {
			if (event.attrName === "href") event.keepAttr = keep;
		});
		expect(sanitizeHtml(input)).toBe("<a>Hook</a>");
		keep = true;
		expect(sanitizeHtml(input)).toBe(input);
		DOMPurify.removeHook("uponSanitizeAttribute");
		expect(sanitizeHtml(input)).toBe(input);
	});

	it("preserves hooks registered before a fresh instance is observed", () => {
		clearWindow();
		let text = "First";
		DOMPurify.addHook("afterSanitizeAttributes", (node) => {
			if (node.localName === "em") node.textContent = text;
		});
		const input = "<p><em>Original</em></p>";
		expect(htmlToPlainText(input)).toBe("First");
		text = "Second";
		expect(htmlToPlainText(input)).toBe("Second");
		DOMPurify.removeHooks("afterSanitizeAttributes");
		expect(htmlToPlainText(input)).toBe("Original");
	});

	it("preserves a pre-existing hook that removes itself by popping the hook stack", () => {
		clearWindow();
		let calls = 0;
		DOMPurify.addHook("beforeSanitizeElements", function (node) {
			calls++;
			if (node.nodeType === 1) (node as Element).setAttribute("data-hook", String(calls));
			this.removeHook("beforeSanitizeElements");
		});
		expect(sanitizeHtml("<p>Self-removing hook</p>")).toBe("<p>Self-removing hook</p>");
		expect(calls).toBe(1);
	});

	it("does not memoize a result produced while a hook removes itself", () => {
		sanitizeHtml("<p>Observe instance before registering hook</p>");
		DOMPurify.addHook("afterSanitizeAttributes", function (node) {
			if (node.localName !== "p") return;
			node.textContent = "Hook pass";
			this.removeHook("afterSanitizeAttributes");
		});
		const input = "<p>Original</p>";
		expect(sanitizeHtml(input)).toBe("<p>Hook pass</p>");
		expect(sanitizeHtml(input)).toBe(input);
	});

	it("does not memoize stateful configuration callbacks", () => {
		let allow = false;
		DOMPurify.setConfig({ ADD_TAGS: (name) => name === "memo-tag" && allow });
		const input = "<memo-tag>Tag</memo-tag>";
		expect(sanitizeHtml(input)).toBe("Tag");
		allow = true;
		expect(sanitizeHtml(input)).toBe(input);
	});

	it("invalidates both DOM helpers for configuration changes", () => {
		const input = "<p>A<em>B</em>C</p>";
		expect(htmlToPlainText(input)).toBe("A B C");
		expect(splitHeadingContent(input)).toEqual({ heading: "A<em>B</em>C", body: "" });
		DOMPurify.setConfig({ RETURN_DOM: true, ALLOWED_TAGS: ["p"] });
		expect(htmlToPlainText(input)).toBe("ABC");
		expect(splitHeadingContent(input)).toEqual({ heading: "ABC", body: "" });
		DOMPurify.clearConfig();
		expect(htmlToPlainText(input)).toBe("A B C");
		expect(splitHeadingContent(input)).toEqual({ heading: "A<em>B</em>C", body: "" });
	});

	it("evicts by the string byte budget before reaching the entry limit", () => {
		const sanitize = vi.spyOn(purifierInstance(), "sanitize");
		const first = `<p>${"a".repeat(600_000)}</p>`;
		const second = `<p>${"b".repeat(600_000)}</p>`;
		sanitizeHtml(first);
		sanitizeHtml("<p>Small retained entry</p>");
		sanitizeHtml(second);
		const calls = sanitize.mock.calls.length;
		sanitizeHtml("<p>Small retained entry</p>");
		expect(sanitize).toHaveBeenCalledTimes(calls);
		sanitizeHtml(first);
		expect(sanitize.mock.calls.length).toBeGreaterThan(calls);
	});

	it("returns fresh heading objects on hits", () => {
		const input = "<p>Memo heading</p><div>Memo body</div>";
		const result = splitHeadingContent(input);
		result.heading = "Changed by caller";
		expect(splitHeadingContent(input)).toEqual({
			heading: "Memo heading",
			body: "<div>Memo body</div>",
		});
	});

	it("invalidates when the dependency replaces its window", () => {
		const input = "<strong>Window</strong>";
		setConfig({ ALLOWED_TAGS: [] });
		expect(sanitizeHtml(input)).toBe("Window");
		clearWindow();
		expect(sanitizeHtml(input)).toBe(input);
	});
});
