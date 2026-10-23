// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import type { PraxityBlock } from "../../../shared-blocks/src/types";
import {
	clearRequiredValidation,
	showRequiredValidation,
} from "../../../shared-blocks/src/viewer/required-blocks";
import { initRatingEnhancements } from "../../template/src/islands/island-rating";
import { renderBlockHtml } from "../render-block-html";

afterEach(() => {
	clearRequiredValidation();
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

it.each(["stars", "emoji", "numeric", "likert", "slider"])(
	"required %s rating becomes invalid only when continuing without an answer",
	(style) => {
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: vi.fn(),
		});
		document.body.innerHTML = renderBlockHtml(
			{
				id: "rating",
				type: "rating",
				data: { label: "Rating", required: true, maxValue: 3, style },
			} as PraxityBlock,
			{ enabledIslands: new Set(["rating"]) },
		);
		const dispose = initRatingEnhancements();
		try {
			expect(
				document.querySelector("input[required], input:invalid, [aria-invalid=true]"),
			).toBeNull();
			expect(document.querySelector("legend")?.textContent).toContain("Required");
			expect(showRequiredValidation()).toBe(true);
			const invalid = document.querySelector<HTMLInputElement>('[aria-invalid="true"]');
			const error = document.querySelector(".praxity-required-message");
			expect(invalid).toBe(document.activeElement);
			expect(invalid?.getAttribute("aria-describedby")?.split(/\s+/)).toContain(error?.id);
			const radio = document.querySelector<HTMLInputElement>('input[type="radio"]');
			if (!radio) throw new Error("Missing rating radio");
			radio.checked = true;
			radio.dispatchEvent(new Event("change"));
			expect(showRequiredValidation()).toBe(false);
			expect(document.querySelector('[aria-invalid="true"], .praxity-required-message')).toBeNull();
			if (style !== "slider")
				expect(document.querySelector('[role="radiogroup"]')?.getAttribute("aria-required")).toBe(
					"true",
				);
		} finally {
			dispose();
		}
	},
);
