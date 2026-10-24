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
			contents: `import {choiceContentSignature} from '@praxity/shared-blocks/assessment-choice';
import vectors from '../shared-blocks/tests/fixtures/choice-signature-vectors.json';
window.choiceVectors = vectors.vectors.map(({data}) => choiceContentSignature({...vectors.question.data, ...data}, false));`,
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

test("browser short signatures match the shared Node literals", async () => {
	await page.addScriptTag({ content: script });
	const actual = await page.evaluate(
		() => (window as unknown as { choiceVectors: unknown }).choiceVectors,
	);
	expect(actual).toEqual(vectors.vectors.map(({ hash }) => hash));
});
