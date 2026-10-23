"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipBounds, VideoPlayerState } from "./types";

/**
 * Hook that drives the Vimeo iframe player via the @vimeo/player SDK.
 *
 * We dynamically import the SDK to avoid including ~15 KB in bundles that
 * don't use Vimeo. The import is guarded by `embedUrl` so it only runs when
 * the source is actually a Vimeo embed.
 */
export function useVimeoPlayer(
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

	const playerRef = useRef<import("@vimeo/player").default | null>(null);
	const clipBoundsRef = useRef(clipBounds);
	clipBoundsRef.current = clipBounds;

	const seekTo = useCallback(
		(seconds: number) => {
			setIsEnded(false);
			if (!playerRef.current) return;
			const clamped = Math.max(seconds, clipBounds?.startTime ?? 0);
			playerRef.current.setCurrentTime(clamped).catch(() => {});
		},
		[clipBounds?.startTime],
	);

	const play = useCallback(() => {
		playerRef.current?.play().catch(() => {});
	}, []);

	useEffect(() => {
		if (!embedUrl) return;
		const iframe = iframeRef.current;
		if (!iframe) return;

		let destroyed = false;

		async function init() {
			const { default: Player } = await import("@vimeo/player");
			if (destroyed || !iframeRef.current) return;

			const player = new Player(iframeRef.current);
			playerRef.current = player;

			player
				.getDuration()
				.then((d) => {
					if (!destroyed) setDuration(d);
				})
				.catch(() => {
					if (!destroyed) setHasError(true);
				});

			if (clipBoundsRef.current?.startTime != null) {
				player
					.setCurrentTime(clipBoundsRef.current.startTime)
					.then(() => {
						if (!autoplay) {
							return player.pause();
						}
					})
					.catch(() => {});
			}

			player.on("play", () => {
				if (!destroyed) {
					setIsPaused(false);
					setIsEnded(false);
				}
			});

			player.on("pause", () => {
				if (!destroyed) setIsPaused(true);
			});

			player.on("ended", () => {
				if (!destroyed) {
					setIsPaused(true);
					setIsEnded(true);
				}
			});

			player.on("error", () => {
				if (!destroyed) setHasError(true);
			});

			player.on("timeupdate", (data: unknown) => {
				if (destroyed) return;
				const { seconds } = data as { seconds: number };
				setCurrentTime(seconds);
				// End-time enforcement
				const endTime = clipBoundsRef.current?.endTime;
				if (endTime != null && seconds >= endTime) {
					player.pause().catch(() => {});
					if (!destroyed) {
						setIsPaused(true);
						setIsEnded(true);
					}
				}
			});
		}

		init().catch(() => {
			if (!destroyed) setHasError(true);
		});

		return () => {
			destroyed = true;
			if (playerRef.current) {
				playerRef.current.destroy();
				playerRef.current = null;
			}
		};
	}, [embedUrl, iframeRef, autoplay]);

	// Reset state when the source changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: embedUrl is the intentional trigger; ref mutations are not deps
	useEffect(() => {
		setCurrentTime(0);
		setIsPaused(true);
		setIsEnded(false);
		setDuration(0);
		setHasError(false);
	}, [embedUrl]);

	return { currentTime, isPaused, isEnded, duration, seekTo, play, hasError };
}
