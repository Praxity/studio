import { describe, expect, it, vi } from "vitest";
import {
	isEditorElementAvailable,
	measureOrigins,
	observeGeometry,
	popupPlacement,
	positionFixed,
} from "./geometry";

it("retained probes remeasure changed geometry without removing nodes", () => {
	const element = document.createElement("div");
	document.body.append(element);
	const retained = new Map<Element | null, HTMLElement>();
	let left = 10;
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		() => new DOMRect(left, 20, 200, 200),
	);
	const observer = new MutationObserver(() => {});
	observer.observe(document, { subtree: true, childList: true });
	try {
		expect(measureOrigins([element], () => {}, retained).get(document.body)?.left).toBe(10);
		const probe = retained.get(document.body);
		left = 30;
		expect(measureOrigins([element], () => {}, retained).get(document.body)?.left).toBe(30);
		expect(retained.get(document.body)).toBe(probe);
		expect(probe?.isConnected).toBe(true);
		expect(observer.takeRecords().flatMap((record) => [...record.removedNodes])).toEqual([]);
	} finally {
		observer.disconnect();
		for (const probe of retained.values()) probe.remove();
		element.remove();
		vi.restoreAllMocks();
	}
});

it.each([
	{ height: 80, expected: "40px" },
	{ height: "auto" as const, expected: "auto" },
])("fixed placement preserves $height height without repeated writes", ({ height, expected }) => {
	const element = document.createElement("div");
	document.body.append(element);
	const origins = new Map([[document.body, new DOMRect(0, 0, 200, 200)]]);
	const box = { left: 20, top: 40, width: 120, height };
	try {
		positionFixed(element, box, () => {}, false, origins);
		expect(element.style.getPropertyValue("height")).toBe(expected);
		expect(element.style.getPropertyValue("width")).toBe("60px");
		const observer = new MutationObserver(() => {});
		observer.observe(element, { attributes: true });
		positionFixed(element, box, () => {}, false, origins);
		expect(observer.takeRecords()).toEqual([]);
		observer.disconnect();
	} finally {
		element.remove();
	}
});

it("avoids duplicate geometry updates for unchanged subscriptions and notices replaced content", async () => {
	const previous = window.ResizeObserver;
	window.ResizeObserver = class {
		constructor(private changed: () => void) {}
		observe() {
			this.changed();
		}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
	const update = vi.fn();
	const geometry = observeGeometry(document, update);
	const frame = () => new Promise<void>((done) => window.requestAnimationFrame(() => done()));
	try {
		const first = document.createElement("p");
		geometry.observe([document.body, first]);
		await frame();
		expect(update).toHaveBeenCalledTimes(1);
		geometry.observe([first, document.body]);
		await frame();
		expect(update).toHaveBeenCalledTimes(1);
		geometry.observe([document.body, document.createElement("p")]);
		await frame();
		expect(update).toHaveBeenCalledTimes(2);
	} finally {
		geometry.dispose();
		window.ResizeObserver = previous;
	}
});
const viewport = { width: 1280, height: 860 };

it.each([
	{ property: "transform", value: "translateX(120px)", continuous: true },
	{ property: "marginBottom", value: "120px", continuous: true },
	{ property: "backgroundColor", value: "red", continuous: false },
	{ property: "outlineColor", value: "red", continuous: false },
	{ property: "fontPalette", value: "dark", continuous: false },
	{ property: "overflowClipMargin", value: "10px", continuous: false },
])(
	"$property animation placement stops at suspension, settlement and disposal",
	({ property, value, continuous }) => {
		const callbacks = new Map<number, FrameRequestCallback>();
		let id = 0;
		const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			callbacks.set(++id, callback);
			return id;
		});
		const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
			callbacks.delete(id);
		});
		const parent = document.createElement("div");
		const anchor = document.createElement("div");
		parent.append(anchor);
		document.body.append(parent);
		const previous = Object.getOwnPropertyDescriptor(document, "getAnimations");
		let running = true;
		Object.defineProperty(document, "getAnimations", {
			configurable: true,
			value: () => [
				{
					playState: running ? "running" : "finished",
					effect: {
						target: parent,
						getKeyframes: () => [{ offset: 0, computedOffset: 0, [property]: value }],
					},
				},
			],
		});
		let presenting = true;
		const update = vi.fn();
		const geometry = observeGeometry(document, update, {
			anchor: () => (presenting ? anchor : undefined),
			affects: (target, anchor) => target.contains(anchor),
		});
		const flush = () => {
			const pending = [...callbacks.values()];
			callbacks.clear();
			for (const callback of pending) callback(0);
		};
		try {
			geometry.schedule();
			flush();
			expect(update).toHaveBeenCalledTimes(1);
			expect(callbacks.size).toBe(continuous ? 1 : 0);
			presenting = false;
			flush();
			expect(callbacks.size).toBe(0);
			presenting = true;
			running = false;
			geometry.schedule();
			flush();
			expect(callbacks.size).toBe(0);
			running = true;
			geometry.schedule();
			const late = [...callbacks.values()][0];
			geometry.dispose();
			update.mockClear();
			late?.(0);
			expect(update).not.toHaveBeenCalled();
			expect(callbacks.size).toBe(0);
		} finally {
			geometry.dispose();
			raf.mockRestore();
			cancel.mockRestore();
			if (previous) Object.defineProperty(document, "getAnimations", previous);
			else Reflect.deleteProperty(document, "getAnimations");
			parent.remove();
		}
	},
);
const anchor = { left: 1100, top: 810, right: 1124, bottom: 834 };
describe("F11 popup placement", () => {
	it.each([
		{
			anchor: { left: 80, right: 104, top: 360, bottom: 384 },
			side: "above",
			top: 0,
			maxHeight: 352,
		},
		{
			anchor: { left: 80, right: 104, top: 300, bottom: 324 },
			side: "below",
			top: 332,
			maxHeight: 396,
		},
	])("caps a tall popup on the roomier side: $side", ({ anchor, side, top, maxHeight }) => {
		expect(
			popupPlacement({
				anchor,
				size: { width: 280, height: 600 },
				viewport: { width: 288, height: 728 },
				hostWidth: 320,
				kind: "menu",
			}),
		).toMatchObject({ side, top, maxHeight });
	});
	it("keeps a helper anchored to its caret line on a narrow host", () => {
		expect(
			popupPlacement({
				anchor: { left: 100, right: 130, top: 100, bottom: 128 },
				size: { width: 150, height: 80 },
				viewport: { width: 358, height: 728 },
				hostWidth: 390,
				kind: "helper",
			}),
		).toMatchObject({ left: 100, top: 136, width: 150, replaceParent: false });
	});
	it("opens a last-block menu upward and keeps its box in the frame", () => {
		expect(
			popupPlacement({
				anchor,
				size: { width: 280, height: 300 },
				viewport,
				hostWidth: 1280,
				kind: "menu",
			}),
		).toEqual({
			left: 1000,
			top: 502,
			width: 280,
			maxHeight: 802,
			side: "above",
			replaceParent: false,
		});
	});
	it("flips submenus left with four pixels of overlap", () => {
		expect(
			popupPlacement({
				anchor,
				size: { width: 280, height: 300 },
				viewport,
				hostWidth: 1280,
				kind: "submenu",
			}),
		).toMatchObject({ left: 824, top: 560, side: "left", replaceParent: false });
	});
	it("replaces a narrow menu panel and leaves six pixels at each edge", () => {
		expect(
			popupPlacement({
				anchor,
				size: { width: 280, height: 900 },
				viewport: { width: 358, height: 728 },
				hostWidth: 390,
				kind: "submenu",
			}),
		).toMatchObject({ left: 6, top: 0, width: 346, maxHeight: 728, replaceParent: true });
	});
});

it("F11 a node that sets visibility back to visible inside a hidden ancestor stays available", () => {
	document.body.innerHTML = `<main style="visibility:hidden"><p id="shown" style="visibility:visible">Shown</p><p id="inherits">Hidden</p></main>`;
	const shown = document.getElementById("shown");
	const inherits = document.getElementById("inherits");
	if (!shown || !inherits) throw new Error("Missing fixture");
	expect(isEditorElementAvailable(shown)).toBe(true);
	expect(isEditorElementAvailable(inherits)).toBe(false);
	document.body.innerHTML = "";
});
