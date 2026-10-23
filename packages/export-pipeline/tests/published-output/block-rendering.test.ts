import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, test } from "vitest";
import { renderBlockHtml } from "../../src/render-block-html";
import { type BuildResult, blocksByType, getBuild } from "./setup";

let build: BuildResult;

beforeAll(async () => {
	build = await getBuild();
}, 120_000);

describe("Block rendering — content blocks", () => {
	test("text blocks render paragraph content", () => {
		const texts = blocksByType(build.blocks, "text");
		expect(texts.length).toBeGreaterThan(0);
		for (const block of texts) {
			expect(block.element.querySelector(".praxity-text, p")).toBeTruthy();
		}
	});

	test("heading blocks render h2-h6 elements", () => {
		const headings = blocksByType(build.blocks, "heading");
		expect(headings.length).toBeGreaterThan(0);
		for (const block of headings) {
			const h = block.element.querySelector("h1, h2, h3, h4, h5, h6");
			expect(h, `heading block ${block.id} missing heading element`).toBeTruthy();
		}
	});

	test("static heading markup uses the shared visual scale after semantic offsets", () => {
		const html = renderBlockHtml({
			id: "heading-offset",
			type: "heading",
			data: { content: "<p>Page title</p>", level: 1, headingOffset: 1 },
		});
		expect(html).toContain('<h2 style="font-size:var(--praxity-type-h1)');
		expect(html).not.toContain("<h2><p>");
	});

	test("image blocks have img with src and alt", () => {
		const images = blocksByType(build.blocks, "image");
		expect(images.length).toBeGreaterThan(0);
		for (const block of images) {
			const img = block.element.querySelector("img");
			expect(img, `image block ${block.id} missing <img>`).toBeTruthy();
			expect(img?.getAttribute("src")).toBeTruthy();
			expect(img?.hasAttribute("alt")).toBe(true);
		}
	});

	test("static images fill their width-capped figures", () => {
		for (const [width, maxWidth] of [
			["small", "33%"],
			["medium", "50%"],
			["large", "75%"],
		] as const) {
			const document = new JSDOM(
				renderBlockHtml({
					id: `image-${width}`,
					type: "image",
					data: { src: "/wide.jpg", altText: "Wide image", width },
				}),
			).window.document;
			expect(document.querySelector("figure")?.style.maxWidth).toBe(maxWidth);
			const imageStyle = document.querySelector("img")?.style;
			expect(imageStyle?.display).toBe("block");
			expect(imageStyle?.objectFit).toBe("cover");
			expect(imageStyle?.width).toBe("100%");
		}
	});

	test("static image float uses validated image settings", () => {
		for (const float of ["left", "right"] as const) {
			const blocks = [
				{
					id: `image-${float}`,
					type: "image" as const,
					data: { src: "/portrait.jpg", altText: "Portrait", width: "medium", float },
				},
				{ id: "prose", type: "text" as const, data: { content: "<p>Following prose.</p>" } },
			];
			const document = new JSDOM(
				renderBlockHtml(blocks[0], { siblingBlocks: blocks, blockIndex: 0 }),
			).window.document;
			const figure = document.querySelector("figure");

			expect(figure?.getAttribute("data-image-float")).toBe(float);
			expect(figure?.getAttribute("data-image-width")).toBe("medium");
			expect(figure?.getAttribute("data-image-alignment")).toBe("center");
		}

		const invalid = [
			{
				id: "invalid-float",
				type: "image" as const,
				data: { src: "/portrait.jpg", altText: "Portrait", width: "medium", float: "around" },
			},
			{ id: "prose", type: "text" as const, data: { content: "<p>Following prose.</p>" } },
		];
		const invalidFigure = new JSDOM(
			renderBlockHtml(invalid[0], { siblingBlocks: invalid, blockIndex: 0 }),
		).window.document.querySelector("figure");
		expect(invalidFigure?.hasAttribute("data-image-float")).toBe(false);
	});

	test("note blocks keep two reading kinds, run-in labels and authored content", () => {
		const notes = blocksByType(build.blocks, "note");
		expect(notes.length).toBeGreaterThan(0);
		const seenColors = new Set<string>();
		for (const block of notes) {
			const noteEl = block.element.querySelector(".praxity-note-base");
			const color = noteEl?.getAttribute("data-color");
			if (color) seenColors.add(color);
			expect(block.element.textContent?.trim().length).toBeGreaterThan(0);
			expect(noteEl?.querySelector(".praxity-note-label")?.textContent?.trim()).toBeTruthy();
			expect(noteEl?.querySelectorAll(".praxity-note-icon").length).toBe(
				color === "warning" || color === "error" ? 1 : 0,
			);
			expect(noteEl?.querySelector("p .praxity-note-label")).toBeTruthy();
		}
		expect([...seenColors].sort()).toEqual(["note", "warning"]);
		const error = new JSDOM(
			renderBlockHtml({
				id: "error-note",
				type: "note",
				data: { color: "error", content: "Error content" },
			}),
		).window.document;
		expect(error.querySelector(".praxity-note-base")?.getAttribute("data-color")).toBe("error");
		expect(error.querySelector(".praxity-note-label")?.textContent).toBe("Error");
		expect(error.querySelectorAll(".praxity-note-icon")).toHaveLength(1);
	});

	test("static assessments use quiet points and standard required metadata", () => {
		const html = renderBlockHtml({
			id: "question-1",
			type: "assessment",
			data: {
				assessmentType: "choice",
				stem: [{ id: "stem", type: "text", data: { content: "Choose one" } }],
				response: {
					type: "choice",
					selectionMode: "single",
					options: [{ id: "a", label: "Answer" }],
				},
				gradingMode: "exact",
				points: 2,
				required: true,
			},
		});
		const document = new JSDOM(html).window.document;
		expect(document.querySelector(".praxity-assessment-points")?.textContent).toBe("2 points");
		expect(document.querySelector(".praxity-required-indicator")?.textContent).toContain(
			"Required",
		);
		const questionId = document.querySelector("fieldset")?.getAttribute("aria-labelledby");
		const question = document.getElementById(questionId ?? "");
		expect(question?.matches("p.praxity-assessment-stem")).toBe(true);
		expect(question?.textContent).toContain("Required");
		const group = document.querySelector("fieldset");
		expect(group?.getAttribute("role")).toBe("radiogroup");
		expect(group?.getAttribute("aria-required")).toBe("true");
		expect(document.querySelector("[aria-invalid]")).toBeNull();
		const input = document.querySelector<HTMLInputElement>('input[type="radio"]');
		expect(input?.hasAttribute("required")).toBe(false);
		expect(input?.matches(":invalid")).toBe(false);
		expect(input?.disabled).toBe(true);
		expect(
			input?.form?.querySelector('button, input[type="submit"], input[type="image"]'),
		).toBeNull();
		expect(document.querySelector("noscript")?.textContent).toContain("needs JavaScript");
		expect(document.querySelector(".mantine-Badge-root")).toBeNull();
	});

	test("required multi-select assessments do not require every checkbox", () => {
		const document = new JSDOM(
			renderBlockHtml({
				id: "question-multiple",
				type: "assessment",
				data: {
					assessmentType: "choice",
					stem: [{ id: "stem", type: "text", data: { content: "Choose all" } }],
					response: {
						type: "choice",
						selectionMode: "multiple",
						options: [
							{ id: "a", label: "Alpha" },
							{ id: "b", label: "Beta" },
						],
					},
					required: true,
				},
			}),
		).window.document;

		const questionId = document.querySelector("fieldset")?.getAttribute("aria-labelledby");
		const question = document.getElementById(questionId ?? "");
		expect(question?.matches("p.praxity-assessment-stem")).toBe(true);
		expect(question?.textContent).toContain("Required");
		for (const checkbox of document.querySelectorAll('input[type="checkbox"]')) {
			expect(checkbox.hasAttribute("aria-required")).toBe(false);
			expect(checkbox.hasAttribute("required")).toBe(false);
		}
	});

	test("logic blocks keep their runtime anchor without learner-facing internals", () => {
		const html = renderBlockHtml({
			id: "logic-1",
			type: "logic",
			data: {
				conditions: { operator: "and", rules: [{ source: "x", comparison: "is", value: 1 }] },
				actions: [{ type: "jumpToPage", targets: ["page-2"] }],
			},
		});
		const document = new JSDOM(html).window.document;
		const block = document.querySelector('[data-block-id="logic-1"]');
		expect(block).toBeTruthy();
		expect(block?.textContent).toBe("");
		expect(block?.querySelector(".praxity-logic-meta")).toBeNull();
	});

	test("button blocks render anchor with href", () => {
		const buttons = blocksByType(build.blocks, "button");
		expect(buttons.length).toBeGreaterThan(0);
		for (const block of buttons) {
			const a = block.element.querySelector("a[href]");
			expect(a, `button block ${block.id} missing <a href>`).toBeTruthy();
		}
	});

	test("quote blocks render blockquote", () => {
		const quotes = blocksByType(build.blocks, "quote");
		expect(quotes.length).toBeGreaterThan(0);
		for (const block of quotes) {
			const bq = block.element.querySelector("blockquote");
			expect(bq, `quote block ${block.id} missing <blockquote>`).toBeTruthy();
		}
	});

	test("static quotes render figure semantics and cite only the work title", () => {
		const document = new JSDOM(
			renderBlockHtml({
				id: "researched-quote",
				type: "quote",
				data: {
					text: "Quoted words…",
					speaker: "Participant",
					work: "Lumière à l'œilleton research project",
					sourceUrl: "https://source.example/",
				},
			}),
		).window.document;
		const figure = document.querySelector("figure.praxity-quote");
		const quote = figure?.querySelector(":scope > blockquote");
		const caption = figure?.querySelector(":scope > figcaption");

		expect(quote?.querySelector(":scope > p")?.textContent).toBe("Quoted words…");
		expect(quote?.getAttribute("cite")).toBe("https://source.example/");
		expect(caption?.querySelector(".praxity-quote__speaker")?.closest("cite")).toBeNull();
		expect(caption?.querySelector("cite")?.textContent).toBe(
			"Lumière à l'œilleton research project",
		);
		expect(caption?.querySelector("a")?.getAttribute("href")).toBe("https://source.example/");
		expect(figure?.lastElementChild).toBe(caption);
		expect(document.querySelector(".praxity-quote-mark")).toBeNull();
	});

	test("static legacy pull quotes keep their content in the single treatment", () => {
		const document = new JSDOM(
			renderBlockHtml({
				id: "legacy-pullquote",
				type: "quote",
				data: {
					text: "Legacy content",
					attribution: "<strong>Legacy speaker</strong>",
					style: "pullquote",
					decorator: "cinematic",
					sourceUrl: "javascript:alert(1)",
				},
			}),
		).window.document;

		expect(document.querySelector("figure.praxity-quote blockquote")?.textContent).toBe(
			"Legacy content",
		);
		expect(document.querySelector("[data-decorator], .praxity-quote-mark")).toBeNull();
		expect(document.querySelector("blockquote")?.hasAttribute("cite")).toBe(false);
		expect(document.querySelector("figcaption")?.textContent).toBe("Legacy speaker");
		expect(document.querySelector("figcaption strong, figcaption a")).toBeNull();
	});

	test("code blocks have language class", () => {
		const codes = blocksByType(build.blocks, "code");
		expect(codes.length).toBeGreaterThan(0);
		for (const block of codes) {
			const pre = block.element.querySelector("pre");
			expect(pre, `code block ${block.id} missing <pre>`).toBeTruthy();
		}
	});

	test("divider blocks render hr or decorative element", () => {
		const dividers = blocksByType(build.blocks, "divider");
		expect(dividers.length).toBeGreaterThan(0);
		for (const block of dividers) {
			const hr = block.element.querySelector("hr, [role='separator']");
			expect(hr, `divider block ${block.id} missing <hr>`).toBeTruthy();
		}
	});

	test("table blocks render table with thead and tbody", () => {
		const tables = blocksByType(build.blocks, "table");
		expect(tables.length).toBeGreaterThan(0);
		for (const block of tables) {
			const table = block.element.querySelector("table");
			expect(table, `table block ${block.id} missing <table>`).toBeTruthy();
			expect(table?.querySelector("thead, th")).toBeTruthy();
			expect(table?.querySelector("tbody, td")).toBeTruthy();
		}
	});

	test("equation blocks render math output", () => {
		const equations = blocksByType(build.blocks, "equation");
		expect(equations.length).toBeGreaterThan(0);
		for (const block of equations) {
			// KaTeX or MathML output
			const math = block.element.querySelector(".katex, math, .praxity-equation");
			expect(math, `equation block ${block.id} missing math output`).toBeTruthy();
		}
	});
});

describe("Block rendering — container blocks", () => {
	test("accordion blocks have trigger and panel structure", () => {
		const accordions = blocksByType(build.blocks, "accordion");
		expect(accordions.length).toBeGreaterThan(0);
		for (const block of accordions) {
			const triggers = block.element.querySelectorAll("button, summary");
			expect(triggers.length, `accordion ${block.id} missing triggers`).toBeGreaterThan(0);
		}
	});

	test("tabs blocks have tablist, tabs, and tabpanels", () => {
		const tabs = blocksByType(build.blocks, "tabs");
		expect(tabs.length).toBeGreaterThan(0);
		for (const block of tabs) {
			const tablist = block.element.querySelector("[role='tablist']");
			expect(tablist, `tabs block ${block.id} missing tablist`).toBeTruthy();
			const tabEls = block.element.querySelectorAll("[role='tab']");
			const panels = block.element.querySelectorAll("[role='tabpanel']");
			expect(tabEls.length).toBeGreaterThan(0);
			expect(panels.length).toBe(tabEls.length);
			// ARIA linkage
			for (const tab of tabEls) {
				const controls = tab.getAttribute("aria-controls");
				expect(controls, `tab missing aria-controls`).toBeTruthy();
				expect(
					block.element.querySelector(`[id="${controls}"]`),
					`tabpanel ${controls} not found`,
				).toBeTruthy();
			}
		}
	});

	test("columns blocks have correct child count", () => {
		const columns = blocksByType(build.blocks, "columns");
		expect(columns.length).toBeGreaterThan(0);
		for (const block of columns) {
			const cols = block.element.querySelectorAll(".praxity-column");
			expect(cols.length, `columns ${block.id} wrong column count`).toBeGreaterThanOrEqual(2);
		}
	});

	test("sequence blocks have step structure", () => {
		const sequences = blocksByType(build.blocks, "sequence");
		expect(sequences.length).toBeGreaterThan(0);
		for (const block of sequences) {
			const steps = block.element.querySelectorAll("[data-step], .praxity-sequence-step, li");
			expect(steps.length, `sequence ${block.id} missing steps`).toBeGreaterThan(0);
		}
	});

	test("card blocks have flip structure", () => {
		const cards = blocksByType(build.blocks, "card");
		expect(cards.length).toBeGreaterThan(0);
		for (const block of cards) {
			const cardArticles = block.element.querySelectorAll(".praxity-card-island article");
			const front = block.element.querySelector(
				'.praxity-card-island article h3, .praxity-card-island article p, [data-card-side="front"]',
			);
			const back = block.element.querySelector(
				'.praxity-card-back, [data-card-back], [data-card-side="back"]',
			);
			expect(cardArticles.length, `card ${block.id} missing card items`).toBeGreaterThan(0);
			expect(front, `card ${block.id} missing front content`).toBeTruthy();
			const items = Array.isArray(block.data?.items)
				? (block.data.items as Array<{ back?: unknown[] }>)
				: [];
			if (items.some((item) => Array.isArray(item.back) && item.back.length > 0)) {
				expect(back, `card ${block.id} missing back`).toBeTruthy();
			}
		}
	});
});

describe("Block rendering — assessment blocks", () => {
	test("choice assessments render radio or checkbox inputs", () => {
		const assessments = blocksByType(build.blocks, "assessment");
		const choices = assessments.filter((b) => b.data?.assessmentType === "choice");
		expect(choices.length).toBeGreaterThan(0);
		for (const block of choices) {
			const inputs = block.element.querySelectorAll("input[type='radio'], input[type='checkbox']");
			expect(inputs.length, `assessment ${block.id} missing choice inputs`).toBeGreaterThan(0);
		}
	});

	test("choice assessment blocks have interactive form structure", () => {
		const assessments = blocksByType(build.blocks, "assessment");
		const choices = assessments.filter((b) => b.data?.assessmentType === "choice");
		expect(choices.length).toBeGreaterThan(0);
		for (const block of choices) {
			const form = block.element.querySelector("form");
			const fieldset = block.element.querySelector("fieldset");
			expect(form, `assessment ${block.id} missing form`).toBeTruthy();
			expect(fieldset, `assessment ${block.id} missing fieldset`).toBeTruthy();
		}
	});

	test("fill-blank keeps its authored sentence and renders underscore inputs", () => {
		const fillBlank = blocksByType(build.blocks, "assessment").find(
			(block) => block.data?.assessmentType === "fillBlank",
		);
		expect(fillBlank, "missing fill-blank fixture").toBeTruthy();
		expect(fillBlank?.element.textContent).toContain('The modal container should have role="');
		expect(fillBlank?.element.querySelectorAll(".praxity-fill-blank-input")).toHaveLength(2);
		expect(fillBlank?.element.textContent).not.toContain("No response configured");
	});

	test("comparison columns keep authored headings instead of preset fallbacks", () => {
		const comparison = blocksByType(build.blocks, "columns").find(
			(block) => block.data?.preset === "comparison",
		);
		expect(comparison, "missing comparison fixture").toBeTruthy();
		expect(comparison?.element.textContent).toContain("Before");
		expect(comparison?.element.textContent).toContain("After");
		expect(comparison?.element.textContent).not.toContain("Option A");
		expect(comparison?.element.textContent).not.toContain("Option B");
	});

	test("checklist blocks render checkbox items", () => {
		const checklists = blocksByType(build.blocks, "checklist");
		expect(checklists.length).toBeGreaterThan(0);
		for (const block of checklists) {
			const items = block.element.querySelectorAll("input[type='checkbox'], [role='checkbox']");
			expect(items.length, `checklist ${block.id} missing items`).toBeGreaterThan(0);
		}
	});
});

describe("Block rendering — media blocks", () => {
	test.each([
		{
			name: "YouTube watch URL",
			data: { source: { type: "url", src: "https://www.youtube.com/watch?v=3f31oufqFSM" } },
			selector: "iframe",
			expected: "https://www.youtube-nocookie.com/embed/3f31oufqFSM",
		},
		{
			name: "YouTube short URL",
			data: { source: { type: "url", src: "https://youtu.be/3f31oufqFSM" } },
			selector: "iframe",
			expected: "https://www.youtube-nocookie.com/embed/3f31oufqFSM",
		},
		{
			name: "Vimeo URL",
			data: { source: { type: "url", src: "https://vimeo.com/76979871" } },
			selector: "iframe",
			expected: "https://player.vimeo.com/video/76979871",
		},
		{
			name: "direct video URL",
			data: { source: { type: "url", src: "https://cdn.example.com/intro.mp4" } },
			selector: "video source",
			expected: "https://cdn.example.com/intro.mp4",
		},
		{
			name: "relative video asset",
			data: { source: { type: "url", src: "assets/intro.webm" } },
			selector: "video source",
			expected: "assets/intro.webm",
		},
	])("renders $name", ({ data, selector, expected }) => {
		const document = new JSDOM(renderBlockHtml({ id: "video-url", type: "video", data })).window
			.document;
		const media = document.querySelector(selector);
		expect(media?.getAttribute(media.tagName === "IFRAME" ? "data-embed-src" : "src")).toBe(
			expected,
		);
		if (media?.tagName === "IFRAME") {
			expect(media.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
		}
	});

	test("renders nothing for a mux source (not supported in v1 exports)", () => {
		const document = new JSDOM(
			renderBlockHtml({
				id: "video-mux",
				type: "video",
				data: { source: { type: "mux", playbackId: "mux-playback", assetId: "mux-asset" } },
			}),
		).window.document;
		expect(document.querySelector("iframe")).toBeNull();
		expect(document.querySelector("video")).toBeNull();
	});

	test.each(["https://example.com/watch/123", "javascript:alert(1).mp4"])(
		"rejects unsupported or unsafe video URL %s",
		(src) => {
			const document = new JSDOM(
				renderBlockHtml({
					id: "video-url",
					type: "video",
					data: { source: { type: "url", src } },
				}),
			).window.document;
			expect(document.querySelector("iframe")).toBeNull();
			expect(document.querySelector("video")).toBeNull();
		},
	);

	test.each([
		["Figma", "https://www.figma.com/embed?embed_host=share&url=https://www.figma.com/file/1"],
		["H5P", "https://tenant.h5p.com/content/123/embed"],
		["Canva", "https://www.canva.com/design/ABC/view?embed"],
		["Google Maps", "https://www.google.com/maps/embed?pb=abc"],
		["Spotify", "https://open.spotify.com/embed/track/abc"],
	])("renders the %s provider as an iframe", (_provider, src) => {
		const document = new JSDOM(
			renderBlockHtml({ id: "embed-url", type: "embed", data: { src, title: "Resource" } }),
		).window.document;
		expect(document.querySelector("iframe")?.getAttribute("data-embed-src")).toBe(src);
		expect(document.querySelector("[role='region'], section[aria-label]")).toBeNull();
	});

	test("renders a safe non-embeddable URL as an external-link fallback", () => {
		const src = "https://example.com/resource";
		const document = new JSDOM(
			renderBlockHtml({ id: "embed-url", type: "embed", data: { src, title: "Resource" } }),
		).window.document;
		expect(document.querySelector("iframe")).toBeNull();
		expect(document.querySelector(".praxity-media-fallback a")?.getAttribute("href")).toBe(src);
	});

	test.each(["javascript:alert(1)", "http://www.figma.com/embed/1", "https://praxity.io/embed/1"])(
		"rejects unsafe embed URL %s",
		(src) => {
			const html = renderBlockHtml({ id: "embed-url", type: "embed", data: { src } });
			expect(html).not.toContain("<iframe");
			expect(html).not.toContain("<a ");
		},
	);

	test("normalizes rich embeds and renders bookmark icons beside their titles", () => {
		const embedDocument = new JSDOM(
			renderBlockHtml({
				id: "embed-url",
				type: "embed",
				data: { src: "https://www.youtube.com/watch?v=3f31oufqFSM", title: "Video" },
			}),
		).window.document;
		expect(embedDocument.querySelector("iframe")?.getAttribute("data-embed-src")).toBe(
			"https://www.youtube-nocookie.com/embed/3f31oufqFSM",
		);
		expect(embedDocument.querySelector("iframe")?.getAttribute("referrerpolicy")).toBe(
			"strict-origin-when-cross-origin",
		);

		const bookmarkDocument = new JSDOM(
			renderBlockHtml({
				id: "bookmark",
				type: "embed",
				data: {
					src: "https://www.w3.org/WAI/WCAG22/quickref/",
					title: "WCAG quick reference",
					display: "bookmark",
				},
			}),
		).window.document;
		const link = bookmarkDocument.querySelector("a.praxity-document-bookmark");
		const card = bookmarkDocument.querySelector(".praxity-document-bookmark");
		const titleLink = bookmarkDocument.querySelector("a.praxity-document-bookmark-link");
		expect(link).toBeNull();
		expect(card).toBeTruthy();
		expect(titleLink?.getAttribute("target")).toBe("_blank");
		expect(titleLink?.getAttribute("rel")).toBe("noopener noreferrer");
		expect(titleLink?.querySelector(".praxity-external-icon")).toBeTruthy();
		expect(bookmarkDocument.querySelector(".praxity-document-meta")?.textContent).toBe("w3.org");
	});

	test("video blocks render iframe or video element", () => {
		const videos = blocksByType(build.blocks, "video");
		expect(videos.length).toBeGreaterThan(0);
		for (const block of videos) {
			const media = block.element.querySelector("iframe, video");
			expect(media, `video block ${block.id} missing media element`).toBeTruthy();
			if (media?.tagName === "IFRAME") {
				expect(media.getAttribute("title")).toBeTruthy();
			}
			if (typeof block.data?.transcript === "string" && block.data.transcript.trim()) {
				const transcript = block.element.querySelector(".praxity-media-transcript");
				expect(transcript, `video block ${block.id} missing transcript disclosures`).toBeTruthy();
			}
		}
	});

	test("audio blocks render controls and transcripts", () => {
		const audioBlocks = blocksByType(build.blocks, "audio");
		expect(audioBlocks.length).toBeGreaterThan(0);
		for (const block of audioBlocks) {
			expect(block.element.querySelector(".praxity-audio-card audio[controls]")).toBeTruthy();
			expect(block.element.querySelector("[role='region'], section[aria-label]")).toBeNull();
			if (typeof block.data?.transcript === "string" && block.data.transcript.trim()) {
				const transcript = block.element.querySelector(".praxity-media-transcript");
				expect(transcript, `audio block ${block.id} missing transcript disclosures`).toBeTruthy();
			}
		}
	});

	test("media blocks with transcripts render transcript disclosures", () => {
		const videoHtml = renderBlockHtml({
			id: "video-transcript",
			type: "video",
			data: {
				src: "https://example.com/video",
				title: "Video title",
				transcript: "Readable video transcript.",
			},
		} as never);
		const audioHtml = renderBlockHtml({
			id: "audio-transcript",
			type: "audio",
			data: {
				src: "https://example.com/audio.mp3",
				transcript: "Readable audio transcript.",
			},
		} as never);

		const dom = new JSDOM(`${videoHtml}${audioHtml}`);
		const transcripts = dom.window.document.querySelectorAll(".praxity-media-transcript");
		expect(transcripts).toHaveLength(2);
		expect(transcripts[0]?.textContent).toContain("Readable video transcript.");
		expect(transcripts[1]?.textContent).toContain("Readable audio transcript.");
	});

	test("chart blocks render chart data table", () => {
		const charts = blocksByType(build.blocks, "chart");
		expect(charts.length).toBeGreaterThan(0);
		for (const block of charts) {
			const table = block.element.querySelector("table.praxity-chart-data");
			expect(table, `chart block ${block.id} missing chart data table`).toBeTruthy();
			expect(table?.querySelector("caption")?.textContent?.trim()).toBeTruthy();
			expect(table?.querySelector("thead th")).toBeTruthy();
			expect(table?.querySelector("tbody tr")).toBeTruthy();
		}
	});
});

describe("Block rendering — every block type present", () => {
	const expectedTypes = [
		"text",
		"heading",
		"image",
		"video",
		"audio",
		"quote",
		"divider",
		"button",
		"note",
		"code",
		"equation",
		"table",
		"accordion",
		"tabs",
		"columns",
		"sequence",
		"card",
		"assessment",
		"checklist",
		"chart",
	];

	for (const type of expectedTypes) {
		test(`at least one "${type}" block exists in output`, () => {
			const found = blocksByType(build.blocks, type);
			expect(
				found.length,
				`no blocks of type "${type}" found — fixture may be missing it`,
			).toBeGreaterThan(0);
		});
	}
});
