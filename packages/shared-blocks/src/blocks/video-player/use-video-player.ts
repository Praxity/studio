"use client";

import { useMemo } from "react";
import type { VideoSource } from "../../types";
import type { ClipBounds, VideoPlayerState } from "./types";
import { isVimeoEmbed, isYouTubeEmbed, toEmbedUrl } from "./url-utils";
import { useDirectVideoPlayer } from "./use-direct-video-player";
import { useVideoSource } from "./use-video-source";
import { useVimeoPlayer } from "./use-vimeo-player";
import { useYouTubePlayer } from "./use-youtube-player";

export interface VideoPlayer extends VideoPlayerState {
	seekTo: (seconds: number) => void;
	play: () => void;
	hasError: boolean;
	embedUrl: string;
	finalEmbedUrl: string;
}

const NOOP_SEEK = () => {};
const NOOP_PLAY = () => {};
const NOOP_STATE: VideoPlayerState = {
	currentTime: 0,
	isPaused: true,
	isEnded: false,
	duration: 0,
};

export function useVideoPlayer(
	videoSource: VideoSource,
	iframeRef: React.RefObject<HTMLIFrameElement | null>,
	videoRef: React.RefObject<HTMLVideoElement | null>,
	options?: {
		clipBounds?: ClipBounds;
		autoplay?: boolean;
		enabled?: boolean;
	},
): VideoPlayer {
	const clipBounds = options?.clipBounds;
	const autoplay = options?.autoplay === true;
	const enabled = options?.enabled !== false;
	const { source } = useVideoSource(videoSource);

	const embedUrl = useMemo(() => {
		if (source === "mux" || source === "direct") return "";
		if (videoSource.type === "url") return toEmbedUrl(videoSource.src);
		return "";
	}, [source, videoSource]);

	const finalEmbedUrl = useMemo(() => {
		if (!isYouTubeEmbed(embedUrl)) return embedUrl;
		try {
			const u = new URL(embedUrl);
			u.searchParams.set("enablejsapi", "1");
			u.searchParams.set("autoplay", autoplay ? "1" : "0");
			if (typeof window !== "undefined") {
				const pageOrigin = window.location.origin;
				if (pageOrigin && pageOrigin !== "null") {
					u.searchParams.set("origin", pageOrigin);
				}
			}
			return u.toString();
		} catch {
			return embedUrl;
		}
	}, [embedUrl, autoplay]);

	const youtubeState = useYouTubePlayer(
		iframeRef,
		source === "youtube" && enabled ? finalEmbedUrl : "",
		source === "youtube" ? clipBounds : undefined,
		source === "youtube" ? autoplay : false,
	);

	const vimeoState = useVimeoPlayer(
		iframeRef,
		source === "vimeo" && enabled ? embedUrl : "",
		source === "vimeo" ? clipBounds : undefined,
		source === "vimeo" ? autoplay : false,
	);

	const directState = useDirectVideoPlayer(
		videoRef,
		enabled && (source === "direct" || source === "mux"),
		source === "direct" || source === "mux" ? clipBounds : undefined,
		source === "direct" || source === "mux" ? autoplay : false,
	);

	if (source === "youtube") {
		if (youtubeState.hasError) {
			const fallback = new URL(finalEmbedUrl);
			fallback.searchParams.delete("enablejsapi");
			fallback.searchParams.delete("origin");
			if (clipBounds?.startTime !== undefined)
				fallback.searchParams.set("start", String(Math.floor(clipBounds.startTime)));
			if (clipBounds?.endTime !== undefined)
				fallback.searchParams.set("end", String(Math.floor(clipBounds.endTime)));
			return { ...youtubeState, embedUrl, finalEmbedUrl: fallback.toString() };
		}
		return { ...youtubeState, embedUrl, finalEmbedUrl };
	}

	if (source === "vimeo") {
		return { ...vimeoState, embedUrl, finalEmbedUrl };
	}

	if (source === "direct" || source === "mux") {
		return { ...directState, hasError: false, embedUrl, finalEmbedUrl };
	}

	return {
		...NOOP_STATE,
		seekTo: NOOP_SEEK,
		play: NOOP_PLAY,
		hasError: false,
		embedUrl,
		finalEmbedUrl,
	};
}
