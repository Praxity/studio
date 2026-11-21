import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { expect, it } from "vitest";
import { renderBlockHtml } from "../render-block-html.ts";
import fixtures from "./fixtures/choice-baseline.json";

it.each(fixtures)(
	"$name: description $block.data.description.0.data.content",
	({ block, options, html }) => {
		expect(renderBlockHtml(block as PraxityBlock, options)).toBe(html);
	},
);
