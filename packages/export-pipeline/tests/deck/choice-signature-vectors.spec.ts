import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { build } from "esbuild";
import vectors from "../../../shared-blocks/tests/fixtures/choice-signature-vectors.json" with {
	type: "json",
};

let script: string;
let page: Page;
test.beforeAll(async ({ browser }) => {
	const result = await build({
		stdin: {
			contents: `import { choiceMaterialContent, choiceMaterialSignature, choiceContentSignature } from '@praxity/shared-blocks/assessment-choice';
import vectors from '../shared-blocks/tests/fixtures/choice-signature-vectors.json';
window.choiceVectors = {
 literals: vectors.vectors.map(({html}) => { const canonical = choiceMaterialContent(html); return {canonical, hash: choiceMaterialSignature(canonical)}; }),
 question: choiceContentSignature({...vectors.question.data, stem: 'Pick'}, false)
};`,
			resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
			loader: "ts",
		},
		bundle: true,
		write: false,
		platform: "browser",
		format: "iife",
		loader: { ".css": "empty" },
	});
	script = result.outputFiles[0].text;
	page = await browser.newPage();
	await page.setContent("<!doctype html><title>Choice vectors</title>");
});
test.afterAll(async () => {
	await page?.context().close();
});

test("browser canonical trees and SHA-256 match the shared Node literals", async () => {
	await page.addScriptTag({ content: script });
	const actual = await page.evaluate(
		() => (window as unknown as { choiceVectors: unknown }).choiceVectors,
	);
	expect(actual).toEqual({
		literals: vectors.vectors.map(({ canonical, hash }) => ({ canonical, hash })),
		question: vectors.question.hash,
	});
});
