// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { findBlockElement } from "./block-element";

describe("findBlockElement", () => {
	it("returns the innermost renderer when a wrapper shares the block ID", () => {
		document.body.innerHTML = `
			<div data-block-id="assessment-1" data-score="0">
				<div data-block-id="assessment-1" data-score="100"></div>
			</div>`;

		expect(findBlockElement("assessment-1")?.dataset.score).toBe("100");
	});
});
