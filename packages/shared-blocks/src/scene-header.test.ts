import { expect, it } from "vitest";
import { renderSceneHeader } from "./scene-header";

it.each([1, 2, 3, 4, 5, 6, "p"] as const)(
	"preserves heading level %s, attributes and title markup",
	(headingLevel) => {
		const doc = document.implementation.createHTMLDocument();
		doc.body.innerHTML = renderSceneHeader({
			icon: "clipboard-check",
			headingLevel,
			titleHtml: "Review <em>your work</em>",
			headingAttributes: ' id="existing-title" tabindex="-1" class="praxity-assessment-stem"',
		});
		const heading = doc.getElementById("existing-title");
		expect(heading?.tagName.toLowerCase()).toBe(headingLevel === "p" ? "p" : `h${headingLevel}`);
		expect(heading?.getAttribute("tabindex")).toBe("-1");
		expect(heading?.querySelector("em")?.textContent).toBe("your work");
		expect(doc.querySelectorAll("h1,h2,h3,h4,h5,h6,p")).toHaveLength(1);
		expect(doc.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
		expect(doc.querySelector("svg")?.getAttribute("focusable")).toBe("false");
		expect(doc.querySelector('path[d="M9 14l2 2l4 -4"]')).not.toBeNull();
	},
);
