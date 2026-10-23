import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDirectVideoPlayer } from "./use-direct-video-player";

// Mock HTMLVideoElement methods that jsdom doesn't fully implement
function createMockVideoElement() {
	let _currentTime = 0;
	let _duration = 120;
	let _paused = true;
	const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

	const el = {
		get currentTime() {
			return _currentTime;
		},
		set currentTime(v: number) {
			_currentTime = v;
		},
		get duration() {
			return _duration;
		},
		set duration(v: number) {
			_duration = v;
		},
		get paused() {
			return _paused;
		},
		play: vi.fn(() => {
			_paused = false;
			return Promise.resolve();
		}),
		pause: vi.fn(() => {
			_paused = true;
		}),
		addEventListener: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
			if (!listeners[event]) listeners[event] = [];
			listeners[event].push(fn);
		}),
		removeEventListener: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
			if (listeners[event]) {
				listeners[event] = listeners[event].filter((f) => f !== fn);
			}
		}),
		emit(event: string) {
			for (const fn of listeners[event] ?? []) fn();
		},
	};
	return el;
}

describe("useDirectVideoPlayer with clip bounds", () => {
	it("seeks to startTime on loadedmetadata", () => {
		const video = createMockVideoElement();
		const ref = { current: video as unknown as HTMLVideoElement };

		renderHook(() => useDirectVideoPlayer(ref, true, { startTime: 30 }));

		act(() => {
			video.emit("loadedmetadata");
		});

		expect(video.currentTime).toBe(30);
	});

	it("keeps direct video paused after seeking to startTime when autoplay is false", () => {
		const video = createMockVideoElement();
		const ref = { current: video as unknown as HTMLVideoElement };

		renderHook(() => useDirectVideoPlayer(ref, true, { startTime: 30 }, false));

		act(() => {
			video.emit("loadedmetadata");
		});

		expect(video.currentTime).toBe(30);
		expect(video.pause).toHaveBeenCalled();
	});

	it("does not force pause after seeking to startTime when autoplay is true", () => {
		const video = createMockVideoElement();
		const ref = { current: video as unknown as HTMLVideoElement };

		renderHook(() => useDirectVideoPlayer(ref, true, { startTime: 30 }, true));

		act(() => {
			video.emit("loadedmetadata");
		});

		expect(video.currentTime).toBe(30);
		expect(video.pause).not.toHaveBeenCalled();
	});

	it("pauses at endTime during timeupdate", () => {
		const video = createMockVideoElement();
		const ref = { current: video as unknown as HTMLVideoElement };

		const { result } = renderHook(() => useDirectVideoPlayer(ref, true, { endTime: 60 }));

		act(() => {
			video.currentTime = 60;
			video.emit("timeupdate");
		});

		expect(video.pause).toHaveBeenCalled();
		expect(result.current.isEnded).toBe(true);
	});

	it("clamps seekTo to startTime", () => {
		const video = createMockVideoElement();
		const ref = { current: video as unknown as HTMLVideoElement };

		const { result } = renderHook(() => useDirectVideoPlayer(ref, true, { startTime: 30 }));

		act(() => {
			result.current.seekTo(10); // Before startTime
		});

		expect(video.currentTime).toBe(30); // Clamped to startTime
	});

	it("does not enforce bounds when clipBounds is undefined", () => {
		const video = createMockVideoElement();
		const ref = { current: video as unknown as HTMLVideoElement };

		renderHook(() => useDirectVideoPlayer(ref, true));

		act(() => {
			video.emit("loadedmetadata");
		});

		expect(video.currentTime).toBe(0); // No seek
	});

	it("handles startTime >= endTime gracefully", () => {
		const video = createMockVideoElement();
		const ref = { current: video as unknown as HTMLVideoElement };

		const { result } = renderHook(() =>
			useDirectVideoPlayer(ref, true, { startTime: 60, endTime: 30 }),
		);

		act(() => {
			result.current.seekTo(45);
		});

		expect(video.currentTime).toBe(60); // Clamped to startTime
	});
});
