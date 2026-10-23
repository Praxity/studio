import { describe, expect, it } from "vitest";
import { getFocusReadingRows, isFocusDimExemptBlock } from "./focus-mode-runtime";

function scope(html: string): HTMLElement {
	const root = document.createElement("main");
	root.innerHTML = html;
	return root;
}

describe("reading guide rows", () => {
	it("uses top-level blocks across authored sections as rows", () => {
		const root = scope(`
			<section class="praxity-section" data-section-index="0">
				<div data-block-id="first" data-focus-row></div>
			</section>
			<section class="praxity-section" data-section-index="1">
				<div data-block-id="second" data-focus-row></div>
			</section>
		`);

		expect(getFocusReadingRows(root).map(([row]) => row?.dataset.blockId)).toEqual([
			"first",
			"second",
		]);
	});

	it("makes every top-level block its own row and keeps columns whole", () => {
		const root = scope(`
			<section class="praxity-section" data-section-index="0">
				<div class="praxity-block" data-block-id="intro" data-focus-row></div>
				<div class="praxity-block" data-block-id="h1" data-focus-row data-focus-exempt="heading"></div>
				<div class="praxity-block" data-block-id="body" data-focus-row></div>
				<div class="praxity-block" data-block-id="columns" data-focus-row>
					<div class="praxity-block" data-block-id="left" data-focus-row></div>
					<div class="praxity-block" data-block-id="right" data-focus-row></div>
				</div>
				<div class="praxity-block" data-block-id="h2" data-focus-row data-focus-exempt="heading"></div>
				<div class="praxity-block" data-block-id="end" data-focus-row></div>
			</section>
		`);

		expect(
			getFocusReadingRows(root).map((row) => row.map((block) => block.dataset.blockId)),
		).toEqual([["intro"], ["h1"], ["body"], ["columns"], ["h2"], ["end"]]);
	});

	it("keeps an image and caption atomic and includes unknown row types by default", () => {
		const root = scope(`
			<figure data-block-id="image" data-focus-row><img><figcaption>Caption</figcaption></figure>
			<div data-block-id="future" data-focus-row></div>
		`);

		expect(
			getFocusReadingRows(root).map((row) => row.map((block) => block.dataset.blockId)),
		).toEqual([["image"], ["future"]]);
	});
});

describe("focus dimming exemptions", () => {
	it("uses the exemption attribute without a block-type list", () => {
		for (const type of ["heading", "button"]) {
			expect(
				isFocusDimExemptBlock(
					scope(`<div data-focus-exempt="${type}"></div>`).firstElementChild as HTMLElement,
				),
			).toBe(true);
		}
		expect(
			isFocusDimExemptBlock(scope("<div data-focus-row></div>").firstElementChild as HTMLElement),
		).toBe(false);
	});
});
