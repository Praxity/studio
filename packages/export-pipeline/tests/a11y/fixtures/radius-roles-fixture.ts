import { readLesson } from "@praxity/grammar";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { normalizeDesignVariants } from "../../../../editor-core/src/lib/themes/normalize-design-variants";
import type { CourseExportInput } from "../../../src/build";
import { extractDesktopDesignFromFrontmatter } from "../../../src/desktop-design";

export function radiusRolesFixture(
	palette: string,
	colorMode: "light" | "dark",
	deck: boolean,
): CourseExportInput {
	const parsed = readLesson(`# Corner roles

::: choice Choose a response {level=3 shuffle}
(x) Ask a question
( ) Make an assumption
:::

::: match Match each item {level=3}
- First -> One
- Second -> Two
:::

::: free-response Your response {level=3}
placeholder: Write your response
:::

::: checklist
- [ ] Read the instructions
:::

::: rating Ten keys 
${Array.from({ length: 10 }, (_, i) => `${i + 1}. ${i === 0 ? "Low" : i === 9 ? "High" : i + 1}`).join("\n")}
:::

::: rating Eleven keys
1. Low
2. High
:::

::: tabs
:: First tab
First panel.
:: Second tab
Second panel.
:::

::: accordion
:: First detail {level=3}
First panel.
:: Second detail {level=3}
Second panel.
:::

::: table
| Item | Value |
|---|---|
| First | One |
:::

\`\`\`text
Code frame
\`\`\`

# Next page

Read the next page.
`);
	if (parsed.hasErrors) throw new Error(JSON.stringify(parsed.errors));
	// Grammar accepts up to ten scale labels; the renderer also accepts an eleven-key model.
	for (const block of parsed.blocks.filter((block) => block.type === "rating")) {
		const count = String(block.data.label).includes("Eleven") ? 11 : 10;
		block.data = {
			...block.data,
			style: "numeric",
			maxValue: count,
			scale: [
				{ id: `${block.id}-low`, value: 1, label: "Low" },
				{ id: `${block.id}-high`, value: count, label: "High" },
			],
		};
	}
	const content = splitBlocksIntoPages(parsed.blocks, "Corner roles");
	for (const [index, page] of content.entries()) {
		page.lessonId = "radius-module";
		page.lessonTitle = "Corner roles";
		page.isFirstPageOfLesson = index === 0;
	}
	return {
		...extractDesktopDesignFromFrontmatter({
			design: normalizeDesignVariants({ palette, colorMode }),
		}),
		id: `radius-${deck ? "deck" : "pages"}-${palette}-${colorMode}`,
		title: "Corner roles",
		sourceLocale: "en",
		content,
		navigationStyle: deck ? "slides" : "sidebar",
		...(deck ? { moduleDeck: { gates: {} }, deckDesign: { outline: true } } : {}),
	};
}
