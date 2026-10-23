// @vitest-environment jsdom

import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initMediaEnhancements } from "../../template/src/islands/island-media";
import { renderBlockHtml } from "../render-block-html";

afterEach(() => {
	document.body.innerHTML = "";
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("published media island", () => {
	it("replaces an unconfirmed navigation even when the browser reports load, with explicit recovery", () => {
		vi.useFakeTimers();
		document.body.innerHTML =
			'<div data-island="media"><div class="praxity-media-frame"><iframe data-embed-src="https://example.com/embed" hidden></iframe><div class="praxity-media-fallback"><button data-embed-retry hidden>Show embedded content</button><a href="https://example.com/embed">Open Example</a></div></div></div>';
		const cleanup = initMediaEnhancements();
		const iframe = document.querySelector<HTMLIFrameElement>("iframe");
		const retry = document.querySelector<HTMLButtonElement>("[data-embed-retry]");
		if (!iframe || !retry) throw new Error("Missing embed controls");
		iframe.focus();
		iframe.dispatchEvent(new Event("load"));
		vi.advanceTimersByTime(2000);
		iframe.dispatchEvent(new Event("load"));
		vi.advanceTimersByTime(1000);
		expect(iframe.hidden).toBe(true);
		expect(retry.hidden).toBe(false);
		expect(document.activeElement).toBe(retry);
		window.dispatchEvent(
			new MessageEvent("message", { origin: "https://example.com", source: iframe.contentWindow }),
		);
		expect(iframe.hidden).toBe(true);
		retry.click();
		expect(iframe.hidden).toBe(false);
		vi.advanceTimersByTime(3000);
		expect(iframe.hidden).toBe(false);
		cleanup();
	});
	it("starts a lazy frame's confirmation deadline only when it enters view", () => {
		vi.useFakeTimers();
		let notify: IntersectionObserverCallback | undefined;
		vi.stubGlobal(
			"IntersectionObserver",
			class {
				constructor(callback: IntersectionObserverCallback) {
					notify = callback;
				}
				observe() {}
				disconnect() {}
			},
		);
		document.body.innerHTML =
			'<div data-island="media"><iframe data-embed-src="https://example.com/embed" hidden></iframe></div>';
		const iframe = document.querySelector<HTMLIFrameElement>("iframe");
		if (!iframe) throw new Error("Missing lazy embed");
		iframe.loading = "lazy";
		const cleanup = initMediaEnhancements();
		if (!notify) throw new Error("Lazy embed was not observed");
		notify([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
		vi.advanceTimersByTime(3000);
		expect(iframe.hidden).toBe(false);
		notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
		vi.advanceTimersByTime(3000);
		expect(iframe.hidden).toBe(true);
		cleanup();
	});
	it("refuses enhancement in a document without a browsing context", () => {
		const standalone = document.implementation.createHTMLDocument("No window");
		standalone.body.innerHTML =
			'<div data-island="media"><iframe src="https://example.com/embed"></iframe></div>';
		expect(() => initMediaEnhancements(standalone)).toThrow("Embed requires a browsing context");
	});
	it("accepts confirmation only from the provider's current frame and exact origin", () => {
		vi.useFakeTimers();
		document.body.innerHTML =
			'<div data-island="media"><iframe data-embed-src="https://example.com/embed" hidden></iframe></div>';
		const cleanup = initMediaEnhancements();
		const iframe = document.querySelector<HTMLIFrameElement>("iframe");
		if (!iframe) throw new Error("Missing embed");
		window.dispatchEvent(
			new MessageEvent("message", { origin: "https://other.test", source: iframe.contentWindow }),
		);
		window.dispatchEvent(
			new MessageEvent("message", { origin: "https://example.com", source: window }),
		);
		vi.advanceTimersByTime(3000);
		expect(iframe.hidden).toBe(true);
		cleanup();
		const confirmedCleanup = initMediaEnhancements();
		window.dispatchEvent(
			new MessageEvent("message", { origin: "https://example.com", source: iframe.contentWindow }),
		);
		vi.advanceTimersByTime(3000);
		expect(iframe.hidden).toBe(false);
		confirmedCleanup();
	});
	it("keeps the local video facade and clears navigation timers on disposal", () => {
		vi.useFakeTimers();
		document.body.innerHTML =
			'<div data-island="media"><iframe data-embed-src="https://example.com/embed" srcdoc="<a>Play</a>" hidden></iframe><iframe data-embed-src="https://other.test/embed" hidden></iframe></div>';
		const cleanup = initMediaEnhancements();
		const iframe = document.querySelector<HTMLIFrameElement>("iframe");
		if (!iframe) throw new Error("Missing facade");
		vi.advanceTimersByTime(3000);
		expect(iframe.hidden).toBe(false);
		cleanup();
		const other = document.querySelector<HTMLIFrameElement>(
			'iframe[data-embed-src="https://other.test/embed"]',
		);
		if (!other) throw new Error("Missing other embed");
		other.hidden = false;
		vi.advanceTimersByTime(3000);
		expect(other.hidden).toBe(false);
	});
	it("replaces a CSP-blocked embed with its in-frame fallback", () => {
		document.body.innerHTML =
			'<div data-island="media" class="praxity-embed-frame"><iframe class="praxity-embed-iframe" src="https://example.com/embed"></iframe><a href="https://example.com/embed">Open Example in a new tab</a></div>';
		const cleanup = initMediaEnhancements();
		const violation = new Event("securitypolicyviolation");
		Object.assign(violation, {
			effectiveDirective: "frame-src",
			blockedURI: "https://example.com",
		});
		document.dispatchEvent(violation);
		expect(document.querySelector<HTMLIFrameElement>("iframe")?.hidden).toBe(true);
		expect(document.querySelector(".praxity-embed-frame")?.textContent).toContain(
			"Open Example in a new tab",
		);
		cleanup();
	});
	it("replaces a failed iframe without affecting other frames", () => {
		document.body.innerHTML =
			'<div data-island="media" class="praxity-embed-frame"><iframe class="praxity-embed-iframe" src="https://example.com/embed"></iframe><a href="https://example.com/embed">Open Example in a new tab</a></div><iframe src="https://other.test/embed"></iframe>';
		const cleanup = initMediaEnhancements();
		document.querySelector(".praxity-embed-iframe")?.dispatchEvent(new Event("error"));
		expect(document.querySelector<HTMLIFrameElement>(".praxity-embed-iframe")?.hidden).toBe(true);
		expect(
			document.querySelector<HTMLIFrameElement>('iframe[src="https://other.test/embed"]')?.hidden,
		).toBe(false);
		cleanup();
	});
	it("starts and stops a direct video at its authored clip bounds", () => {
		document.body.innerHTML = renderBlockHtml(
			{
				id: "bounded-video",
				type: "video",
				data: { src: "assets/video.mp4", startTime: 2.5, endTime: 8 },
			} as unknown as PraxityBlock,
			{ enabledIslands: new Set(["media"]) },
		);
		const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
		const video = document.querySelector<HTMLVideoElement>("video");
		if (!video) throw new Error("Missing direct video");
		const cleanup = initMediaEnhancements();

		video.dispatchEvent(new Event("loadedmetadata"));
		expect(video.currentTime).toBe(2.5);
		video.currentTime = 9;
		video.dispatchEvent(new Event("timeupdate"));
		expect(pause).toHaveBeenCalledOnce();
		expect(video.currentTime).toBe(8);
		video.currentTime = 1;
		video.dispatchEvent(new Event("seeking"));
		expect(video.currentTime).toBe(2.5);

		cleanup();
		expect(
			document.querySelector<HTMLElement>('[data-island="media"]')?.dataset.mediaEnhanced,
		).toBe(undefined);
	});

	it("uses Vimeo's postMessage API for clip bounds and ignores other origins", () => {
		document.body.innerHTML = renderBlockHtml(
			{
				id: "bounded-vimeo",
				type: "video",
				data: {
					src: "https://vimeo.com/123456",
					startTime: 4,
					endTime: 12,
					autoplay: true,
				},
			} as unknown as PraxityBlock,
			{ enabledIslands: new Set(["media"]) },
		);
		const iframe = document.querySelector<HTMLIFrameElement>("iframe");
		if (!iframe?.contentWindow) throw new Error("Missing Vimeo iframe");
		const cleanup = initMediaEnhancements();
		if (!iframe.contentWindow) throw new Error("Missing activated Vimeo iframe");
		const postMessage = vi.spyOn(iframe.contentWindow, "postMessage").mockImplementation(() => {});
		// Navigation replaces the iframe window; Vimeo is initialized when the player loads.
		iframe.dispatchEvent(new Event("load"));

		expect(postMessage).toHaveBeenCalledWith(
			{ method: "addEventListener", value: "timeupdate" },
			"https://player.vimeo.com",
		);
		expect(postMessage).toHaveBeenCalledWith(
			{ method: "setCurrentTime", value: 4 },
			"https://player.vimeo.com",
		);
		expect(postMessage).toHaveBeenCalledWith({ method: "play" }, "https://player.vimeo.com");

		postMessage.mockClear();
		window.dispatchEvent(
			new MessageEvent("message", {
				origin: "https://attacker.example",
				source: iframe.contentWindow,
				data: { event: "timeupdate", data: { seconds: 15 } },
			}),
		);
		expect(postMessage).not.toHaveBeenCalled();

		window.dispatchEvent(
			new MessageEvent("message", {
				origin: "https://player.vimeo.com",
				source: iframe.contentWindow,
				data: JSON.stringify({ event: "timeupdate", data: { seconds: 15 } }),
			}),
		);
		expect(postMessage).toHaveBeenCalledWith({ method: "pause" }, "https://player.vimeo.com");
		expect(postMessage).toHaveBeenCalledWith(
			{ method: "setCurrentTime", value: 12 },
			"https://player.vimeo.com",
		);

		cleanup();
	});
});
