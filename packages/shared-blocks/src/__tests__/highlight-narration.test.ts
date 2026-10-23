import { expect, it } from "vitest";
import {
	extractNarrationSegments,
	type NarrationSidecarV2,
	normalizeNarrationScript,
	normalizeNarrationSourceContent,
	resolveNarrationV2,
} from "../narration";
import type { HighlightContent, PraxityBlock } from "../types";

it("gives the admitted highlight discriminator no derived narration", () => {
	expect(
		extractNarrationSegments(
			"",
			{},
			[
				{
					id: "highlight",
					type: "highlight",
					data: {
						content: {
							mode: "key",
							title: "Unspoken title",
							paragraphs: [
								[
									{
										id: "chunk",
										text: "Unspoken passage",
										key: true,
										note: "Unspoken explanation",
									},
								],
							],
						},
					},
				},
			],
			{},
			"en",
		),
	).toEqual([]);
});

it.each(
	["accordion", "card"].flatMap((type) =>
		["page", "deck"].flatMap((layout) =>
			["edit", "in-place edit", "insert", "remove", "regroup", "spoken edit"].map((change) => ({
				type,
				layout,
				change,
			})),
		),
	),
)("keeps $type recording ownership in $layout after $change", ({ type, layout, change }) => {
	const original = passage();
	(original.data.content as HighlightContent).paragraphs[0].push({
		id: "second",
		text: "Another unspoken passage",
		key: false,
	});
	const parent = (children: PraxityBlock[]) => wrap(type as PraxityBlock["type"], children);
	const resolve = (children: PraxityBlock[], sidecar: NarrationSidecarV2) =>
		resolveNarrationV2({
			courseId: "course",
			lessonId: "lesson",
			locale: "en",
			moduleDeck: layout === "deck" ? {} : undefined,
			pages: [{ id: "page", title: "", blocks: [parent(children)] }],
			sidecar,
			digest: (text) => text,
		}).pages[0].segments;
	const empty: NarrationSidecarV2 = { version: 2, courseId: "course", lessons: {} };
	const baseline = resolve([spoken, original], {
		...empty,
		lessons: { lesson: { segments: [{ target: { id: "parent", role: "body" } }] } },
	});
	expect(baseline).toHaveLength(1);
	const sidecar: NarrationSidecarV2 = {
		...empty,
		lessons: {
			lesson: {
				segments: [
					{
						target: baseline[0].target,
						reviewedRevision: baseline[0].revision,
						script: "Author-owned surrounding script.",
						audio: "surrounding.mp3",
						audioFor: {
							script: "Author-owned surrounding script.",
							language: "en",
							voice: "Maya",
							speed: 1,
						},
					},
				],
			},
		},
	};
	const expected = resolve([spoken, original], sidecar);
	expect(expected[0]).toMatchObject({ status: "ready", audioForCurrent: true, custom: true });
	const changed = structuredClone(original);
	let children = [spoken, changed];
	switch (change) {
		case "edit":
			changed.id = "other-highlight";
			changed.name = "other-name";
			changed.data = {
				hide: true,
				level: 6,
				content: {
					mode: "evidence",
					title: "Other title",
					question: "Other question",
					maxMarks: 2,
					paragraphs: [[{ id: "other-chunk", text: "Other text", key: true, note: "Other note" }]],
				},
			};
			break;
		case "in-place edit": {
			const content = changed.data.content as HighlightContent;
			content.mode = "evidence";
			content.title = "Edited title";
			content.question = "Edited question";
			Object.assign(content.paragraphs[0][0], {
				text: "Edited passage",
				key: false,
				note: "Edited note",
			});
			break;
		}
		case "insert": {
			const copy = passage("New unspoken passage");
			copy.id = "copy";
			children.push(copy);
			break;
		}
		case "remove":
			children = [spoken];
			break;
		case "regroup": {
			const content = changed.data.content as HighlightContent;
			const [first, second] = content.paragraphs[0];
			content.paragraphs = [[first], [second]];
			children = [changed, spoken];
			break;
		}
		case "spoken edit":
			children = [{ ...spoken, data: { content: "Changed narrated words." } }, original];
			break;
	}
	if (change === "in-place edit") expect(changed.id).toBe(original.id);
	const actual = resolve(children, sidecar);
	const canonical = (children: PraxityBlock[]) =>
		normalizeNarrationSourceContent(JSON.stringify({ type, data: parent(children).data }));
	if (change === "spoken edit") {
		expect(actual[0]).toMatchObject({
			status: "needsReview",
			script: "Author-owned surrounding script.",
			audioForCurrent: true,
		});
		expect(actual[0].revision).not.toBe(expected[0].revision);
		expect(canonical(children)).not.toBe(canonical([spoken, original]));
	} else {
		expect(actual).toEqual(expected);
		expect(canonical(children)).toBe(canonical([spoken, original]));
	}
});

it.each([{}])("creates no retained-empty highlight target: %j", (data) => {
	const block: PraxityBlock = { id: "highlight", type: "highlight", data };
	expect(
		extractNarrationSegments("", {}, [block], {}, "en", {
			retainEmptyTargets: new Set([block.id]),
		}),
	).toEqual([]);
});

const passage = (text = "UNSPOKEN passage"): PraxityBlock => ({
	id: "highlight",
	type: "highlight",
	name: "unspoken",
	data: {
		level: 2,
		hide: false,
		content: {
			mode: "key",
			title: "UNSPOKEN title",
			question: "UNSPOKEN question",
			paragraphs: [[{ id: "chunk", text, key: true, note: "UNSPOKEN note" }]],
		},
	},
});
const spoken: PraxityBlock = {
	id: "spoken",
	type: "text",
	data: { content: "<p>Spoken surrounding words.</p>" },
};
const wrap = (
	type: PraxityBlock["type"],
	children: PraxityBlock[],
	narration?: string,
): PraxityBlock => ({
	id: "parent",
	type,
	data: {
		title: "Parent",
		...(narration ? { narration } : {}),
		items: [
			{
				id: "item",
				label: "Panel",
				...(type === "card" ? { front: children, back: [], backId: "back" } : { children }),
			},
		],
	},
});

it.each(["accordion", "tabs", "sequence", "card", "columns"] as const)(
	"omits complete highlight records from %s source collections and fingerprints",
	(type) => {
		const resolve = (children: PraxityBlock[], script?: string) =>
			resolveNarrationV2({
				courseId: "course",
				lessonId: "lesson",
				locale: "en",
				pages: [{ id: "page", title: "", blocks: [wrap(type, children, script)] }],
				sidecar: { version: 2, courseId: "course", lessons: {} },
				digest: (text) => text,
			}).pages[0].segments;
		const original = passage();
		const changed = passage("UNSPOKEN edited passage");
		changed.id = "different-highlight";
		changed.data = {
			...changed.data,
			level: 6,
			hide: true,
			entrance: "fade",
			content: {
				mode: "evidence",
				title: "UNSPOKEN other title",
				question: "UNSPOKEN other question",
				maxMarks: 3,
				paragraphs: [
					[{ id: "new-chunk", text: "UNSPOKEN changed", key: false }],
					[{ id: "second", text: "UNSPOKEN second", key: true, note: "UNSPOKEN changed note" }],
				],
			},
		};
		for (const script of [undefined, "Custom parent script."]) {
			const expected = resolve([spoken], script);
			for (const children of [
				[original, spoken],
				[spoken, changed],
				[original, spoken, changed],
			]) {
				const actual = resolve(children, script);
				expect(actual).toEqual(expected);
				expect(JSON.stringify(actual)).not.toContain("UNSPOKEN");
			}
			const normalized = (children: PraxityBlock[]) =>
				normalizeNarrationSourceContent(
					JSON.stringify({ type, data: wrap(type, children, script).data }),
				);
			expect(normalized([spoken, original])).toBe(normalized([spoken]));
			expect(normalized([changed, spoken])).toBe(normalized([spoken]));
			const editedSpoken = { ...spoken, data: { content: "<p>Changed surrounding words.</p>" } };
			expect(resolve([editedSpoken], script).map((s) => s.sourceContent)).not.toEqual(
				expected.map((s) => s.sourceContent),
			);
		}
	},
);

it("normalizes a legacy highlight source to no fingerprint", () => {
	expect(
		normalizeNarrationSourceContent(JSON.stringify({ type: "highlight", data: passage().data })),
	).toBe("");
});

it.each(["accordion", "tabs", "sequence", "card"] as const)(
	"preserves explicit surrounding %s scripts while excluding highlight source records",
	(type) => {
		const extract = (children: PraxityBlock[]) =>
			extractNarrationSegments("", {}, [wrap(type, children, "Authored surrounding script.")]);
		const expected = extract([spoken]);
		expect(expected).toHaveLength(1);
		expect(expected[0]).toMatchObject({ script: "Authored surrounding script.", custom: true });
		expect(extract([passage(), spoken])).toEqual(expected);
		expect(extract([spoken, passage("UNSPOKEN changed")])).toEqual(expected);
	},
);

it.each([
	{ variant: "ordinary", data: {}, whole: false },
	{ variant: "hide", data: { hide: true }, whole: true },
])("keeps a parent accordion recording whole with a $variant highlight", ({ data, whole }) => {
	// Item recordings exercise recurse; whole-container recordings exercise visibility splitting.
	const extract = (children: PraxityBlock[]) =>
		extractNarrationSegments("", {}, [
			{
				id: "parent",
				type: "accordion",
				data: {
					...(whole ? { narration: "Parent script." } : {}),
					items: [
						{
							id: "item",
							label: "Panel",
							children,
							...(!whole ? { narration: "Parent script." } : {}),
						},
					],
				},
			},
		]);
	const expected = extract([spoken]);
	expect(expected).toHaveLength(1);
	expect(expected[0]).toMatchObject({ script: "Parent script.", custom: true });
	const highlight = passage();
	highlight.data = { ...highlight.data, ...data };
	expect(extract([spoken, highlight])).toEqual(expected);
});

it("keeps a surrounding v2 recording and explicit script current across highlight edits", () => {
	const parent = (children: PraxityBlock[]) => wrap("accordion", children);
	const [derived] = extractNarrationSegments("", {}, [parent([spoken])], {}, "fr", {
		wholeContainerIds: new Set(["parent"]),
	});
	const resolve = (children: PraxityBlock[]) =>
		resolveNarrationV2({
			courseId: "course",
			lessonId: "lesson",
			locale: "fr",
			pages: [{ id: "page", title: "", blocks: [parent(children)] }],
			digest: (text) => text,
			sidecar: {
				version: 2,
				courseId: "course",
				lessons: {
					lesson: {
						segments: [
							{
								target: { id: "parent", role: "body" },
								reviewedRevision: normalizeNarrationScript(derived.derivedScript),
								script: "Script explicite.",
								language: "fr",
								voice: "Maya",
								speed: 1.25,
								audio: "parent.mp3",
								audioFor: {
									script: "Script explicite.",
									language: "fr",
									voice: "Maya",
									speed: 1.25,
								},
							},
						],
					},
				},
			},
		}).pages[0].segments;
	const expected = resolve([spoken]);
	expect(expected).toHaveLength(1);
	expect(expected[0]).toMatchObject({
		script: "Script explicite.",
		status: "ready",
		audioForCurrent: true,
		settings: { language: "fr", voice: "Maya", speed: 1.25 },
	});
	const copy = passage("UNSPOKEN copy");
	copy.id = "highlight-copy";
	(copy.data.content as HighlightContent).paragraphs[0][0].id = "copied-chunk";
	for (const children of [
		[passage(), spoken],
		[spoken, passage("UNSPOKEN changed")],
		[passage(), spoken, copy],
	])
		expect(resolve(children)).toEqual(expected);
	expect(resolve([{ ...spoken, data: { content: "Changed surrounding words." } }])[0].status).toBe(
		"needsReview",
	);
});
