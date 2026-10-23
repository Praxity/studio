import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyA11yPreferences,
	readA11yPreferences,
	writeA11yPreferences,
} from "./a11y-preferences-store";

const KEY = "praxity-a11y";

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	document.documentElement.removeAttribute("data-praxity-focus-mode");
	document.documentElement.removeAttribute("data-praxity-text-size");
});

describe("learner reading preferences", () => {
	it("reads older choices and writes only supported settings", () => {
		localStorage.setItem(
			KEY,
			JSON.stringify({ textSize: "x-large", focusMode: true, highContrast: true }),
		);
		const preferences = readA11yPreferences();
		expect(preferences).toEqual({ textSize: "large", focusChoice: true });

		writeA11yPreferences(preferences);
		expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toEqual({
			textSize: "large",
			focusChoice: true,
			focusMode: true,
		});
	});

	it("treats an older off value as no choice so the page default can apply", () => {
		localStorage.setItem(KEY, JSON.stringify({ focusMode: false, textSize: "large" }));
		expect(readA11yPreferences()).toEqual({ textSize: "large", focusChoice: null });
	});

	it("reads session storage when local storage has no choice", () => {
		sessionStorage.setItem(KEY, JSON.stringify({ focusChoice: true }));
		expect(readA11yPreferences().focusChoice).toBe(true);
	});

	it("keeps an explicit choice in session storage when local storage rejects writes", () => {
		const getItem = Storage.prototype.getItem;
		const setItem = Storage.prototype.setItem;
		const getSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
			this: Storage,
			key,
		) {
			if (this === localStorage) throw new Error("Storage denied");
			return getItem.call(this, key);
		});
		const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
			this: Storage,
			key,
			value,
		) {
			if (this === localStorage) throw new Error("Storage denied");
			return setItem.call(this, key, value);
		});
		try {
			writeA11yPreferences({ textSize: "large", focusChoice: false });
			expect(readA11yPreferences()).toEqual({ textSize: "large", focusChoice: false });
			expect(getItem.call(sessionStorage, KEY)).toContain('"focusChoice":false');
		} finally {
			getSpy.mockRestore();
			setSpy.mockRestore();
		}
	});

	it("applies the reading guide and text size to the learner page", () => {
		const root = document.createElement("main");
		root.dataset.praxityRoot = "";
		document.body.append(root);
		try {
			applyA11yPreferences("large", true);
			expect(root).toHaveAttribute("data-praxity-focus-mode", "true");
			expect(document.documentElement).toHaveAttribute("data-praxity-text-size", "large");
			applyA11yPreferences("default", false);
			expect(root).not.toHaveAttribute("data-praxity-focus-mode");
		} finally {
			root.remove();
		}
	});
});
