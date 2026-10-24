import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { describe, expect, it } from "vitest";
import { renderBlockHtml, sanitizeBlockForJson } from "../render-block-html.ts";

// Exercise the public renderer/projection boundary before and after extraction.
function block(type: PraxityBlock["type"], data: Record<string, unknown>): PraxityBlock {
	return { id: "probe", type, data } as PraxityBlock;
}

describe("published markup characterisation", () => {
	it("omits the internal folded-page-title mark from learner JSON", () => {
		expect(
			sanitizeBlockForJson(
				block("assessmentGroup", {
					groupName: "Lesson",
					_headingLevel: 1,
					_foldedPageTitle: true,
					memberBlockIds: [],
				}),
			).data,
		).toEqual({ groupName: "Lesson", _headingLevel: 1, memberBlockIds: [] });
	});
	it("escapes ampersand, angle brackets and double quotes, retaining apostrophes", () => {
		expect(renderBlockHtml({ id: "&<>\"'", type: "divider", data: {} })).toBe(
			'<div id="block-&amp;&lt;&gt;&quot;\'" class="praxity-block praxity-block-divider praxity-block-&amp;&lt;&gt;&quot;\'" data-block-id="&amp;&lt;&gt;&quot;\'" data-node-id="&amp;&lt;&gt;&quot;\'" data-block-type="divider" data-focus-row><hr class="praxity-divider praxity-divider-line" /></div>',
		);
	});

	it("converts camel case wrapper types without changing empty marker output", () => {
		expect(renderBlockHtml(block("pageBreak", {}))).toBe("");
		expect(renderBlockHtml(block("blockBreak", { close: "float" }))).toBe(
			'<div data-node-id="probe"></div>',
		);
		expect(renderBlockHtml(block("heroCover", {}))).toContain(
			'class="praxity-block praxity-block-hero-cover praxity-block-probe"',
		);
	});

	it("sanitizes inline HTML and preserves inline markup", () => {
		expect(
			renderBlockHtml(
				block("text", {
					content:
						'<p>A &amp; <strong>B</strong><script>bad()</script><img src="x" onerror="bad()"></p>',
				}),
			),
		).toBe(
			'<div id="block-probe" class="praxity-block praxity-block-text praxity-block-probe" data-block-id="probe" data-node-id="probe" data-block-type="text" data-focus-row><div class="praxity-text"><p>A &amp; <strong>B</strong><img src="x"></p></div></div>',
		);
		expect(renderBlockHtml(block("text", { content: 42 }))).toContain(
			'<div class="praxity-text"></div>',
		);
	});

	it("renders prepared and fallback inline fields with their current precedence", () => {
		const prepared = renderBlockHtml(
			block("table", {
				title: "Raw **title**",
				_inline: { title: "<em>Prepared</em><script>bad()</script>" },
				caption: "A **bold** caption",
				headers: [],
				rows: [],
			}),
		);
		expect(prepared).toContain(
			'<p id="probe-table-title" class="praxity-block-title"><em>Prepared</em></p>',
		);
		expect(prepared).toContain("A <strong>bold</strong> caption");
		expect(prepared).not.toContain("Raw");
		expect(prepared).not.toContain("bad()");
	});

	it.each([
		[" http://example.test/a ", "http://example.test/a", "http://example.test/a"],
		[" https://example.test/a ", "https://example.test/a", "https://example.test/a"],
		[" mailto:a@example.test ", "mailto:a@example.test", "mailto:a@example.test"],
		[" ../media/a.png ", "../media/a.png", "../media/a.png"],
		[" /page.html#x ", "/page.html#x", "/page.html#x"],
		[" data:image/png;base64,AAAA ", "data:image/png;base64,AAAA", "#"],
		["DATA:image/JPEG;base64,AAAA", "DATA:image/JPEG;base64,AAAA", "#"],
		["data:image/svg+xml,<svg/>", "#", "#"],
		["data:text/html,<script>bad()</script>", "#", "#"],
		["data:audio/mp3;base64,AAAA", "#", "#"],
		[" \nJaVaScRiPt:bad()\t", "#", "#"],
		[" \tVbScRiPt:bad()\n", "#", "#"],
		// These scalar URL policies trim but do not decode entities or inner whitespace.
		["java\nscript:bad()", "java\nscript:bad()", "java\nscript:bad()"],
		["jav&#x61;script:bad()", "jav&#x61;script:bad()", "jav&#x61;script:bad()"],
		["vb&#115;cript:bad()", "vb&#115;cript:bad()", "vb&#115;cript:bad()"],
	])("keeps media and href JSON policies distinct: %s", (input, media, href) => {
		expect(
			sanitizeBlockForJson(
				block("image", {
					src: input,
					source: input,
					background: input,
					imageSrc: input,
					avatar: input,
					href: input,
					url: input,
					sourceUrl: input,
				}),
			).data,
		).toEqual({
			src: media,
			source: media,
			background: media,
			imageSrc: media,
			avatar: media,
			href,
			url: href,
			sourceUrl: href,
		});
	});

	it.each([
		"http://example.test/embed",
		"mailto:a@example.test",
		"../embed.html",
		"data:image/png;base64,AAAA",
		" \tJaVaScRiPt:bad()",
		"VbScRiPt:bad()",
		"jav&#x61;script:bad()",
		"java\nscript:bad()",
	])("refuses inadmissible embed URLs with the same empty content: %s", (src) => {
		expect(renderBlockHtml(block("embed", { src }))).toBe(
			'<div id="block-probe" class="praxity-block praxity-block-embed praxity-block-probe" data-block-id="probe" data-node-id="probe" data-block-type="embed" data-focus-row></div>',
		);
	});

	it("normalizes supported video URLs and keeps third-party HTTPS embed admission", () => {
		expect(renderBlockHtml(block("video", { src: "https://vimeo.com/123456" }))).toContain(
			'data-embed-src="https://player.vimeo.com/video/123456"',
		);
		expect(renderBlockHtml(block("embed", { src: " https://example.test/embed " }))).toContain(
			'href="https://example.test/embed"',
		);
		expect(renderBlockHtml(block("video", { src: "https://example.test/unknown" }))).not.toContain(
			"<iframe",
		);
	});

	it("recurses through JSON, retaining raw text and display metadata only", () => {
		expect(
			sanitizeBlockForJson(
				block("text", {
					code: "<script>literal</script>",
					title: "<b>raw</b>",
					content: "<strong>safe</strong><script>bad()</script>",
					_inline: { title: "<em>display</em>" },
					_htmlFields: ["title"],
					items: [
						{ content: "<em>nested</em><script>bad()</script>", _htmlFields: ["content"] },
						null,
						true,
						4,
					],
				}),
			),
		).toEqual(
			block("text", {
				code: "<script>literal</script>",
				title: "<b>raw</b>",
				content: "<strong>safe</strong>",
				_inline: { title: "<em>display</em>" },
				items: [{ content: "<em>nested</em>" }, null, true, 4],
			}),
		);
	});

	it("projects only the self-check prompt at top level and inside containers", () => {
		const prompt = block("selfCheck", {
			content: { task: "Explain your choice.", parts: [{ id: "criterion-1" }] },
		});
		expect(sanitizeBlockForJson(prompt)).toEqual({
			id: "probe",
			type: "selfCheck",
			data: { content: { task: "Explain your choice.", parts: [{ id: "criterion-1" }] } },
		});
		const nested = sanitizeBlockForJson(block("card", { children: [prompt] }));
		expect(nested.data).toEqual({
			children: [
				{
					id: "probe",
					type: "selfCheck",
					data: { content: { task: "Explain your choice.", parts: [{ id: "criterion-1" }] } },
				},
			],
		});
		const rendered = renderBlockHtml(prompt, { includeDataBlockJson: true });
		expect(rendered).toContain(
			'data-block-json=\'{"id":"probe","type":"selfCheck","data":{"content":{"task":"Explain your choice.","parts":[{"id":"criterion-1"}]}}}\'',
		);
		for (const secret of ['"model":', '"criteria":', '"hints":'])
			expect(rendered).not.toContain(secret);
	});

	it.each(["model", "criteria", "hints"])(
		"refuses hidden self-check %s rather than publishing it",
		(key) => {
			const hostile = block("selfCheck", {
				content: { task: "Task", parts: [{ id: "one" }], [key]: "PRIVATE-SENTINEL" },
			});
			for (const input of [hostile, block("card", { children: [hostile] })]) {
				expect(() => sanitizeBlockForJson(input)).toThrowError(
					expect.objectContaining({
						message: "Invalid self-check prompt data.",
						code: "ESELFCHECKPROMPT",
					}),
				);
			}
		},
	);
});
