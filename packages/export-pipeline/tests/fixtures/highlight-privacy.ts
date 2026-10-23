import { readLesson } from "@praxity/grammar";
import type { HighlightContent } from "@praxity/shared-blocks/types";
import { enhanceHighlight } from "../../src/patterns/highlight/enhance";
import { renderHighlight } from "../../src/patterns/highlight/render";
import { compilePage } from "../../src/preview/compile-page";
import { createCourseContext } from "../../src/preview/course-context";
import { renderBlockHtml } from "../../src/render-block-html";
import { highlightSource } from "./highlight-source";
import { compilerIslandAssets } from "./page-compiler";

function privacyContent(lang: "en" | "fr", index: number): HighlightContent {
	return {
		mode: index ? "evidence" : "key",
		title: `HL-PRIVATE-TITLE-${lang}`,
		question: `HL-PRIVATE-QUESTION-${lang}`,
		maxMarks: 2,
		paragraphs: [
			[
				{ id: "HL-one", text: `HL-PRIVATE-TEXT-${lang}`, key: true, note: "HL-PRIVATE-NOTE" },
				{ id: "HL-two", text: "HL-PRIVATE-SECOND", key: true },
				{ id: "HL-wrong", text: "HL-PRIVATE-WRONG", note: "HL-PRIVATE-WRONG-NOTE" },
			],
		],
	};
}

export function highlightPrivacyMarkup(): string {
	return (["en", "fr"] as const)
		.map((lang, index) => {
			const content = privacyContent(lang, index);
			return `<section ${index ? "hidden" : ""} data-block-type="highlight" data-block-id="HL-PRIVATE-${index}">${renderHighlight(content, { prefix: `HL-PRIVATE-${index}`, lang, headingLevel: 2 })}</section>`;
		})
		.join("");
}

/** Exercise both mounted instances, including the hidden one, checking every stage. */
export function exerciseHighlightPrivacy(
	doc: Document,
	check: () => void,
	reattach: (root: HTMLElement) => unknown = enhanceHighlight,
): void {
	for (const root of doc.querySelectorAll<HTMLElement>("[data-highlight]")) {
		const chunks = [...root.querySelectorAll<HTMLElement>("[data-highlight-chunk]")];
		for (const selection of [[], [0], [0, 1], [2], [0, 1, 2]]) {
			selection.forEach((index) => chunks[index].click());
			check();
			root.querySelector<HTMLButtonElement>("[data-highlight-check]")!.click();
			reattach(root);
			check();
			doc.defaultView!.dispatchEvent(new doc.defaultView!.Event("beforeprint"));
			doc.defaultView!.dispatchEvent(new doc.defaultView!.Event("afterprint"));
			check();
			root.querySelector<HTMLButtonElement>("[data-highlight-restart]")!.click();
			check();
		}
		chunks[0].click();
		root.querySelector<HTMLButtonElement>("[data-highlight-check]")!.click();
		check();
	}
}

export function highlightPrivacyChoice(): string {
	const choice = readLesson(
		"# Reading\n::: choice Report an ordinary answer. {required=false}\n(x) Ordinary answer\n( ) Other answer\n:::\n",
	).blocks.find((block) => block.type === "assessment");
	if (!choice) throw new Error("Missing reporting control");
	choice.id = "check";
	return renderBlockHtml(choice);
}

/** The actual preview compiler owns the wrappers and admitted source projection. */
export async function highlightPrivacyPreview(
	courseId: string,
	pageId: string,
	locale: "en" | "fr",
): Promise<string> {
	const source =
		"# Reading\n" +
		(["en", "fr"] as const)
			.map((lang, index) => highlightSource(privacyContent(lang, index), { hide: index === 1 }))
			.join("") +
		"::: choice Report an ordinary answer. {required=false}\n(x) Ordinary answer\n( ) Other answer\n:::\n";
	let nextId = 0;
	const read = readLesson(source, { ids: () => `HL-PRIVATE-${nextId++}` });
	if (read.hasErrors)
		throw new Error("Invalid highlight privacy source: " + JSON.stringify(read.diagnostics));
	read.pages[0].id = pageId;
	const choice = read.pages[0].blocks.find((block) => block.type === "assessment");
	if (!choice) throw new Error("Missing reporting control");
	choice.id = "check";
	const context = await createCourseContext({
		id: courseId,
		title: "Privacy course",
		sourceLocale: locale,
		content: read.pages,
		htmlOutput: {
			islandAssets: {
				...compilerIslandAssets,
				islandFilenames: { ...compilerIslandAssets.islandFilenames, highlight: "highlight.js" },
			},
		},
	});
	return compilePage(context, pageId).html;
}
