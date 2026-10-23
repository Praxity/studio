import { copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getRetrievalSheetStrings } from "@praxity/shared-blocks/i18n/retrieval-sheet-strings";
import type { RetrievalSheetContent } from "@praxity/shared-blocks/types";
import { strings } from "learning-patterns/patterns/retrieval-sheet/strings.js";
import { fingerprintedStylesheetName } from "../../../src/build";
import { computeViewerSourceHash, readViewerManifest } from "../../../src/bundle-viewer";
import { buildExportCssBundle } from "../../../src/export-css";
import { generateCourseCss, generateHtmlPage } from "../../../src/html-gen";
import { renderRetrievalSheet } from "../../../src/patterns/retrieval-sheet/render";
import { planPageRuntime } from "../../../src/runtime-plan";
import { readCachedViewer, VIEWER_CACHE_DIR } from "../../../src/viewer-cache";

// A direct renderer harness, never an admission exception in the compiler.
export async function writeRetrievalSheetHarness(
	directory: string,
	enhanced = false,
	printFixtures = false,
): Promise<void> {
	await buildExportCssBundle(directory);
	// The suite's global setup (or focused runner) prepares the viewer once.
	// Worker restarts reuse those bytes; no full viewer build happens in this file.
	const prepared =
		process.env.PRAXITY_RETRIEVAL_ASSETS_DIR ??
		(await readCachedViewer(VIEWER_CACHE_DIR, await computeViewerSourceHash()))?.directory;
	if (!prepared) throw new Error("Prepare viewer assets before running the retrieval-sheet spec.");
	const manifest = await readViewerManifest(prepared);
	const island = manifest.islands["island-retrieval-sheet"];
	if (enhanced) {
		await copyFile(
			resolve(prepared, "islands", island),
			resolve(directory, "retrieval-controls.js"),
		);
	}
	const sheetCss = await readFile(resolve(prepared, manifest.retrievalSheetCss));
	const sheetStylesheet = fingerprintedStylesheetName(manifest.retrievalSheetCss, sheetCss);
	await writeFile(resolve(directory, sheetStylesheet), sheetCss);
	await copyFile(resolve(prepared, manifest.css), resolve(directory, manifest.css));
	await copyFile(resolve(prepared, manifest.shell), resolve(directory, manifest.shell));
	const baseCss = `${await readFile(resolve(directory, "styles-lite.css"), "utf8")}\n${await readFile(resolve(directory, manifest.css), "utf8")}${printFixtures ? `\n${await readFile(resolve(prepared, manifest.deckCss), "utf8")}` : ""}`;
	for (const lang of ["en", "fr"] as const) {
		for (const colorMode of ["light", "dark"] as const) {
			for (const variant of printFixtures ? [1, 3, 8, "8-short"] : [3, 8]) {
				const rows = typeof variant === "number" ? variant : 8;
				const shortAnswers = variant === "8-short";
				const content: RetrievalSheetContent = {
					title: lang === "en" ? "Design approaches" : "Approches de conception",
					questions: Array.from({ length: rows }, (_, i) => ({
						id: `q${i + 1}`,
						question: (lang === "en"
							? [
									"What does universal design consider?",
									"What does an accommodation address?",
									"When should access needs be considered?",
								]
							: [
									"Que prévoit la conception universelle ?",
									"À quoi répond une adaptation ?",
									"Quand faut-il prendre en compte les besoins d’accès ?",
								])[i % 3],
						answer:
							rows === 8 && i === 7 && !shortAnswers
								? (lang === "en"
										? "A longer answer remains readable as the sheet grows: consider people, environments and changing needs throughout the design process. "
										: "Une réponse plus longue reste lisible sur la fiche : tenez compte des personnes, des environnements et de l’évolution des besoins tout au long de la conception. "
									).repeat(5) + "internationalisation".repeat(5)
								: (lang === "en"
										? [
												"Diverse users from the start.",
												"An individual's access need.",
												"Throughout the design process.",
											]
										: [
												"La diversité des personnes dès le départ.",
												"Le besoin d’accès d’une personne.",
												"Tout au long du processus de conception.",
											])[i % 3],
					})),
				};
				if (shortAnswers) {
					const pairs =
						lang === "en"
							? [
									["Who is included?", "People with varied abilities."],
									["When is access considered?", "Throughout design."],
									["What is an accommodation?", "A change for an individual's access need."],
									["What does a caption convey?", "Speech and meaningful sounds."],
									["What helps keyboard users?", "Visible focus and keyboard controls."],
									["What does alt text explain?", "An image's relevant meaning."],
									["What makes instructions clear?", "Plain words and explicit steps."],
									["How are barriers found?", "Test with people with access needs."],
								]
							: [
									["Qui est inclus ?", "Des personnes aux capacités variées."],
									["Quand penser à l’accès ?", "Tout au long de la conception."],
									[
										"Qu’est-ce qu’une adaptation ?",
										"Un changement pour un besoin d’accès individuel.",
									],
									["Que transmet un sous-titre ?", "La parole et les sons pertinents."],
									[
										"Qu’est-ce qui aide au clavier ?",
										"Un focus visible et des commandes au clavier.",
									],
									["Que décrit un texte alternatif ?", "Le sens pertinent d’une image."],
									[
										"Qu’est-ce qu’une consigne claire ?",
										"Des mots simples et des étapes explicites.",
									],
									[
										"Comment trouver les obstacles ?",
										"Tester avec des personnes ayant des besoins d’accès.",
									],
								];
					content.questions = pairs.map(([question, answer], index) => ({
						id: `q${index + 1}`,
						question,
						answer,
					}));
				}
				if (printFixtures && rows === 8 && !shortAnswers) {
					for (const [index, row] of content.questions.entries()) {
						const sentence =
							lang === "en"
								? "Consider people, environments and changing access needs throughout the design process. "
								: "Tenez compte des personnes, des environnements et des besoins d’accès tout au long de la conception. ";
						row.answer = `${sentence.repeat(18).slice(0, 1400)} END-${index + 1}`;
					}
				}
				const sheet = renderRetrievalSheet(content, {
					prefix: "sheet-retrieval",
					lang,
					headingLevel: 1,
					strings: strings[lang],
					noDate: getRetrievalSheetStrings(lang).retrievalNoDate,
				});
				const stylesheet = `styles-${colorMode}.css`;
				await writeFile(
					resolve(directory, stylesheet),
					`${baseCss}\n${generateCourseCss({ colorMode })}`,
				);
				const emptyPage = { id: "sheet-page", title: content.title, blocks: [] };
				const config = {
					id: "sheet-course",
					title: content.title,
					sourceLocale: lang,
					pages: [emptyPage],
					totalPages: 1,
					colorMode,
					navigationStyle: "sidebar" as const,
					navToggles: { navTopBar: false, showA11yPill: false },
				};
				const runtimePlan = planPageRuntime(
					config,
					{
						...emptyPage,
						blocks: [
							{
								id: "sheet",
								type: "retrievalSheet",
								data: { content, level: 1 },
							},
						],
					},
					true,
				);
				// Renderer-only fixture: real publication guards remain active. Feed the
				// literal baseline into the production document/stylesheet path.
				const html = generateHtmlPage({
					config,
					page: emptyPage,
					index: 0,
					currentSlug: "sheet-page",
					slugList: [{ pageId: "sheet-page", slug: "sheet-page", title: content.title }],
					slugMap: new Map([["sheet-page", "sheet-page"]]),
					runtimePlan,
					shellFilename: manifest.shell,
					liteStylesheetFilename: stylesheet,
					retrievalSheetStylesheetFilename: sheetStylesheet,
					pageContentHtml: `<div class="praxity-block" data-block-type="retrievalSheet"${enhanced ? ' data-block-id="sheet"' : ""}>${sheet}</div>`,
				});
				await writeFile(
					resolve(directory, `${lang}-${colorMode}-${variant}.html`),
					enhanced
						? html.replace(
								"</body>",
								'<script type="module" src="retrieval-controls.js"></script></body>',
							)
						: html,
				);
			}
		}
	}
}
