// @vitest-environment jsdom
import type { LearnerStrings } from "@praxity/shared-blocks/i18n/strings";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { initInlineTooltips } from "@praxity/shared-blocks/viewer/inline-tooltips";
import { computeAccessibleName } from "dom-accessibility-api";
import { describe, expect, it } from "vitest";
import { readBlockFixture } from "../../../grammar/__tests__/helpers/lesson-fixture";
import { type CourseConfig, generateHtmlPage } from "../html-gen";
import { compileDocument } from "../preview/compile-page";
import { createCourseContextFromHtml } from "../preview/course-context";
import { renderBlockHtml } from "../render-block-html";

const url = (source: string) => `https://example.com/${source}`;
const richLink = (source: string) => `<a href="${url(source)}" target="_blank">${source}</a>`;
const text = (source: string): PraxityBlock => ({
	id: source,
	type: "text",
	data: { content: `<p>${richLink(source)}</p>` },
});
const button = (source: string): PraxityBlock => {
	const { blocks } = readBlockFixture(`::: button [${source}](${url(source)}) {newTab}\n:::\n`);
	return { ...blocks[0], id: source };
};

function fixtureBlocks(): PraxityBlock[] {
	// G4 inline Markdown has no new-tab option. Rich model fields retain their
	// existing sanitizer policy; generated button targets exercise each container.
	return [
		text("prose"),
		{ id: "heading", type: "heading", data: { level: 2, content: richLink("heading") } },
		button("button"),
		{
			id: "glossary",
			type: "text",
			data: {
				content: `<span class="inline-tooltip-trigger" data-tooltip-content="${richLink("definition").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}">Term</span>`,
			},
		},
		{
			id: "callout",
			type: "note",
			data: { title: "Callout", content: richLink("callout-rich") },
		},
		...(["accordion", "tabs", "columns", "sequence"] as const).map((type) => ({
			id: type,
			type,
			data: {
				items: [
					{
						id: `${type}-item`,
						label: "Item",
						children: [text(`${type}-rich`), button(`${type}-button`)],
					},
				],
			},
		})),
		{
			id: "card",
			type: "card",
			data: {
				items: [
					{
						id: "card-item",
						label: "Card",
						front: [button("card-front")],
						back: [button("card-back")],
					},
				],
			},
		},
		{
			id: "table",
			type: "table",
			data: { headers: ["Source"], rows: [[richLink("table")]], caption: richLink("caption") },
		},
		{
			id: "feedback",
			type: "rating",
			data: { label: "Rate this", feedback: richLink("feedback") },
		},
		...readBlockFixture(`Read the source @source{[Footnote](${url("footnote")})}.`).blocks,
		{ id: "audio", type: "audio", data: { src: url("audio.mp3"), title: "Audio" } },
		{
			id: "document",
			type: "document",
			data: { url: url("document.pdf"), title: richLink("document-title") },
		},
		{
			id: "bookmark",
			type: "embed",
			data: { src: url("bookmark"), title: richLink("bookmark-title"), display: "bookmark" },
		},
		{
			id: "embed",
			type: "embed",
			data: { src: "https://www.youtube.com/watch?v=abc123", title: "Embed" },
		},
		{
			id: "video",
			type: "video",
			data: { src: "https://www.youtube.com/watch?v=def456", title: "Video" },
		},
		{
			id: "resource",
			type: "resourceEntry",
			data: {
				title: "Resource",
				url: url("resource"),
				resourceType: "link",
				includeInResourcesPage: true,
			},
		},
	];
}

function assertMarked(root: ParentNode, expectedText: string) {
	for (const link of root.querySelectorAll('a[target="_blank"]')) {
		const label = link.getAttribute("href") ?? "";
		expect
			.soft(link.querySelector(".praxity-external-icon")?.getAttribute("aria-hidden"), label)
			.toBe("true");
		const name = computeAccessibleName(link);
		expect.soft(name, label).toContain(expectedText);
		expect.soft(name.match(/new tab|nouvel onglet/gi), `${label}: ${name}`).toHaveLength(1);
	}
	for (const template of root.querySelectorAll("template"))
		assertMarked(template.content, expectedText);
}

describe.each(["en", "fr"])("media fallback accessible names (%s)", (locale) => {
	it.each(["embed", "video"] as const)("warns exactly once for %s", (type) => {
		document.body.innerHTML = renderBlockHtml(
			{
				id: "media",
				type,
				data: { src: "https://www.youtube.com/watch?v=abc123", title: "Safety" },
			},
			{ sourceLocale: locale },
		);
		const link = document.querySelector(".praxity-media-fallback a");
		if (!link) throw new Error("Missing media fallback");
		expect(computeAccessibleName(link)).toBe(
			locale === "fr"
				? "Ouvrir Safety, (s’ouvre dans un nouvel onglet)"
				: "Open Safety, (opens in a new tab)",
		);
		document.body.innerHTML = "";
	});
});

describe.each(["en", "fr"])("compiled new-tab links (%s)", (locale) => {
	it("marks the static navigation glossary link", () => {
		const page = { id: "static", title: "Static", blocks: [] };
		const config: CourseConfig = {
			id: "static-course",
			title: "Static course",
			sourceLocale: locale,
			totalPages: 1,
			pages: [page],
			glossaryTerms: [
				{
					term: "Safety",
					definition: "Working safely",
					lessonTitle: "Static",
					lessonSlug: "static",
				},
			],
		};
		const parsed = new DOMParser().parseFromString(
			generateHtmlPage({
				config,
				page,
				index: 0,
				currentSlug: "static",
				slugList: [{ pageId: "static", slug: "static", title: "Static" }],
				slugMap: new Map([["static", "static"]]),
				runtimePlan: { mode: "static", islands: [], legacyReasons: [] },
			}),
			"text/html",
		);
		document.body.innerHTML = parsed.body.innerHTML;
		try {
			expect(document.querySelector('a[href="glossary.html"][target="_blank"]')).not.toBeNull();
			assertMarked(
				document,
				locale === "fr" ? "(s’ouvre dans un nouvel onglet)" : "(opens in a new tab)",
			);
		} finally {
			document.body.innerHTML = "";
		}
	});

	it.each([false, true])(
		"marks every target in Pages/deck=%s, utility documents and popovers",
		async (deck) => {
			const expectedText =
				locale === "fr" ? "(s’ouvre dans un nouvel onglet)" : "(opens in a new tab)";
			const context = await createCourseContextFromHtml(
				{
					id: "link-course",
					title: "Link course",
					sourceLocale: locale,
					totalPages: 1,
					...(deck ? { moduleDeck: {} } : {}),
					pages: [{ id: "links", title: "Links", blocks: fixtureBlocks() }],
					resourceEntries: [
						{
							title: "Resource",
							description: richLink("resource-description"),
							resourceType: "link",
							url: url("resource-page"),
						},
					],
				},
				{
					islandAssets: {
						loaderFilename: "loader.js",
						islandFilenames: Object.fromEntries(
							[
								"narration",
								"nav",
								"table",
								"deck",
								"card",
								"accordion",
								"tabs",
								"sequence",
								"assessment",
								"media",
								"tooltip",
								"rating",
							].map((name) => [name, `${name}.js`]),
						),
					},
				},
			);
			const contentDocument = context.documents.find((entry) => entry.pageIds.includes("links"));
			if (!contentDocument) throw new Error("Missing fixture content document");
			const content = new DOMParser().parseFromString(
				compileDocument(context, contentDocument.slug).html,
				"text/html",
			);
			const strings: LearnerStrings = JSON.parse(
				content.getElementById("praxity-config")?.textContent ?? "{}",
			).strings;
			expect(strings.opensInNewTab).toBe(expectedText);
			const seen = new Set<string>();
			const newTabTargets = new Set<string>();
			const collect = (root: ParentNode) => {
				for (const link of root.querySelectorAll("a[href]")) {
					const href = link.getAttribute("href") ?? "";
					seen.add(href);
					if (link.getAttribute("target") === "_blank") newTabTargets.add(href);
				}
				for (const template of root.querySelectorAll("template")) collect(template.content);
			};
			for (const entry of context.documents) {
				const compiled = compileDocument(context, entry.slug);
				const parsed = new DOMParser().parseFromString(compiled.html, "text/html");
				document.documentElement.lang = locale;
				document.body.innerHTML = parsed.body.innerHTML;
				const cleanup = initInlineTooltips(strings.definitionAvailable, strings.opensInNewTab, {
					href: "glossary.html",
					label: strings.fullGlossary,
				});
				try {
					for (const trigger of document.querySelectorAll<HTMLElement>("[data-tooltip-content]")) {
						trigger.click();
						assertMarked(document, expectedText);
						collect(document);
					}
					assertMarked(document, expectedText);
					collect(document);
				} finally {
					cleanup();
					document.body.innerHTML = "";
				}
			}
			for (const source of [
				"prose",
				"heading",
				"button",
				"definition",
				"callout-rich",
				"accordion-rich",
				"tabs-rich",
				"columns-rich",
				"sequence-rich",
				"accordion-button",
				"tabs-button",
				"columns-button",
				"sequence-button",
				"card-front",
				"card-back",
				"table",
				"caption",
				"feedback",
				"footnote",
				"audio.mp3",
				"document.pdf",
				"bookmark",
				"resource",
				"resource-page",
				"resource-description",
			]) {
				expect(seen.has(url(source)), `missing fixture source ${source}`).toBe(true);
			}
			for (const source of [
				"button",
				"definition",
				"accordion-button",
				"tabs-button",
				"columns-button",
				"sequence-button",
				"card-front",
				"card-back",
				"audio.mp3",
				"document.pdf",
				"bookmark",
				"resource",
				"resource-page",
			]) {
				expect(newTabTargets.has(url(source)), `missing new-tab target ${source}`).toBe(true);
			}
			expect(newTabTargets.has("https://www.youtube.com/watch?v=abc123")).toBe(true);
			expect(newTabTargets.has("https://www.youtube-nocookie.com/embed/def456")).toBe(true);
		},
	);
});
