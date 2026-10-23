import { readLesson, readSelfCheckContent } from "@praxity/grammar";
import { JSDOM } from "jsdom";
import { expect, it } from "vitest";
import { compilePage, createCourseContext, renderNode } from "../src/build";
import { createCourseContextFromHtml, refreshCourseContext } from "../src/preview/course-context";
import { selfCheckContentInput, selfCheckRuntimeAssets } from "../src/self-check";
import { loadSelfCheckAsset } from "../template/src/self-check-asset";

const source = (model = "MODEL_ONE", hint = "HINT_ONE") =>
	`# Practice\n::: self-check Write an answer.\nmodel: ${model}\n:: LABEL_ONE\nmissed: ${hint}\n:::\n`;
it.each([false, true])(
	"marks only self-check wrappers pending while preserving literal task text, nested=%s",
	async (nested) => {
		const task =
			'Explain the literal data-self-check-id= attribute and data-self-check-id="activity".';
		const read = readLesson(source().replace("Write an answer.", task));
		const block = read.blocks.find((block) => block.type === "selfCheck");
		if (!block) throw new Error("Missing activity");
		const context = await createCourseContext({
			id: "literal-task",
			title: "Practice",
			sourceLocale: "en",
			content: nested
				? read.pages.map((page) => ({
						...page,
						blocks: [
							{
								id: "container",
								type: "columns",
								data: { items: [{ id: "column", children: page.blocks }] },
							},
						],
					}))
				: read.pages,
			selfCheckContents: [selfCheckContentInput(block.id, readSelfCheckContent(read, block.id))],
		});
		const page = context.pages[0];
		const prompt = page.blocks.find(
			(candidate) => candidate.id === (nested ? "container" : block.id),
		);
		if (!prompt) throw new Error("Missing prompt");
		const fragment = renderNode(context, page.id, prompt.id, prompt);
		const doc = new JSDOM(fragment.html).window.document;
		expect(doc.querySelector("[data-self-check] h2")?.textContent).toBe(task);
		expect(doc.querySelectorAll("[data-self-check-context-pending]")).toHaveLength(1);
		expect(
			doc.querySelector("[data-self-check-context-pending]")?.hasAttribute("data-self-check"),
		).toBe(true);
		expect(
			new JSDOM(compilePage(context, page.id).html).window.document.querySelector(
				"[data-self-check-context-pending]",
			),
		).toBeNull();
	},
);
it("uses S5's exact Content revision independently of criterion order", () => {
	const content = {
		task: "Write an answer.",
		model: "EVIDENCE_A EVIDENCE_B",
		parts: [
			{ id: "b", label: "LABEL_B", missed: "HINT_B", evidence: "EVIDENCE_B" },
			{ id: "a", label: "LABEL_A", missed: "HINT_A", evidence: "EVIDENCE_A" },
		],
	};
	const revision = "sha256:95c5df052b62abe337373dc631bb99de3110a19a05d391fb6cf50260d8b3c7e7";
	expect(selfCheckContentInput("activity", content).contentRevision).toBe(revision);
	expect(
		selfCheckContentInput("activity", { ...content, parts: [...content.parts].reverse() })
			.contentRevision,
	).toBe(revision);
	expect(content.parts.map((part) => part.id)).toEqual(["b", "a"]);
});
it("emits ASCII-only activity bytes with exact non-ASCII content", async () => {
	const context = await createCourseContext(fixture("MODÈLE café 😀", "INDICE déjà"));
	const asset = selfCheckRuntimeAssets(context.selfCheckRuntime)[0];
	expect([...asset.bytes].every((byte) => byte < 128)).toBe(true);
	const payload = asset.bytes.toString().match(/\?\.\((.*)\);/u)?.[1];
	if (!payload) throw new Error("Missing activity payload");
	expect(JSON.parse(payload).content).toMatchObject({
		model: "MODÈLE café 😀",
		parts: [{ missed: "INDICE déjà" }],
	});
});
it("refuses a loader path outside the packaged self-check assets", async () => {
	const doc = new JSDOM("<!doctype html><html><head></head><body></body></html>").window.document;
	await expect(
		loadSelfCheckAsset(
			{ blockId: "activity", contentRevision: "revision", path: "../private.js" },
			doc,
		),
	).rejects.toMatchObject({
		code: "self-check-asset-invalid",
		message: "self-check-asset-invalid",
	});
	expect(doc.querySelector("script")).toBeNull();
});
function fixture(model?: string, hint?: string) {
	const read = readLesson(source(model, hint), {
		ids: (node, role) => `${node.type}-${role ?? node.span.start}`,
	});
	const block = read.blocks.find((block) => block.type === "selfCheck");
	if (!block) throw new Error("Missing activity fixture");
	return {
		id: "course",
		title: "Practice",
		sourceLocale: "en",
		content: read.pages,
		selfCheckContents: [selfCheckContentInput(block.id, readSelfCheckContent(read, block.id))],
	};
}

it("requires explicit content and refuses duplicate, orphaned, invalid and wrong-revision entries without content", async () => {
	const input = fixture();
	for (const [entries, code] of [
		[[], "self-check-content-missing"],
		[[...input.selfCheckContents, ...input.selfCheckContents], "self-check-content-duplicate"],
		[[{ ...input.selfCheckContents[0], blockId: "orphan" }], "self-check-content-orphaned"],
		[[{ ...input.selfCheckContents[0], contentRevision: "old" }], "self-check-content-revision"],
		[
			[
				selfCheckContentInput(input.selfCheckContents[0].blockId, {
					...input.selfCheckContents[0].content,
					task: "Wrong task.",
				}),
			],
			"self-check-content-revision",
		],
		[
			[{ ...input.selfCheckContents[0], content: { model: "SECRET" } }],
			"self-check-content-invalid",
		],
	] as const) {
		await expect(
			createCourseContext({ ...input, selfCheckContents: entries } as never),
		).rejects.toMatchObject({ code, message: code });
	}
	const entry = {
		...input.selfCheckContents[0],
		get content(): never {
			throw new Error("SECRET");
		},
	};
	await expect(createCourseContext({ ...input, selfCheckContents: [entry] })).rejects.toMatchObject(
		{ code: "self-check-content-invalid", message: "self-check-content-invalid" },
	);
});

it("captures per-activity assets and invalidates retained contexts on model and same-length hint edits", async () => {
	const input = fixture();
	const siblingRead = readLesson(source("SIBLING_MODEL", "SIBLING_HINT"), {
		ids: (node, role) => `sibling-${node.span.start}-${role ?? "block"}`,
	});
	const sibling = siblingRead.blocks.find((block) => block.type === "selfCheck");
	if (!sibling) throw new Error("Missing sibling fixture");
	const addSibling = (value: ReturnType<typeof fixture>) => ({
		...value,
		content: [...value.content, ...siblingRead.pages],
		selfCheckContents: [
			...value.selfCheckContents,
			selfCheckContentInput(sibling.id, readSelfCheckContent(siblingRead, sibling.id)),
		],
	});
	const first = await createCourseContext(addSibling(input));
	const model = await refreshCourseContext(first, addSibling(fixture("MODEL_TWO")), {});
	const hint = await refreshCourseContext(model, addSibling(fixture("MODEL_TWO", "HINT_TWO")), {});
	const asset = (context: typeof first, id: string) => {
		const found = selfCheckRuntimeAssets(context.selfCheckRuntime).find(
			(asset) => asset.blockId === id,
		);
		if (!found) throw new Error("Missing activity asset");
		return found;
	};
	const firstAsset = asset(first, input.selfCheckContents[0].blockId);
	const assetSlice = first.slices.assets;
	if (!assetSlice) throw new Error("Missing asset dependencies");
	expect((assetSlice.value as Map<string, string>).get(firstAsset.path)).toBe(
		firstAsset.contentRevision,
	);
	expect(firstAsset.path).toMatch(/^self-check\/[a-f0-9]{64}\.js$/);
	expect(firstAsset.bytes.toString()).toContain("MODEL_ONE");
	expect(asset(model, firstAsset.blockId).path).not.toBe(firstAsset.path);
	expect(asset(hint, firstAsset.blockId).path).not.toBe(asset(model, firstAsset.blockId).path);
	expect(asset(hint, sibling.id).path).toBe(asset(first, sibling.id).path);
	expect(first.pages[0].assetPaths).toContain(firstAsset.path);
	expect(first.pages[0].sourceDigest).not.toBe(model.pages[0].sourceDigest);
	expect(model.pages[0].sourceDigest).not.toBe(hint.pages[0].sourceDigest);
	expect(first.slices[first.pages[0].lessonKey]?.digest).not.toBe(
		model.slices[model.pages[0].lessonKey]?.digest,
	);
	expect(model.slices[model.pages[0].lessonKey]?.digest).not.toBe(
		hint.slices[hint.pages[0].lessonKey]?.digest,
	);
	const latest = compilePage(hint, hint.pages[0].id);
	const older = compilePage(first, first.pages[0].id);
	expect(latest.deps).not.toEqual(older.deps);
	expect(compilePage(hint, hint.pages[0].id)).toBe(latest);
	const afterOlder = await refreshCourseContext(
		hint,
		addSibling(fixture("MODEL_TWO", "HINT_TWO")),
		{},
	);
	expect(compilePage(afterOlder, afterOlder.pages[0].id).fragments).toBe(latest.fragments);
	expect(compilePage(hint, hint.pages[1].id).deps).toEqual(
		compilePage(first, first.pages[1].id).deps,
	);
	expect(compilePage(first, first.pages[0].id).html).toContain(firstAsset.path);
	expect(latest.html).toContain(asset(hint, firstAsset.blockId).path);
	expect(JSON.stringify(hint)).not.toMatch(/MODEL_|HINT_|LABEL_/);
	input.selfCheckContents[0].content.model = "MUTATED";
	expect(firstAsset.bytes.toString()).not.toContain("MUTATED");
	const original = first.pages[0].blocks.find((block) => block.type === "selfCheck");
	if (!original) throw new Error("Missing original fixture");
	// Even a model-only draft has unchanged prompt data and must wait for refresh.
	expect(renderNode(first, first.pages[0].id, original.id, original).html).toContain(
		"data-self-check-context-pending",
	);
	expect(
		renderNode(first, first.pages[0].id, original.id, undefined, first.pages[0].blocks).html,
	).toContain("data-self-check-context-pending");
	expect(compilePage(first, first.pages[0].id).html).not.toContain(
		"data-self-check-context-pending",
	);
	const changedPrompt = {
		...original,
		data: {
			content: {
				task: "New draft task.",
				parts: [{ id: input.selfCheckContents[0].content.parts[0].id }],
			},
		},
	};
	expect(renderNode(first, first.pages[0].id, changedPrompt.id, changedPrompt).html).not.toContain(
		"data-self-check-src",
	);
});

it("does not emit assets for refused nodes", async () => {
	const input = fixture();
	const context = await createCourseContext({
		...input,
		unresolvedNodes: new Map([
			[input.selfCheckContents[0].blockId, { code: "invalid-source", line: 2 }],
		]),
	});
	expect(selfCheckRuntimeAssets(context.selfCheckRuntime)).toEqual([]);
	const refusedWithoutContent = await createCourseContext({
		...input,
		selfCheckContents: [],
		unresolvedNodes: new Map([
			[input.selfCheckContents[0].blockId, { code: "invalid-source", line: 2 }],
		]),
	});
	expect(selfCheckRuntimeAssets(refusedWithoutContent.selfCheckRuntime)).toEqual([]);
	expect(context.pages[0].assetPaths).toEqual([]);
	expect(compilePage(context, context.pages[0].id).html).not.toContain("self-check/");
	const htmlContext = await createCourseContextFromHtml(
		{
			id: "course",
			title: "Practice",
			sourceLocale: "en",
			pages: context.normalizedCourse.content,
			totalPages: context.pages.length,
		},
		{
			islandAssets: {
				loaderFilename: "island-loader.js",
				islandFilenames: { nav: "island-nav.js", selfCheck: "island-self-check.js" },
			},
		},
		context.selfCheckRuntime,
	);
	expect(selfCheckRuntimeAssets(htmlContext.selfCheckRuntime)).toEqual([]);
	expect(htmlContext.pages[0].assetPaths).toEqual([]);
	const nested = await createCourseContext({
		...input,
		content: input.content.map((page) => ({
			...page,
			blocks: [
				{
					id: "container",
					type: "columns",
					data: { items: [{ id: "item", children: page.blocks }] },
				},
			],
		})),
		unresolvedNodes: new Map([["container", { code: "invalid-source", line: 1 }]]),
	});
	expect(selfCheckRuntimeAssets(nested.selfCheckRuntime)).toEqual([]);
});
