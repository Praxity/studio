"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipBounds, VideoPlayerState } from "./types";

/**
 * Hook that drives a native <video> element for direct video sources
 * (e.g. .mp4, .webm, .ogg files).
 *
 * Listens to timeupdate / play / pause / loadedmetadata events and enforces
 * authored clip bounds.
 */
export function useDirectVideoPlayer(
	videoRef: React.RefObject<HTMLVideoElement | null>,
	active: boolean,
	clipBounds?: ClipBounds,
	autoplay = false,
): VideoPlayerState & { seekTo: (seconds: number) => void; play: () => void } {
	const clipBoundsRef = useRef(clipBounds);
	clipBoundsRef.current = clipBounds;
	const [currentTime, setCurrentTime] = useState(0);
	const [isPaused, setIsPaused] = useState(true);
	const [isEnded, setIsEnded] = useState(false);
	const [duration, setDuration] = useState(0);

	const seekTo = useCallback(
		(seconds: number) => {
			setIsEnded(false);
			const video = videoRef.current;
			if (!video) return;
			const clamped = Math.max(seconds, clipBounds?.startTime ?? 0);
			video.currentTime = clamped;
		},
		[videoRef, clipBounds?.startTime],
	);

	const play = useCallback(() => {
		videoRef.current?.play().catch(() => {});
	}, [videoRef]);

	useEffect(() => {
		const video = videoRef.current;
		if (!video || !active) return;

		const onTimeUpdate = () => {
			const time = video.currentTime;
			setCurrentTime(time);
			// End-time enforcement
			const endTime = clipBoundsRef.current?.endTime;
			if (endTime != null && time >= endTime) {
				video.pause();
				setIsEnded(true);
			}
		};

		const onEnded = () => setIsEnded(true);
		const onPause = () => setIsPaused(true);
		const onPlay = () => {
			setIsPaused(false);
			setIsEnded(false);
		};
		const onLoadedMetadata = () => {
			setDuration(video.duration);
			if (clipBoundsRef.current?.startTime != null) {
				video.currentTime = clipBoundsRef.current.startTime;
				if (!autoplay) {
					video.pause();
				}
			}
		};
		const onDurationChange = () => setDuration(video.duration);

		video.addEventListener("timeupdate", onTimeUpdate);
		video.addEventListener("ended", onEnded);
		video.addEventListener("pause", onPause);
		video.addEventListener("play", onPlay);
		video.addEventListener("loadedmetadata", onLoadedMetadata);
		video.addEventListener("durationchange", onDurationChange);

		// If already loaded, grab the duration immediately.
		if (video.duration) setDuration(video.duration);

		return () => {
			video.removeEventListener("timeupdate", onTimeUpdate);
			video.removeEventListener("ended", onEnded);
			video.removeEventListener("pause", onPause);
			video.removeEventListener("play", onPlay);
			video.removeEventListener("loadedmetadata", onLoadedMetadata);
			video.removeEventListener("durationchange", onDurationChange);
		};
	}, [videoRef, active, autoplay]);

	// Reset state when active changes (source switch).
	useEffect(() => {
		if (!active) return;
		setCurrentTime(0);
		setIsPaused(true);
		setIsEnded(false);
		setDuration(0);
	}, [active]);

	return { currentTime, isPaused, isEnded, duration, seekTo, play };
}
