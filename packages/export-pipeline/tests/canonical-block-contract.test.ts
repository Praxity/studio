import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contrastRatio } from "@praxity/shared-blocks/color-math";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { buildScormPackage } from "../src/build";
import { renderBlockHtml } from "../src/render-block-html";

function render(
	type: PraxityBlock["type"],
	data: Record<string, unknown>,
	a11y?: PraxityBlock["a11y"],
) {
	return new JSDOM(renderBlockHtml({ id: "source-id", type, data, a11y })).window.document;
}

describe("canonical block contracts retained from the React projections", () => {
	it("keeps canonical quote attribution in small, normal, contrasting ink", () => {
		const document = render("quote", { text: "Quoted words.", speaker: "Speaker" });
		expect(document.querySelector("figcaption.praxity-quote-attribution")?.textContent).toBe(
			"Speaker",
		);
		const css = readFileSync(
			resolve(import.meta.dirname, "../../shared-blocks/src/blocks/shared-blocks.css"),
			"utf8",
		);
		const rule = css.match(/\.praxity-quote-attribution\s*\{([^}]*)\}/)?.[1];
		expect(rule).toContain("color: var(--ink-2)");
		expect(rule).toContain("font-size: var(--type-small)");
		expect(rule).toContain("font-style: normal");
		expect(rule).not.toMatch(/font-style\s*:\s*italic/);
		expect(contrastRatio("#1f2900", "#faf9f7")).toBeGreaterThanOrEqual(4.5);
	});

	it("keeps canonical quotes free of surfaces and generated quotation marks", () => {
		const document = render("quote", { text: "Quoted words.", speaker: "Speaker" });
		expect(document.querySelector("figure.praxity-quote blockquote")?.textContent).toBe(
			"Quoted words.",
		);
		const css = readFileSync(
			resolve(import.meta.dirname, "../../shared-blocks/src/blocks/shared-blocks.css"),
			"utf8",
		);
		const rule = css.match(/\.praxity-quote\s*\{([^}]*)\}/)?.[1];
		// The border and indent identify the quotation; generated marks are redundant.
		expect(rule).not.toMatch(/\bbackground(?:-color)?\s*:/);
		expect(rule).toMatch(/border-inline-start\s*:/);
		expect(css).not.toContain(".praxity-quote::before");
		expect(css).not.toContain(".praxity-quote::after");
	});

	it.each(["narrow", "wide"])(
		"retains source identity, focus rows and %s layout",
		async (layout) => {
			const result = await buildScormPackage(
				{
					id: "layouts",
					title: "Layouts",
					sourceLocale: "en",
					content: [
						{
							id: "page",
							title: "Page",
							blocks: [
								{
									id: "source-id",
									type: "text",
									data: { content: "<p>Hello</p>", layoutMode: layout },
								},
							],
						},
					],
				},
				{ format: "html" },
			);
			const zip = new AdmZip(result.zip);
			const entry = zip
				.getEntries()
				.find(
					(entry) =>
						entry.entryName.endsWith(".html") &&
						zip.readAsText(entry).includes('data-block-id="source-id"'),
				);
			expect(entry).toBeTruthy();
			if (!entry) throw new Error("Missing compiled layout fixture");
			const document = new JSDOM(zip.readAsText(entry)).window.document;
			const wrapper = document.querySelector('[data-block-id="source-id"]');
			expect(wrapper?.getAttribute("data-node-id")).toBe("source-id");
			expect(wrapper?.hasAttribute("data-focus-row")).toBe(true);
			expect(wrapper?.classList.contains(`praxity-layout-${layout}`)).toBe(true);
			expect(wrapper?.textContent).toBe("Hello");
		},
	);
	it.each(["side-by-side", "slider"])("retains comparison alt aliases in %s output", (display) => {
		const document = render("imageComparison", {
			display,
			beforeImage: { src: "/before.png", alt: "Before & after training" },
			afterImage: { src: "/after.png", alt: "Alias description", altText: "Preferred description" },
		});
		expect(document.querySelector('img[src="/before.png"]')?.getAttribute("alt")).toBe(
			"Before & after training",
		);
		expect(document.querySelector('img[src="/after.png"]')?.getAttribute("alt")).toBe(
			"Preferred description",
		);
	});
	it.each(["all", "click", "sequential"])(
		"retains decorative graphic alternatives in %s output",
		(reveal) => {
			for (const imageAlt of ["", "Annotated diagram"]) {
				for (const flags of [
					{ data: { decorative: true }, decorative: true },
					{ data: {}, a11y: { decorative: true }, decorative: true },
					{ data: {}, decorative: false },
					{ data: { decorative: false }, decorative: false },
					{ data: { decorative: "true" }, decorative: false },
				]) {
					const document = render(
						"labeledGraphic",
						{ imageSrc: "/picture.png", imageAlt, labels: [], reveal, ...flags.data },
						flags.a11y,
					);
					const group = document.querySelector('.praxity-labeled-graphic[role="group"]');
					const image = group?.querySelector("img");
					expect(image?.getAttribute("alt")).toBe(
						flags.decorative ? "" : imageAlt || "Labeled graphic",
					);
					expect(image?.getAttribute("role")).toBe(flags.decorative ? "presentation" : null);
					expect(group?.getAttribute("aria-label")).toBe(imageAlt || "Labeled graphic");
				}
			}
		},
	);
	it("retains dialogue speaker names, continuation and source positions", () => {
		const document = render("dialogue", {
			turns: [
				{ id: "one", speaker: "Alex", name: "Alex", avatar: "NoNe", paragraphs: ["Hello"] },
				"junk",
				{ id: "two", speaker: " aLEX ", name: "Alex", paragraphs: ["Again"] },
				{ id: "three", speaker: "Sam", name: "Sam", avatar: "sam.png", paragraphs: ["Reply"] },
			],
		});
		const turns = Array.from(document.querySelectorAll("ol > li"));
		expect(turns.map((turn) => turn.getAttribute("data-turn-index"))).toEqual(["0", "2", "3"]);
		expect(turns.map((turn) => turn.querySelector(".praxity-dialogue-name")?.textContent)).toEqual([
			"Alex",
			"Alex",
			"Sam",
		]);
		expect(turns[1].getAttribute("data-continuation")).toBe("true");
		expect(
			turns[1].querySelector(".praxity-dialogue-name")?.classList.contains("praxity-sr-only"),
		).toBe(true);
		expect(turns[0].querySelector("img")).toBeNull();
		expect(turns[2].querySelector("img")?.getAttribute("alt")).toBe("");
		expect(turns[2].querySelector("img")?.getAttribute("role")).toBe("presentation");
		expect(document.querySelector("[aria-live]")).toBeNull();
	});
	it("retains a named image caption link and one original image for retired effects", () => {
		const document = render("image", {
			src: "image.png",
			altText: "Portrait",
			decorative: false,
			caption: "Photograph by [Mira Vale](https://unsplash.com/photos/demo-star-07)",
			treatment: "grayscale",
			effects: { progressiveBlur: { intensity: 8 } },
		});
		expect(document.querySelectorAll("img")).toHaveLength(1);
		expect(document.querySelector("img")?.getAttribute("alt")).toBe("Portrait");
		expect(document.querySelector("figcaption a")?.textContent).toBe("Mira Vale");
		expect(document.querySelector("figcaption a")?.getAttribute("href")).toBe(
			"https://unsplash.com/photos/demo-star-07",
		);
		expect(document.querySelector('[class*="praxity-image-treatment-"]')).toBeNull();
		expect(document.querySelector(".praxity-blur-clone")).toBeNull();
	});
});
