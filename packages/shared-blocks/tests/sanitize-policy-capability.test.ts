import DOMPurify from "isomorphic-dompurify";
import { afterEach, expect, it, vi } from "vitest";
import { htmlToPlainText, sanitizeHtml, splitHeadingContent } from "../src/sanitize";

vi.mock("isomorphic-dompurify", async (importOriginal) => {
	const original = await importOriginal<typeof import("isomorphic-dompurify")>();
	return {
		...original,
		default: new Proxy(original.default, {
			get(target, property) {
				if (property === "hasPersistentConfig") return undefined;
				return Reflect.get(target, property);
			},
		}),
	};
});

afterEach(() => {
	vi.restoreAllMocks();
	DOMPurify.removeAllHooks();
	DOMPurify.clearConfig();
});

for (const [name, run] of Object.entries({ sanitizeHtml, htmlToPlainText, splitHeadingContent })) {
	it(`${name} bypasses caching when the dependency cannot verify policy ownership`, () => {
		let instance: typeof DOMPurify | undefined;
		DOMPurify.addHook("beforeSanitizeElements", function () {
			instance = this;
		});
		DOMPurify.sanitize("<p>Find instance</p>");
		DOMPurify.removeAllHooks();
		if (!instance) throw new Error("Expected DOMPurify hook receiver");
		const sanitize = vi.spyOn(instance, "sanitize");
		const input = "<p>Unverified policy</p>";
		const expected =
			name === "splitHeadingContent"
				? { heading: "Unverified policy", body: "" }
				: name === "sanitizeHtml"
					? input
					: "Unverified policy";
		expect(run(input)).toEqual(expected);
		const calls = sanitize.mock.calls.length;
		expect(run(input)).toEqual(expected);
		expect(sanitize.mock.calls.length).toBeGreaterThan(calls);
	});
}
