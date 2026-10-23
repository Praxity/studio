import { JSDOM } from "jsdom";
import { expect, it } from "vitest";
import { cutoverCoverageHtml } from "../fixtures/cutover-coverage";

it("publishes converted containers, table alignment and required rating controls", () => {
	const dom = new JSDOM(cutoverCoverageHtml());
	try {
		const document = dom.window.document;
		expect(document.querySelectorAll('.praxity-tabs-static [role="tab"]')).toHaveLength(2);
		expect(document.querySelector("table")?.textContent).toContain("Read pressure");
		expect(document.querySelectorAll("[data-disclosure-trigger]")).toHaveLength(2);
		expect(document.body.textContent).toContain("Which action helps?");
		expect(document.body.textContent).toContain("Read the explanation.");
	} finally {
		dom.window.close();
	}
});
