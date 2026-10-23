import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { traverseAssetGraph } from "@praxity/shared-blocks/asset-graph";
import {
	hasInlineIconMarkup,
	materializeInlineIcons,
} from "@praxity/shared-blocks/inline-markdown";
import { expect, it } from "vitest";
import { compileDocument } from "../src/preview/compile-page";
import { createCourseContext, getPageDependencies } from "../src/preview/course-context";
import { pageHasTooltipMarkup } from "../src/runtime-plan";
import { stripChoiceStateFacts } from "./fixtures/choice-facts";
import { choiceGlossaryContext } from "./fixtures/choice-glossary";
import { compilerIslandAssets } from "./fixtures/page-compiler";

it("keeps the main glossary document bytes for escaped terms and terms inside notes", async () => {
	const context = await choiceGlossaryContext();
	// Captured from main before compiler-only choice trees existed.
	const html = stripChoiceStateFacts(compileDocument(context, "glossary").html);
	expect(html).toBe(
		readFileSync(new URL("./fixtures/choice-glossary.txt", import.meta.url), "utf8"),
	);
});

it("keeps compiler metadata opaque to runtime, icon, asset and preview consumers", async () => {
	const metadata = {
		content: [
			{
				kind: "variable",
				name: "learner",
				src: "assets/hidden.png",
				value: 'inline-tooltip-trigger data-praxity-inline-icon="mail"',
			},
		],
	};
	const page = {
		id: "p",
		title: "P",
		blocks: [
			{ id: "b", type: "text" as const, data: { content: "<p>Read</p>", _inlineTrees: metadata } },
		],
	};
	expect(pageHasTooltipMarkup(page)).toBe(false);
	expect(hasInlineIconMarkup(page)).toBe(false);
	const materialized = structuredClone(page);
	materializeInlineIcons(materialized, { outline: {}, filled: {} });
	expect(materialized).toEqual(page);
	const assets: string[] = [];
	const rewritten = await traverseAssetGraph([page], {
		onAsset: ({ value }) => {
			assets.push(value);
		},
		rewriteAsset: () => "changed",
	});
	expect(assets).toEqual([]);
	expect(rewritten).toEqual([page]);
	const input = {
		id: "c",
		title: "C",
		sourceLocale: "en",
		content: [page],
		htmlOutput: { islandAssets: compilerIslandAssets },
	};
	const decorated = await createCourseContext(input);
	const pristine = await createCourseContext({
		...input,
		content: [{ ...page, blocks: [{ ...page.blocks[0], data: { content: "<p>Read</p>" } }] }],
	});
	expect(decorated.pages[0].sourceDigest).toBe(pristine.pages[0].sourceDigest);
	expect(decorated.pages[0].assetPaths).toEqual(pristine.pages[0].assetPaths);
	expect(getPageDependencies(decorated, "p", "fragments")).toEqual(
		getPageDependencies(pristine, "p", "fragments"),
	);
});
