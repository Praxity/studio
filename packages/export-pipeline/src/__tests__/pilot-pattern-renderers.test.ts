import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { expect, it } from "vitest";
import { renderBlockHtml } from "../render-block-html.ts";
import fixtures from "./fixtures/pilot-pattern-renderers.json";

// Literal pre-extraction output, including wrapper whitespace, focus markers,
// sanitization, locale precedence and the existing note/heading domain rules.
it.each(fixtures)(
	"$name: source $block.data.sourceUrl, locale $options.sourceLocale",
	({ block, options, html }) => {
		const { hiddenBlockIds, ...rest } = options as typeof options & { hiddenBlockIds?: string[] };
		expect(
			renderBlockHtml(block as PraxityBlock, {
				...rest,
				hiddenBlockIds: hiddenBlockIds ? new Set(hiddenBlockIds) : undefined,
			}),
		).toBe(html);
	},
);
