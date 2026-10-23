// @vitest-environment jsdom

import {
	clearRequiredValidation,
	showRequiredValidation,
} from "@praxity/shared-blocks/viewer/required-blocks";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("required-blocks focus management", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		HTMLElement.prototype.scrollIntoView = vi.fn();
		window.matchMedia = vi.fn().mockReturnValue({ matches: false });
	});

	it("focuses the first actionable control in the first incomplete required block", () => {
		document.body.innerHTML = `
      <div data-required="true" data-block-type="assessment">
        <div>
          <input id="answer-input" type="text" />
        </div>
      </div>
    `;

		const blocked = showRequiredValidation();
		const input = document.getElementById("answer-input");

		expect(blocked).toBe(true);
		expect(input?.getAttribute("aria-invalid")).toBe("true");
		expect(input?.getAttribute("aria-required")).toBe("true");
		expect(document.activeElement).toBe(input);
	});

	it("does not smooth-scroll when reduced motion is preferred", () => {
		window.matchMedia = vi.fn().mockReturnValue({ matches: true });
		document.body.innerHTML = `
      <div data-required="true" data-block-type="assessment">
        <input id="answer-input" type="text" />
      </div>
    `;

		showRequiredValidation();

		expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
			behavior: "instant",
			block: "center",
		});
	});

	it("clears injected validation state and messages", () => {
		document.body.innerHTML = `
      <div data-required="true" data-block-type="assessment">
        <div>
          <input id="answer-input" type="text" />
        </div>
      </div>
    `;

		showRequiredValidation();
		clearRequiredValidation();

		const input = document.getElementById("answer-input");
		expect(input?.hasAttribute("aria-invalid")).toBe(false);
		expect(input?.hasAttribute("aria-describedby")).toBe(false);
		expect(input?.hasAttribute("data-required-validation-target")).toBe(false);
		expect(document.querySelector(".praxity-required-message")).toBeNull();
	});
});
