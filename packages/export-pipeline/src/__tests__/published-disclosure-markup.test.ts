// @vitest-environment jsdom

import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { describe, expect, it } from "vitest";
import { enhanceDisclosure } from "../../template/src/disclosure.ts";
import {
	renderDisclosureChevron,
	renderDisclosureHeading,
	renderTranscript,
} from "../published-disclosure-markup.ts";
import { renderBlockHtml } from "../render-block-html.ts";

// Literal markup contracts, independent of the production helpers.
const chevron =
	'<svg class="praxity-disclosure-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m9 5 7 7-7 7"/></svg>';
const plus =
	'<svg class="praxity-disclosure-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M5 12h14"/><path class="praxity-disclosure-icon-vertical" d="M12 5v14"/></svg>';
const transcriptEn =
	'<div class="praxity-media-transcript"><h3 class="praxity-disclosure-heading"><span id="media-transcript-trigger-label" class="praxity-disclosure-title" data-disclosure-label>View transcript</span><button type="button" class="praxity-disclosure-trigger" data-disclosure-trigger id="media-transcript-trigger" aria-expanded="true" aria-controls="media-transcript-panel" hidden>' +
	plus +
	'</button></h3><div id="media-transcript-panel" class="praxity-transcript-content" data-disclosure-panel><p>Read <em>this</em> &amp; learn.</p></div></div>';
const transcriptFr =
	'<div class="praxity-media-transcript"><h3 class="praxity-disclosure-heading"><span id="media-transcript-trigger-label" class="praxity-disclosure-title" data-disclosure-label>Voir la transcription</span><button type="button" class="praxity-disclosure-trigger" data-disclosure-trigger id="media-transcript-trigger" aria-expanded="true" aria-controls="media-transcript-panel" hidden>' +
	plus +
	'</button></h3><div id="media-transcript-panel" class="praxity-transcript-content" data-disclosure-panel><p>Read <em>this</em> &amp; learn.</p></div></div>';
const transcript = "<p>Read <em>this</em> &amp; learn.</p>";

function block(type: PraxityBlock["type"], data: Record<string, unknown>): PraxityBlock {
	return { id: "media", type, data } as PraxityBlock;
}

describe("published disclosure markup characterisation", () => {
	it("keeps the decorative chevron bytes used by accordion and tabs", () => {
		expect(renderDisclosureChevron()).toBe(chevron);
	});

	it("keeps a visible inline heading label and an initially hidden native trigger", () => {
		expect(renderDisclosureHeading("<em>Read</em> &amp; learn", "button", "panel", 2)).toBe(
			'<h2 class="praxity-disclosure-heading"><span id="button-label" class="praxity-disclosure-title" data-disclosure-label><em>Read</em> &amp; learn</span><button type="button" class="praxity-disclosure-trigger" data-disclosure-trigger id="button" aria-expanded="true" aria-controls="panel" hidden>' +
				plus +
				"</button></h2>",
		);
	});

	it("retains h6, a missing label and escaping in both ID references", () => {
		expect(renderDisclosureHeading("", 'b&"<>', 'p&"<>', 6, true)).toBe(
			'<h6 class="praxity-disclosure-heading"><span id="b&amp;&quot;&lt;&gt;-label" class="praxity-disclosure-title" data-disclosure-label></span><button type="button" class="praxity-disclosure-trigger" data-disclosure-trigger id="b&amp;&quot;&lt;&gt;" aria-expanded="true" aria-controls="p&amp;&quot;&lt;&gt;" hidden>' +
				chevron +
				"</button></h6>",
		);
	});

	it.each([
		["View transcript", transcriptEn],
		["Voir la transcription", transcriptFr],
	])("retains literal transcript markup with %s", (label, expected) => {
		expect(renderTranscript(transcript, "media", label)).toBe(expected);
	});

	it("sanitizes transcript content and escapes its text-only label and IDs", () => {
		expect(
			renderTranscript(
				"<p>Read <strong>this</strong><script>bad()</script></p>",
				'm&"',
				'<Voir & "lire">',
			),
		).toBe(
			'<div class="praxity-media-transcript"><h3 class="praxity-disclosure-heading"><span id="m&amp;&quot;-transcript-trigger-label" class="praxity-disclosure-title" data-disclosure-label>&lt;Voir &amp; &quot;lire&quot;&gt;</span><button type="button" class="praxity-disclosure-trigger" data-disclosure-trigger id="m&amp;&quot;-transcript-trigger" aria-expanded="true" aria-controls="m&amp;&quot;-transcript-panel" hidden>' +
				plus +
				'</button></h3><div id="m&amp;&quot;-transcript-panel" class="praxity-transcript-content" data-disclosure-panel><p>Read <strong>this</strong></p></div></div>',
		);
	});

	it("retains readable content even with an empty transcript label", () => {
		expect(renderTranscript("Read", "media", "")).toBe(
			'<div class="praxity-media-transcript"><h3 class="praxity-disclosure-heading"><span id="media-transcript-trigger-label" class="praxity-disclosure-title" data-disclosure-label></span><button type="button" class="praxity-disclosure-trigger" data-disclosure-trigger id="media-transcript-trigger" aria-expanded="true" aria-controls="media-transcript-panel" hidden>' +
				plus +
				'</button></h3><div id="media-transcript-panel" class="praxity-transcript-content" data-disclosure-panel>Read</div></div>',
		);
	});

	it.each([undefined, null, 42, {}, "", "<script>bad()</script>"])(
		"omits an empty or refused transcript %j",
		(value) => {
			expect(renderTranscript(value, "media", "View transcript")).toBe("");
		},
	);

	it.each([
		["en", "Video", transcriptEn],
		["fr", "Vidéo", transcriptFr],
	])(
		"keeps complete video output and the %s fallback title",
		(sourceLocale, title, expectedTranscript) => {
			expect(
				renderBlockHtml(block("video", { src: "assets/clip.mp4", transcript }), { sourceLocale }),
			).toBe(
				'<div id="block-media" class="praxity-block praxity-block-video praxity-block-media" data-block-id="media" data-node-id="media" data-block-type="video" data-focus-row><div class="praxity-video"><video controls preload="metadata" playsinline width="1280" height="720" aria-label="' +
					title +
					'"><source src="assets/clip.mp4" /></video>' +
					expectedTranscript +
					"</div></div>",
			);
		},
	);

	it.each([
		["en", transcriptEn],
		["fr", transcriptFr],
	])(
		"keeps complete audio output and %s transcript without a download link",
		(sourceLocale, expectedTranscript) => {
			expect(
				renderBlockHtml(block("audio", { src: "assets/clip.mp3", transcript }), { sourceLocale }),
			).toBe(
				'<div id="block-media" class="praxity-block praxity-block-audio praxity-block-media" data-block-id="media" data-node-id="media" data-block-type="audio" data-focus-row><div class="praxity-audio-card"><div class="praxity-audio-controls"><div data-audio-player data-audio-src="assets/clip.mp3" data-audio-title="Audio"><audio controls preload="metadata" class="praxity-audio-player" aria-label="Audio"><source src="assets/clip.mp3" /></audio></div></div>' +
					expectedTranscript +
					"</div></div>",
			);
		},
	);

	it("keeps the audio download fallback when transcript sanitizes to empty", () => {
		expect(
			renderBlockHtml(
				block("audio", { src: "assets/clip.mp3", transcript: "<script>bad()</script>" }),
			),
		).toBe(
			'<div id="block-media" class="praxity-block praxity-block-audio praxity-block-media" data-block-id="media" data-node-id="media" data-block-type="audio" data-focus-row><div class="praxity-audio-card"><div class="praxity-audio-controls"><div data-audio-player data-audio-src="assets/clip.mp3" data-audio-title="Audio"><audio controls preload="metadata" class="praxity-audio-player" aria-label="Audio"><source src="assets/clip.mp3" /></audio></div><a href="assets/clip.mp3" download class="praxity-audio-download">Download</a></div></div></div>',
		);
	});

	it("keeps video output without a transcript when it is empty", () => {
		expect(renderBlockHtml(block("video", { src: "assets/clip.mp4", transcript: "" }))).toBe(
			'<div id="block-media" class="praxity-block praxity-block-video praxity-block-media" data-block-id="media" data-node-id="media" data-block-type="video" data-focus-row><div class="praxity-video"><video controls preload="metadata" playsinline width="1280" height="720" aria-label="Video"><source src="assets/clip.mp4" /></video></div></div>',
		);
	});

	it.each([false, true])(
		"keeps all no-JS panels readable for multiple-open=%s",
		(allowMultipleOpen) => {
			expect(
				renderBlockHtml(
					block("accordion", {
						allowMultipleOpen,
						items: [{ id: "first", label: "<em>Read</em>", children: [] }],
					}),
				),
			).toBe(
				'<div id="block-media" class="praxity-block praxity-block-accordion praxity-block-media" data-block-id="media" data-node-id="media" data-block-type="accordion" data-focus-row><div class="praxity-accordion-static" data-multiple="' +
					allowMultipleOpen +
					'" data-style="default"><div data-accordion-item data-item-id="first" data-node-id="first" data-narration-reveal="first"><h3 class="praxity-disclosure-heading"><span id="media-summary-first-label" class="praxity-disclosure-title" data-disclosure-label><em>Read</em></span><button type="button" class="praxity-disclosure-trigger" data-disclosure-trigger id="media-summary-first" aria-expanded="true" aria-controls="media-panel-first" hidden>' +
					chevron +
					'</button></h3><div id="media-panel-first" class="praxity-accordion-panel" data-disclosure-panel role="region" aria-labelledby="media-summary-first-label" data-narration-reveal="first"></div></div></div></div>',
			);
		},
	);

	it.each(["en", "fr"])("keeps the missing item label fallback in %s", (sourceLocale) => {
		expect(
			renderBlockHtml(block("accordion", { headingLevel: 5, headingOffset: 4, items: [{}] }), {
				sourceLocale,
			}),
		).toBe(
			'<div id="block-media" class="praxity-block praxity-block-accordion praxity-block-media" data-block-id="media" data-node-id="media" data-block-type="accordion" data-focus-row><div class="praxity-accordion-static" data-multiple="false" data-style="default"><div data-accordion-item data-item-id="item-0" data-node-id="item-0" data-narration-reveal="item-0"><h6 class="praxity-disclosure-heading"><span id="media-summary-item-0-label" class="praxity-disclosure-title" data-disclosure-label>Section 1</span><button type="button" class="praxity-disclosure-trigger" data-disclosure-trigger id="media-summary-item-0" aria-expanded="true" aria-controls="media-panel-item-0" hidden>' +
				chevron +
				'</button></h6><div id="media-panel-item-0" class="praxity-accordion-panel" data-disclosure-panel role="region" aria-labelledby="media-summary-item-0-label" data-narration-reveal="item-0"></div></div></div></div>',
		);
	});

	it("keeps nested accordion headings and native panel/label relationships", () => {
		const inner = {
			id: "inner",
			type: "accordion",
			data: { headingLevel: 4, items: [{ id: "inside", label: "Inside" }] },
		} as PraxityBlock;
		expect(
			renderBlockHtml(
				block("accordion", {
					headingLevel: 2,
					items: [{ id: "outside", label: "Outside", children: [inner] }],
				}),
			),
		).toBe(
			'<div id="block-media" class="praxity-block praxity-block-accordion praxity-block-media" data-block-id="media" data-node-id="media" data-block-type="accordion" data-focus-row><div class="praxity-accordion-static" data-multiple="false" data-style="default"><div data-accordion-item data-item-id="outside" data-node-id="outside" data-narration-reveal="outside"><h2 class="praxity-disclosure-heading"><span id="media-summary-outside-label" class="praxity-disclosure-title" data-disclosure-label>Outside</span><button type="button" class="praxity-disclosure-trigger" data-disclosure-trigger id="media-summary-outside" aria-expanded="true" aria-controls="media-panel-outside" hidden>' +
				chevron +
				'</button></h2><div id="media-panel-outside" class="praxity-accordion-panel" data-disclosure-panel role="region" aria-labelledby="media-summary-outside-label" data-narration-reveal="outside"><div id="block-inner" class="praxity-block praxity-block-accordion praxity-block-inner" data-block-id="inner" data-node-id="inner" data-block-type="accordion" data-focus-row><div class="praxity-accordion-static" data-multiple="false" data-style="default"><div data-accordion-item data-item-id="inside" data-node-id="inside" data-narration-reveal="inside"><h4 class="praxity-disclosure-heading"><span id="inner-summary-inside-label" class="praxity-disclosure-title" data-disclosure-label>Inside</span><button type="button" class="praxity-disclosure-trigger" data-disclosure-trigger id="inner-summary-inside" aria-expanded="true" aria-controls="inner-panel-inside" hidden>' +
				chevron +
				'</button></h4><div id="inner-panel-inside" class="praxity-accordion-panel" data-disclosure-panel role="region" aria-labelledby="inner-summary-inside-label" data-narration-reveal="inside"></div></div></div></div></div></div></div></div>',
		);
	});
});

// The server has no authored open/closed option; enhancement owns these states.
it.each([false, true])("keeps literal accordion markup when enhanced open=%s", (open) => {
	document.body.innerHTML = renderBlockHtml(
		block("accordion", {
			items: [{ id: "first", label: "Read", children: [] }],
		}),
	);
	const button = document.getElementById("media-summary-first") as HTMLButtonElement;
	const panel = document.getElementById("media-panel-first") as HTMLElement;
	const disclosure = enhanceDisclosure(button, panel);
	try {
		if (open) button.click();
		expect(button.parentElement?.outerHTML).toBe(
			'<h3 class="praxity-disclosure-heading"><button type="button" class="praxity-disclosure-trigger" data-disclosure-trigger="" id="media-summary-first" aria-expanded="' +
				open +
				'" aria-controls="media-panel-first"><span id="media-summary-first-label" class="praxity-disclosure-title" data-disclosure-label="">Read</span><svg class="praxity-disclosure-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m9 5 7 7-7 7"></path></svg></button></h3>',
		);
		expect(panel.parentElement?.parentElement?.outerHTML).toBe(
			'<div data-content-reveal="' +
				(open ? "open" : "closed") +
				'" data-reveal-print="expand" aria-hidden="' +
				!open +
				'"><div class="praxity-reveal-clip"><div id="media-panel-first" class="praxity-accordion-panel" data-disclosure-panel="" role="region" aria-labelledby="media-summary-first" data-narration-reveal="first"></div></div></div>',
		);
	} finally {
		disclosure.destroy();
		document.body.replaceChildren();
	}
});
