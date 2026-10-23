import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
	readBlockFixture as readBlockSource,
	replayLesson,
	grammar4Starter as starterSnippet,
} from "../../../grammar/__tests__/helpers/lesson-fixture.ts";
import { renderBlockHtml } from "../render-block-html.ts";

it.each(["bookmark", "document"])("keeps new-tab title labels noninteractive (%s)", (kind) => {
	const url = "https://example.com/outer";
	const title = '<a href="https://example.com/nested">Formatted <strong>title</strong></a>';
	const dom = new JSDOM(
		renderBlockHtml({
			id: "linked-title",
			type: kind === "bookmark" ? "embed" : "document",
			data: kind === "bookmark" ? { src: url, display: "bookmark", title } : { url, title },
		}),
	);
	try {
		const link = dom.window.document.querySelector('a[target="_blank"]');
		expect(link?.getAttribute("href")).toBe(url);
		expect(link?.querySelector("strong")?.textContent).toBe("title");
		expect(link?.querySelector(".praxity-external-icon")?.getAttribute("aria-hidden")).toBe("true");
		expect(
			[...(link?.querySelectorAll(".praxity-sr-only") ?? [])]
				.map((span) => span.textContent)
				.join(" "),
		).toContain("(opens in a new tab)");
		expect(dom.window.document.querySelector('a[href="https://example.com/nested"]')).toBeNull();
	} finally {
		dom.window.close();
	}
});

it("frames only the journal's existing prompt, with its original element and id", () => {
	const data = {
		assessmentType: "textResponse",
		gradingMode: "none",
		private: true,
		stem: [{ id: "stem", type: "text", data: { content: "<p>Reflect <em>carefully</em></p>" } }],
		response: { type: "textResponse", inputType: "long" },
	};
	const render = (changes = {}) =>
		new JSDOM(
			renderBlockHtml({
				id: "journal",
				type: "assessment",
				data: { ...data, ...changes },
			} as PraxityBlock),
		).window.document;
	const doc = render();
	expect(doc.querySelectorAll("h1,h2,h3,h4,h5,h6")).toHaveLength(0);
	expect(doc.querySelector(".praxity-scene p")?.id).toBe("assessment-question-journal");
	expect(doc.querySelector(".praxity-scene em")?.textContent).toBe("carefully");
	expect(doc.querySelector(".praxity-scene-icon svg")?.getAttribute("aria-hidden")).toBe("true");
	expect(doc.querySelector(".praxity-scene-icon svg")?.getAttribute("focusable")).toBe("false");
	for (const changes of [
		{ private: false },
		{ gradingMode: "exact" },
		{ response: { type: "textResponse", inputType: "short" } },
		{ assessmentType: "choice", response: { type: "choice", options: [] } },
	])
		expect(render(changes).querySelector(".praxity-scene")).toBeNull();
});

it("renders only authored kickers, in sentence case", () => {
	const heading = {
		id: "title",
		type: "heading",
		data: { level: 2, content: "Read this", kicker: "KNOWLEDGE CHECK" },
	} as PraxityBlock;
	expect(
		new JSDOM(renderBlockHtml(heading)).window.document.querySelector(".praxity-kicker")
			?.textContent,
	).toBe("Knowledge check");
	expect(renderBlockHtml({ ...heading, data: { level: 2, content: "Read this" } })).not.toContain(
		"praxity-kicker",
	);
});

it("emits decoded French text once in published media labels", () => {
	const doc = new JSDOM(
		renderBlockHtml({
			id: "french-video",
			type: "video",
			data: {
				src: "https://www.youtube.com/watch?v=abc123",
				title: "<span>Présentation&nbsp;: l’équipe&#x202f;? &amp; réponses</span>",
			},
		} as PraxityBlock),
	).window.document;
	expect(doc.querySelector("iframe")?.title).toBe("Présentation\u00a0: l’équipe\u202f? & réponses");
});

it.each(["choose-one", "choose-many"] as const)(
	"keeps the %s action row empty before hydration without exposing an inactive submit",
	(variant) => {
		const [block] = adaptGrammarPreviewBlocks(readBlockSource(starterSnippet(variant)).blocks);
		const doc = new JSDOM(renderBlockHtml(block)).window.document;
		const actions = doc.querySelector("form > .praxity-assessment-actions");
		expect(actions?.hasAttribute("data-pending")).toBe(false);
		expect(actions?.previousElementSibling?.hasAttribute("data-assessment-feedback")).toBe(true);
		expect(actions?.textContent).toBe("");
		expect(doc.querySelector("button")).toBeNull();
	},
);

describe("legacy stemless hotspot", () => {
	it("uses the image description as group name and keeps required status", () => {
		const [block] = adaptGrammarPreviewBlocks(
			readBlockSource(`::: hotspot Controls {scored}
![Equipment controls with a valve and gauge](/assets/controls.png)
- Valve {x=30 y=40 correct}
:::
`).blocks,
		);
		block.data.stem = [];
		const doc = new JSDOM(renderBlockHtml(block)).window.document;
		expect(doc.querySelector("fieldset")?.getAttribute("aria-label")).toBe(
			"Equipment controls with a valve and gauge",
		);
		expect(doc.querySelector("fieldset")?.hasAttribute("aria-labelledby")).toBe(false);
		expect(doc.querySelector(".praxity-assessment-stem")?.textContent).toBe("Required");
		expect(doc.body.textContent).not.toMatch(/No question text|Question/);
		expect(doc.querySelectorAll("button[disabled]")).toHaveLength(1);
	});
});

describe("dialogue", () => {
	const render = (data: Record<string, unknown> | null) =>
		renderBlockHtml({ id: "d1", type: "dialogue", data } as PraxityBlock);
	it("keeps repeated speakers named inside each bubble and marks only attributed continuations", () => {
		const doc = new JSDOM(
			render({
				turns: [
					{ speaker: "Alex", name: "Alex", paragraphs: ["Hello"] },
					{ speaker: " alex ", name: "Alex", paragraphs: ["Again"] },
					{ paragraphs: ["Unattributed"] },
					{ paragraphs: ["Another unattributed turn"] },
				],
			}),
		).window.document;
		const turns = [...doc.querySelectorAll("li")];
		expect(
			turns[0].querySelector(".praxity-dialogue-bubble > .praxity-dialogue-name")?.textContent,
		).toBe("Alex");
		expect(turns[1].getAttribute("data-continuation")).toBe("true");
		expect(
			turns[1].querySelector(".praxity-dialogue-name")?.classList.contains("praxity-sr-only"),
		).toBe(true);
		expect(turns[2].hasAttribute("data-continuation")).toBe(false);
		expect(turns[3].hasAttribute("data-continuation")).toBe(false);
		expect(doc.querySelectorAll(".praxity-dialogue-bubble > .praxity-dialogue-text")).toHaveLength(
			4,
		);
	});

	it("indexes turns by their position in the source data, skipping malformed entries", () => {
		const html = render({
			turns: [
				{ speaker: "roger", name: "Roger", paragraphs: ["One"] },
				"junk",
				{ speaker: "roxanne", name: "Roxanne", paragraphs: ["Two"] },
			],
		});
		const turns = [...new JSDOM(html).window.document.querySelectorAll("li.praxity-dialogue-turn")];
		expect(turns.map((turn) => turn.getAttribute("data-turn-index"))).toEqual(["0", "2"]);
	});

	it("renders an ordered list of named turns with decorative avatars", () => {
		const html = render({
			turns: [
				{
					id: "item-0",
					speaker: "roger",
					name: "Roger",
					avatar: "assets/roger.png",
					paragraphs: ["Hi *there*"],
				},
				{ id: "item-1", speaker: "roxanne", name: "Roxanne", paragraphs: ["First", "Second"] },
				{ id: "item-2", speaker: "Roger", name: "Roger", paragraphs: ["Again"] },
			],
			caption: "At the office",
		});
		const doc = new JSDOM(html).window.document;
		expect(doc.querySelector("figure.praxity-dialogue")?.getAttribute("data-style")).toBe(
			"bubbles",
		);
		expect(doc.querySelector("figcaption")?.textContent).toBe("At the office");
		const turns = [...doc.querySelectorAll("ol > li")];
		expect(turns.map((turn) => turn.getAttribute("data-side"))).toEqual(["start", "end", "start"]);
		expect(turns[0].querySelector("bdi")?.textContent).toBe("Roger");
		expect(turns[0].querySelector("img")?.getAttribute("alt")).toBe("");
		// WebKit + VoiceOver read alt="" images inside a figure by file name without it.
		expect(turns[0].querySelector("img")?.getAttribute("role")).toBe("presentation");
		expect(doc.querySelector("ol")?.getAttribute("role")).toBe("list");
		expect(turns[0].querySelector("em")?.textContent).toBe("there");
		expect(turns[1].querySelectorAll(".praxity-dialogue-text p")).toHaveLength(2);
		expect(doc.querySelector("[aria-live]")).toBeNull();
	});

	it("omits an image for a mixed-case avatar none sentinel", () => {
		const html = render({
			turns: [{ speaker: "Roger", name: "Roger", avatar: "NoNe", paragraphs: ["Hi"] }],
		});
		expect(html).not.toMatch(/<img\b/u);
		expect(html).toContain("<bdi>Roger</bdi>");
	});

	it("uses the first attributed speaker to choose sides", () => {
		const doc = new JSDOM(
			render({
				turns: [
					{ speaker: "", paragraphs: ["Unattributed"] },
					{ speaker: "roger", paragraphs: ["First"] },
					{ speaker: "roxanne", paragraphs: ["Reply"] },
					{ speaker: "roger", paragraphs: ["Again"] },
				],
			}),
		).window.document;
		expect(
			[...doc.querySelectorAll(".praxity-dialogue-turn")].map((turn) =>
				turn.getAttribute("data-side"),
			),
		).toEqual(["start", "start", "end", "start"]);
	});

	it("honors a resolved side and ignores malformed persisted sides", () => {
		const doc = new JSDOM(
			render({
				turns: [
					{ speaker: "learner", side: "end", paragraphs: ["First"] },
					{ speaker: "coach", side: "left", paragraphs: ["Reply"] },
				],
			}),
		).window.document;
		expect(
			[...doc.querySelectorAll(".praxity-dialogue-turn")].map((turn) =>
				turn.getAttribute("data-side"),
			),
		).toEqual(["end", "end"]);
	});

	it("escapes names, sanitizes text and survives malformed data", () => {
		const html = render({
			turns: [
				{
					speaker: "x",
					name: "<img src=x onerror=alert(1)>",
					avatar: "javascript:alert(1)",
					paragraphs: ["<script>bad()</script>ok"],
				},
				{ speaker: "roger", name: "<b></b>", paragraphs: ["Next"] },
				{ speaker: "roxanne", name: "   ", paragraphs: ["Reply"] },
				"junk",
				{ paragraphs: "nope" },
			],
			speakers: "not a map",
			style: "script",
		});
		expect(html).not.toContain("<script");
		expect(html).not.toContain("onerror=");
		expect(html).toContain('data-style="script"');
		const turns = new JSDOM(html).window.document.querySelectorAll(".praxity-dialogue-turn");
		expect(turns).toHaveLength(3);
		expect(turns[0].querySelector("img")).toBeNull();
		expect(turns[0].querySelector("bdi")?.textContent).toBe("x");
		expect(turns[1].querySelector("bdi")?.textContent).toBe("roger");
		expect(turns[2].querySelector("bdi")?.textContent).toBe("roxanne");
		expect(render({ turns: "nope" })).toContain("praxity-dialogue");
	});

	it("renders an empty figure when persisted data is null", () => {
		const doc = new JSDOM(render(null)).window.document;
		expect(doc.querySelector("figure.praxity-dialogue")?.getAttribute("data-style")).toBe(
			"bubbles",
		);
		expect(doc.querySelector("ol.praxity-dialogue-turns")?.children).toHaveLength(0);
	});

	it("hides delivery cues and skips turns without string paragraphs", () => {
		const doc = new JSDOM(
			render({
				turns: [
					{ speaker: "Alex", paragraphs: ["[warm] Hello *there*", "[sighs] Again \\[warm]"] },
					{ speaker: "Ghost", paragraphs: [42, null] },
				],
			}),
		).window.document;
		expect(doc.querySelectorAll("ol > li")).toHaveLength(1);
		expect(doc.querySelector(".praxity-dialogue-text")?.textContent).toBe(
			" Hello there[sighs] Again [warm]",
		);
	});
});

describe("metadata-only blocks", () => {
	it("keeps a variable runtime anchor without learner-facing declaration text", () => {
		const html = renderBlockHtml({
			id: "variable-1",
			type: "variable",
			data: {
				variableName: "attempts",
				dataType: "number",
				source: "manual",
				defaultValue: 0,
			},
		} as PraxityBlock);

		expect(html).toContain('data-block-type="variable"');
		expect(html).toMatch(/data-block-type="variable"[^>]*><\/div>$/);
		expect(html).not.toContain("attempts");
	});

	it("omits page and block break metadata from learner HTML", () => {
		for (const type of ["pageBreak", "blockBreak"] as const) {
			expect(renderBlockHtml({ id: type, type, data: {} } as PraxityBlock)).toBe("");
		}
	});

	it("renders resource entries without the React viewer", () => {
		const html = renderBlockHtml({
			id: "guide",
			type: "resourceEntry",
			data: {
				title: "Author guide",
				description: "Read before facilitation",
				resourceType: "link",
				url: "https://example.com/guide.pdf",
				includeInResourcesPage: true,
			},
		} as PraxityBlock);

		expect(html).toContain("Author guide");
		expect(html).toContain("Read before facilitation");
		expect(html).toContain('href="https://example.com/guide.pdf"');
		expect(html).toContain('target="_blank" rel="noopener noreferrer"');
		expect(html).toContain("Open link (PDF)");
		expect(html).toContain('<span class="praxity-sr-only">: Author guide</span>');
		expect(html).toContain("opens in a new tab");
		const localized = renderBlockHtml(
			{
				id: "guide-fr",
				type: "resourceEntry",
				data: {
					title: '<a href="https://nested.example">Guide de l’auteur</a>',
					resourceType: "link",
					url: "/guide.pdf",
					includeInResourcesPage: true,
				},
			} as PraxityBlock,
			{
				strings: {
					resourceOpenLink: "Ouvrir le lien",
					opensInNewTab: "(s’ouvre dans un nouvel onglet)",
				},
			},
		);
		expect(localized).toContain("Ouvrir le lien");
		expect(localized).toContain('<span class="praxity-sr-only">: Guide de l’auteur</span>');
		expect(localized).toContain("ouvre dans un nouvel onglet");
		expect(localized).not.toContain('praxity-sr-only">: <a');
	});

	it("keeps excluded resource entries learner-invisible", () => {
		expect(
			renderBlockHtml({
				id: "internal",
				type: "resourceEntry",
				data: {
					title: "Internal",
					resourceType: "link",
					url: "https://example.com/internal",
					includeInResourcesPage: false,
				},
			} as PraxityBlock),
		).not.toContain("Internal");
	});
});

describe("page action buttons", () => {
	it("renders a keyboard-native action control without inventing an href", () => {
		const html = renderBlockHtml({
			id: "continue",
			type: "button",
			data: {
				text: "<strong>Continue</strong><script>bad()</script>",
				variant: "outline",
				action: "goToPage",
				targetPageId: 'page-two" autofocus="true',
			},
		} as PraxityBlock);

		expect(html).toContain('<button type="button" class="praxity-button"');
		expect(html).toContain('data-action="goToPage"');
		expect(html).toContain('data-variant="outline"');
		expect(html).toContain('data-target-page="page-two&quot; autofocus=&quot;true"');
		expect(html).toContain("<strong>Continue</strong>");
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("href=");
	});
});

describe("code blocks", () => {
	it("preserves source rows without adding preformatted whitespace between them", () => {
		const source = 'const answer = 42;\n\n\tconsole.log("<safe>");\n';
		const doc = new JSDOM(
			renderBlockHtml({
				id: "spacing",
				type: "code",
				data: { code: source, language: "javascript", startLine: 4, highlightLines: [6] },
			} as PraxityBlock),
		).window.document;
		const content = doc.querySelector("[data-code-content]");
		expect(
			Array.from(content?.childNodes ?? [])
				.filter((node) => node.nodeType === 3)
				.map((node) => node.textContent),
		).toEqual([]);
		expect(
			Array.from(doc.querySelectorAll("[data-code-line]"), (line) => line.textContent),
		).toEqual(["const answer = 42;", "", '\tconsole.log("<safe>");', ""]);
		expect(
			Array.from(doc.querySelectorAll(".praxity-code-line-number"), (line) => line.textContent),
		).toEqual(["4", "5", "6", "7"]);
		expect(doc.querySelector(".praxity-code-line--highlighted [data-code-line]")?.textContent).toBe(
			'\tconsole.log("<safe>");',
		);
		expect(doc.querySelector("safe")).toBeNull();
	});
	it("server-renders readable code and a native copy control", () => {
		const html = renderBlockHtml(
			{
				id: "example",
				type: "code",
				data: {
					title: "Example",
					language: "javascript",
					code: "const answer = 42;\nanswer;",
					startLine: 4,
					highlightLines: [5],
				},
			} as PraxityBlock,
			{ enabledIslands: new Set(["code"]) },
		);

		expect(html).toContain('data-island="code"');
		expect(html).toContain('aria-label="Copy code to clipboard"');
		expect(html.replace(/<[^>]+>/g, "")).toContain("const answer = 42;");
		expect(html).toContain(">4</span>");
		expect(html).toContain(">JavaScript</span>");
		expect(html).toContain('class="praxity-code-token token keyword"');
		expect(html).toContain("--praxity-code-token-dark-color:");
		expect(html).toContain('class="praxity-code-line praxity-code-line--highlighted"');
		expect(html).not.toContain("data-block-json");
	});
});

describe("sequence blocks", () => {
	it("renders vertical alignment, markers, and nested blocks within normal width", () => {
		const html = renderBlockHtml({
			id: "process",
			type: "sequence",
			data: {
				variant: "numbered",
				orientation: "vertical",
				alignment: "center",
				items: ["Plan", "Build", "Test", "Ship"].map((label, index) => ({
					id: `step-${index}`,
					label,
					children: [{ id: `body-${index}`, type: "text", data: { content: label } }],
				})),
			},
		} as unknown as PraxityBlock);

		expect(html).toContain('data-orientation="vertical"');
		expect(html).toContain('data-alignment="center"');
		expect(html).toContain('data-distribution="uniform"');
		expect(html).toContain('class="praxity-sequence-frame"');
		expect(html).not.toContain("praxity-layout-wide");
		expect(html.match(/class="praxity-accent-badge"/g)).toHaveLength(4);
		expect(html).toContain('data-block-id="body-3"');
		expect(html).toContain('aria-label="Steps: Plan – Ship"');
	});

	it("keeps scaled spacing and a keyboard-reachable native scroll viewport", () => {
		const html = renderBlockHtml(
			{
				id: "timeline",
				type: "sequence",
				data: {
					variant: "timeline",
					orientation: "horizontal",
					distribution: "scaled",
					scrollable: true,
					items: ["2000", "2001", "2010"].map((label) => ({ id: label, label, children: [] })),
				},
			} as unknown as PraxityBlock,
			{
				enabledIslands: new Set(["sequence"]),
				strings: { sequenceScrollRegion: "Chronologie défilante" },
			},
		);

		expect(html).toContain('data-island="sequence"');
		expect(html).toContain('data-orientation="horizontal"');
		expect(html).toContain('data-distribution="scaled"');
		expect(html).toContain('aria-label="Chronologie défilante" tabindex="0"');
		expect(html).toContain('data-label-position="above"');
		expect(html).toContain("--praxity-sequence-column:101");
		expect(html).toContain("--praxity-sequence-gap-before:");
		expect(html).toContain("--praxity-sequence-gap-after:");
		expect(html).toContain('data-sequence-scroll="start"');
		expect(html).toContain('data-sequence-scroll="end"');
		expect(html).not.toContain("praxity-layout-wide");
	});

	it("renders a localized empty state", () => {
		const html = renderBlockHtml(
			{ id: "empty", type: "sequence", data: { items: [] } } as unknown as PraxityBlock,
			{ strings: { sequenceEmpty: "Aucune étape" } },
		);
		expect(html).toContain('class="praxity-sequence-empty praxity-text-light"');
		expect(html).toContain("Aucune étape");
		expect(html).not.toContain("<ol");
	});
});

describe("container labels", () => {
	it("renders a localized assessment group header for the native island", () => {
		const html = renderBlockHtml(
			{
				id: "checkpoint",
				type: "assessmentGroup",
				data: {
					groupName: "**Safety** <img src=x onerror=bad()>",
					mode: "all",
					memberBlockIds: ["q1", "q2"],
					passingScore: 80,
					pointsOverride: 5,
					headingOffset: 1,
				},
			} as PraxityBlock,
			{
				enabledIslands: new Set(["assessmentGroup"]),
				assessmentGroupMembers: [
					{
						id: "q1",
						type: "assessment",
						data: { assessmentType: "choice", gradingMode: "exact" },
					} as PraxityBlock,
					{
						id: "q2",
						type: "assessment",
						data: { assessmentType: "textResponse", gradingMode: "none" },
					} as PraxityBlock,
				],
				strings: {
					assessmentGroupProgress: "Questions terminées : {completed} sur {total}",
					assessmentGroupPassingScore: "Score de réussite : {score} %",
					assessmentPoints: "{points} points",
				},
			},
		);

		expect(html).toContain('data-island="assessmentGroup"');
		expect(html).not.toContain("data-block-json");
		expect(html).toContain('role="group"');
		expect(html).toContain("<h3");
		expect(html).toContain("<strong>Safety</strong>");
		expect(html).not.toContain("onerror");
		expect(html).toContain("Questions terminées : 0 sur 2");
		expect(html).toContain("Score de réussite : 80 %");
		expect(html).toContain("5 points");
		expect(html).toContain(
			'aria-labelledby="assessment-group-title-checkpoint assessment-group-progress-checkpoint assessment-group-passing-score-checkpoint assessment-group-points-checkpoint"',
		);
	});

	it("omits the quiz counter for a published reflection group", () => {
		const html = renderBlockHtml(
			{
				id: "journal",
				type: "assessmentGroup",
				data: { groupName: "Journal", memberBlockIds: ["reflection", "plan"] },
			} as PraxityBlock,
			{
				assessmentGroupMembers: ["reflection", "plan"].map((id) => ({
					id,
					type: "assessment",
					data: { assessmentType: "textResponse", gradingMode: "none" },
				})) as PraxityBlock[],
			},
		);
		expect(html).not.toContain("Questions completed");
		expect(html).not.toContain("data-assessment-group-progress");
		expect(html).toContain('aria-labelledby="assessment-group-title-journal"');
	});

	it("renders readable accordion fallback with heading-wrapped disclosure buttons and tab shells", () => {
		const accordion = renderBlockHtml({
			id: "accordion-1",
			type: "accordion",
			data: {
				items: [{ id: "one", label: "First", children: [] }],
				allowMultipleOpen: false,
			},
		} as unknown as PraxityBlock);
		const tabs = renderBlockHtml({
			id: "tabs-1",
			type: "tabs",
			data: {
				items: [
					{ id: "one", label: "First", children: [] },
					{ id: "two", label: "Second", children: [] },
				],
			},
		} as unknown as PraxityBlock);

		const doc = new JSDOM(accordion).window.document;
		expect(doc.querySelector("details, summary")).toBeNull();
		const button = doc.querySelector("h3 > button");
		expect(button?.id).toBe("accordion-1-summary-one");
		expect(button?.getAttribute("aria-expanded")).toBe("true");
		expect(button?.getAttribute("aria-controls")).toBe("accordion-1-panel-one");
		expect(button?.hasAttribute("hidden")).toBe(true);
		expect(button?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
		expect(doc.querySelector(".praxity-accordion-panel")?.hasAttribute("hidden")).toBe(false);
		expect(doc.querySelector("[data-disclosure-label]")?.textContent).toBe("First");
		expect(accordion).toContain('role="region" aria-labelledby=');
		expect(tabs).toContain('class="praxity-tabs-list" role="tablist"');
		expect(tabs).toContain('aria-selected="true" tabindex="0"');
		expect(tabs).toContain('aria-selected="false" tabindex="-1"');
		expect(tabs).toContain('role="tabpanel"');
	});

	it.each(["audio", "video"])("renders a readable %s transcript before enhancement", (type) => {
		const doc = new JSDOM(
			renderBlockHtml(
				{
					id: "media-one",
					type,
					data: {
						src: "assets/media.mp4",
						transcript: "<p>Spoken words</p><script>alert(1)</script>",
					},
				} as PraxityBlock,
				{ strings: { viewTranscript: "Voir la transcription" } },
			),
		).window.document;
		const transcript = doc.querySelector(".praxity-media-transcript");
		expect(transcript?.tagName).toBe("DIV");
		const button = transcript?.querySelector("h3 > button");
		expect(transcript?.querySelector("[data-disclosure-label]")?.textContent).toBe(
			"Voir la transcription",
		);
		expect(button?.hasAttribute("hidden")).toBe(true);
		expect(button?.getAttribute("aria-expanded")).toBe("true");
		const panel = doc.getElementById(button?.getAttribute("aria-controls") ?? "");
		expect(panel?.hasAttribute("hidden")).toBe(false);
		expect(panel?.textContent).toBe("Spoken words");
		expect(transcript?.querySelector("script")).toBeNull();
	});

	it("renders inline Prax markup in static card titles", () => {
		const html = renderBlockHtml({
			id: "card-1",
			type: "card",
			data: {
				items: [
					{
						id: "item-1",
						label: "@highlight{Scenario}",
						front: [],
						back: [],
					},
				],
			},
		} as unknown as PraxityBlock);

		expect(html).toContain('data-doodle="highlight"');
		expect(html).not.toContain("@highlight");
	});

	it.each(["none", "outline", "filled"])(
		"preserves card heading semantics and %s header spacing",
		(style) => {
			const block = {
				id: "card-1",
				type: "card",
				data: {
					style,
					items: [{ id: "item-1", label: "Question", headingLevel: 2, front: [], back: [] }],
				},
			} as unknown as PraxityBlock;

			const headerClass =
				style === "none" ? "praxity-card-header--minimal" : "praxity-card-header--outline";
			expect(renderBlockHtml(block)).toContain(`<h2 class="${headerClass}">Question</h2>`);
			block.data.headings = false;
			expect(renderBlockHtml(block)).toContain(
				`<div class="praxity-card-label ${headerClass}">Question</div>`,
			);
		},
	);

	it("renders a distinct card group title at its authored level", () => {
		const html = renderBlockHtml({
			id: "card-1",
			type: "card",
			data: {
				title: "Four key questions",
				_headingLevel: 2,
				items: [{ id: "item-1", label: "Question", headingLevel: 3, front: [], back: [] }],
			},
		} as unknown as PraxityBlock);

		expect(html).toContain("<h2");
		expect(html).toContain("Four key questions</h2>");
		expect(html).toContain('<h3 class="praxity-card-header--minimal">Question</h3>');
	});
});

describe("image comparison", () => {
	const data = {
		beforeImage: {
			src: "/assets/before.png",
			altText: "Before state",
			intrinsicWidth: 1200,
			intrinsicHeight: 800,
			loading: "eager",
			fetchPriority: "high",
		},
		afterImage: {
			src: "/assets/after.png",
			altText: "After state",
			intrinsicWidth: 1200,
			intrinsicHeight: 800,
			loading: "lazy",
		},
		beforeLabel: "Original",
		afterLabel: "Revised",
		beforeCaption: "Before caption",
		afterCaption: "After caption",
	};

	it.each(["side-by-side", "slider"])(
		"preserves comparison alt aliases in %s output",
		(display) => {
			const doc = new JSDOM(
				renderBlockHtml({
					id: "comparison-alias",
					type: "imageComparison",
					data: {
						display,
						beforeImage: { src: "/before.png", alt: "Before & after training" },
						afterImage: {
							src: "/after.png",
							alt: "Alias description",
							altText: "Preferred description",
						},
					},
				}),
			).window.document;
			expect(doc.querySelector('img[src="/before.png"]')?.getAttribute("alt")).toBe(
				"Before & after training",
			);
			expect(doc.querySelector('img[src="/after.png"]')?.getAttribute("alt")).toBe(
				"Preferred description",
			);
		},
	);

	it("renders side-by-side images and captions without an interactive control", () => {
		const html = renderBlockHtml({
			id: "comparison",
			type: "imageComparison",
			data: { ...data, display: "side-by-side" },
		} as unknown as PraxityBlock);

		expect(html).toContain('class="praxity-image-comparison-grid"');
		expect(html).toContain('alt="Before state" width="1200" height="800" loading="eager"');
		expect(html).toContain('fetchpriority="high"');
		expect(html).toContain("Before caption");
		expect(html).toContain("After caption");
		expect(html).not.toContain('type="range"');
	});

	it("renders the complete slider state before its island loads", () => {
		const html = renderBlockHtml(
			{
				id: "comparison",
				type: "imageComparison",
				data: { ...data, display: "slider" },
			} as unknown as PraxityBlock,
			{ strings: { imageComparisonSlider: "Compare the two images" } },
		);

		expect(html).toContain('style="--praxity-comparison-position:50%"');
		expect(html).toContain('type="range" min="0" max="100" step="2" value="50"');
		expect(html).toContain('aria-label="Compare the two images"');
		expect(html).toContain('aria-valuenow="50"');
		expect(html).toContain('aria-valuetext="50% Original, 50% Revised"');
		expect(html).toContain("Before caption · After caption");
		expect(html.match(/<img /g)).toHaveLength(2);
	});
});

/**
 * This markup is the pre-hydration shell: the React viewer owns answering,
 * submitting, feedback and scoring. Shipped with live inputs it was a form a
 * learner could fill in that could never be submitted — no submit control, no
 * feedback, answers gone at the next page.
 */
describe("static assessment shell", () => {
	const choiceBlock = {
		id: "blk1",
		type: "assessment",
		data: {
			assessmentType: "choice",
			stem: [{ type: "text", data: { content: "<p>Pick one</p>" } }],
			response: {
				type: "choice",
				selectionMode: "single",
				options: [
					{ id: "a", label: "First", isCorrect: true },
					{ id: "b", label: "Second" },
				],
			},
		},
	} as unknown as PraxityBlock;

	it("keeps rich stem instructions outside the question paragraph", () => {
		const block = structuredClone(choiceBlock);
		block.data.stem = [
			{
				type: "text",
				data: {
					content:
						"<p>Pick <em>one</em></p><p>Review the choices.</p><ul><li>Keep this list.</li></ul>",
				},
			},
		];
		const html = renderBlockHtml(block);
		expect(html).toContain(
			'<span class="praxity-assessment-stem-content">Pick <em>one</em></span></p>',
		);
		expect(html).toContain(
			'<div class="praxity-assessment-stem-body"><p>Review the choices.</p><ul><li>Keep this list.</li></ul></div>',
		);
	});

	it("retains each authored supporting paragraph ID for canvas mapping", () => {
		const block = structuredClone(choiceBlock);
		block.data.description = [
			{ id: "prompt-one", type: "text", data: { content: "<p>Choose <em>one</em>.</p>" } },
			{ id: "prompt-two", type: "text", data: { content: "<p>Read carefully.</p>" } },
		];
		const doc = new JSDOM(renderBlockHtml(block)).window.document;
		expect(doc.querySelector('[data-node-id="prompt-one"] > p')?.innerHTML).toBe(
			"Choose <em>one</em>.",
		);
		expect(doc.querySelector('[data-node-id="prompt-two"] > p')?.textContent).toBe(
			"Read carefully.",
		);
		expect(doc.querySelectorAll("input")).toHaveLength(3);
	});

	it.each([undefined, { type: "fillBlank", blanks: [], template: "" }])(
		"preserves rich stem content with incomplete response %s",
		(response) => {
			const html = renderBlockHtml({
				...choiceBlock,
				data: {
					...choiceBlock.data,
					assessmentType: "fillBlank",
					response,
					stem: [
						{
							type: "text",
							data: {
								content:
									"<p>Question title</p><p>Keep instructions.</p><ul><li>Keep list.</li></ul>",
							},
						},
					],
				},
			});
			expect(html).toContain("Question title");
			expect(html).toContain("<p>Keep instructions.</p><ul><li>Keep list.</li></ul>");
		},
	);

	it("exposes required choice status without native constraint invalidity", () => {
		const block = structuredClone(choiceBlock);
		block.data.gradingMode = "exact";
		const document = new JSDOM(renderBlockHtml(block)).window.document;
		expect(document.querySelector("input[required]")).toBeNull();
		expect(document.querySelector('[role="radiogroup"]')?.getAttribute("aria-required")).toBe(
			"true",
		);
	});

	it.each(["stars", "emoji", "numeric", "likert", "slider"])(
		"required %s ratings are not natively invalid",
		(style) => {
			const document = new JSDOM(
				renderBlockHtml({
					id: "rating",
					type: "rating",
					data: { label: "Rating", required: true, maxValue: 3, style },
				} as PraxityBlock),
			).window.document;
			expect(document.querySelector("input[required], input:invalid")).toBeNull();
			expect(document.querySelector("legend")?.textContent).toContain("Required");
			if (style !== "slider")
				expect(document.querySelector('[role="radiogroup"]')?.getAttribute("aria-required")).toBe(
					"true",
				);
		},
	);

	it("ships its inputs inert, because nothing can act on them yet", () => {
		const inputs = renderBlockHtml(choiceBlock).match(/<input[^>]*>/g) ?? [];
		expect(inputs).toHaveLength(3);
		expect(inputs.at(-1)).toContain('value="dont-know"');
		for (const input of inputs) expect(input).toContain("disabled");
	});

	it("says why, for a learner without scripting", () => {
		const html = renderBlockHtml(choiceBlock);
		expect(html).toContain("<noscript>");
		expect(html).toContain("needs JavaScript");
	});

	it("still labels the group with the question", () => {
		const document = new JSDOM(renderBlockHtml(choiceBlock)).window.document;
		const stem = document.querySelector("p.praxity-assessment-stem");
		expect(stem?.id).toBe("assessment-question-blk1");
		expect(stem?.querySelector("p")).toBeNull();
		expect(document.querySelector("fieldset")?.getAttribute("aria-labelledby")).toBe(stem?.id);
	});

	it("renders inline Prax markup in choice labels", () => {
		const block = structuredClone(choiceBlock);
		(block.data as { response: { options: Array<{ label: string }> } }).response.options[0].label =
			"@highlight.red{First}";
		const html = renderBlockHtml(block);

		expect(html).toContain('data-doodle="highlight" data-doodle-mods="red"');
		expect(html).not.toContain("@highlight.red");
	});

	it("renders fill-blank prose and one inert input per marker", () => {
		const html = renderBlockHtml({
			id: "fill",
			type: "assessment",
			data: {
				assessmentType: "fillBlank",
				stem: [{ type: "text", data: { content: "<p>Finish it</p>" } }],
				response: {
					type: "fillBlank",
					template: "I feel ____. I will ____.",
					blanks: [
						{ id: "one", answer: "" },
						{ id: "two", answer: "" },
					],
				},
			},
		} as unknown as PraxityBlock);
		expect(html.replace(/<[^>]+>/g, "")).toContain("I feel ");
		expect(html.match(/praxity-fill-blank-input/g)).toHaveLength(2);
		expect(html.match(/praxity-fill-blank-unit/g)).toHaveLength(2);
		expect(html).toContain("Blank 1 of 2, after “I feel”");
		expect(html).toContain('size="12"');
	});

	it("keeps the authored prompt when response configuration is absent", () => {
		const html = renderBlockHtml({
			id: "missing",
			type: "assessment",
			data: {
				assessmentType: "fillBlank",
				stem: [{ type: "text", data: { content: "<p>Authored prompt</p>" } }],
			},
		} as unknown as PraxityBlock);
		expect(html).toContain("Authored prompt");
		expect(html).not.toContain("No response configured");
	});
});

/**
 * A media block used to append `<h3 class="praxity-sr-only">Continue after
 * video</h3>`. It put a phantom section in the heading outline with nothing
 * under it — on a page whose first real section was an h2, a screen-reader user
 * browsing by heading hit an h3 between the page title and the first section.
 * The block is already a labelled region, which is what AT navigates past, and
 * the string was hardcoded English with no French entry.
 *
 * The register in `.claude/skills/a11y` records "every media embed needs a
 * following heading" as refuted: 2.4.1 asks for a mechanism to bypass repeated
 * blocks, not this technique.
 */
describe("media blocks and the heading outline", () => {
	it("renders Markdown links in image captions", () => {
		const html = renderBlockHtml({
			id: "image",
			type: "image",
			data: {
				src: "/assets/image.png",
				altText: "Test image",
				caption: "Photograph by [Mira Vale on Unsplash](https://unsplash.com/photos/demo-star-07)",
			},
		} as unknown as PraxityBlock);
		expect(html).toContain(
			'<a href="https://unsplash.com/photos/demo-star-07">Mira Vale on Unsplash</a>',
		);
	});

	it("hides decorative images from assistive technology", () => {
		const render = (decorative: boolean) =>
			new JSDOM(
				renderBlockHtml({
					id: "image",
					type: "image",
					data: { src: "/assets/image.png", altText: "A chart", decorative },
				} as unknown as PraxityBlock),
			).window.document.querySelector("figure img");
		// WebKit + VoiceOver read alt="" images inside a figure by file name.
		expect(render(true)?.getAttribute("alt")).toBe("");
		expect(render(true)?.getAttribute("role")).toBe("presentation");
		expect(render(false)?.getAttribute("alt")).toBe("A chart");
		expect(render(false)?.hasAttribute("role")).toBe(false);
	});

	it("emits intrinsic image dimensions and eager priority metadata", () => {
		const html = renderBlockHtml({
			id: "image",
			type: "image",
			data: {
				src: "/assets/image.png",
				altText: "Test image",
				intrinsicWidth: 1200,
				intrinsicHeight: 675,
				loading: "eager",
				fetchPriority: "high",
			},
		} as unknown as PraxityBlock);
		expect(html).toContain('width="1200" height="675" loading="eager" fetchpriority="high"');
	});

	it("renders a sized hero cover without a client runtime", () => {
		const html = renderBlockHtml({
			id: "hero",
			type: "heroCover",
			data: {
				imageSrc: "/assets/hero.webp",
				imageAlt: "A skyline",
				title: "Welcome",
				intrinsicWidth: 1600,
				intrinsicHeight: 900,
				loading: "eager",
				fetchPriority: "high",
			},
		} as unknown as PraxityBlock);
		expect(html).toContain('width="1600" height="900" loading="eager" fetchpriority="high"');
		expect(html).toContain('<h1 class="praxity-hero-cover-title">Welcome</h1>');
	});

	it("renders accessible math instead of raw LaTeX delimiters", () => {
		const html = renderBlockHtml({
			id: "equation",
			type: "equation",
			data: { latex: "x^2 + y^2 = z^2" },
		} as unknown as PraxityBlock);
		expect(html).toContain('role="math"');
		expect(html).toContain("katex");
		const doc = new JSDOM(html).window.document;
		expect(doc.querySelectorAll("math")).toHaveLength(1);
		expect(doc.querySelectorAll(".katex-html")).toHaveLength(0);
		expect(html).not.toContain("$$");
	});

	it("preserves authored YouTube metadata and the click facade", () => {
		const html = renderBlockHtml({
			id: "vid",
			type: "video",
			data: {
				src: "https://www.youtube.com/watch?v=abc123",
				title: "<em>A video</em>",
				caption: "A <strong>useful</strong> caption<script>bad()</script>",
				startTime: 5,
				endTime: 45,
			},
		} as unknown as PraxityBlock);
		expect(html).toContain("<iframe");
		expect(html).toContain("www.youtube-nocookie.com/embed/abc123?start=5&amp;end=45");
		expect(html).toContain("srcdoc=");
		expect(html).toContain("i.ytimg.com/vi/abc123/hqdefault.jpg");
		expect(html).toContain('loading="lazy"');
		expect(html).toContain('width="1280" height="720"');
		expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-presentation"');
		expect(html).toContain('<h3 class="praxity-block-title"><em>A video</em></h3>');
		expect(html).toContain(
			'<p class="praxity-block-caption">A <strong>useful</strong> caption</p>',
		);
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("Continue after");
	});

	it("preserves direct media tracks, clip metadata, source, and autoplay", () => {
		const nonAutoplayVideo = renderBlockHtml({
			id: "direct-video-no-autoplay",
			type: "video",
			data: { source: { type: "url", src: "assets/lesson.mp4" } },
		} as unknown as PraxityBlock);
		expect(nonAutoplayVideo).toContain('<video controls preload="metadata" playsinline');
		expect(nonAutoplayVideo).not.toContain(" autoplay");

		const video = renderBlockHtml(
			{
				id: "direct-video",
				type: "video",
				data: {
					source: { type: "url", src: "assets/lesson.mp4" },
					title: "Lesson",
					caption: "Watch closely",
					autoplay: true,
					startTime: 2.5,
					endTime: 9,
					captionTracks: [
						{
							kind: "captions",
							language: "en",
							label: "English",
							src: "assets/captions.vtt",
							default: true,
						},
						{
							kind: "descriptions",
							language: "en",
							label: "Audio description",
							src: "assets/descriptions.vtt",
						},
					],
				},
			} as unknown as PraxityBlock,
			{ enabledIslands: new Set(["media"]) },
		);
		expect(video).toContain('data-island="media"');
		expect(video).toContain('<video controls preload="auto" playsinline');
		expect(video).toContain(" autoplay");
		expect(video).toContain('<source src="assets/lesson.mp4" />');
		expect(video).toContain('data-start-time="2.5" data-end-time="9"');
		expect(video).toContain(
			'<track kind="captions" src="assets/captions.vtt" srclang="en" label="English" default />',
		);
		expect(video).toContain(
			'<track kind="descriptions" src="assets/descriptions.vtt" srclang="en" label="Audio description" />',
		);

		const audio = renderBlockHtml({
			id: "audio",
			type: "audio",
			data: {
				src: "assets/narration.mp3",
				title: "Narration",
				caption: "Listen to the example",
				autoplay: true,
				captionTracks: [
					{
						kind: "descriptions",
						language: "en",
						label: "Described audio",
						src: "assets/audio-description.vtt",
					},
				],
			},
		} as unknown as PraxityBlock);
		expect(audio).toContain('<h3 class="praxity-block-title">Narration</h3>');
		expect(audio).toContain('<audio controls preload="auto"');
		expect(audio).toContain(" autoplay");
		expect(audio).toContain('kind="descriptions"');
		expect(audio).toContain('<p class="praxity-block-caption">Listen to the example</p>');
		expect(audio).toContain('href="assets/narration.mp3" download');
		expect(audio).not.toContain('target="_blank"');

		const externalAudio = renderBlockHtml({
			id: "external-audio",
			type: "audio",
			data: { src: "https://media.example/narration.mp3" },
		} as unknown as PraxityBlock);
		expect(externalAudio).toContain('target="_blank" rel="noopener noreferrer"');
		expect(externalAudio).not.toContain(" download");
	});

	it("marks local document files as downloads and HTTPS documents as external", () => {
		const local = renderBlockHtml({
			id: "document-local",
			type: "document",
			data: { url: "assets/guide.pdf", title: "Guide", filename: "guide.pdf" },
		} as unknown as PraxityBlock);
		expect(local).toContain('href="assets/guide.pdf" download="guide.pdf"');
		expect(local).not.toContain('target="_blank"');

		const external = renderBlockHtml({
			id: "document-external",
			type: "document",
			data: { url: "https://example.com/guide", title: "Guide" },
		} as unknown as PraxityBlock);
		expect(external).toContain('target="_blank" rel="noopener noreferrer"');
		expect(external).toContain("praxity-external-icon");
	});

	it("honors autoplay in YouTube and Vimeo embeds without a YouTube facade", () => {
		const youtube = renderBlockHtml({
			id: "youtube",
			type: "video",
			data: {
				src: "https://youtu.be/abc123",
				autoplay: true,
				start: 3,
				end: 12,
			},
		} as unknown as PraxityBlock);
		expect(youtube).toContain(
			"www.youtube-nocookie.com/embed/abc123?start=3&amp;end=12&amp;autoplay=1",
		);
		expect(youtube).toContain('loading="eager"');
		expect(youtube).not.toContain("srcdoc=");

		const vimeo = renderBlockHtml(
			{
				id: "vimeo",
				type: "video",
				data: {
					src: "https://vimeo.com/123456",
					autoplay: true,
					startTime: 4,
					endTime: 20,
				},
			} as unknown as PraxityBlock,
			{ enabledIslands: new Set(["media"]) },
		);
		expect(vimeo).toContain("player.vimeo.com/video/123456?autoplay=1");
		expect(vimeo).toContain('data-island="media"');
		expect(vimeo).toContain('data-media-provider="vimeo" data-start-time="4"');
	});

	it("leaves responsive embed width to CSS and keeps an authored pixel width", () => {
		const block = {
			id: "embed",
			type: "embed",
			data: { src: "https://www.youtube.com/embed/abc123" },
		} as unknown as PraxityBlock;
		expect(renderBlockHtml(block)).not.toContain('title="Document" width=');
		expect(renderBlockHtml(block)).toContain("www.youtube-nocookie.com/embed/abc123");
		expect(renderBlockHtml(block)).toContain("srcdoc=");
		expect(renderBlockHtml(block)).toContain('loading="lazy"');
		expect(renderBlockHtml({ ...block, data: { ...block.data, width: 640 } })).toContain(
			'width="640"',
		);
	});
});

describe("statistics", () => {
	it("renders one item as a statement with a named source link", () => {
		const html = renderBlockHtml({
			id: "stat",
			type: "stats",
			data: {
				items: [
					{
						id: "stat-1",
						value: "63%",
						label: "of the observatory instruments use mirrored optics.",
					},
				],
				size: "very-large",
				caption: "Source: [North Ridge Observatory](https://observatory.example)",
			},
		} as unknown as PraxityBlock);
		expect(html).toContain('data-layout="statement"');
		expect(html).toContain('data-size="very-large"');
		expect(html).toContain(
			'<span class="praxity-stats-value">63%</span><span class="praxity-stats-label">of the observatory instruments use mirrored optics.</span>',
		);
		expect(html).toContain('<a href="https://observatory.example">North Ridge Observatory</a>');
	});

	it("renders multiple items as the requested grid", () => {
		const html = renderBlockHtml({
			id: "stats",
			type: "stats",
			data: {
				items: [
					{ id: "one", value: "2×", label: "as likely" },
					{ id: "two", value: "4×", label: "as likely" },
				],
				columns: 2,
			},
		} as unknown as PraxityBlock);
		expect(html).toContain('data-layout="grid"');
		expect(html).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
	});
});

describe("assessment static previews", () => {
	it.each([
		["match", "select", "Left item 1"],
		["order", "ol", "First item"],
		["free-response", "textarea", "Type your response"],
	])("renders %s before the interactive island loads", (keyword, control, text) => {
		const [block] = adaptGrammarPreviewBlocks(readBlockSource(starterSnippet(keyword)).blocks);
		const html = renderBlockHtml(block, { enabledIslands: new Set(["assessment"]) });
		expect(html).toContain(`<${control}`);
		expect(html).toContain(text);
		expect(html).toContain('data-island="assessment"');
		expect(html).toContain('class="praxity-block-assessment praxity-assessment-baseline"');
	});
});

it("retains the matrix question when older response data omits rows or scale points", () => {
	const html = renderBlockHtml({
		id: "older-matrix",
		type: "assessment",
		data: {
			assessmentType: "matrix",
			stem: [{ id: "stem", type: "text", data: { content: "Rate these skills" } }],
			response: { type: "matrix" },
		},
	} as unknown as PraxityBlock);
	expect(html).toContain("Rate these skills");
	expect(html).toContain('<table class="praxity-matrix-table"');
});

it.each(["long", "short", "numeric"])(
	"styles the inert %s text response with the shared native input class",
	(inputType) => {
		const html = renderBlockHtml({
			id: "response",
			type: "assessment",
			data: {
				assessmentType: "textResponse",
				stem: [{ id: "stem", type: "text", data: { content: "Explain your answer" } }],
				response: { type: "textResponse", inputType },
			},
		} as PraxityBlock);
		expect(html).toContain('class="praxity-assessment-text-input"');
		expect(html).toContain(
			inputType === "long" ? "<textarea" : `type="${inputType === "numeric" ? "number" : "text"}"`,
		);
		expect(html).toContain('class="praxity-fieldset-reset"');
		expect(html).toContain("disabled");
	},
);

it("resets the fill-blank fieldset and places supporting prose after the question", () => {
	const source = starterSnippet("fill-blank");
	const [block] = adaptGrammarPreviewBlocks(readBlockSource(source).blocks);
	block.data.description = [
		{ id: "supporting-detail", type: "text", data: { content: "<p>Supporting detail.</p>" } },
	];
	const html = renderBlockHtml(block);
	expect(html).toContain('class="praxity-block-assessment praxity-assessment-baseline"');
	expect(html).toContain('class="praxity-fieldset-reset"');
	expect(html).toContain('<p id="assessment-question-');
	expect(html).toContain('aria-labelledby="assessment-question-');
	expect(html.indexOf("</p>")).toBeLessThan(html.indexOf("Supporting detail."));
});

it("retains categorize category images and rejects unsafe image URLs in the native table", () => {
	const html = renderBlockHtml({
		id: "categories",
		type: "assessment",
		data: {
			assessmentType: "categorize",
			stem: [{ id: "stem", type: "text", data: { content: "Sort the items" } }],
			response: {
				type: "categorize",
				categories: [
					{
						id: "a",
						name: "Tools",
						items: ["Hammer"],
						image: "assets/tools.png",
						imageAlt: "Hand tools",
					},
					{
						id: "b",
						name: "Other",
						items: ["Book"],
						image: "javascript:alert(1)",
						imageAlt: "Unsafe",
					},
				],
			},
		},
	} as PraxityBlock);
	expect(html).toContain('class="praxity-categorize-table"');
	expect(
		Array.from(new JSDOM(html).window.document.querySelectorAll("tbody td"), (cell) =>
			cell.getAttribute("data-category"),
		),
	).toEqual(["Tools", "Other", "Tools", "Other"]);
	expect(html).toContain(
		'class="praxity-categorize-category-image" src="assets/tools.png" alt="Hand tools"',
	);
	expect(html).not.toContain("javascript:");
	expect(html).not.toContain('alt="Unsafe"');
});

it("renders the divider starter with the visible shared line treatment", () => {
	const [block] = readBlockSource(starterSnippet("divider")).blocks;
	expect(block.type).toBe("divider");
	expect(renderBlockHtml(block)).toContain('<hr class="praxity-divider praxity-divider-line" />');
});

it("keeps every legacy reveal:each list item in static learner output", () => {
	const [block] = readBlockSource(
		"# Untitled {hideTitle}\n\n- One\n- Two\n- Three\nreveal: each\n",
	).blocks;
	const html = renderBlockHtml(block);
	expect(html).toContain("One");
	expect(html).toContain("Two");
	expect(html).toContain("Three");
	expect(html).not.toContain("hidden");
	expect(html).not.toContain("data-reveal-each");
});

it.each(["style: none", "variant: plain"])("renders %s sequences without markers", (setting) => {
	const source = `# Fixture {hideTitle}\n\n::: sequence${setting === "style: none" ? " {style=none}" : ""}\n:: First step\nFirst content.\n:: Second step\nSecond content.\n:::\n`;
	const [block] = adaptGrammarPreviewBlocks(readBlockSource(source).blocks);
	if (setting === "variant: plain") block.data.variant = "plain";
	const html = renderBlockHtml(block);
	expect(html).toContain('data-variant="plain"');
	expect(html).toContain("First content.");
	expect(html).toContain("Second content.");
	expect(html).not.toContain('class="praxity-sequence-marker"');
});

describe.each(["neutral", "warning"])("%s note labels", (color) => {
	it("uses the sanitized custom title as its only label", () => {
		const html = renderBlockHtml({
			id: "custom-note",
			type: "note",
			data: {
				color,
				title: "  <em>Custom title</em><script>alert(1)</script>  ",
				content: "Note body",
			},
		} as PraxityBlock);
		expect(html).toMatch(/class="praxity-note-label">\s*<em>Custom title<\/em>\s*<\/strong>/);
		expect(html.match(/class="praxity-note-label"/g)).toHaveLength(1);
		expect(html).not.toContain("praxity-note-title");
		expect(html).not.toContain("<script");
		expect(html).not.toContain("alert(1)");
		expect(
			new JSDOM(html).window.document
				.querySelector(".praxity-note-body p")
				?.textContent?.trim()
				.replace(/\s+/g, " "),
		).toBe("Custom title Note body");
	});

	it.each([undefined, "", " \n\t "])("falls back to localized labels for title %j", (title) => {
		const block = {
			id: "untitled-note",
			type: "note",
			data: { color, title, content: "Note body" },
		} as PraxityBlock;
		for (const [strings, expected] of [
			[undefined, color === "warning" ? "Warning" : "Note"],
			[
				{ noteType: "Remarque", warningNoteType: "Avertissement" },
				color === "warning" ? "Avertissement" : "Remarque",
			],
		] as const) {
			const html = renderBlockHtml(block, { strings });
			expect(html).toContain(`<strong class="praxity-note-label">${expected}</strong>`);
			expect(html).not.toContain("praxity-note-title");
		}
	});
});

it("retires decorative note icons while keeping labels and content", () => {
	const source = "# Untitled {hideTitle}\n\n::: note For sample review\nNote text\n:::\n";
	const html = renderBlockHtml(
		readBlockSource(
			source.replace("::: note For sample review", "::: note For sample review {icon=none}"),
		).blocks[0],
	);
	expect(html).not.toContain("praxity-note-icon");
	expect(html).not.toContain("praxity-note-icon");
	expect(html).toContain("For sample review");
	expect(html).toContain("Note text");
	const defaultHtml = renderBlockHtml(readBlockSource(source).blocks[0]);
	expect(defaultHtml).not.toContain('data-icon="none"');
	expect(defaultHtml).not.toContain("praxity-note-icon");
});

it("renders canonical and legacy shaded note styles identically", () => {
	const render = (style: string) =>
		renderBlockHtml({
			id: "note-alias",
			type: "note",
			data: { content: "Reminder", style, color: "success" },
		} as PraxityBlock);
	expect(render("shaded")).toBe(render("filled"));
	expect(render("shaded")).toContain('data-style="shaded"');
	expect(render("shaded")).toContain('data-color="note"');
});

it.each(["grid", "masonry", "single"])(
	"renders prompt and answer with a linked disclosure button in %s HTML",
	(layout) => {
		const card = (back: PraxityBlock[]) =>
			renderBlockHtml({
				id: "cue",
				type: "card",
				data: { layout, items: [{ id: "item", label: "Card", front: [], back }] },
			} as unknown as PraxityBlock);
		expect(card([])).not.toContain("praxity-card-flip-cue");
		const html = card([{ id: "back", type: "text", data: { content: "<p>Back</p>" } }]);
		expect(html).not.toContain("praxity-card-flip-cue");
		expect(html).toContain('type="button" class="praxity-flashcard-toggle"');
		expect(html).toContain('aria-expanded="true" aria-controls="cue-answer-item"');
		expect(html).toContain('id="cue-answer-item"');
		expect(html).toContain("Hide answer");
	},
);
