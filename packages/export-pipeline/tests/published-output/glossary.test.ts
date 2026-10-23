import { describe, expect, it } from "vitest";
import { getBuild, stylesheetEntry } from "./setup";

describe("published output — glossary", () => {
	it("renders authored tooltips as triggers and aggregates them into a glossary page", async () => {
		const { pages, zip } = await getBuild();

		const trigger = pages
			.flatMap((page) => [...page.document.querySelectorAll("[data-tooltip-content]")])
			.find((el) => el.textContent?.trim().startsWith("PPE"));
		expect(trigger?.getAttribute("data-tooltip-content")).toContain(
			"Personal Protective Equipment",
		);
		expect(trigger?.querySelector(":scope > .inline-tooltip-fallback")?.textContent).toContain(
			"Personal Protective Equipment",
		);

		const glossary = zip.readAsText("glossary.html");
		expect(glossary).toContain("PPE");
		expect(glossary).toContain("Web Content Accessibility Guidelines");
		expect(glossary.match(/<h1\b/g)).toHaveLength(1);
		const styles = zip.readAsText(stylesheetEntry(zip));
		expect(styles).toContain(".praxity-glossary-term-name");
		expect(styles).toContain(".praxity-glossary-term-definition");
	});
});
