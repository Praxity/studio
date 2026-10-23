// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import { showRequiredValidation } from "../../../shared-blocks/src/viewer/required-blocks";
import { initRatingEnhancements } from "../../template/src/islands/island-rating";
import { selfCheckDocument } from "../../template/src/self-check-document";
import { renderBlockHtml } from "../render-block-html";

afterEach(() => {
	window.__praxitySelfCheckDocument?.dispose();
	delete window.__praxityBlockState;
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

function setup(style = "numeric", required = false) {
	vi.stubGlobal("__PRAXITY_SELF_CHECK_BUILD__", "rating-early-input-test");
	const set = vi.fn();
	window.__praxityBlockState = { get: () => ({ value: 1 }), set };
	document.body.innerHTML = renderBlockHtml(
		{
			id: "rating",
			type: "rating",
			data: { label: "Rating", maxValue: 3, style, required },
		},
		{ enabledIslands: new Set(["rating"]) },
	);
	const owner = selfCheckDocument();
	const options = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
	return { owner, options, set };
}

it.each(["numeric", "likert", "stars", "emoji", "slider"])(
	"keeps and saves an early %s choice once, including required completion",
	(style) => {
		const { options, set } = setup(style, true);
		const control =
			style === "slider"
				? document.querySelector<HTMLInputElement>('input[type="range"]')
				: options[2];
		if (!control) throw new Error("Missing rating control");
		control.focus();
		if (style === "slider") {
			expect(document.querySelector<HTMLElement>(".praxity-rating-options")?.hidden).toBe(true);
			control.value = "3";
			control.dispatchEvent(new Event("input", { bubbles: true }));
			control.dispatchEvent(new Event("change", { bubbles: true }));
		} else control.click();
		const dispose = initRatingEnhancements();
		try {
			expect(options.map((option) => option.checked)).toEqual([false, false, true]);
			expect(document.activeElement).toBe(control);
			expect(set).toHaveBeenCalledExactlyOnceWith("rating", { value: 3 });
			expect(document.querySelector('[data-completed="true"]')).not.toBeNull();
			expect(showRequiredValidation()).toBe(false);
			// A second attachment cannot consume the same gesture again.
			initRatingEnhancements()();
			expect(set).toHaveBeenCalledTimes(1);
			dispose();
			const detach = initRatingEnhancements();
			try {
				expect(set).toHaveBeenCalledTimes(1);
			} finally {
				detach();
			}
		} finally {
			dispose();
		}
	},
);

it.each(["reset", "provider"])(
	"accepts a fresh click on the same early option after %s",
	(change) => {
		const { owner, options, set } = setup();
		options[2].click();
		if (change === "reset") owner.reset();
		else window.__praxityBlockState = { get: () => ({ value: 1 }), set };
		options[2].click();
		const dispose = initRatingEnhancements();
		try {
			expect(options.map((option) => option.checked)).toEqual([false, false, true]);
			expect(set).toHaveBeenCalledExactlyOnceWith("rating", { value: 3 });
		} finally {
			dispose();
		}
	},
);

it.each(["numeric", "slider"])(
	"keeps an early %s choice across the first host provider install",
	(style) => {
		setup(style, true).owner.dispose();
		delete window.__praxityBlockState;
		const owner = selfCheckDocument(document, true);
		const initialTicket = owner.loadTicket();
		const options = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
		if (style === "slider") {
			const slider = document.querySelector<HTMLInputElement>('input[type="range"]');
			if (!slider) throw new Error("Missing visible slider");
			slider.value = "3";
			slider.dispatchEvent(new Event("input", { bubbles: true }));
		} else options[2].click();
		const set = vi.fn();
		window.__praxityBlockState = { get: () => ({ value: 1 }), set };
		expect(initialTicket()).toBe(false);
		const lifetime = owner.lifetime();
		if (!lifetime) throw new Error("Missing provider lifetime");
		owner.admit(lifetime);
		const dispose = initRatingEnhancements();
		try {
			expect(options.map((option) => option.checked)).toEqual([false, false, true]);
			expect(set).toHaveBeenCalledExactlyOnceWith("rating", { value: 3 });
			expect(showRequiredValidation()).toBe(false);
		} finally {
			dispose();
		}
	},
);

it("captures a same-option activation on controls parsed after the owner starts", () => {
	setup().owner.dispose();
	const markup = document.body.innerHTML;
	document.body.replaceChildren();
	const owner = selfCheckDocument();
	document.body.innerHTML = markup;
	const options = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
	options[2].focus();
	options[2].click();
	owner.reset();
	options[2].click();
	const set = window.__praxityBlockState?.set;
	const dispose = initRatingEnhancements();
	try {
		expect(options.map((option) => option.checked)).toEqual([false, false, true]);
		expect(set).toHaveBeenCalledExactlyOnceWith("rating", { value: 3 });
	} finally {
		dispose();
	}
});

it("captures a parsed label's pointer activation without requiring native focus", () => {
	setup().owner.dispose();
	const markup = document.body.innerHTML;
	document.body.replaceChildren();
	const owner = selfCheckDocument();
	document.body.innerHTML = markup;
	const options = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
	const label = options[2].labels?.[0];
	if (!label) throw new Error("Missing rating label");
	const target = label.querySelector("span") ?? label;
	target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
	label.click();
	owner.reset();
	target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
	label.click();
	const dispose = initRatingEnhancements();
	try {
		expect(document.activeElement).toBe(document.body);
		expect(options.map((option) => option.checked)).toEqual([false, false, true]);
		expect(window.__praxityBlockState?.set).toHaveBeenCalledExactlyOnceWith("rating", { value: 3 });
	} finally {
		dispose();
	}
});

it.each(["reset", "return"])(
	"keeps fresh pre-provider input after %s through the first provider install",
	(change) => {
		setup().owner.dispose();
		delete window.__praxityBlockState;
		const owner = selfCheckDocument(document, true);
		const options = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
		options[2].click();
		const revokedTicket = owner.loadTicket();
		if (change === "reset") owner.reset();
		else {
			window.dispatchEvent(new PageTransitionEvent("pagehide"));
			window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
		}
		expect(revokedTicket()).toBe(false);
		options[2].click();
		const freshTicket = owner.loadTicket();
		expect(freshTicket()).toBe(true);
		const set = vi.fn();
		window.__praxityBlockState = { get: () => ({ value: 1 }), set };
		expect(freshTicket()).toBe(false);
		const lifetime = owner.lifetime();
		if (!lifetime) throw new Error("Missing provider lifetime");
		owner.admit(lifetime);
		const dispose = initRatingEnhancements();
		try {
			expect({
				value: document.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value,
				writes: set.mock.calls,
			}).toEqual({ value: "3", writes: [["rating", { value: 3 }]] });
		} finally {
			dispose();
		}
	},
);

it.each(["existing", "first install"])(
	"does not carry input after removing a provider from %s",
	(start) => {
		let { owner, options } = setup();
		if (start === "first install") {
			owner.dispose();
			delete window.__praxityBlockState;
			owner = selfCheckDocument(document, true);
			window.__praxityBlockState = { get: () => ({ value: 1 }), set: vi.fn() };
		}
		window.__praxityBlockState = undefined;
		options[2].click();
		const set = vi.fn();
		window.__praxityBlockState = { get: () => ({ value: 1 }), set };
		const lifetime = owner.lifetime();
		if (!lifetime) throw new Error("Missing provider lifetime");
		owner.admit(lifetime);
		const dispose = initRatingEnhancements();
		try {
			expect(options.map((option) => option.checked)).toEqual([true, false, false]);
			expect(set).not.toHaveBeenCalled();
		} finally {
			dispose();
		}
	},
);

it.each(["reset", "hide"])("does not carry a pre-provider choice through %s", (change) => {
	setup().owner.dispose();
	delete window.__praxityBlockState;
	const owner = selfCheckDocument(document, true);
	const options = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
	options[2].click();
	if (change === "reset") owner.reset();
	else {
		window.dispatchEvent(new PageTransitionEvent("pagehide"));
		window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
	}
	const set = vi.fn();
	window.__praxityBlockState = { get: () => ({ value: 1 }), set };
	const lifetime = owner.lifetime();
	if (!lifetime) throw new Error("Missing provider lifetime");
	owner.admit(lifetime);
	const dispose = initRatingEnhancements();
	try {
		expect(options.map((option) => option.checked)).toEqual([true, false, false]);
		expect(set).not.toHaveBeenCalled();
	} finally {
		dispose();
	}
});

it.each(["reset", "provider"])("discards an early choice revoked by %s", (change) => {
	const { owner, options, set } = setup();
	options[2].click();
	const replacementSet = vi.fn();
	if (change === "reset") owner.reset();
	else window.__praxityBlockState = { get: () => ({ value: 1 }), set: replacementSet };
	const dispose = initRatingEnhancements();
	try {
		expect(options.map((option) => option.checked)).toEqual([true, false, false]);
		expect(set).not.toHaveBeenCalled();
		expect(replacementSet).not.toHaveBeenCalled();
	} finally {
		dispose();
	}
});

it("rejects an early ticket when a provider descriptor is replaced without notifying the owner", () => {
	const { options, set } = setup();
	options[2].click();
	const replacementSet = vi.fn();
	Object.defineProperty(window, "__praxityBlockState", {
		configurable: true,
		writable: true,
		value: { get: () => ({ value: 1 }), set: replacementSet },
	});
	const dispose = initRatingEnhancements();
	try {
		expect(options.map((option) => option.checked)).toEqual([true, false, false]);
		expect(set).not.toHaveBeenCalled();
		expect(replacementSet).not.toHaveBeenCalled();
	} finally {
		dispose();
	}
});

it("makes initial input available before publishing the provider lifetime", () => {
	setup().owner.dispose();
	delete window.__praxityBlockState;
	const owner = selfCheckDocument(document, true);
	const options = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
	options[2].click();
	let detach = () => {};
	const stop = owner.observe((lifetime) => {
		if (lifetime?.reason !== "provider" || owner.isAdmitted()) return;
		owner.admit(lifetime);
		detach = initRatingEnhancements();
	});
	const set = vi.fn();
	try {
		window.__praxityBlockState = { get: () => ({ value: 1 }), set };
		expect(options.map((option) => option.checked)).toEqual([false, false, true]);
		expect(set).toHaveBeenCalledExactlyOnceWith("rating", { value: 3 });
	} finally {
		stop();
		detach();
	}
});

it.each(["reset", "provider"])("accepts a fresh early choice after %s", (change) => {
	const { owner, options, set } = setup();
	options[2].click();
	if (change === "reset") owner.reset();
	else window.__praxityBlockState = { get: () => ({ value: 1 }), set };
	options[1].click();
	const dispose = initRatingEnhancements();
	try {
		expect(options.map((option) => option.checked)).toEqual([false, true, false]);
		expect(set).toHaveBeenCalledExactlyOnceWith("rating", { value: 2 });
	} finally {
		dispose();
	}
});

it("restores a replacement provider after a hydrated choice", () => {
	const { options, set } = setup();
	const dispose = initRatingEnhancements();
	options[2].click();
	expect(set).toHaveBeenCalledExactlyOnceWith("rating", { value: 3 });
	dispose();
	const replacementSet = vi.fn();
	window.__praxityBlockState = { get: () => undefined, set: replacementSet };
	const detach = initRatingEnhancements();
	try {
		expect(options.map((option) => option.checked)).toEqual([false, false, false]);
		expect(replacementSet).not.toHaveBeenCalled();
	} finally {
		detach();
	}
});

it("saves only the latest early choice", () => {
	const { options, set } = setup();
	options[2].click();
	options[1].click();
	const dispose = initRatingEnhancements();
	try {
		expect(options.map((option) => option.checked)).toEqual([false, true, false]);
		expect(set).toHaveBeenCalledExactlyOnceWith("rating", { value: 2 });
	} finally {
		dispose();
	}
});

it("does not replay an already hydrated input on reattachment", () => {
	const { options, set } = setup();
	const dispose = initRatingEnhancements();
	options[2].click();
	dispose();
	const detach = initRatingEnhancements();
	try {
		expect(set).toHaveBeenCalledExactlyOnceWith("rating", { value: 3 });
	} finally {
		detach();
	}
});

it("cannot save into a provider replaced during the early interaction notification", () => {
	const { options, set } = setup();
	options[2].click();
	const replacementSet = vi.fn();
	const replace = vi.fn(() => {
		window.__praxityBlockState = { get: () => ({ value: 1 }), set: replacementSet };
	});
	document.addEventListener("praxity:block-interaction", replace);
	const dispose = initRatingEnhancements();
	try {
		expect(replace).toHaveBeenCalledTimes(1);
		expect(set).not.toHaveBeenCalled();
		expect(replacementSet).not.toHaveBeenCalled();
	} finally {
		document.removeEventListener("praxity:block-interaction", replace);
		dispose();
	}
});
