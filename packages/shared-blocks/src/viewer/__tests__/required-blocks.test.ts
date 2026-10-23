import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSelfCheckCompletionStrings } from "../../i18n/self-check-completion-strings";
import {
	checkRequiredBlocks,
	clearRequiredValidation,
	isRequiredBlockComplete,
	showRequiredValidation,
} from "../required-blocks";

const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
	Element.prototype,
	"scrollIntoView",
);

beforeEach(() => {
	Object.defineProperty(Element.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn(),
	});
});

afterEach(() => {
	clearRequiredValidation();
	document.body.innerHTML = "";
	if (scrollIntoViewDescriptor) {
		Object.defineProperty(Element.prototype, "scrollIntoView", scrollIntoViewDescriptor);
	} else {
		delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
	}
	vi.restoreAllMocks();
});

describe("required block validation", () => {
	it("an old highlight timer cannot clear a newer validation on the same block", () => {
		vi.useFakeTimers();
		try {
			document.body.innerHTML =
				'<div data-required="true" data-block-type="rating"><button>Rate</button></div>';
			expect(showRequiredValidation()).toBe(true);
			vi.advanceTimersByTime(1000);
			expect(showRequiredValidation()).toBe(true);
			vi.advanceTimersByTime(1000);
			expect(document.querySelector("[data-required-highlight]")).not.toBeNull();
			vi.advanceTimersByTime(1000);
			expect(document.querySelector("[data-required-highlight]")).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});
	it("a highlight timer cannot touch a replacement provider's validation", () => {
		vi.useFakeTimers();
		let epoch = 0;
		Object.assign(window, { __praxitySelfCheckDocument: { consumers: { epoch: () => epoch } } });
		try {
			document.body.innerHTML =
				'<div data-required="true" data-block-type="rating"><button>Rate</button></div>';
			expect(showRequiredValidation()).toBe(true);
			epoch++;
			vi.advanceTimersByTime(2000);
			expect(document.querySelector("[data-required-highlight]")).not.toBeNull();
		} finally {
			Reflect.deleteProperty(window, "__praxitySelfCheckDocument");
			vi.useRealTimers();
		}
	});
	it.each([
		["en", "Write an answer, check its parts, then show feedback to complete this activity."],
		[
			"fr",
			"Écrivez une réponse, vérifiez ses éléments, puis affichez la rétroaction pour terminer cette activité.",
		],
	])("focuses a required self-check answer with a %s message", (locale, message) => {
		document.body.innerHTML = `<div data-required="true" data-block-type="selfCheck"><div data-self-check lang="${locale}" data-self-check-incomplete="${getSelfCheckCompletionStrings(locale).selfCheckIncomplete}"><textarea></textarea></div></div>`;
		expect(showRequiredValidation()).toBe(true);
		expect(document.activeElement).toBe(document.querySelector("textarea"));
		expect(document.querySelector(".praxity-required-message")?.textContent).toBe(message);
	});
	it("restores owned ARIA state and removes only its described-by token", () => {
		document.body.innerHTML = `
			<div data-required="true" data-block-type="assessment">
				<button aria-invalid="false" aria-describedby="existing" aria-required="false">Answer</button>
			</div>
			<button id="unrelated" aria-invalid="true" aria-describedby="other">Other</button>`;

		expect(showRequiredValidation()).toBe(true);
		const target = document.querySelector<HTMLElement>("[data-required-validation-target]");
		expect(target).not.toBeNull();
		const messageId = document.querySelector<HTMLElement>(".praxity-required-message")?.id;
		expect(target).toHaveAttribute("aria-invalid", "true");
		expect(target).toHaveAttribute("aria-required", "true");
		expect(target?.getAttribute("aria-describedby")?.split(/\s+/)).toEqual(["existing", messageId]);

		target?.setAttribute("aria-describedby", `${target.getAttribute("aria-describedby")} late`);
		clearRequiredValidation();

		expect(target).toHaveAttribute("aria-invalid", "false");
		expect(target).toHaveAttribute("aria-required", "false");
		expect(target).toHaveAttribute("aria-describedby", "existing late");
		expect(document.querySelector("#unrelated")).toHaveAttribute("aria-invalid", "true");
		expect(document.querySelector("#unrelated")).toHaveAttribute("aria-describedby", "other");
		expect(document.querySelector(".praxity-required-message")).toBeNull();
	});

	it("ignores required blocks hidden directly or by an ancestor", () => {
		document.body.innerHTML = `
			<div hidden><div data-required="true" data-block-type="assessment"></div></div>
			<div data-required="true" data-block-type="signature" data-signed="true"></div>`;

		expect(checkRequiredBlocks()).toEqual({
			valid: true,
			firstIncomplete: null,
			blockType: null,
		});
	});

	it("shares completion rules for direct and descendant state", () => {
		const block = document.createElement("div");
		block.setAttribute("data-block-type", "card");
		block.setAttribute("data-required-min", "2");
		block.innerHTML = '<div data-flipped-count="2"></div>';
		expect(isRequiredBlockComplete(block)).toBe(true);

		block.setAttribute("data-block-type", "assessment");
		block.removeAttribute("data-required-min");
		block.innerHTML = '<div data-paid="true"></div>';
		expect(isRequiredBlockComplete(block)).toBe(true);
	});
});
