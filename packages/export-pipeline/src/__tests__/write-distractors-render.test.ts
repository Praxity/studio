import { describe, expect, it } from "vitest";
import { renderWriteDistractors } from "../patterns/write-distractors/render";
import { renderBlockHtml } from "../render-block-html";
import { getBlockIsland, planPageRuntime } from "../runtime-plan";

describe("write-distractors baseline", () => {
	for (const lang of ["en", "fr"] as const)
		it(`${lang}: literal prompt and native answer only`, () => {
			const html = renderWriteDistractors(
				{ question: '<script>Question & "text"</script>', count: 2, items: [{ id: "one" }] },
				{ prefix: 'one"', lang, headingLevel: 2 },
			);
			expect(html).toContain("&lt;script&gt;Question &amp; &quot;text&quot;&lt;/script&gt;");
			expect(html).toContain('for="one&quot;-answer"');
			expect(html).toContain("<textarea");
			expect(html).toContain(lang === "fr" ? "nécessite JavaScript" : "needs JavaScript");
			expect(html).not.toMatch(/maxlength|authorOptions|misconceptions|type="hidden"/);
		});
	it("serializes the real island reference and baseline association", () => {
		const html = renderWriteDistractors(
			{ question: "Question", count: 2, items: [{ id: 'a"<&' }] },
			{
				prefix: "wd",
				lang: "en",
				headingLevel: 2,
				reference: {
					blockId: 'id"<&',
					path: 'write-distractors/a".js',
					contentRevision: 'sha256:a"',
					sha256: "a",
				},
			},
		);
		expect(html).toContain('data-distractor-id="id&quot;&lt;&amp;"');
		expect(html).toContain('data-distractor-src="write-distractors/a&quot;.js"');
		expect(html).toContain('data-distractor-revision="sha256:a&quot;"');
		expect(html).toContain('data-distractor-count="2"');
		expect(html).toContain('data-distractor-items="[&quot;a\\&quot;&lt;&amp;&quot;]"');
		expect(html).toContain('aria-describedby="wd-baseline"');
		expect(html).toContain('id="wd-baseline"');
	});

	it("publishes a prompt-only direct baseline", () => {
		const html = renderBlockHtml({
			id: "wd",
			type: "writeDistractors",
			data: { level: 2, content: { question: "Question", count: 2, items: [{ id: "one" }] } },
		});
		expect(html).toContain("Question");
		expect(html).toContain("data-write-distractors");
		expect(html).not.toMatch(/authorOptions|misconceptions/);
	});
});

it("plans the explicit island only for a distractor document", () => {
	const block = { id: "wd", type: "writeDistractors" as const, data: {} };
	expect(getBlockIsland(block)).toBe("writeDistractors");
	expect(
		planPageRuntime(
			{ sourceLocale: "en", navigationStyle: "none" },
			{ id: "p", title: "Practice", blocks: [block] },
			true,
		).islands,
	).toContain("writeDistractors");
	expect(
		planPageRuntime(
			{ sourceLocale: "en", navigationStyle: "none" },
			{ id: "p", title: "Static", blocks: [] },
			true,
		).islands,
	).not.toContain("writeDistractors");
});

it("published distractor DOM has no completion, attempt, signature or payment attributes", () => {
	const html = renderBlockHtml({
		id: "wd",
		type: "writeDistractors",
		data: { level: 2, content: { question: "Question", count: 2, items: [{ id: "one" }] } },
	});
	expect(html).toContain("data-write-distractors");
	expect(html).not.toMatch(
		/data-(?:required|completed|completion|attempted|attempt|track-completion|signature|payment)(?:=|\s|>)/,
	);
	expect(html).not.toMatch(/notifyCompletion|setCompleted|markCompleted/);
});
