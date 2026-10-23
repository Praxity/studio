import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createElement, useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useVideoPlayer } from "./use-video-player";

afterEach(() => {
	cleanup();
	document.querySelector('script[src="https://www.youtube.com/iframe_api"]')?.remove();
	delete window.onYouTubeIframeAPIReady;
});

function YouTubeVideo() {
	const iframe = useRef<HTMLIFrameElement>(null);
	const video = useRef<HTMLVideoElement>(null);
	const player = useVideoPlayer(
		{ type: "url", src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
		iframe,
		video,
		{ clipBounds: { startTime: 12, endTime: 30 } },
	);
	return createElement("iframe", {
		ref: iframe,
		title: "Installing NVDA",
		src: player.finalEmbedUrl,
	});
}

it("keeps a named keyboard-reachable plain iframe when the YouTube API script fails", async () => {
	render(createElement(YouTubeVideo));
	const iframe = screen.getByTitle("Installing NVDA") as HTMLIFrameElement;
	const script = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
	expect(script).not.toBeNull();
	await act(async () => {
		script?.dispatchEvent(new Event("error"));
	});
	await waitFor(() => expect(new URL(iframe.src).searchParams.has("enablejsapi")).toBe(false));
	expect(screen.getByTitle("Installing NVDA")).toBe(iframe);
	expect(iframe.src).toBe(
		"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=0&start=12&end=30",
	);
	expect(iframe.tabIndex).toBe(0);
	iframe.focus();
	expect(document.activeElement).toBe(iframe);
});

describe("useVideoPlayer embed URLs", () => {
	it("marks YouTube start-time embeds as non-autoplaying by default", () => {
		const iframeRef = { current: null };
		const videoRef = { current: null };

		const { result } = renderHook(() =>
			useVideoPlayer(
				{ type: "url", src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
				iframeRef,
				videoRef,
				{ clipBounds: { startTime: 12 } },
			),
		);

		const url = new URL(result.current.finalEmbedUrl);
		expect(url.searchParams.get("enablejsapi")).toBe("1");
		expect(url.searchParams.get("autoplay")).toBe("0");
	});

	it("allows explicit YouTube autoplay", () => {
		const iframeRef = { current: null };
		const videoRef = { current: null };

		const { result } = renderHook(() =>
			useVideoPlayer({ type: "url", src: "https://youtu.be/dQw4w9WgXcQ" }, iframeRef, videoRef, {
				clipBounds: { startTime: 12 },
				autoplay: true,
			}),
		);

		const url = new URL(result.current.finalEmbedUrl);
		expect(url.searchParams.get("autoplay")).toBe("1");
	});
});
