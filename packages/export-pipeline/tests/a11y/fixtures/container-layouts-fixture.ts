import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readLesson, serializeFrontmatter } from "@praxity/grammar";
import { DEFAULT_DESIGN_VARIANTS } from "../../../../editor-core/src/lib/themes/design-variant-defaults";
import { THEME_PRESET_DEFAULTS } from "../../../../editor-core/src/lib/themes/theme-preset-defaults";
import type { DesktopExportInput } from "../../../src/build";

export function containerLayoutsFixture(): { route: string; course: DesktopExportInput } {
	const body =
		'# Card rows\n\n::: cards {layout=rows style=none shadow=none}\n:: Before the meeting {level=3}\nRead the agenda and identify the decision the group needs to make.\n\n- Check the room booking.\n- Send the relevant documents.\n\n:: After the meeting {level=3}\nRecord the decision and assign the next action to a named person.\n:::\n\n# Narrow card rows {hideTitle}\n\n::: columns\n::\n::: cards {layout=rows style=none shadow=none}\n:: Before the meeting\nRead the agenda.\n\n- Check the room booking.\n- Send the documents.\n\n:: After the meeting\nRecord the decision.\n:::\n\n:: {weight=2}\nThis wider column supplies context for the narrow card rows beside it.\n:::\n\n# Media flush {hideTitle}\n\n::: cards {layout=grid columns=2 style=outline media=flush}\n:: Review the request {level=3}\n![Example illustration for the request](/assets/test-image.webp){ratio=16:9 fit=cover}\n\nRead the request before updating the invite.\n\n:: Confirm the booking {level=3}\n![Example illustration for the booking](/assets/test-image-wide.webp){ratio=16:9 fit=cover}\n\nCheck that the booking matches the new date.\n:::\n\n# Media inset {hideTitle}\n\n::: cards {layout=grid columns=2 style=outline media=inset}\n:: Keep the whole illustration {level=3}\n![Complete example illustration](/assets/test-image.webp){ratio=16:9 fit=contain}\n\nAll of the illustration remains in the frame.\n:::\n\n# Media rows flip {hideTitle}\n\n::: cards {layout=rows media=flush style=outline}\n:: Review the illustration {level=3}\n::: figure\n![Front illustration](/assets/test-image.webp){ratio=16:9 fit=contain}\nFront image credit\n:::\n\nRead this before revealing the explanation.\n\n::: back\nKeep this explanation before the back image.\n\n::: figure\n![Back illustration](/assets/test-image-wide.webp)\nBack image credit\n:::\n:::\n:::\n\n# Media slides flip {hideTitle}\n\n::: cards {layout=slides media=flush style=outline}\n:: Review the illustration {level=3}\n::: figure\n![Front illustration](/assets/test-image.webp){ratio=16:9 fit=contain}\nFront image credit\n:::\n\nRead this before revealing the explanation.\n\n::: back\nKeep this explanation before the back image.\n\n::: figure\n![Back illustration](/assets/test-image-wide.webp)\nBack image credit\n:::\n:::\n:::\n\n# Media masonry flip {hideTitle}\n\n::: cards {layout=masonry media=flush style=outline}\n:: Review the illustration {level=3}\n::: figure\n![Front illustration](/assets/test-image.webp){ratio=16:9 fit=contain}\nFront image credit\n:::\n\nRead this before revealing the explanation.\n\n::: back\nKeep this explanation before the back image.\n\n::: figure\n![Back illustration](/assets/test-image-wide.webp)\nBack image credit\n:::\n:::\n:::\n\n# Comparison columns {hideTitle}\n\n::: comparison {layout=side-by-side}\n:: Brief request {level=3}\nCheck the date.\n\n:: Detailed request {level=3}\nCheck the date, time, room booking, attendee list and supporting documents before sending the revised invitation.\n:::\n\n# Weighted columns {hideTitle}\n\n::: columns\n::\nShort example.\n\n:: {weight=2}\nThe explanation has twice the available column width. Both columns must remain readable when they stack.\n:::\n\n# Row table {hideTitle}\n\n::: table {header=column gridlines=rows columnAlignments="left, left" striped=false}\n| Inspect | Read the request and check the room booking before changing the invitation. |\n| Prepare | Keep the attendee list with the request so the next person can check it. |\n| Confirm | Confirm the final date and share the updated invitation with the group. |\n:::\n\n# Automatic table {hideTitle}\n\n::: table {header=column gridlines=rows width=wide}\n| @icon{shield} Inspect | Read the request carefully and check that the room booking meets the requirements before changing the invitation. |\n| @icon{users} Prepare | Keep the attendee list and supporting documents with the request so another person can check the details before making changes. |\n| @icon{home} Confirm | Confirm the final date with the organizer and share the updated invitation with everyone who needs to attend. |\n:::\n\n# Compact table {hideTitle}\n\n::: table {header=column gridlines=rows}\n| Observatory responsibility for reliable instruments | 27 |\n| Protecting lenses from accidental damage | 123 |\n| Maintaining accurate tracking throughout the night | 45 |\n:::\n\n# Prose table {hideTitle}\n\n::: table {header=none gridlines=rows}\n| Review the request with the organizer and confirm which changes need to be made before updating the invitation. | Read the supporting documents carefully and check that the proposed changes meet the requirements for the meeting. |\n| Keep the attendee list with the request so another person can check the details before making changes. | Confirm the final date with everyone who needs to attend and record the decision with the supporting documents. |\n:::\n\n# Long table token {hideTitle}\n\n::: table {gridlines=rows}\n| Identifier | Status |\n| abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789 | Recorded |\n:::\n\n# Narrow reading {hideTitle}\n\n::: note {width=narrow}\nA short note keeps its normal text size while its reading measure becomes narrower.\n:::\n\n::: quote {width=narrow}\nA useful quotation can stand apart through its measure without centering the words.\n:::\n\n::: cards {layout=slides width=narrow}\n:: A narrow card {level=3}\nThe card keeps its single-card presentation within a narrower reading measure.\n:::\n\nNormal-width surrounding prose.\n';
	// Exercise the saved-source path as well as rendering, including table controls.
	const saved = readLesson(body)
		.tree.stream.tokens.map((token) => token.raw)
		.join("");
	const parsed = readLesson(
		serializeFrontmatter(
			{
				title: "Container layouts",
				lang: "en",
				design: {
					...DEFAULT_DESIGN_VARIANTS,
					...THEME_PRESET_DEFAULTS.standard,
					colorMode: "light",
					navArchetype: "minimal",
				},
			},
			saved,
		),
	);
	// These publisher controls remain supported in stored models. They have no
	// G4 spelling; retain their original values after reading valid G4 content.
	for (const page of parsed.pages) {
		for (const block of page.blocks) {
			if (block.type === "card" && page.title === "Media inset") block.data.columns = 1;
			if (block.type !== "table") continue;
			if (["Row table", "Automatic table"].includes(page.title)) {
				Object.assign(block.data, { shadeHeaders: false, firstRowLine: false });
			}
			if (page.title === "Row table") block.data.firstColLine = true;
		}
	}
	return {
		route: "container-layouts",
		course: {
			courseId: "container-layouts",
			blocks: parsed.blocks,
			frontmatter: parsed.frontmatter ?? {},
			config: { completionThreshold: 0.8 },
			resolvedAssets: new Map(
				["test-image.webp", "test-image-wide.webp"].map((name) => [
					`assets/${name}`,
					readFileSync(
						resolve(import.meta.dirname, "../../../../../docs/test-fixtures/assets", name),
					),
				]),
			),
			viewerVersion: "local",
			locale: "en",
		},
	};
}
