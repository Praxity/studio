import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HighlightContent } from "@praxity/shared-blocks/types";
import { build } from "esbuild";
import { buildExportCssBundle } from "../../../src/export-css";
import { generateCourseCss } from "../../../src/html-gen";
import { renderHighlight } from "../../../src/patterns/highlight/render";

export function highlightHarnessContent(
	lang: "en" | "fr",
	mode: "key" | "evidence",
): HighlightContent {
	return {
		mode,
		title: lang === "en" ? "A useful pause" : "Une pause utile",
		question:
			lang === "en" ? "Why say when you will return?" : "Pourquoi préciser l'heure de son retour ?",
		paragraphs:
			lang === "en"
				? [
						[
							{
								id: "pause",
								text: "You need a moment to think.",
								note: "This explains the pause, not the return time.",
							},
							{
								id: "return",
								text: "They know when to expect you.",
								key: true,
								note: "This gives a reason to say when you will return.",
							},
						],
						[
							{
								id: "time",
								text: "Agree on a time before leaving.",
								note: "This is advice rather than the reason asked for.",
							},
							{ id: "blue", text: "The wall is blue." },
						],
					]
				: [
						[
							{
								id: "pause",
								text: "Pourquoi partir ? Pour réfléchir.",
								note: "Ce détail décrit la pause.",
							},
							{
								id: "return",
								text: "Il dit : « Je reviens à midi ! »",
								key: true,
								note: "Une heure précise réduit l'incertitude.",
							},
						],
						[
							{ id: "time", text: "Une heure précise réduit l'incertitude.", key: true },
							{
								id: "blue",
								text: "Le mur est bleu.",
								note: "Cette couleur n'explique pas l'intérêt de préciser l'heure.",
							},
						],
					],
	};
}

/** Direct presentation fixture. Course publication remains refused by admission. */
export async function writeHighlightHarness(directory: string, delivery = false): Promise<void> {
	await mkdir(directory, { recursive: true });
	await buildExportCssBundle(directory);
	// Build the real shared CSS once. This fixture needs no viewer or learner bundle.
	const shared = await build({
		entryPoints: [
			join(import.meta.dirname, "../../../../shared-blocks/src/blocks/shared-blocks.css"),
		],
		bundle: true,
		write: false,
	});
	const css = `${await readFile(join(directory, "styles-lite.css"), "utf8")}\n${shared.outputFiles[0].text}\n${await readFile(join(import.meta.dirname, "../../../src/patterns/highlight/style.css"), "utf8")}`;
	for (const lang of ["en", "fr"] as const) {
		for (const theme of ["light", "dark"] as const) {
			await writeFile(
				join(directory, `${lang}-${theme}.css`),
				`${css}\n${generateCourseCss({ colorMode: theme })}`,
			);
			for (const mode of ["key", "evidence"] as const) {
				const content = highlightHarnessContent(lang, mode);
				const markup = `<div class="praxity-block"${delivery ? ' data-island="highlight"' : ""}>${renderHighlight(content, { prefix: `practice-${mode}`, lang, headingLevel: 2 })}</div>`;
				await writeFile(
					join(directory, `${mode}-${lang}-${theme}.html`),
					`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${content.title}</title><link rel="stylesheet" href="${lang}-${theme}.css"></head><body><main data-praxity-root class="praxity-page-content"><h1>${lang === "en" ? "Reading evidence" : "Lire les idées clés"}</h1>${markup}</main></body></html>`,
				);
			}
		}
	}
}
