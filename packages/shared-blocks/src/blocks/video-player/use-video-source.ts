"use client";

import { useMemo } from "react";
import type { VideoSource } from "../../types";
import type { VideoSourceTier } from "./types";
import { getSourceTier, getVideoSourceType, type VideoSourceType } from "./url-utils";

export type ExtendedVideoSourceType = VideoSourceType | "mux";

export interface VideoSourceInfo {
	source: ExtendedVideoSourceType;
	tier: VideoSourceTier;
	canPause: boolean;
	canSeek: boolean;
	hasTimeEvents: boolean;
}

export function useVideoSource(videoSource: VideoSource): VideoSourceInfo {
	return useMemo(() => {
		const source = getVideoSourceType(videoSource);
		const tier: VideoSourceTier = source === "mux" ? "full-control" : getSourceTier(source);
		return {
			source,
			tier,
			canPause: tier !== "manual-mode",
			canSeek: tier !== "manual-mode",
			hasTimeEvents: tier !== "manual-mode",
		};
	}, [videoSource]);
}
