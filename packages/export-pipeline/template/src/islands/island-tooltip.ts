import { shouldAttachIslandAutomatically } from "@praxity/shared-blocks/self-check-consumers";
import { initInlineTooltips } from "@praxity/shared-blocks/viewer/inline-tooltips";

const rawConfig = document.getElementById("praxity-config")?.textContent;
let definitionCue = "";
let newTabText = "";
let glossary: { href: string; label: string } | undefined;
if (rawConfig) {
	try {
		const config = JSON.parse(rawConfig) as {
			strings?: {
				definitionAvailable?: unknown;
				opensInNewTab?: unknown;
				fullGlossary?: unknown;
			};
			glossaryEnabled?: boolean;
		};
		if (typeof config.strings?.definitionAvailable === "string") {
			definitionCue = config.strings.definitionAvailable;
		}
		if (typeof config.strings?.opensInNewTab === "string") {
			newTabText = config.strings.opensInNewTab;
		}
		if (config.glossaryEnabled && typeof config.strings?.fullGlossary === "string") {
			glossary = {
				href: "glossary.html",
				label: config.strings.fullGlossary,
			};
		}
	} catch {
		// Keep the tooltip usable without the optional assistive cue.
	}
}
export function attachIsland() {
	initInlineTooltips(definitionCue, newTabText, glossary);
}
if (shouldAttachIslandAutomatically()) attachIsland();
