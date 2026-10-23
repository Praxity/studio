export type VideoSourceTier = "full-control" | "partial-control" | "manual-mode";

export interface VideoPlayerState {
	currentTime: number;
	isPaused: boolean;
	isEnded: boolean;
	duration: number;
}

export interface ClipBounds {
	startTime?: number;
	endTime?: number;
}
