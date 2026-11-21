import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyA11yPreferences,
	applyMotionPreferences,
	readA11yPreferences,
	setMotionChoice,
	writeA11yPreferences,
} from "./a11y-preferences-store";

const KEY = "praxity-a11y";

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	document.documentElement.removeAttribute("data-praxity-focus-mode");
	document.documentElement.removeAttribute("data-praxity-text-size");
	document.documentElement.removeAttribute("data-praxity-reduced-motion");
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

describe("learner motion preference", () => {
	it.each(["{", "null", "[]", '"off"', '{"motionChoice":true}', '{"motionChoice":"on"}'])(
		"ignores corrupt or unsupported motion choice %s",
		(raw) => {
			localStorage.setItem(KEY, raw);
			applyMotionPreferences(false);
			expect(readA11yPreferences().motionChoice).toBeUndefined();
			expect(document.documentElement).not.toHaveAttribute("data-praxity-reduced-motion");
			applyMotionPreferences(true);
			expect(document.documentElement).toHaveAttribute("data-praxity-reduced-motion", "true");
		},
	);

	it("restores the device setting without removing reading preferences or negating OS reduction", () => {
		writeA11yPreferences({ textSize: "large", focusChoice: false });
		setMotionChoice("off");
		expect(readA11yPreferences()).toEqual({
			textSize: "large",
			focusChoice: false,
			motionChoice: "off",
		});
		expect(document.documentElement).toHaveAttribute("data-praxity-reduced-motion", "true");
		setMotionChoice(null);
		expect(readA11yPreferences()).toEqual({ textSize: "large", focusChoice: false });
		expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).not.toHaveProperty("motionChoice");
		applyMotionPreferences(true);
		expect(document.documentElement).toHaveAttribute("data-praxity-reduced-motion", "true");
	});

	it.each([false, true])(
		"keeps the in-document choice with readable stale storage and session write denial %s",
		(denySession) => {
			const stored = JSON.stringify({ textSize: "large", focusChoice: false });
			localStorage.setItem(KEY, stored);
			sessionStorage.setItem(KEY, stored);
			const setItem = Storage.prototype.setItem;
			const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
				this: Storage,
				key,
				value,
			) {
				if (this === localStorage || denySession) throw new Error("Storage full");
				return setItem.call(this, key, value);
			});
			try {
				setMotionChoice("off");
				expect(readA11yPreferences()).toEqual({
					textSize: "large",
					focusChoice: false,
					motionChoice: "off",
				});
				expect(document.documentElement).toHaveAttribute("data-praxity-reduced-motion", "true");
				setMotionChoice(null);
				expect(readA11yPreferences()).toEqual({ textSize: "large", focusChoice: false });
				expect(document.documentElement).not.toHaveAttribute("data-praxity-reduced-motion");
			} finally {
				setSpy.mockRestore();
				writeA11yPreferences({ focusChoice: null });
			}
		},
	);

	it.each([false, true])(
		"keeps motion off when local storage is denied and session denial is %s",
		(denySession) => {
			const getItem = Storage.prototype.getItem;
			const setItem = Storage.prototype.setItem;
			const getSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
				this: Storage,
				key,
			) {
				if (this === localStorage || denySession) throw new Error("Storage denied");
				return getItem.call(this, key);
			});
			const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
				this: Storage,
				key,
				value,
			) {
				if (this === localStorage || denySession) throw new Error("Storage denied");
				return setItem.call(this, key, value);
			});
			try {
				setMotionChoice("off");
				applyMotionPreferences(false);
				expect(readA11yPreferences().motionChoice).toBe("off");
				expect(document.documentElement).toHaveAttribute("data-praxity-reduced-motion", "true");
				if (!denySession)
					expect(JSON.parse(getItem.call(sessionStorage, KEY) ?? "{}").motionChoice).toBe("off");
				setMotionChoice(null);
				expect(readA11yPreferences().motionChoice).toBeUndefined();
				expect(document.documentElement).not.toHaveAttribute("data-praxity-reduced-motion");
			} finally {
				getSpy.mockRestore();
				setSpy.mockRestore();
				writeA11yPreferences({ focusChoice: null });
			}
		},
	);
});
