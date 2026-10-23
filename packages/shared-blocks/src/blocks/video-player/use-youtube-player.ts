"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipBounds, VideoPlayerState } from "./types";

// Minimal YT.Player types — avoids pulling in the full @types/youtube package.
interface YTPlayerEvents {
	onReady?: (event: { target: YTPlayer }) => void;
	onStateChange?: (event: { data: number }) => void;
	onError?: (event: { data: number }) => void;
}

interface YTPlayer {
	getCurrentTime(): number;
	getDuration(): number;
	pauseVideo(): void;
	playVideo(): void;
	seekTo(seconds: number, allowSeekAhead: boolean): void;
	destroy(): void;
}

interface YTPlayerConstructor {
	new (element: HTMLIFrameElement, options: { events: YTPlayerEvents }): YTPlayer;
}

interface YTGlobal {
	Player: YTPlayerConstructor;
	PlayerState: { PLAYING: number };
}

declare global {
	interface Window {
		YT?: YTGlobal;
		onYouTubeIframeAPIReady?: () => void;
	}
}

/**
 * Loads the YouTube IFrame API script if not already present.
 * Returns a promise that resolves to the YT global once ready.
 */
function loadYouTubeAPI(): Promise<YTGlobal> {
	// Already loaded
	if (window.YT?.Player) return Promise.resolve(window.YT);

	return new Promise<YTGlobal>((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error("YouTube API load timeout"));
		}, 10_000);
		const existing = document.querySelector<HTMLScriptElement>(
			'script[src*="youtube.com/iframe_api"]',
		);
		const tag = existing ?? document.createElement("script");
		const failed = () => {
			cleanup();
			reject(new Error("YouTube API script unavailable"));
		};
		const cleanup = () => {
			clearTimeout(timeout);
			tag.removeEventListener("error", failed);
		};
		tag.addEventListener("error", failed, { once: true });

		// Another call may have already injected the script — just wait for the callback.
		const prev = window.onYouTubeIframeAPIReady;
		window.onYouTubeIframeAPIReady = () => {
			cleanup();
			prev?.();
			if (window.YT) resolve(window.YT);
		};

		if (!existing) {
			tag.src = "https://www.youtube.com/iframe_api";
			document.head.appendChild(tag);
		}
	});
}

/**
 * Hook that drives the YouTube iframe player via the official IFrame API.
 *
 * Uses `YT.Player` wrapping the existing iframe (requires `enablejsapi=1`
 * on the embed URL, which useVideoPlayer already appends). This replaces
 * the previous raw postMessage approach which was unreliable due to
 * origin mismatches and race conditions in published output.
 *
 * We poll every 500 ms for time updates — the YouTube IFrame API does not
 * push continuous time events, only discrete state-change events.
 */
export function useYouTubePlayer(
	iframeRef: React.RefObject<HTMLIFrameElement | null>,
	embedUrl: string,
	clipBounds?: ClipBounds,
	autoplay = false,
): VideoPlayerState & { seekTo: (seconds: number) => void; play: () => void; hasError: boolean } {
	const [currentTime, setCurrentTime] = useState(0);
	const [isPaused, setIsPaused] = useState(true);
	const [isEnded, setIsEnded] = useState(false);
	const [duration, setDuration] = useState(0);
	const [hasError, setHasError] = useState(false);

	const isPausedRef = useRef(true);
	const currentTimeRef = useRef(0);
	const playerRef = useRef<YTPlayer | null>(null);
	const readyRef = useRef(false);
	const clipBoundsRef = useRef(clipBounds);
	clipBoundsRef.current = clipBounds;

	const seekTo = useCallback(
		(seconds: number) => {
			setIsEnded(false);
			if (!playerRef.current) return;
			const clamped = Math.max(seconds, clipBounds?.startTime ?? 0);
			playerRef.current.seekTo(clamped, true);
		},
		[clipBounds?.startTime],
	);

	const play = useCallback(() => {
		playerRef.current?.playVideo();
	}, []);

	useEffect(() => {
		if (!embedUrl) return;
		const iframe = iframeRef.current;
		if (!iframe) return;

		let destroyed = false;
		let pollInterval: ReturnType<typeof setInterval> | null = null;

		async function init() {
			const YT = await loadYouTubeAPI();
			if (destroyed || !iframeRef.current) return;

			const player = new YT.Player(iframeRef.current, {
				events: {
					onReady: (event) => {
						if (destroyed) return;
						playerRef.current = event.target;
						readyRef.current = true;
						const d = event.target.getDuration();
						if (d > 0) setDuration(d);
						if (clipBoundsRef.current?.startTime != null) {
							event.target.seekTo(clipBoundsRef.current.startTime, true);
							if (!autoplay) {
								event.target.pauseVideo();
							}
						}
					},
					onStateChange: (event) => {
						if (destroyed) return;
						// YT.PlayerState: -1=unstarted, 0=ended, 1=playing, 2=paused, 3=buffering, 5=cued
						if (event.data === 0) {
							setIsEnded(true);
						} else if (event.data === 1) {
							setIsEnded(false);
						}
						const playing = event.data === 1;
						isPausedRef.current = !playing;
						setIsPaused(!playing);
					},
					onError: () => {
						if (!destroyed) setHasError(true);
					},
				},
			});

			// Poll for time updates and clip-end enforcement (only after onReady fires)
			pollInterval = setInterval(() => {
				if (destroyed || !playerRef.current || !readyRef.current) return;
				if (!isPausedRef.current) {
					try {
						const t = playerRef.current.getCurrentTime();
						currentTimeRef.current = t;
						setCurrentTime(t);

						// Also grab duration if we don't have it yet
						const d = playerRef.current.getDuration();
						if (d > 0) setDuration(d);

						// End-time enforcement
						const endTime = clipBoundsRef.current?.endTime;
						if (endTime != null && t >= endTime) {
							playerRef.current?.pauseVideo();
							isPausedRef.current = true;
							setIsPaused(true);
							setIsEnded(true);
						}
					} catch {
						// Player may have been destroyed between the check and the call
					}
				}
			}, 500);

			// If the effect is cleaned up before onReady, destroy the player.
			// Otherwise, onReady will set playerRef.current.
			if (destroyed) {
				player.destroy();
			}
		}

		init().catch(() => {
			if (!destroyed) setHasError(true);
		});

		return () => {
			destroyed = true;
			if (pollInterval) clearInterval(pollInterval);
			// Don't call player.destroy() — it removes the iframe from the DOM.
			// Just drop the reference; React will unmount the iframe element.
			playerRef.current = null;
			readyRef.current = false;
		};
	}, [embedUrl, iframeRef, autoplay]);

	// Reset state when the video source changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: embedUrl is the intentional trigger; ref mutations are not deps
	useEffect(() => {
		setCurrentTime(0);
		setIsPaused(true);
		setIsEnded(false);
		setDuration(0);
		setHasError(false);
		isPausedRef.current = true;
		currentTimeRef.current = 0;
		readyRef.current = false;
	}, [embedUrl]);

	return { currentTime, isPaused, isEnded, duration, seekTo, play, hasError };
}
