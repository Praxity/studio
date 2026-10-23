// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initSignatureEnhancements } from "../../template/src/islands/island-signature";
import { renderBlockHtml } from "../render-block-html";

function signature(mode: "draw" | "type" = "draw"): PraxityBlock {
	return {
		id: "acknowledgement",
		type: "signature",
		data: {
			mode,
			label: "Trainee signature",
			sublabel: "Sign after reading",
			required: true,
		},
	} as PraxityBlock;
}

afterEach(() => {
	document.body.innerHTML = "";
	delete window.__praxityBlockState;
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("signature island", () => {
	it("revocation inside interaction cannot authorize a later completion timeout", () => {
		const callbacks: (() => void)[] = [];
		vi.spyOn(window, "setTimeout").mockImplementation(((callback: () => void) => {
			callbacks.push(callback);
			return callbacks.length;
		}) as typeof window.setTimeout);
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			clearRect: vi.fn(),
		} as never);
		let epoch = 0;
		Object.assign(window, { __praxitySelfCheckDocument: { consumers: { epoch: () => epoch } } });
		document.body.innerHTML = renderBlockHtml(signature("type"));
		const root = document.querySelector<HTMLElement>('[data-block-type="signature"]');
		if (!root) throw new Error("Missing signature");
		root.dataset.island = "signature";
		const release = initSignatureEnhancements();
		const replace = () => {
			++epoch;
			document.dispatchEvent(new Event("praxity:self-check-owner"));
			root.querySelectorAll<HTMLElement>("[data-signature-status]").forEach((status) => {
				status.textContent = "Successor status";
			});
		};
		document.addEventListener("praxity:block-interaction", replace);
		try {
			const input = root.querySelector<HTMLInputElement>("input");
			if (!input) throw new Error("Missing input");
			input.value = "Ada";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			expect(epoch).toBe(1);
			callbacks.forEach((callback) => callback());
			expect(
				[...root.querySelectorAll("[data-signature-status]")].map((status) => status.textContent),
			).toEqual(["Successor status", "Successor status"]);
		} finally {
			document.removeEventListener("praxity:block-interaction", replace);
			release();
			Reflect.deleteProperty(window, "__praxitySelfCheckDocument");
		}
	});

	it("retained completion timeout cannot replace successor status", () => {
		const callbacks: (() => void)[] = [];
		vi.spyOn(window, "setTimeout").mockImplementation(((callback: () => void) => {
			callbacks.push(callback);
			return callbacks.length;
		}) as typeof window.setTimeout);
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			clearRect: vi.fn(),
		} as never);
		let epoch = 0;
		Object.assign(window, { __praxitySelfCheckDocument: { consumers: { epoch: () => epoch } } });
		document.body.innerHTML = renderBlockHtml(signature("type"));
		const root = document.querySelector<HTMLElement>('[data-block-type="signature"]');
		if (!root) throw new Error("Missing signature");
		root.dataset.island = "signature";
		const release = initSignatureEnhancements();
		try {
			const input = root.querySelector<HTMLInputElement>("input");
			if (!input) throw new Error("Missing input");
			input.value = "Ada";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			epoch++;
			document.dispatchEvent(new Event("praxity:self-check-owner"));
			root.querySelectorAll<HTMLElement>("[data-signature-status]").forEach((status) => {
				status.textContent = "Successor status";
			});
			callbacks.forEach((callback) => callback());
			expect(
				[...root.querySelectorAll("[data-signature-status]")].map((status) => status.textContent),
			).toEqual(["Successor status", "Successor status"]);
		} finally {
			release();
			Reflect.deleteProperty(window, "__praxitySelfCheckDocument");
		}
	});

	it.each([false, true])(
		"keeps locked methods discoverable and recovers with Clear (restored: %s)",
		(restored) => {
			vi.useFakeTimers();
			vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
				clearRect: vi.fn(),
			} as never);
			const set = vi.fn();
			window.__praxityBlockState = {
				get: () => (restored ? { completed: true, method: "type", typedValue: "Ada" } : undefined),
				set,
			};
			document.body.innerHTML = renderBlockHtml(signature("type"), {
				strings: {
					signatureMethodLocked: "Effacez votre signature pour changer de mode de signature.",
				},
			});
			const root = document.querySelector<HTMLElement>('[data-block-type="signature"]');
			if (!root) throw new Error("signature root missing");
			root.dataset.island = "signature";
			const cleanup = initSignatureEnhancements();
			const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
			const input = root.querySelector<HTMLInputElement>("input");
			if (!input) throw new Error("signature input missing");
			input.focus();
			if (!restored) {
				input.value = "Ada";
				input.dispatchEvent(new Event("input", { bubbles: true }));
			}
			expect(document.activeElement).toBe(input);
			expect(tabs.map((tab) => tab.getAttribute("aria-disabled"))).toEqual(["true", "true"]);
			expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0]);
			for (const tab of tabs) {
				const reason = document.getElementById(tab.getAttribute("aria-describedby") ?? "");
				expect(reason?.textContent).toBe(
					"Effacez votre signature pour changer de mode de signature.",
				);
				expect(reason?.hidden).toBe(false);
			}
			set.mockClear();
			tabs[1].focus();
			for (const [key, target] of [
				["ArrowLeft", 0],
				["End", 1],
				["Home", 0],
				["ArrowRight", 1],
			] as const) {
				document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
				expect(document.activeElement).toBe(tabs[target]);
				expect(tabs.map((tab) => tab.tabIndex)).toEqual(target === 0 ? [0, -1] : [-1, 0]);
			}
			for (const tab of tabs) {
				tab.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
				tab.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
				tab.click();
			}
			expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
			expect(root.querySelector<HTMLElement>('[data-signature-panel="draw"]')?.hidden).toBe(true);
			expect(input.value).toBe("Ada");
			expect(set).not.toHaveBeenCalled();
			root.querySelector<HTMLButtonElement>("[data-signature-clear]:not([hidden])")?.click();
			expect(document.activeElement).toBe(input);
			expect(input.value).toBe("");
			expect(tabs.map((tab) => tab.getAttribute("aria-disabled"))).toEqual([null, null]);
			expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0]);
			expect(tabs.every((tab) => !tab.hasAttribute("aria-describedby"))).toBe(true);
			tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
			expect(tabs[0].getAttribute("aria-selected")).toBe("true");
			cleanup();
		},
	);
	it("server-renders a localized, usable type input and complete tab semantics", () => {
		const html = renderBlockHtml(signature("type"), {
			strings: {
				required: "Obligatoire",
				signatureMethod: "Mode de signature",
				signatureDraw: "Dessiner",
				signatureType: "Taper",
				drawYourSignature: "Dessinez votre signature",
				signatureKeyboardHint: "Passez au clavier avec Entrée ou Espace.",
			},
		});
		document.body.innerHTML = html;

		const root = document.querySelector<HTMLElement>('[data-block-type="signature"]');
		const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
		const input = document.querySelector<HTMLInputElement>(".praxity-signature-typed-input");
		const panels = Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]'));

		expect(root?.dataset.required).toBe("true");
		expect(html).not.toContain("data-block-json");
		expect(document.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe(
			"Mode de signature",
		);
		expect(
			tabs.map((tab) => [tab.textContent, tab.getAttribute("aria-selected"), tab.tabIndex]),
		).toEqual([
			["Dessiner", "false", -1],
			["Taper", "true", 0],
		]);
		expect(panels.map((panel) => panel.hidden)).toEqual([true, false]);
		expect(input?.required).toBe(true);
		expect(input?.getAttribute("aria-labelledby")).toBe("acknowledgement-signature-label");
		expect(document.body.textContent).toContain("Obligatoire");
		const ids = Array.from(document.querySelectorAll("[id]"), (element) => element.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("enhances the SSR controls in place and emits once per signed transition", () => {
		vi.useFakeTimers();
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			clearRect: vi.fn(),
		} as never);
		document.body.innerHTML = renderBlockHtml(signature("type"), {
			strings: { signedAt: "Signé le {date}", clearSignature: "Effacer" },
		});
		const root = document.querySelector<HTMLElement>('[data-block-type="signature"]');
		if (!root) throw new Error("signature root missing");
		root.dataset.island = "signature";
		const input = root.querySelector<HTMLInputElement>(".praxity-signature-typed-input");
		const interaction = vi.fn();
		document.addEventListener("praxity:block-interaction", interaction);
		const cleanup = initSignatureEnhancements();

		input?.focus();
		if (input) input.value = "Ada";
		input?.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.signed).toBe("true");
		expect(root.dataset.completed).toBe("true");
		expect(interaction).toHaveBeenCalledOnce();

		if (input) input.value = "Ada Lovelace";
		input?.dispatchEvent(new Event("input", { bubbles: true }));
		expect(interaction).toHaveBeenCalledOnce();
		vi.advanceTimersByTime(1500);
		expect(
			root.querySelector<HTMLElement>("[data-signature-status]:not([hidden])")?.textContent,
		).toContain("Signé le");

		const clear = root.querySelector<HTMLButtonElement>("[data-signature-clear]:not([hidden])");
		clear?.click();
		expect(root.dataset.signed).toBe("false");
		expect(root.dataset.completed).toBe("false");
		expect(input?.value).toBe("");
		expect(root.querySelector("[data-signature-status]")?.textContent).toBe("Sign after reading");
		expect(document.activeElement).toBe(input);

		cleanup();
		document.removeEventListener("praxity:block-interaction", interaction);
	});

	it("supports tab keys, keyboard fallback, and theme-colored pointer drawing", () => {
		const context = {
			arc: vi.fn(),
			beginPath: vi.fn(),
			clearRect: vi.fn(),
			fill: vi.fn(),
			fillStyle: "",
			lineCap: "",
			lineJoin: "",
			lineWidth: 0,
			moveTo: vi.fn(),
			quadraticCurveTo: vi.fn(),
			stroke: vi.fn(),
			strokeStyle: "",
		};
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
		vi.stubGlobal(
			"matchMedia",
			vi.fn(() => ({ matches: false })),
		);
		document.body.innerHTML = renderBlockHtml(signature());
		const root = document.querySelector<HTMLElement>('[data-block-type="signature"]');
		if (!root) throw new Error("signature root missing");
		root.dataset.island = "signature";
		const interaction = vi.fn();
		document.addEventListener("praxity:block-interaction", interaction);
		const cleanup = initSignatureEnhancements();
		const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
		const canvas = root.querySelector<HTMLCanvasElement>("canvas");
		const input = root.querySelector<HTMLInputElement>("input");

		tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
		expect(document.activeElement).toBe(tabs[1]);
		tabs[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
		expect(document.activeElement).toBe(tabs[0]);
		canvas?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		expect(document.activeElement).toBe(input);

		tabs[0]?.click();
		canvas?.style.setProperty("--praxity-color-text", "#123456");
		vi.spyOn(canvas as HTMLCanvasElement, "getBoundingClientRect").mockReturnValue({
			bottom: 200,
			height: 200,
			left: 0,
			right: 460,
			top: 0,
			width: 460,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		});
		canvas?.dispatchEvent(
			new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 80 }),
		);
		document.dispatchEvent(
			new MouseEvent("pointermove", { bubbles: true, button: 0, clientX: 120, clientY: 90 }),
		);
		document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
		canvas?.dispatchEvent(
			new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 140, clientY: 100 }),
		);
		expect(context.fillStyle).toBe("#123456");
		expect(context.fill).toHaveBeenCalledTimes(2);
		expect(context.stroke).toHaveBeenCalledOnce();
		expect(root.dataset.signed).toBe("true");
		expect(interaction).toHaveBeenCalledOnce();

		cleanup();
		document.removeEventListener("praxity:block-interaction", interaction);
	});

	it("rehydrates semantic signature state without restoring canvas pixels", () => {
		vi.useFakeTimers();
		const get = vi.fn(() => ({
			completed: true,
			method: "type",
			typedValue: "Ada Lovelace",
		}));
		const set = vi.fn();
		window.__praxityBlockState = { get, set };
		document.body.innerHTML = renderBlockHtml(signature("draw"));
		const root = document.querySelector<HTMLElement>('[data-block-type="signature"]');
		if (!root) throw new Error("signature root missing");
		root.dataset.island = "signature";

		const cleanup = initSignatureEnhancements();
		const input = root.querySelector<HTMLInputElement>(".praxity-signature-typed-input");
		const canvas = root.querySelector<HTMLCanvasElement>(".praxity-signature-canvas");
		expect(get).toHaveBeenCalledWith("acknowledgement");
		expect(input?.value).toBe("Ada Lovelace");
		expect(root.dataset.completed).toBe("true");
		expect(root.querySelector<HTMLElement>('[data-signature-panel="type"]')?.hidden).toBe(false);
		expect(canvas?.getAttribute("aria-label")).toBe("Signature drawn");
		expect(root.querySelector<HTMLElement>("[data-signature-status]")?.textContent).toBe(
			"Sign after reading",
		);
		expect(set).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1500);
		expect(root.querySelector<HTMLElement>("[data-signature-status]")?.textContent).toBe(
			"Sign after reading",
		);

		if (!input) throw new Error("signature input missing");
		input.value = "Ada L.";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		expect(set).toHaveBeenCalledWith("acknowledgement", {
			completed: true,
			method: "type",
			typedValue: "Ada L.",
		});
		cleanup();
	});

	it("does not restore completion for a drawn signature without stored pixels", () => {
		const get = vi.fn(() => ({
			completed: true,
			method: "draw",
			typedValue: "",
		}));
		const set = vi.fn();
		window.__praxityBlockState = { get, set };
		document.body.innerHTML = renderBlockHtml(signature());
		const root = document.querySelector<HTMLElement>('[data-block-type="signature"]');
		if (!root) throw new Error("signature root missing");
		root.dataset.island = "signature";

		const cleanup = initSignatureEnhancements();
		const input = root.querySelector<HTMLInputElement>(".praxity-signature-typed-input");
		expect(root.dataset.completed).toBe("false");
		expect(root.dataset.signed).toBe("false");
		expect(input?.value).toBe("");
		expect(set).not.toHaveBeenCalled();
		cleanup();
	});

	it("keeps every signature action at least 44 CSS pixels", () => {
		const css = readFileSync(
			resolve(import.meta.dirname, "../../../shared-blocks/src/blocks/shared-blocks.css"),
			"utf8",
		);
		expect(css).toMatch(/\.praxity-signature-tab\s*\{[^}]*min-height:\s*var\(--target-size\)/s);
		expect(css).toMatch(/\.praxity-signature-clear\s*\{[^}]*min-height:\s*var\(--target-size\)/s);
	});
});
