import { expect, it } from "vitest";
import {
	bodyHashes,
	normalizeRendererAssets,
	recordBaseline,
} from "../scripts/update-page-compiler-baseline.mts";
import type { CourseExportInput } from "../src/build.ts";

function fixture(id: string, deck: boolean): CourseExportInput {
	return {
		id,
		title: id,
		sourceLocale: "en",
		...(deck ? { moduleDeck: {} } : {}),
		content: [
			{
				id: `page-${id}`,
				title: "Tiny page",
				lessonId: "module",
				lessonTitle: "Tiny module",
				isFirstPageOfLesson: true,
				blocks: [
					{
						id: `${id}-image`,
						type: "image",
						data: { src: "images/tiny.png", alt: "Tiny fixture" },
					},
				],
			},
		],
	};
}

it("records every P2 baseline hash from full build output", async () => {
	// Images exercise build-added hints in HTML and deck JSON; documents include
	// index and numbered redirects that compileDocument alone does not emit.
	// T50 round 2 renames the serialized media action key to mediaOpen.
	expect(await recordBaseline([fixture("deck", true), fixture("pages", false)])).toEqual({
		deck: {
			bodies: {
				"page-deck": "cf01d3dea4db3beb199f3f7548d1842b0d081a48478d0d85f09335f41365e47a",
			},
			documents: {
				"index.html": "2ce74ff5b722f57711ea82d0cd6c565e102cf49e8cd98ea87adea69c0b8424df",
				"page-1.html": "faf9c9f356a04e34b537f5356921b8190a0f35fbde38be76654f75052f8d385b",
				"tiny-page.html": "ddbc90ac7596e354bd40c82b9b9ac2c2155d6b26511a10295f00f448f0c87d12",
			},
		},
		pages: {
			bodies: {
				"page-pages": "d539a02c7d7814066bacad2add9f05ce9ab21bf1ef356df9cd0400c5d0385265",
			},
			documents: {
				"index.html": "20f13e71ff6bcab5b7a46e1ec4652b5b88a3c809d11c7e791e1f24092665be4e",
				"page-1.html": "faf9c9f356a04e34b537f5356921b8190a0f35fbde38be76654f75052f8d385b",
				"tiny-page.html": "7ca45d7f582c9d51127258ba009c73953a8f403e9902c4ee6e6691a3b0244800",
			},
		},
	});
});

it("refuses a body whose closing tag the browser would invent", () => {
	expect(() => bodyHashes('<main id="main-content"><p>Unclosed</p>', ["page"], false)).toThrow(
		"Missing body bounds: page",
	);
});

it("omits the three inert choice fact fields from recorded document hashes", async () => {
	const input = fixture("choice", false);
	input.content[0].blocks = [
		{ id: "group", type: "assessmentGroup", data: { mode: "all", memberBlockIds: ["question"] } },
		{
			id: "question",
			type: "assessment",
			data: {
				assessmentType: "choice",
				gradingMode: "none",
				dontKnow: true,
				stem: [{ id: "stem", type: "text", data: { content: "Choose an item" } }],
				response: {
					type: "choice",
					selectionMode: "single",
					options: [
						{ id: "yes", label: "Yes", isCorrect: true },
						{ id: "no", label: "No" },
					],
				},
			},
		},
	];
	// Frozen renderer fixture bytes, including the question/group configuration
	// apart from the same three fields excluded by the page-compiler guard.
	expect((await recordBaseline([input])).choice.documents["tiny-page.html"]).toBe(
		"a21f9338625453cbb6b090d402c5da81ee757764f32aae0132691dc8957ca27b",
	);
});

it("matches renderer-only assets without removing authored lifetime references", () => {
	const html = [
		'<script src="self-check-lifetime-ABCDEFGH.classic.js"></script>',
		'<script defer src="self-check-lifetime-IJKLMNOP.classic.js"></script>',
		'<script type="module" src="islands/island-self-check-ABCDEFGH.js"></script>',
		'<a href="self-check-lifetime-ABCDEFGH.classic.js">Source</a>',
	].join("\n");
	expect(normalizeRendererAssets(html)).toBe(
		[
			'<script type="module" src="selfCheck.js"></script>',
			'<a href="self-check-lifetime-ABCDEFGH.classic.js">Source</a>',
		].join("\n"),
	);
});
