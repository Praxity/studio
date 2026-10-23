import { readLesson } from "@praxity/grammar";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import type { CourseExportInput } from "../../../src/build";

export function activityTypographyFixture(): CourseExportInput {
	const parsed = readLesson(`# Activity typography

::: categorize Classify each statement {level=3}
:: Paramètres de confidentialité et de sécurité pour les équipes internationales
- A statement the learner reads before choosing its category.
:: Cartes et coordonnées des instruments de notre observatoire
- Another statement with enough words to wrap on a phone.
:::

::: matrix Classify each row {level=3}
1. Paramètres de confidentialité et de sécurité pour les équipes internationales
2. Cartes et coordonnées des instruments de notre observatoire
- A matrix statement the learner must read.
:::

::: choice Choose one {level=3}
(x) A learner-read choice label.
( ) Another learner-read choice label.
:::

::: fill-blank Complete the paragraph {level=3}
This sentence has no input and follows the normal reading rhythm.
This sentence contains {an answer} for the learner to enter.
This final sentence has no input and follows the normal reading rhythm.
:::

::: button [i](https://example.com) {style=filled}
:::

::: button [Continue to the detailed explanation of the answer and review every step before starting the next activity](https://example.com) {style=filled}
:::
`);
	if (parsed.warnings.length) throw new Error(JSON.stringify(parsed.warnings));
	return {
		id: "activity-typography",
		title: "Activity typography",
		sourceLocale: "en",
		content: splitBlocksIntoPages(parsed.blocks, "Activity typography"),
		navigationStyle: "sidebar",
	};
}
