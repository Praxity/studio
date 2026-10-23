import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { bundleViewer } from "../../../src/bundle-viewer";
import { buildExportCssBundle } from "../../../src/export-css";
import { generateCourseCss } from "../../../src/html-gen";
import { renderWriteDistractors } from "../../../src/patterns/write-distractors/render";
import {
	admitWriteDistractorsRuntime,
	captureWriteDistractorsRuntime,
	writeDistractorsContentInput,
	writeDistractorsPageAssets,
	writeDistractorsRuntimeAssets,
} from "../../../src/write-distractors";

/** Focused presentation fixture. Built exports are covered by write-distractors-acceptance.spec.ts. */
export async function writeDistractorsHarness(directory: string) {
	await mkdir(directory, { recursive: true });
	const { manifest } = await bundleViewer(directory);
	await buildExportCssBundle(directory);
	await cp(join(directory, "islands"), directory, { recursive: true });
	const uiCss = await readFile(join(directory, manifest.css), "utf8");
	const patternCss = await readFile(join(directory, manifest.writeDistractorsCss ?? ""), "utf8");
	const baseCss = await readFile(join(directory, "styles-lite.css"), "utf8");
	const payloads: Array<{ path: string; raw: number; gzip: number }> = [];
	for (const lang of ["en", "fr"] as const) {
		const input = writeDistractorsContentInput("wd", {
			question:
				lang === "en"
					? "When should access needs be considered?"
					: "Quand faut-il prendre en compte les besoins d'accès ?",
			rightAnswer:
				lang === "en"
					? "Throughout the design process."
					: "Tout au long du processus de conception.",
			count: 2,
			misconceptions: [
				{ id: "late", label: lang === "en" ? "Access comes last" : "L'accès vient en dernier" },
				{
					id: "average",
					label:
						lang === "en" ? "Everyone has the same needs" : "Tout le monde a les mêmes besoins",
				},
			],
			authorOptions: [
				{ misconception: "late", text: "AUTHOR-OPTION-PRIVATE-ONE" },
				{ misconception: "average", text: "AUTHOR-OPTION-PRIVATE-TWO" },
			],
		});
		const prompt = {
			question: input.content.question,
			count: 2 as const,
			items: [{ id: "late" }, { id: "average" }],
		};
		const blocks: PraxityBlock[] = [
			{ id: input.blockId, type: "writeDistractors", data: { content: prompt } },
		];
		const runtime = admitWriteDistractorsRuntime(
			[{ id: "practice", title: "Practice", blocks }],
			captureWriteDistractorsRuntime({ writeDistractorsContents: [input] }),
		);
		const [asset] = writeDistractorsRuntimeAssets(runtime);
		const [reference] = writeDistractorsPageAssets(runtime, blocks);
		if (!asset || !reference) throw new Error("Missing distractor fixture asset");
		await mkdir(join(directory, "write-distractors"), { recursive: true });
		await writeFile(join(directory, asset.path), asset.bytes);
		payloads.push({
			path: asset.path,
			raw: asset.bytes.length,
			gzip: gzipSync(asset.bytes).length,
		});
		for (const theme of ["light", "dark"] as const) {
			await writeFile(
				join(directory, `${lang}-${theme}.css`),
				`${patternCss}\n${baseCss}\n${uiCss}\n${generateCourseCss({ colorMode: theme })}`,
			);
			const markup = renderWriteDistractors(prompt, {
				prefix: "wd",
				lang,
				headingLevel: 2,
				reference,
			});
			const fixture = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Practice</title><link rel="stylesheet" href="${lang}-${theme}.css"><script src="${manifest.selfCheckLifetime}"></script></head><body><main data-praxity-root class="praxity-page-content"><h1>${lang === "en" ? "Design for access" : "Concevoir pour l'accès"}</h1>${markup}</main><script>
    window.fixtureState = new Map(); window.fixtureWrites = []; window.fixtureSaveFailure = false; window.fixtureDeviceScope = "shared-device";
    window.installFixtureProvider = () => {window.__praxityBlockState = {get: id => window.fixtureState.get(id), set: (id, value) => {if (window.fixtureSaveFailure) throw new Error("Fixture storage unavailable"); window.fixtureState.set(id, value); window.fixtureWrites.push({id, value});}, getSaveResult: () => window.fixtureWrites.length ? {status: 'saved', destination: 'device'} : undefined, getPolicy: () => 'device', getDeviceScope: () => window.fixtureDeviceScope}; const owner = window.__praxitySelfCheckDocument; owner.admit(owner.lifetime());};
    if (!new URL(location.href).searchParams.has('pending')) window.installFixtureProvider();
    window.addEventListener('pageshow', event => {if (event.persisted) {const owner = window.__praxitySelfCheckDocument; owner.admit(owner.lifetime());}});
    </script><script type="module">import {attachIsland} from "./${manifest.islands["island-write-distractors"]}"; window.releaseDistractors = attachIsland(); window.remountDistractors = () => {window.releaseDistractors = attachIsland();};</script></body></html>`;
			await writeFile(join(directory, `${lang}-${theme}.html`), fixture);
			const bootstrap = fixture
				.replace(
					"<html ",
					`<html data-praxity-islands="writeDistractors" data-island-write-distractors="${manifest.islands["island-write-distractors"]}" `,
				)
				.replace(
					/<script type="module">[\s\S]*?<\/script>/,
					`<script defer src="${manifest.islands["island-loader"]}"></script>`,
				)
				.replace(
					"data-write-distractors ",
					'data-island="writeDistractors" data-write-distractors ',
				);
			await writeFile(join(directory, `${lang}-${theme}-bootstrap.html`), bootstrap);
		}
	}
	await writeFile(join(directory, "payloads.json"), JSON.stringify(payloads, null, 2));
	return manifest;
}
