/** @vitest-environment jsdom */
import type { HighlightContent } from "@praxity/shared-blocks/types";
import { afterEach, expect, it, vi } from "vitest";
import { enhanceHighlight } from "../patterns/highlight/enhance";
import { renderHighlight } from "../patterns/highlight/render";

const content: HighlightContent = {
	mode: "key",
	title: "Pause",
	maxMarks: 1,
	paragraphs: [
		[
			{ id: "a", text: "Literal &amp; &lt; \" '", key: true, note: "Target note" },
			{ id: "b", text: "Other", note: "Other note" },
		],
		[{ id: "c", text: "Unmarked" }],
	],
};
const mounted: ReturnType<typeof enhanceHighlight>[] = [];
function fixture(data = content, prefix = "hl", lang = "en") {
	document.body.insertAdjacentHTML(
		"beforeend",
		renderHighlight(data, { prefix, lang, headingLevel: 2 }),
	);
	return document.querySelector<HTMLElement>(`[aria-labelledby="${prefix}-title"]`)!.parentElement!;
}
function attach(root: HTMLElement) {
	const instance = enhanceHighlight(root);
	mounted.push(instance);
	return instance;
}
function node<T extends HTMLElement = HTMLElement>(root: HTMLElement, name: string) {
	return root.querySelector<T>(`[data-highlight-${name}]`)!;
}
afterEach(() => {
	vi.restoreAllMocks();
	mounted.splice(0).forEach((instance) => instance.destroy());
	document.body.replaceChildren();
});

it("attaches once, preserves literal text and mounted memory, and isolates two roots", () => {
	const first = fixture(),
		second = fixture(content, "other");
	const instance = attach(first);
	attach(second);
	node(first, "chunk").click();
	expect(enhanceHighlight(first)).toBe(instance);
	expect(first.querySelectorAll("[data-highlight-memory-notice]")).toHaveLength(1);
	expect(node(first, "chunk").textContent).toBe(content.paragraphs[0][0].text);
	expect(node(first, "chunk").getAttribute("aria-pressed")).toBe("true");
	expect(node(second, "chunk").getAttribute("aria-pressed")).toBe("false");
	expect(node(first, "chunk").hasAttribute("aria-describedby")).toBe(false);
	expect(node(first, "passage").getAttribute("aria-describedby")).toBe("hl-instructions");
});

it("locks a zero-mark Check, focuses Start over once, opens all notes, and resets silently", () => {
	const root = fixture();
	attach(root);
	node(root, "chunk").focus();
	node(root, "check").click();
	expect(document.activeElement).toBe(node(root, "restart"));
	expect(node(root, "restart").getAttribute("aria-describedby")).toBe("hl-summary");
	expect(node(root, "summary").textContent).toBe("You found 0 of 1 key ideas.");
	expect(node(root, "status").textContent).toBe("");
	expect(node<HTMLDetailsElement>(root, "fallback").open).toBe(true);
	expect(node(root, "fallback").textContent).toContain("Target note");
	expect(node(root, "fallback").textContent).toContain("Other note");
	node(root, "chunk").click();
	expect(node(root, "chunk").getAttribute("aria-pressed")).toBe("false");
	node(root, "chunk").focus();
	node(root, "check").click();
	expect(document.activeElement).toBe(node(root, "chunk"));
	node(root, "restart").click();
	expect(document.activeElement).toBe(node(root, "chunk"));
	expect(node(root, "restart").hasAttribute("aria-describedby")).toBe(false);
	expect(node<HTMLDetailsElement>(root, "fallback").open).toBe(false);
	expect(node(root, "fallback").hidden).toBe(true);
	expect(node(root, "status").textContent).toBe("");
});

it.each(["key", "evidence"] as const)(
	"uses upstream outcomes and the specified note labels in %s",
	(mode) => {
		const root = fixture({ ...content, mode, question: "Why?" });
		attach(root);
		root.querySelectorAll<HTMLElement>("[data-highlight-chunk]")[1].click();
		node(root, "check").click();
		expect(
			[...root.querySelectorAll("[data-highlight-feedback]")].map((n) => n.textContent),
		).toEqual(["Missed", mode === "key" ? "Not a key idea: Other note" : "Other note", ""]);
		expect(root.querySelectorAll('[aria-disabled="true"]')).toHaveLength(3);
	},
);

it("announces a limit once until unmarking, ignores held activation keys and resets before Check", async () => {
	const root = fixture();
	attach(root);
	const [first, second] = [...root.querySelectorAll<HTMLElement>("[data-highlight-chunk]")];
	first.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
	first.dispatchEvent(new KeyboardEvent("keydown", { key: " ", repeat: true, bubbles: true }));
	expect(first.getAttribute("aria-pressed")).toBe("true");
	const announcements: string[] = [];
	const observer = new MutationObserver(() =>
		announcements.push(node(root, "status").textContent ?? ""),
	);
	observer.observe(node(root, "status"), { childList: true });
	second.click();
	await Promise.resolve();
	second.click();
	await Promise.resolve();
	expect(announcements).toEqual(["You can mark one passage. Unmark it to choose another."]);
	first.click();
	await Promise.resolve();
	expect(node(root, "limit").hidden).toBe(true);
	expect(node(root, "status").textContent).toBe("");
	second.click();
	node(root, "restart").click();
	expect(node(root, "count").textContent).toBe("0 of 1 marked");
	observer.disconnect();
});

it("destroys listeners and results, closes a reopened Answer, and reattaches empty without focus", () => {
	const root = fixture();
	const old = attach(root);
	const chunk = node(root, "chunk");
	chunk.click();
	node(root, "check").click();
	const answer = node<HTMLDetailsElement>(root, "fallback");
	answer.open = false;
	answer.open = true;
	const outside = document.createElement("button");
	document.body.append(outside);
	outside.focus();
	old.destroy();
	old.destroy();
	chunk.click();
	expect(document.activeElement).toBe(outside);
	expect(answer.hidden).toBe(true);
	expect(answer.open).toBe(false);
	expect(
		root.querySelectorAll(
			'[role="button"], [aria-pressed], [data-highlight-outcome], [data-highlight-memory-notice]',
		),
	).toHaveLength(0);
	expect(node(root, "feedback").textContent).toBe("");
	attach(root);
	expect(document.activeElement).toBe(outside);
	expect(chunk.getAttribute("aria-pressed")).toBe("false");
});

it("rolls back a partial listener failure atomically and can retry the same root", () => {
	const root = fixture();
	const second = root.querySelectorAll<HTMLElement>("[data-highlight-chunk]")[1];
	vi.spyOn(second, "addEventListener").mockImplementationOnce(() => {
		throw new Error("registration");
	});
	expect(() => enhanceHighlight(root)).toThrow("registration");
	expect(
		root.querySelectorAll(
			'[role="button"], [tabindex="0"], [aria-pressed], [data-highlight-memory-notice]',
		),
	).toHaveLength(0);
	expect(node(root, "flow").hidden).toBe(true);
	expect(node<HTMLDetailsElement>(root, "fallback").open).toBe(false);
	expect(node(root, "fallback").hidden).toBe(false);
	attach(root);
	node(root, "chunk").click();
	expect(node(root, "count").textContent).toBe("1 of 1 marked");
});

it.each(["text", "order", "paragraph", "id"])(
	"refuses %s tampering before changing the baseline",
	(kind) => {
		const root = fixture();
		if (kind === "text") node(root, "chunk").textContent = "Changed";
		if (kind === "order") node(root, "chunk").setAttribute("data-highlight-chunk", "b");
		if (kind === "paragraph") node(root, "passage").append(document.createElement("p"));
		if (kind === "id") node(root, "feedback").id = "hl-summary";
		expect(() => enhanceHighlight(root)).toThrow("Invalid highlight");
		expect(node(root, "flow").hidden).toBe(true);
		expect(node(root, "fallback").hidden).toBe(false);
		expect(root.querySelectorAll('[role="button"], [data-highlight-memory-notice]')).toHaveLength(
			0,
		);
	},
);

it("stale detached controls cannot mutate a replacement mount", () => {
	const root = fixture();
	attach(root);
	const stale = node(root, "chunk");
	root.remove();
	const replacement = fixture();
	attach(replacement);
	stale.click();
	expect(stale.getAttribute("aria-pressed")).toBe("false");
	expect(node(replacement, "chunk").getAttribute("aria-pressed")).toBe("false");
});

it.each(["fr", "fr-CA"])(
	"keeps authored French punctuation and nonbreaking spaces byte-for-byte in %s",
	(lang) => {
		const text = "Pourquoi ? Oui ! Il dit : « Bonjour » ;\u00a0fin\u202f!";
		const note = "Note : « intacte » ;\u00a0oui\u202f!";
		const root = fixture(
			{
				...content,
				paragraphs: [
					[
						{ id: "target", text, key: true },
						{ id: "other", text: "Autre", note },
					],
				],
			},
			"fr",
			lang,
		);
		attach(root);
		const chunks = root.querySelectorAll<HTMLElement>("[data-highlight-chunk]");
		expect(chunks[0].textContent).toBe(text);
		chunks[1].click();
		node(root, "check").click();
		expect(root.querySelectorAll("[data-highlight-feedback]")[1].textContent).toBe(
			`Ce n'est pas une idée clé\u202f: ${note}`,
		);
		expect(chunks[0].textContent).toBe(text);
	},
);

it("preserves a learner's newer focus during result projection", () => {
	const root = fixture();
	attach(root);
	const outside = document.createElement("button");
	document.body.append(outside);
	const summary = node(root, "summary");
	const setter = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!.set!;
	vi.spyOn(summary, "textContent", "set").mockImplementation((value) => {
		setter.call(summary, value);
		outside.focus();
	});
	node(root, "chunk").focus();
	node(root, "check").click();
	expect(document.activeElement).toBe(outside);
	expect(node(root, "summary").hidden).toBe(false);
});

it.each(["key", "evidence"] as const)(
	"labels a found target and a wrong chunk without a note in %s",
	(mode) => {
		const root = fixture({
			mode,
			title: "Read",
			question: "Why?",
			maxMarks: 2,
			paragraphs: [
				[
					{ id: "target", text: "Target", key: true, note: "Target explanation" },
					{ id: "other", text: "Other" },
					{ id: "missed", text: "Missed target", key: true, note: "Missed explanation" },
				],
			],
		});
		attach(root);
		const chunks = root.querySelectorAll<HTMLElement>("[data-highlight-chunk]");
		chunks[0].click();
		chunks[1].click();
		node(root, "check").click();
		expect(
			[...root.querySelectorAll("[data-highlight-feedback]")].map((n) => n.textContent),
		).toEqual([
			mode === "key" ? "Key idea" : "Answers the question",
			mode === "key" ? "Not a key idea" : "This doesn't answer the question.",
			"Missed",
		]);
		expect(node(root, "summary").textContent).toBe(
			mode === "key"
				? "You found 1 of 2 key ideas."
				: "You found 1 of 2 passages that answer the question.",
		);
		expect(node(root, "fallback").textContent).toContain("Target explanation");
		expect(node(root, "fallback").textContent).toContain("Missed explanation");
	},
);

it("removes a notice and every listener after a late attach failure", () => {
	const root = fixture();
	const append = root.append.bind(root);
	vi.spyOn(root, "append").mockImplementationOnce((...nodes) => {
		append(...nodes);
		throw new Error("late attach");
	});
	expect(() => enhanceHighlight(root)).toThrow("late attach");
	expect(root.querySelectorAll('[role="button"], [data-highlight-memory-notice]')).toHaveLength(0);
	expect(node(root, "fallback").hidden).toBe(false);
	expect(node(root, "flow").hidden).toBe(true);
});

it.each([
	"media-only",
	"events-only",
	"beforeprint-first",
	"media-first",
	"afterprint-before-screen",
	"css-blur-first",
])("preserves checked highlight focus and exact screen state after %s", (order) => {
	const media = Object.assign(new EventTarget(), { matches: false, media: "print" });
	vi.stubGlobal("matchMedia", () => media);
	try {
		const root = fixture();
		attach(root);
		node(root, "check").click();
		const restart = node(root, "restart");
		expect(document.activeElement).toBe(restart);
		const before = root.outerHTML;
		if (order === "beforeprint-first" || order === "events-only")
			window.dispatchEvent(new Event("beforeprint"));
		if (order === "css-blur-first") {
			media.matches = true;
			restart.blur();
		}
		if (order !== "events-only") {
			media.matches = true;
			media.dispatchEvent(Object.assign(new Event("change"), { matches: true }));
		}
		restart.blur();
		if (order === "media-first") window.dispatchEvent(new Event("beforeprint"));
		if (order === "afterprint-before-screen") window.dispatchEvent(new Event("afterprint"));
		if (order !== "events-only") {
			media.matches = false;
			media.dispatchEvent(Object.assign(new Event("change"), { matches: false }));
		}
		window.dispatchEvent(new Event("afterprint"));
		expect(document.activeElement).toBe(restart);
		expect(root.outerHTML).toBe(before);
	} finally {
		vi.unstubAllGlobals();
	}
});
it.each(["later-focus", "input", "destroy"])("does not restore print focus after %s", (reason) => {
	const media = Object.assign(new EventTarget(), { matches: false, media: "print" });
	vi.stubGlobal("matchMedia", () => media);
	try {
		const root = fixture();
		const instance = attach(root);
		node(root, "check").click();
		const restart = node(root, "restart");
		window.dispatchEvent(new Event("beforeprint"));
		restart.blur();
		const other = document.createElement("button");
		document.body.append(other);
		if (reason === "later-focus") other.focus();
		if (reason === "input")
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
		if (reason === "destroy") instance.destroy();
		window.dispatchEvent(new Event("afterprint"));
		expect(document.activeElement).not.toBe(restart);
	} finally {
		vi.unstubAllGlobals();
	}
});
