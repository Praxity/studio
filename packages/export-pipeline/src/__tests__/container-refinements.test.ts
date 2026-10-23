// @vitest-environment jsdom
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { expect, it } from "vitest";
import { readBlockFixture as readBlockSource } from "../../../grammar/__tests__/helpers/lesson-fixture.ts";
import { renderBlockHtml } from "../render-block-html";

it.each(["grid", "rows", "masonry", "single"])(
	"renders %s media before its semantic label without dropping children",
	(layout) => {
		const blocks = adaptGrammarPreviewBlocks(
			readBlockSource(`::: cards {layout=${layout === "single" ? "slides" : layout} media=flush}
:: Room {level=3}
![Floor plan](/assets/room.png){ratio=16:9 fit=contain}

Keep all details.
:::
`).blocks,
		);
		const wrapper = document.createElement("div");
		wrapper.innerHTML = renderBlockHtml(blocks[0]);
		const card = wrapper.querySelector(".praxity-card")!;
		expect(card.children[0].className).toBe("praxity-card-media");
		expect(card.children[1].tagName).toBe("H3");
		expect(card.querySelectorAll("img")).toHaveLength(1);
		expect(card.textContent).toContain("Keep all details.");
		expect(card.querySelector("img")?.style.aspectRatio).toBe("16 / 9");
		expect(card.querySelector("img")?.style.objectFit).toBe("contain");
	},
);

it("keeps flip-front media before its label and preserves the back", () => {
	const blocks = adaptGrammarPreviewBlocks(
		readBlockSource(
			"# Untitled {hideTitle}\n\n::: cards {media=inset}\n:: Front {level=3}\n![Room](/assets/room.png)\n\nFront details.\n\n::: back\nBack details.\n:::\n:::\n",
		).blocks,
	);
	const html = renderBlockHtml(blocks[0]);
	expect(html.indexOf('class="praxity-card-media"')).toBeLessThan(
		html.indexOf('class="praxity-flashcard-face-heading"'),
	);
	expect(html).toContain("Back details.");
});

it("uses equal flex bases and safely keeps positive authored proportions", () => {
	const widths = [2, 1, undefined, -1, Infinity, "1; color:red"];
	const block = {
		id: "columns",
		type: "columns",
		data: { items: widths.map((width, index) => ({ id: String(index), width, children: [] })) },
	} as unknown as PraxityBlock;
	const html = renderBlockHtml(block);
	expect(html.match(/flex:6 1 0px/g)).toHaveLength(1);
	expect(html.match(/flex:3 1 0px/g)).toHaveLength(5);
	expect(html).not.toContain("color:red");
});

it("ignores untrusted image framing values", () => {
	const html = renderBlockHtml({
		id: "image",
		type: "image",
		data: { src: "/room.png", ratio: "1; color:red", fit: "cover; color:red" },
	} as PraxityBlock);
	expect(html).not.toContain("color:red");
	expect(html).not.toContain("aspect-ratio:");
	expect(html).toContain("object-fit:cover");
});

it("fills the row when authored fractional proportions sum to less than one", () => {
	const block = {
		id: "columns",
		type: "columns",
		data: {
			items: [
				{ id: "a", width: 0.2, children: [] },
				{ id: "b", width: 0.3, children: [] },
			],
		},
	} as PraxityBlock;
	const wrapper = document.createElement("div");
	wrapper.innerHTML = renderBlockHtml(block);
	const columns = [...wrapper.querySelectorAll<HTMLElement>(".praxity-column")];
	const weights = columns.map((column) => Number(column.style.flexGrow));
	expect(weights[0] / weights[1]).toBeCloseTo(2 / 3);
	expect(weights.reduce((sum, width) => sum + width, 0)).toBeGreaterThanOrEqual(1);
});

it("defaults a requested image frame to contain without changing legacy image defaults", () => {
	const html = renderBlockHtml({
		id: "image",
		type: "image",
		data: { src: "/room.png", ratio: "16:9" },
	} as PraxityBlock);
	expect(html).toContain("aspect-ratio:16 / 9");
	expect(html).toContain("object-fit:contain");
});
